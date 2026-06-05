# Harmony Hub activity-end bug — investigation handoff

## TL;DR

The Harmony Hub at `192.168.68.62` (serial `19088003`) ends the active Harmony activity (both `Music` 53805522 and `Fire` 53803271) when the Sonos Arc reports `status: "pause"` or sustained `activity: false` over the Hub's Sonos integration. Two captured events confirm this — same trigger, two different activities. The offending notifications consistently arrive with `groupId` referencing the **Bedroom Era 100** (`RINCON_74CA607796AA01400`), strongly implying the Arc is bonded to a multi-room group whose coordinator is the Bedroom, and Bedroom-side transport state is leaking to the Arc and reaching the Hub.

The recommended fix is to extend `sonos-ws` / Neurotto to (a) ensure the Arc is its own group coordinator at the start of any Harmony Fire/Music activity, and (b) optionally rewrite or suppress the Sonos transport-state notifications that reach the Hub during active Harmony sessions.

## System topology (relevant pieces)

| Component | Address | ID |
|---|---|---|
| Harmony Hub | `192.168.68.62` | hub serial `19088003`, FW `4.15.600` |
| Hub local WebSocket | `ws://192.168.68.62:8088/?domain=svcs.myharmony.com&hubId=19088003` | hubId 19088003 |
| Sonos Arc (home theater coordinator) | `192.168.68.96` | `RINCON_38420BEE8DA901400` |
| Bedroom Era 100 (coordinator of the leaking group) | `192.168.68.90` | `RINCON_74CA607796AA01400` |
| Office Era 100 | `192.168.68.225` | `RINCON_74CA6077BA0801400` |
| Era 300 surround L | `192.168.68.233` | `RINCON_F0F6C1C88ADE01400` |
| Era 300 surround R | `192.168.68.70` | `RINCON_F0F6C1C8882201400` |
| Sub | `192.168.68.111` | `RINCON_F0F6C1EE8F3601400` |
| Home Assistant | `192.168.68.99` (HAOS) | Harmony integration via aioharmony |
| Sonos household | — | `Sonos_20GB5vetu6fpN91IHbJGNwwVF2.1cggtB4AhmAm5SlWZuP6` |
| Arc group ID (its own home-theater group) | — | `RINCON_38420BEE8DA901400:2327365778` |

The Arc is also represented inside the Harmony Hub's config as device `82995141` (the Hub's internal deviceId; not a Sonos RINCON).

Harmony activities:
- `Music` = `53805522` — Listen-to-music idle activity. Devices in activity: Samsung TV (off), Fire Cube (manual), Samsung TV(2) (manual), Emoku (manual), Emoku2 (manual), Arc (on). Volume role: Arc.
- `Fire` = `53803271` — Watch-Netflix activity. Devices: Samsung TV (on), Fire Cube (manual), Samsung TV(2) (manual), Emoku (manual), Emoku2 (manual), Arc (on). Volume role: Arc.
- `PowerOff` = `-1` — system-defined off state.

Both activities have the Arc as the volume device. The Hub's Sonos integration subscribes to Arc transport-state notifications.

## Hub local WebSocket protocol (what we observed)

Connection: `ws://192.168.68.62:8088`, sub-protocol headers as documented in `aioharmony`. Once subscribed, the Hub streams JSON messages of the form `{ "type": "...", "data": {...} }`.

Relevant message types observed during these incidents:

### `harmonyengine.metadata?notify`
Sonos device transport / metadata reports proxied through the Hub's Sonos integration. Examples:

```json
{ "type": "harmonyengine.metadata?notify",
  "data": { "musicMeta": { "deviceId": "82995141", "activity": false,
                            "groupId": "RINCON_74CA607796AA01400:2603579460" } } }
```

```json
{ "type": "harmonyengine.metadata?notify",
  "data": { "musicMeta": { "deviceId": "82995141", "status": "pause" } } }
```

```json
{ "type": "harmonyengine.metadata?notify",
  "data": { "musicMeta": { "title": "TV Audio", "service": "", "deviceId": "82995141" } } }
```

