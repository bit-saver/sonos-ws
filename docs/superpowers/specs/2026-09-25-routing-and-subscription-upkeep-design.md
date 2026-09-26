# Command Routing, Subscription Upkeep and SonosClient — Design

**Date:** 2026-09-25
**Status:** APPROVED 2026-09-26 — implementation plan `docs/superpowers/plans/2026-09-26-routing-and-subscription-upkeep.md`.
**Branch:** `routing-and-subscription-upkeep`

## Problem

A review of the codebase after the lifecycle release turned up four live bugs and a set of smaller defects. Each bug below was reproduced against the real speakers (Arc `.96`, Office `.225`, Bedroom `.90`) with throwaway probe scripts; the speakers were idle, and every grouping and volume was restored afterwards.

### 1. Playback commands go through the wrong socket

A group-level command must go through the group coordinator's socket. `VolumeControl.group` learned this in `cb4ce85`; `PlaybackControl`, `FavoritesAccess.load` and `PlaylistsAccess.load` never did — `PlayerHandle` builds them on the player's own socket (`PlayerHandle.ts:102-104`). With Office grouped under Bedroom:

| Sent through Office's own socket (Office not coordinator) | Result |
|---|---|
| `playback:1` `getPlaybackStatus`, `pause`, `subscribe` | `groupCoordinatorChanged` failure |
| `playbackMetadata:1` `getMetadataStatus`, `subscribe` | `groupCoordinatorChanged` failure |
| `playerVolume:1` `getVolume`, `subscribe` | works |
| `settings:1` `getPlayerSettings` | works |
| `favorites:1` `getFavorites`, `playlists:1` `getPlaylists` | works |

The same `playback:1` commands succeed through Bedroom's socket. So Neurotto's `play`/`pause`/`skip` on any speaker that is grouped but not leading its group fails today. `loadFavorite` and `loadPlaylist` were not live-tested (a success would start audio); they target a group, so they get the same routing.

### 2. Subscriptions die silently

Two mechanisms, both observed:

- **A regroup kills group-level subscriptions.** When Office joined Bedroom's group, Office's socket received `groupCoordinatorChanged` with `GROUP_STATUS_GONE`, and when it left it came back under a new group ID. Across three probe regroups Office's group ID went `…:2291886207` → `…:2291886210`. A `groupVolume:1` or `playback:1` subscription names a group ID, so it is dead from the first regroup on. A coordinator that keeps its group keeps its ID and its subscriptions — Bedroom's stayed `…:2603579627` throughout.
- **A speaker socket that reconnects loses everything.** The household re-subscribes only when the *primary* socket reconnects (`SonosHousehold.ts:603-609`). A per-speaker socket that drops and recovers on its own ladder comes back with no subscriptions.

Neurotto's diagnostic logging from `692c95d` depends on exactly these subscriptions, so the Arc's volume and playback diagnostics stop after its first regroup.

### 3. Updates from non-primary sockets never reach listeners

`SonosHousehold` listens for events only on the primary socket (`SonosHousehold.ts:188`). An event from a subscription on any other speaker's socket is logged by `SonosConnection` and then dropped. After fix 1, playback subscriptions for a group led by Office live on Office's socket, so this gap would swallow them.

### 4. `SonosClient` does not work at all

`SonosClient` — the README's Quick Start — sends `getGroups` without a household ID. Every speaker rejects that (`success:false`, `type:globalError`), `send()` throws, the catch logs a warning, and no player handle is created. Against Office with the shipped `dist/`: `connect()` resolves, `householdId` is `undefined`, and `client.volume` throws `Not connected — call connect() first`. It also emits `connected` twice per connect (`SonosClient.ts:98` and `:137`). Even with a household ID it would pick `groups[0]`, which is not necessarily the speaker it connected to; the response headers do not identify the connected player, but each player's `websocketUrl` carries its IP.

### Smaller defects

