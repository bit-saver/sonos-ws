# Audio Transfer by Music Context — Design

**Date:** 2026-10-03
**Status:** Approved 2026-10-03 20:31 CDT; the owner asked to go straight through plan, build and deploy. Amended the
same evening after the whole-branch review: the source is left paused, not idle, so the single-player source search
gained a guard (Behavior). **Superseded by the 2026-10-05 fourth addendum at the end:** transfers only move the source
group with `setGroupMembers`; the copy failed in production and in later live checks (the addenda in between are the
history).

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
  (0.3–0.6 s per command in the probe). Through the library on the built branch: 913 ms, 530 ms (paused audio) and
  once 21 s — the Arc played within a second, but Sonos held the `createGroup` answer until the old group paused 20 s
  later; the next run was 913 ms.
- End state: `| Arc | Office | Bedroom |`, the Arc playing, as today — except that the source group's coordinator is
  left PAUSED holding the old audio, where the shuffle left it idle (`| 󰐊 Arc | 󰏤 Office | Bedroom |` in Neurotto's
  log). Home Assistant's player for that speaker reads paused.
- So that a paused leftover never undoes a transfer, the single-player source search skips PAUSED groups when the
  target is already PLAYING: a repeated `group arc` is a no-op, and `group arc` from a playing `( Arc* + Bedroom )`
  only splits Bedroom off. Before, both would have moved the paused audio onto the Arc and stopped its music.
- A paused leftover can still be chosen when nothing plays: `group eras` with both idle except a paused Office makes
  Office its coordinator, carrying the old audio (case 2), where Bedroom used to coordinate.
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
5. A playing target with only paused audio elsewhere: no command.
6. A playing `( Arc* + Bedroom )` with Office paused, `group([Arc], { transfer: true })`: only
   `createGroup(['Bedroom'])`.

Mutation-verify: dropping the music context fails tests 1–3; skipping the leftover split fails test 1; dropping the
guard fails tests 5 and 6.

Live, before deploy: time the built library's `group([Arc], { transfer: true })` from a playing `( Office + Bedroom )` —
target playing in under 5 s, end state three solo groups. After deploy: the next morning `group arc` in Neurotto's log.

## Ship

`npm run build`, merge to `main`, message the House of Auto session with the sha, diff summary and tests, then bump
Neurotto's pin and deploy per memory `feedback_deploy_sonos_ws_to_neurotto`.

## 2026-10-04 addendum: move the group, don't copy its audio

**Status:** Approved by the owner 2026-10-04 08:19 CDT. House of Auto agreed and set the live check below.

### What went wrong

Deployed 10-03 21:08 (pin `2d3e324`). At 10-04 06:30 the morning `group arc` failed outright: `createGroup` answered in
11 ms, nothing moved, and `group()` rejected; HA's retry at 06:30:33 failed the same way. Neurotto returns that error
to its caller without logging it. Reproduced at 08:04 on the paused ( Office + Bedroom ) session:

    ERROR_PLAYBACK_FAILED: "musicContextGroupId music context content cannot be copied"

The 10-03 probes all moved a Spotify playlist context (`playlist.spotify.connect`), which Sonos copies. The morning group
held a bare Spotify Connect session (`spotify.connect`), which it refuses to copy. The shuffle never copied anything,
so it worked for that content, slowly. Neurotto was rolled back to `bbdafee` at 08:06 (Neurotto commit `97f0bd9`).

### What Sonos offers instead

`groups:1 setGroupMembers { playerIds }` on a group "replaces the players in an existing group with a new set". The
group keeps its own session, so nothing is copied. Silent probes 10-04 on the paused bare session:

| Command | Answered | Settled | End |
|---|---|---|---|
| `setGroupMembers([Office])` on `( Office + Bedroom* )` — target inside | 670 ms | < 1.9 s | Office* holds the session; Bedroom IDLE |
| `setGroupMembers([Bedroom])` on solo Office — target outside | 283 ms | 0.72 s | Bedroom* holds the session; Office IDLE |