The `deviceId` here is the Hub's internal Arc id (`82995141`), not a Sonos RINCON. The `groupId` is a Sonos coordinator RINCON + a session-suffix.

### `connect.stateDigest?notify`
Hub's authoritative activity-state broadcast. The fields the Hub flips when it ends an activity:
- `activityId`: `"-1"` instead of the prior activity ID
- `activityStatus`: `0` (off) instead of `3` (running)
- `runningActivityList`: `""` (empty) — though right after the flip it briefly still lists the prior activity then clears

### `harmony.engine?startActivityFinished`
Confirms a completed activity transition. Carries `activityId` of the new state and `errorCode/errorString`.

## Captured event #1 — Music activity ended on Spotify pause (2026-04-27)

Tyler was using Spotify on a Sonos system involving the Arc. Pausing in the Spotify app caused the Music Harmony activity to end ~60 seconds later.

```
07:18:09.157  Hub <- Sonos: musicMeta { deviceId: 82995141 (Arc), activity: false,
                  groupId: RINCON_74CA607796AA01400:2603579460 (Bedroom-coordinated) }

[60s elapse]

07:19:09.493  Hub state: activityId=53805522 (Music), activityStatus=3 (running)
07:19:09.565  Sonos: musicMeta { shuffle:true, skipFwdOk:true, ... deviceId:82995141 }  (capability only)
07:19:09.614  Sonos: musicMeta { album:"BACK AND FORTH", title:"BACK AND FORTH",
                  service:"Spotify", artist:"SEBASTIAN PAUL", deviceId:82995141 }
07:19:09.661  Hub state: activityId=-1 (PowerOff), activityStatus=0
07:19:09.662  Harmony: "Powering off from activity: PowerOff(-1)"
07:19:09.726  startActivityFinished: activityId=-1, errorCode 200 OK
07:19:09.727  HA reflects: activity (-1, 'PowerOff') started
```

The HA `states` table for the Harmony entity has no `context_user_id` and no `context_parent_id` on the off events — the off originated from the Hub itself, not from any HA service call, automation, webhook, or user.

## Captured event #2 — Fire activity ended mid-Netflix (2026-04-29)

Tyler was actively watching Netflix on Fire activity for ~18 minutes (started 18:27:05). Same pattern fires:

```
18:44:12.202  Hub <- Sonos: musicMeta { deviceId: 82995141 (Arc), activity: false,
                  groupId: RINCON_74CA607796AA01400:2603579462 (Bedroom-coordinated) }

[60s elapse]

18:45:12.653  Hub state: activityId=53803271 (Fire), activityStatus=3 (running)
18:45:12.802  Sonos: musicMeta { status:"play", repeatOk:false, skipFwdOk:false, deviceId:82995141 }
18:45:12.931  Sonos: musicMeta { title:"TV Audio", service:"", deviceId:82995141 }
18:45:13.065  Sonos: musicMeta { groupVolume:24, deviceId:82995141 }
18:45:13.196  Sonos: musicMeta { volumeLevel:24, mute:false, deviceId:82995141 }
18:45:14.746  Sonos: musicMeta { status:"pause", deviceId:82995141 }   ← TRIGGER
18:45:14.889  Hub state: activityId=-1 (PowerOff), activityStatus=0   (143 ms after pause)
18:45:14.890  Harmony: "Powering off from activity: PowerOff(-1)"
18:45:15.011  startActivityFinished: activityId=-1, errorCode 200 OK
18:45:42.338  Hub WebSocket disconnect + reconnect (post-power-off side effect)
```

Tyler did not pause Netflix; he was actively watching. The Arc transport state nevertheless flipped from `play` → `pause`, which the Hub interpreted as activity-end.

## Root-cause hypothesis (combining both events)