- `VolumeControl.group.relative` (`VolumeControl.ts:98-121`) accepts a `groupVolume` event for any group on the socket; if both the event and the fallback `getVolume` fail it returns a fabricated `{volume:0}`; and if `setRelativeVolume` rejects, its listener and timer live on and send a stray `getVolume` two seconds later. Live check: `getVolume` sent immediately after `setRelativeVolume` returns the *old* value, so waiting for the event is the right design and stays.
- `SonosConnection.send()` waits while `'reconnecting'` but throws while `'connecting'` (`SonosConnection.ts:344-349`). Every ladder attempt passes through `'connecting'` (`connect()` sets it at `:167`), so a command landing in an attempt's handshake window — up to `connectTimeout`, 10 s — fails instead of waiting like the rest of the reconnect.
- `SonosHousehold.connect()` attaches its five connection listeners again on every call (`:177-188`), and so does `SonosClient.connect()`.
- `handleReconnected()` runs are fire-and-forget with no guard (`:177-184`); a connection that flaps mid-setup starts a second run over the first.
- A reconnect-branch setup abort (`:599-601`) is swallowed without a log line; only the first-connect branch logs.
- The coordinator resolver is written out twice (`:375-383`, `:546-553`) and reads the private `handle['_group']`. It finds the primary speaker only by falling through a failed map lookup. Handles created after setup (a new speaker, or `autoConnect: false`) never get a resolver.
- `playbackMetadata:1` events exist in the event map but nothing can subscribe to them.
- `BaseNamespace.resubscribe()` and `isSubscribed` have no callers; the household re-subscribes player volume by hand instead.
- `crypto.randomUUID()` is used as a global (`BaseNamespace.ts:99`, `SonosHousehold.ts:450`, `SonosClient.ts:108`), but `engines` says `node >=18`, and Node 18 exposes the global only behind a flag.
- `examples/smoke.ts` documents `npx tsx`, and `tsx` is not a devDependency.
- A leftover docstring for `subscribeToTopology` sits above `subscribeDiagnostics` (`:297-302`).
- The event and send log lines do not say which speaker's socket they came from, which made today's diagnosis slower than it needed to be.

## Decisions

- **Updates from every speaker reach listeners, tagged with their source.** Tyler's choice, 2026-09-25, over keeping events Arc-only. Known cost: Neurotto's `volumeChanged` listener, which logs `Volume: N`, will also log Office and Bedroom group volume until the Neurotto session filters on the tag. A handoff note goes to Neurotto.
- **Subscriptions are kept alive by re-sending, not by bookkeeping.** Live check: subscribing twice to the same target on one socket yields one event per change, and a single `unsubscribe` removes it. So re-sending every wanted subscription after any change is safe and needs no registry. A reference-counted registry was the alternative; it would also handle the one case re-sending does not (below), at the cost of state that must itself be kept correct across regroups and reconnects.
- **`send()` waits while `'connecting'`**, bounded by `connectTimeout`. The previous session parked this as a UX question; the ladder's own `'connecting'` window makes it a bug, since the documented behavior is that commands wait out a reconnect.
- **`SonosClient` is fixed, not deprecated.** It is the README's first example.

## Design

### Routing

- `PlayerHandle` passes the coordinator context to `PlaybackControl` (both `playback:1` and `playbackMetadata:1`), and to `FavoritesAccess` and `PlaylistsAccess` for `load` only; their `get` calls stay on the speaker socket.
- `PlayerHandle` gains a public `coordinatorId` getter, next to `isCoordinator`.
- `SonosHousehold` gets one private `connectionForPlayer(playerId)`: the speaker's own connection, else the primary. That fallback is correct for the primary speaker, which reuses the primary connection and so has no entry of its own, and is today's best effort under `autoConnect: false`. The coordinator resolver is `() => connectionForPlayer(handle.coordinatorId)`, set once when `refreshTopology` creates the handle. Both copies of the resolver go.

### Subscription upkeep

- `BaseNamespace` records the subscription *intent* before sending: `subscribe()` sets it, `unsubscribe()` clears it, and both still send immediately so the caller sees any error. An intent survives a failed send, so a subscribe attempted while a socket is down is retried when it comes back. `resubscribe()` (existing, currently unused) re-sends when the intent is set; `isSubscribed` reports the intent.
- Each control that owns subscribable namespaces gets an internal `resubscribe()`. `PlayerHandle.resubscribe()` attempts every one — a failure does not stop the rest — and then rejects with an `AggregateError` of the failures, if any. The household logs it.
- `PlaybackControl` gains `subscribeMetadata()` / `unsubscribeMetadata()`. `subscribe()` keeps covering playback only, so existing subscribers do not start receiving large metadata events.
- `SonosHousehold.resubscribeAll()` calls `resubscribe()` on every handle and logs each failure. It runs:
  - at the end of first-connect setup and of every primary reconnect, replacing the hand-written player-volume loop;
  - when any per-speaker socket emits `connected` (a listener attached where the household creates speaker connections);
  - after `refreshTopology` whenever group *membership* changed — group IDs, coordinators or members, deliberately excluding `playbackState`, which changes on every play/pause.
