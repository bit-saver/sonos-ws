# Audio Transfer by Music Context — Design

**Date:** 2026-10-03
**Status:** Approved 2026-10-03 20:31 CDT; the owner asked to go straight through plan, build and deploy.

## Why

`household.group([Arc], { transfer: true })` from `( Office + Bedroom )` takes about 20 s, so Home Assistant's 10 s
`rest_command.group` times out on every morning regroup (09-29 through 10-03). Neurotto's detail log for 10-03 06:44:23
shows where the time goes in `GroupingEngine.transferAudio()`:

| Step | What | Took |
|---|---|---|
| 2 | Bedroom (source coordinator) adds the Arc | 68 ms |
| 3 | the shuffle: Bedroom removes itself; Sonos makes **Office** coordinator, not the Arc | 7 s |
| 4 | `pollUntil(Arc is coordinator)` — cannot succeed, burns `POLL_DEADLINE_MS` | 8 s |
| 5 | the Arc's group drops Office: a second coordinator move | 3.7 s |

The shuffle also caused 25 of the 26 `Failed to restore event subscriptions` warnings logged since 09-28 (five per
morning `group arc`; `group eras` and `ungroup` log none).

## What Sonos offers

`groups:1 createGroup` takes `{ playerIds, musicContextGroupId }`. Sonos's reference
(docs.sonos.com/reference/groups-creategroup-householdid): *"(Optional) The group containing the audio that you want to
use. If empty or not provided, the new group will not contain any audio."* The library's `createGroup(playerIds)` never
sends it.

## Live probe

2026-10-03, about 19:30–20:00 CDT, built library at `bd688f1`, Spotify Connect playing "Discover Weekly":

| Transfer | `createGroup` answered | target coordinating and PLAYING |
|---|---|---|
| Office → Bedroom | 568 ms | 1273 ms |
| ( Office* + Bedroom ) → Arc — the morning case | 3236 ms | 3263 ms |
| ( Arc* + Bedroom ) → Bedroom — target inside the source group | 2129 ms | 2167 ms |
| Bedroom → Office | 607 ms | 629 ms |

- It is a move: the source group goes to PAUSED and the Spotify session follows the target.
- The source group's other members stay grouped (`( Office* + Bedroom )` paused). Today's shuffle ends with them solo.
- A target inside the source group is pulled out into its own group with the audio; the rest stay behind.
- The answer arrives once the target's group exists: the first `getGroups` after it already shows the target
  coordinating.
- No restore-subscription warnings during any of these transfers.
- For comparison, a two-speaker shuffle (`( Bedroom* + Office )`, Bedroom removes itself) answered OK in 40 ms, moved
  nothing and paused the music. Not investigated: this design removes the shuffle.
- `playback.stop()` answers `ERROR_UNSUPPORTED_COMMAND` for Spotify Connect, so a leftover stays PAUSED.

## What already exists

- `src/namespaces/GroupsNamespace.ts:28` — `createGroup(playerIds)`, the command this design extends.
- `src/household/GroupingEngine.ts:279` — `transferAudio()`: Step 2 add (:296), Step 3 shuffle (:303), Step 4 poll
  (:314), Step 5 second move (:322).
- `GroupingEngine.ts` helpers kept as they are: `pollUntil` (:345), `withRetry` (:369), `simpleGroup` (:244),
  `refreshAndSnapshot` (:390). `isExpectedShuffleError` (:383) exists only for the shuffle.
- `GroupingEngine.ts:129` — `ungroupAll()`: splits each multi-player group with `createGroup([id])` per non-coordinator,
  inline.
- `GroupingEngine.ts:89` — `group()`'s comment on the three audio-source cases; case 3's rationale names the shuffle.
- `tests/household/GroupingEngine.test.ts:10` `makeTopology`, `:14` `mockHandle`, `:35` the three-solo-group fixture.
  No test covers a transfer today.

## New names and files

- The optional `musicContextGroupId` parameter of `GroupsNamespace.createGroup` — public, because the namespace is the
  library's one wrapper per Sonos command; it carries the field Sonos defines.