1. The Sonos Arc is currently a member of a multi-room Sonos group whose coordinator is the **Bedroom Era 100** (`RINCON_74CA607796AA01400`). This is residual state from prior Neurotto regrouping operations.
2. When the Bedroom-coordinator changes transport state (Spotify pause, music ending, Alexa routine, etc.), Sonos propagates that state to all members of the group, including the Arc.
3. The Arc reports its (now group-inherited) transport state to the Harmony Hub via the Sonos→Hub integration as `harmonyengine.metadata?notify { musicMeta: { activity:false } }` and/or `{ status: "pause" }`.
4. The Harmony Hub treats this as "primary media device stopped" and ends the active Harmony activity (after a ~60s grace, or immediately on `status:"pause"` if a prior `activity:false` already armed the timer).
5. The activity-end macro fires, which includes powering the TV off. Tyler observes "TV suddenly went off mid-Netflix" or "Music activity ended overnight."

Both events show the same `groupId: RINCON_74CA607796AA01400:...` pattern, supporting the cross-room leakage theory. The Bedroom is the consistent source of the offending `activity:false` notifications.

This is a Hub-side rule, not a Logitech-cloud or HA-side rule. The HA logbook attributes the off to no user, no automation, no webhook, no service call. The Hub independently flips `activityId` to `-1` after receiving the Sonos transport notification.

## Why this isn't a button-mapping issue

Tyler initially suspected the Harmony remote's Pause button (which is mapped to Emoku → Neurotto → Sonos.pause on the Arc). The Spotify-pause event refutes this — Tyler paused via the Spotify app on his phone, the Harmony remote was untouched, and the Hub still ended the Music activity. The Netflix event reinforces it — Tyler didn't pause anything; the pause came from Sonos's own group-state propagation.

The trigger is **any path that produces `status: "pause"` on the Arc**, including paths Neurotto/Emoku never see (Spotify app pause, Alexa routine, Sonos app pause, group-coordinator pause, etc.).

## Recommended fix paths (in order of leverage)

### (1) Ungroup the Arc when Harmony Fire/Music activity starts (preferred)