- `subscribeDiagnostics()` keeps its role: it declares the diagnostic intents once at setup. Upkeep is `resubscribeAll()`'s job.

Not handled, documented instead: an `unsubscribe()` on a group-level namespace removes that group's subscription from the coordinator's socket for every handle in the group, until the next `resubscribeAll()` puts back the ones still wanted. And a consumer that subscribed only one player keeps receiving its old group's events after that player moves; the source tag lets it tell.

### Event forwarding

- The household listens for `message` on every connection it owns, not only the primary.
- Every typed event and `rawMessage` gets a second argument, `source: EventSource = { playerId?: string; groupId?: string }`, copied from the event headers — player-level events carry `playerId`, group-level events carry `groupId` (both verified live). Additive: a one-argument listener still type-checks and still runs. `SonosClient` passes the same.
- `groupCoordinatorChanged` now arrives from several sockets at once during a regroup, so it schedules the debounced topology refresh instead of refreshing immediately.
- `SonosConnection` log lines name the socket's host after the namespace, so existing greps keep working: `Event: playerVolume:1.playerVolume @192.168.68.90 {…}` and `Sending playback:1.pause @192.168.68.90 [cmdId]`.

### Lifecycle

- `SonosHousehold` attaches its connection listeners once, in the constructor. `connect()` creates a fresh pending-setup promise on the instance; the `connected` handler settles it.
- `handleReconnected()` runs are serialized on a promise chain, so a flap during setup queues the next run behind the current one instead of interleaving with it.
- The reconnect branch logs its setup abort before rethrowing.
- `SonosConnection.send()` in `'connecting'` awaits the in-flight connect promise (which always settles — an invariant this repo already enforces), then falls into the existing `'reconnecting'` wait or the open-socket check.

### SonosClient

- Listeners attach once, in the constructor.
- Setup discovers the household ID from the error response (one helper shared with `SonosHousehold`), then reads groups with it and picks the player whose `websocketUrl` host equals the configured host. No match rejects `connect()` with `PLAYER_NOT_FOUND`, listing the hosts Sonos reported — a DNS name for the host is therefore not supported, and the error says so.
- `connect()` rejects when setup fails, rather than resolving with no handle. `connected` fires once per successful connect or reconnect.
- On reconnect the client updates its existing handle's group and calls `handle.resubscribe()`, instead of building a new handle that has forgotten its subscriptions.

### Smaller fixes

- `VolumeControl.group.relative` matches only events whose `groupId` is its own group's, rejects instead of fabricating a volume, and tears down its listener and timer when `setRelativeVolume` rejects.
- `randomUUID` is imported from `node:crypto`.
- `tsx` becomes a devDependency.
- The stray docstring moves back onto `subscribeToTopology`.

## Out of scope

- `connectTimeout` validation. The option is not reachable from `SonosHouseholdOptions` or `SonosClientOptions`, so there is nothing to validate until it is exposed.
- `autoConnect: false` still routes coordinator commands through the primary, because it opens no per-speaker sockets. Unchanged; documented on the option.

## Testing

- Unit tests first for each change (TDD), in the existing vitest files and mocks. The `ws` mock's throw-on-unlistened-`'error'` stays.
- Mutation-verify every test that guards an invariant: routing, re-subscribe triggers, the listener-once guarantee, serialized setup, `send()` while connecting.
- Live, after the build, with Office and Bedroom idle and restored afterwards: through the built library, `play`/`pause` on a grouped non-coordinator succeeds; a subscription survives a regroup and keeps delivering tagged events; `examples/smoke.ts` runs `SonosClient` end to end against Office.
- Deploy to Neurotto by the standing recipe, then confirm health, three sockets, and tagged `Event:` lines in `neurotto.detail.log`.

## Follow-ups outside this repo

- Neurotto handoff: `volumeChanged` now fires for every group; filter on `source.groupId` (the Arc's group) or listen to `playerVolumeChanged` with `source.playerId`.
- Update memory `project_external_volume_controller` for the new log format, and `feedback_sonos_api_constraints` with the routing table, the group-ID churn and idempotent subscribe.