The answer arrives once Sonos has added the target; it removes the others just after (a read at 0.51 s showed
`( Office* + Bedroom )`). The players removed end IDLE — the end state the shuffle used to leave.

### Design

`transferAudio(source, targetCoordinator, allMemberIds)`:

1. Inside `withRetry`: refresh, find the source's group (throw `GROUP_OPERATION_FAILED` if none), then the group's
   coordinator handle sends `setGroupMembers([target.id])`.
2. `pollUntil` the target coordinates a group holding none of the source group's other members; warn on timeout and
   continue, as before.
3. `simpleGroup(target, allMemberIds)` adds the other requested members, only when there are any.

Removed: the music-context `createGroup` call and Step 4's leftover split — the players `setGroupMembers` removes end up
solo and IDLE. Kept: `GroupsNamespace.createGroup`'s optional `musicContextGroupId` (a faithful wrapper of Sonos's field,
unused by the engine); `ungroupMembers()` (still used by `ungroupAll()` and `group()`); the guard that paused audio
elsewhere never replaces what the target already plays (paused groups also come from moves made in the Spotify app).
The `GroupOptions.transfer` JSDoc line "moving audio leaves the source's group paused" becomes "the players the audio
leaves end up idle".

### Behavior

- `group arc` from `( Office + Bedroom )`, any content: one command; end state `| Arc | Office | Bedroom |` with the Arc
  playing and Office and Bedroom IDLE, as before 10-03.
- Unchanged from the 10-03 design: which calls move audio, explicit-source validation, `ERROR_NO_CONTENT`.

### Testing

The fake topology in `tests/household/GroupingEngine.test.ts` gains `setGroupMembers` on each handle: the handle's group
keeps its playback state and becomes exactly the named players, coordinated by the first; every player removed becomes
a solo IDLE group. Transfer tests 1–3 expect one `setGroupMembers(['A'])` from the source coordinator, no `createGroup`,
and IDLE leftovers; tests 5–6 (the guard) are unchanged. Mutation-verify: sending the move from the target's handle
instead of the source coordinator's fails tests 1–3.