Have Neurotto subscribe to Harmony Hub state changes (it can either (a) consume HA's `state_changed` events for `select.harmony_activities`, or (b) connect directly to the Hub WebSocket alongside HA — the Hub supports multiple subscribers).

When the activity transitions to `Music` or `Fire`:
1. Use `sonos-ws` to call `Groups.modifyGroupMembers` (or whatever the equivalent is — `createGroup`/`leaveGroup` style) to make the Arc its own group coordinator. Use `householdId: Sonos_20GB5vetu6fpN91IHbJGNwwVF2.1cggtB4AhmAm5SlWZuP6` and target Arc group `RINCON_38420BEE8DA901400:2327365778`.
2. Verify by polling `Groups.getGroups` or subscribing to group changes that the Arc is now its own coordinator.

This stops Bedroom-side transport state from ever reaching the Arc, which stops the Hub from ever receiving spurious `status:"pause"` for the Arc.

Caveats:
- If Tyler intentionally has multi-room audio playing during a Harmony activity (e.g., listening to music in multiple rooms while Music activity is active), this fix breaks that intent. Confirm with him whether that's a real use case or just a side effect of past testing.
- Need to handle the inverse: when activity ends to PowerOff, optionally restore prior grouping. Or just leave the Arc ungrouped — Tyler can regroup deliberately as needed.

### (2) Suppress / rewrite Sonos→Hub transport notifications

The Hub doesn't connect *to* `sonos-ws` — it talks to the Arc via Sonos's own UPnP/WS protocol. So Neurotto can't sit in-between the Hub and the Arc transparently. But Neurotto **can** post fake notifications onto the Hub's local WebSocket if the Hub accepts client-injected `harmonyengine.metadata?notify` messages (untested — needs investigation).

Two sub-options:
- **2a:** As soon as a `status:"pause"` lands on the Arc while Harmony is in Fire/Music, Neurotto immediately resumes Arc playback (or at least pushes a fake `status:"play"` to the Hub, if the Hub accepts it) to prevent the activity-end flip.
- **2b:** Reconfigure the Sonos Arc so it never reports `activity:false`/`status:"pause"` for TV-input streams. Probably not configurable on Sonos side; included for completeness.

### (3) Reactive re-arm via Neurotto

Subscribe to Hub WebSocket. When `connect.stateDigest?notify` flips to `activityId:"-1"` and the previous activity was Fire/Music within the last N seconds, immediately call back into the Hub with `harmony.engine?startactivity` (`activityId: <prior>`) to re-arm. Visible side effect: TV blinks off then back on. Functionally restores playback but with a perceptible glitch.

### (4) Remove the Arc from the Harmony activities entirely

Re-architect: Harmony activities don't include the Arc as a device at all. Volume buttons in any activity route through Neurotto → sonos-ws directly to the Arc. The Hub never subscribes to Arc transport state, so no activity-end trigger. Most invasive but most permanent.

## Specific implementation suggestions for sonos-ws / Neurotto

The library already covers the Sonos-side primitives needed for fix (1):
- `client.groups.getGroups()` — discover current group topology
- `client.groups.modifyGroupMembers(...)` or `client.groups.createGroup(...)` — pull Arc into its own group
- Subscribe to `groupsChanged` to verify

Missing pieces in the codebase (as of this handoff) that would benefit from being added:
- A Harmony Hub WebSocket client. The `aioharmony` Python lib in HA does this; you'd want a Node/TS analogue. The Hub local WS speaks the protocol shown in the captured events (no auth — once you know the hubId you connect over plain `ws://`). For a starting point, mirror the structure of `aioharmony.hubconnector_websocket`.
- An "ActivityWatcher" abstraction in Neurotto that:
  1. Connects to the Hub's WS
  2. Tracks the current `activityId` from `connect.stateDigest?notify`
  3. Emits events `activityChanged(prev, next)`
  4. Allows Neurotto to wire side-effects: on `Music`/`Fire` start → ungroup Arc; on `PowerOff` → optional restore.

## Useful references in Tyler's setup

- `~/projects/harmony/all_fixes.md` — full Harmony reset/configuration plan, with Music/Fire activity definitions
- `~/projects/harmony/harmony_config_report.md` — exported Harmony Hub config (devices, activities, button mappings)
- `~/projects/harmony/handoff/SESSION_BRIEFING.md` — sonos-ws library architecture and integration plan
- HA at `192.168.68.99` — Harmony debug logging is currently enabled (`logger.logs.aioharmony: debug` and `homeassistant.components.harmony: debug`) and should be left on for verification of any fix
- HA recorder DB at `/config/home-assistant_v2.db` on the HAOS host — useful for context-id-level forensics on any state change

## Verification approach for any proposed fix

1. With debug logger still enabled, deliberately trigger the historical failure mode:
   - Music: pause Spotify on a Bedroom-grouped Sonos.
   - Fire: pause whatever's playing in a Bedroom-coordinated group while a different Fire/Netflix session is active.
2. After the deliberate trigger, wait ≥90 seconds (covers the ~60s grace + headroom for the immediate-pause-triggered case).
3. Confirm:
   - HA `select.harmony_activities` did NOT change to `power_off`.
   - The Hub WS log shows the offending `status:"pause"` arrived but the Hub did NOT emit `connect.stateDigest?notify { activityId:"-1" }`.
4. Repeat 3× across different group topologies and audio sources.

When verified, the debug logger can be removed:
```yaml
# remove from configuration.yaml
logger:
  default: warning
  logs:
    homeassistant.components.harmony: debug
    aioharmony: debug
```
Backup of the original `configuration.yaml` is at `/config/configuration.yaml.bak.<timestamp>` on HAOS.

## Open questions for the next session

1. Why is the Arc currently bonded to a Bedroom-coordinated group? Is this expected (Tyler's intentional multi-room setup) or residual (stale Neurotto operation that didn't clean up)?
2. Does the Hub accept client-injected `harmonyengine.metadata?notify` messages, or does it only consume those from its own Sonos polling? (Determines viability of fix path 2a.)
3. Is there a Hub-side configuration toggle for the "media-stopped → activity-end" rule that we missed? (Logitech docs are sparse; haven't found one in the mobile app to date.)
4. Confirm the 60-second grace timer behavior: is it reset by intermediate `status:"play"` messages? The Fire event suggests yes (60s passed, then a play→pause sequence triggered immediate end), but cleaner empirical confirmation would help.