- A private `GroupingEngine` helper, `ungroupMembers(group)`, holding the split that `ungroupAll()` now does inline —
  `transferAudio()` needs the same split for its leftovers, and one copy beats two.

No new files.

## Design

`GroupsNamespace.createGroup(playerIds, musicContextGroupId?)` — the body carries `musicContextGroupId` only when given.

`GroupingEngine.transferAudio(source, targetCoordinator, allMemberIds)` becomes:

1. Inside `withRetry`: refresh, find the source's group (throw `GROUP_OPERATION_FAILED` if there is none, as today),
   then `householdGroups.createGroup([target.id], sourceGroup.id)`. Reading the group inside the closure means the retry
   after `groupCoordinatorChanged` uses the fresh group ID.
2. `pollUntil(target coordinates a group)`; on timeout keep today's warn and continue. Insurance only: every probe had
   the target coordinating on the first read.
3. `simpleGroup(target, allMemberIds)` adds the other requested members. With a single target it sends nothing.
4. Leftovers: members of the source group that were not requested and still share a group with another player. Each
   such group goes through `ungroupMembers()`.

Removed: the shuffle (Step 3), the 8 s poll that could not succeed, Step 5's second move, `isExpectedShuffleError()`.
The case-3 comment in `group()` loses its shuffle rationale; the behavior it describes is unchanged.

## Behavior

- `group arc` from `( Office + Bedroom )`: about 3.3 s for the transfer plus one `createGroup` to split the leftovers
  (0.3–0.6 s per command in the probe). End state as today: `| Arc | Office | Bedroom |`, the Arc playing.
- Unchanged: which calls move audio. `group eras` while the Arc plays still groups without moving the audio (case 3);
  `group arc`, `group office`, `group bedroom` move it. Explicit-source validation and `ERROR_NO_CONTENT` are unchanged.
- If Sonos refuses a `createGroup` with a music context, `group()` rejects with Sonos's `CommandError`.

## Not doing

- Skipping membership re-sends on incomplete snapshots (handoff action 2). The shuffle produced 25 of the 26 warnings;
  the remaining one (`group all`, 10-03 10:55) came from a complete but transient snapshot, which a completeness check
  would not catch. Revisit if the warnings persist after deploy.
- Auto-transfer into a multi-player target still leaves audio found outside it where it is (case 3).
- Moving TV audio (the Arc's HDMI input) off the Arc: unverified. No Neurotto command did it since 09-28, and the
  shuffle was never verified for it either.
- Neurotto answering HA before the regroup finishes: the Neurotto session's call.

## Testing

`tests/household/GroupingEngine.test.ts` gains the first transfer tests. Its fake topology applies the semantics the
probe observed: `createGroup` with a music context moves the target into its own group carrying the source's playback
state, and the source group keeps the rest, PAUSED.

1. `group([Arc], { transfer: true })` from `( Bedroom* + Office )` playing: `createGroup(['Arc'], <source group id>)`,
   no shuffle, then `createGroup(['Office'])` for the leftovers. End: three solo groups, the Arc's PLAYING.
2. Target inside the source group, `( Bedroom* + Arc )` playing: `createGroup(['Arc'], <id>)`; Bedroom is left solo,
   so no leftover split.
3. Explicit transfer to two speakers, `group([Arc, Office], { transfer: { id: Bedroom } })` from
   `( Bedroom* + Office )`: `createGroup(['Arc'], <id>)`, then the Arc's group adds Office; no leftover split.
4. `GroupsNamespace.createGroup` sends `musicContextGroupId` only when given.

Mutation-verify: dropping the music context fails test 1; skipping the leftover split fails test 1.

Live, before deploy: time the built library's `group([Arc], { transfer: true })` from a playing `( Office + Bedroom )` —
target playing in under 5 s, end state three solo groups. After deploy: the next morning `group arc` in Neurotto's log.

## Ship

`npm run build`, merge to `main`, message the House of Auto session with the sha, diff summary and tests, then bump
Neurotto's pin and deploy per memory `feedback_deploy_sonos_ws_to_neurotto`.