Live, before deploying (House of Auto's conditions): through `household.group([Arc], { transfer: true })` on the built
branch, time (a) a bare Spotify Connect session on `( Office + Bedroom )` started the way the morning music starts and
(b) a Spotify playlist started from the app; both must end with the Arc playing and Office and Bedroom IDLE; then
confirm the Arc's home-theater state (`homeTheater` options, TV input) is unchanged. Send the sha and both timings to
House of Auto before deploying, and the next morning's result after.

## 2026-10-04 second addendum: copy first, move only when Sonos refuses

**Status:** Chosen by the owner 2026-10-04 09:31 CDT ("~3 s is always preferable to ~8 s unless there's no other
choice"). Supersedes the first addendum's "one path".

### Why

The live check of the move (09:24, the owner's "Liked Songs" playlist on `( Office* + Bedroom )` → Arc, through
`household.group([arc], { transfer: true })` on the built branch) took **8.4 s**: Sonos added the Arc and removed
Office at once (09:25:00), then took **7 s** to hand the playing group's coordinator role to the Arc (09:25:07). The
silent probes were fast only because nothing was playing. A copy needs no handoff: 0.5–3.3 s on 10-03. So the copy
stays the first choice, and the move covers what Sonos refuses to copy. End state and home-theater options were right.

### Design

`transferAudio(source, targetCoordinator, allMemberIds)`:

1. Inside `withRetry`: refresh, find the source's group and its coordinator handle (throw `GROUP_OPERATION_FAILED` if
   either is missing), then `householdGroups.createGroup([target.id], sourceGroup.id)`. If Sonos answers
   `ERROR_PLAYBACK_FAILED` (it cannot copy the session), log at info and send `setGroupMembers([target.id])` from the
   source coordinator's handle instead. Any other error propagates.
2. `pollUntil` the target coordinates a group holding none of the source group's other players (unchanged).
3. `simpleGroup(target, allMemberIds)` when there are other members (unchanged).
4. Split what is left of the source group (`ungroupMembers`, the 10-03 Step 4): a copy leaves its other members grouped;
   after a move they are already solo, so this finds nothing.

### Behavior

- Copyable audio (a playlist started from the Spotify app): about 1–3 s; the source's coordinator is left PAUSED holding
  the old audio, its other players solo; the guard keeps that paused leftover from replacing what a target plays.
- Audio Sonos cannot copy (a bare Spotify Connect session): about 8 s with music playing; the players it leaves end IDLE.
- `GroupOptions.transfer`'s JSDoc says both.

### Testing

The fake's `createGroup` refuses a music context from a group the test marks uncopyable, with a `CommandError`
`ERROR_PLAYBACK_FAILED`. Tests: copy (one `createGroup` with the context, then the leftover split; end
`A:PLAYING, B:PAUSED, C:IDLE`); refused copy → move (`setGroupMembers(['A'])` from the source coordinator; end
`A:PLAYING, B:IDLE, C:IDLE`); target inside the source group (copy); explicit transfer to two speakers (copy); the
settle-wait and coordinator-choice tests on the move path; another `CommandError` from the copy propagates with no move;
the two guard tests. Mutation-verify: always rethrowing the copy's error fails the refused-copy test; falling back on any
error fails the propagation test; dropping the leftover split fails the copy test.

Live: the morning's own audio — Alexa playing "Mountain Morning Chill" on Bedroom, Office grouped in — moved to the Arc,
which shows whether Alexa's session is copyable, plus the 09:24 playlist run above. Sha and timings to House of Auto
before deploying.

## 2026-10-04 third addendum: a copy counts as done once the target plays it

**Status:** Chosen by the owner 2026-10-04 17:45 CDT (option A, over move-only).

### Why

The live check of the morning's own audio (12:24: Alexa playing "Mountain Morning Chill" on Bedroom, Office grouped in,
`group([Arc], { transfer: true })` through the built branch) was copied, not refused — and took **20.7 s**. Neurotto's
log: the Arc played at 12:24:32, a second after the command, but Sonos kept `( Office + Bedroom )` playing beside it and
answered `createGroup` only when they paused at 12:24:52. The library waited for that answer. The 10-03 21 s outlier
had the same shape. Copies of app-started playlists were answered in 0.5–3.3 s; the move took 8.4 s.

### Design

Step 1's copy (`copyAudio(target, sourceGroup, sourceMemberIds)`, a private helper of `GroupingEngine`):

1. Send `createGroup([target], sourceGroup.id)` and wait up to `COPY_ANSWER_GRACE_MS` (1 s) for the answer. An answer —
   success or refusal — ends the step as before (a refusal still falls back to the move).
2. Without an answer by then, race it against `pollUntil` the target coordinates a PLAYING group holding none of the
   source group's other players (the poll also ends when the answer arrives). If the target plays first, the copy is
   done: Step 1 returns, and a later failure of the pending command is logged at warn, never thrown. If the poll gives
   up first, wait for the answer.

Steps 2–4 are unchanged; Step 4 now splits off the source group's other players while Sonos is still releasing the
source group's coordinator.

### Behavior

- Morning `group arc` (Alexa session, copied): returns in about 1–2 s with the Arc playing and Office split off;
  Bedroom keeps playing until Sonos releases it (up to ~20 s), then ends PAUSED.
- A copy Sonos answers within 1 s, a refused copy, and the move: unchanged.
- A target whose group is already PLAYING (the Arc on TV audio) skips the race and waits for Sonos's answer, as before:
  the poll would be satisfied at once and could hide a late refusal. Mornings start with the Arc not playing.
- While a copy's source is still being released, its coordinator is in a `releasing` set that both source searches skip,
  so a second `group arc` in that window is a no-op instead of a second copy. The entry clears when Sonos answers (every
  request settles within the 120 s request timeout).

### Testing

Fake `createGroup` variants: one that applies the copy at once but answers 20 s later (the source still PLAYING until
then); one that applies it and rejects 20 s later. Tests: `group()` resolves within 3 s of fake time with
`A:PLAYING, B:PLAYING, C:IDLE`, and after the answer `B:PAUSED`; a late rejection is logged at warn and does not reject
`group()`. Mutation: awaiting the answer instead of racing it fails the first test.

Live: the Alexa morning case again → Arc, timed; House of Auto gets the timings and the sha before deploying.

## 2026-10-05 fourth addendum: move only, done once Sonos has added the target

**Status:** Chosen by the owner 2026-10-05 12:12 CDT. Supersedes the second and third addenda (copy first).

### Why

Live check 2026-10-05 12:04, the Alexa morning playlist on `( Office + Bedroom )` → Arc through the copy-first build:
the copy played on the Arc within a second, but Sonos held every later group command behind it — Step 4's
`createGroup([Office])`, sent at 3.9 s, was answered only when Sonos released Bedroom at 24 s, so `group()` took
23.7 s. Splitting Office off mid-release also left Office playing a session of its own; a second `group arc` then took
it as a source, Sonos refused to copy it, and moving Office's group onto the Arc silenced the Arc. Copying a Spotify
Connect session has now failed live three ways (refused, ~20 s holds, odd leftovers); moving the group was clean every
time (10-04 09:24: the Arc joined the playing group at once and played in sync, Office dropped at once, Bedroom handed
the coordinator role over at 7 s).

### Design

`transferAudio(source, targetCoordinator, allMemberIds)`:

1. Inside `withRetry`: refresh, find the source's group and its coordinator handle (throw `GROUP_OPERATION_FAILED` if
   either is missing), then the coordinator sends `setGroupMembers([target.id])`.
2. A single target is done: Sonos has added it, it plays in sync, and the coordinator handoff finishes on Sonos's side.
3. Several targets: `pollUntil` the target coordinates a group holding none of the source group's other players, then
   `simpleGroup(target, allMemberIds)`.

Removed: the music-context copy, `copyAudio()`, `COPY_ANSWER_GRACE_MS`, the `releasing` set and both source searches'
checks of it, and the leftover split. Kept: the guard that paused audio elsewhere never replaces what the target plays;
`createGroup`'s optional `musicContextGroupId` (an accurate wrapper, unused by the engine).

### Behavior

- `group arc` from `( Office + Bedroom )`, any content: the call returns once Sonos answers (5.5 s live on 10-05 — Sonos
  may answer only near the end of the handoff); the Arc plays at once,
  Office goes quiet at once, Bedroom drops out when Sonos finishes the handoff (~7 s). End: `| Arc | Office | Bedroom |`,
  the Arc playing, Office and Bedroom IDLE.
- A command during the handoff: volume goes to the group's coordinator, so it reaches the Arc's group; a second
  `group arc` finds the Arc inside Bedroom's playing group and sends the same `setGroupMembers([Arc])` again.

### Testing

Restore the move-era transfer tests (dad3c58) minus the copy-path ones: one `setGroupMembers(['A'])` from the source
coordinator with IDLE leftovers; target inside the source group; explicit transfer to two speakers; waiting for the move
to land before adding members; sending from the source group's coordinator; the two guard tests. New: a single-target
transfer returns while the handoff is still in progress (`( B* + A )`), with no poll. Mutation-verify each guard.

Live: the morning content again (Office + Bedroom playing) → Arc through `household.group`, timed; a second
`group([Arc])` and a volume read during the handoff; the end state after it; the Arc's home-theater options unchanged.
