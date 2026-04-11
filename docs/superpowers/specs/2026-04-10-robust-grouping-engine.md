# Robust Grouping Engine

## Problem

The current grouping implementation has three fundamental flaws:

1. **Stale groupIds.** Every topology-mutating API call (`createGroup`, `modifyGroupMembers`) changes the device state, but `PlayerHandle` groupIds are only updated on `refreshTopology()`. Commands sent between the mutation and the refresh use stale groupIds. The Sonos API returns `{success: false, type: 'groupCoordinatorChanged'}` — a coordinator redirect — but the library misidentifies this as error code `'UNKNOWN'` because `resBody.errorCode` is absent and the fallback chain doesn't check `resHeaders.type`.

2. **Hardcoded 500ms wait.** After the coordinator shuffle, `transferAudio` sleeps 500ms and hopes topology settled. If it hasn't, `refreshTopology()` returns stale data and downstream steps use wrong groupIds. The result: members don't get re-added, audio gets lost, speakers end up in wrong groups.

3. **No retry on redirect errors.** When a volume or group command fails because the handle's groupId is stale, the library throws and gives up. The handle's `getGroupId()` closure would return the correct value if `refreshTopology()` were called first — but nobody calls it.

## Solution

Three targeted fixes plus a structural extraction:

### Fix A: Error Code Extraction

In `SonosConnection.send()`, change the error code extraction to check `resHeaders.type` as a fallback:

```typescript
// Before:
const errorCode = (resBody?.errorCode as string) ?? resHeaders.response ?? 'UNKNOWN';

// After:
const errorCode = (resBody?.errorCode as string)
  ?? resHeaders.type
  ?? resHeaders.response
  ?? 'UNKNOWN';
```

This makes `groupCoordinatorChanged` responses produce `CommandError` with code `'groupCoordinatorChanged'` instead of `'UNKNOWN'`. Every caller can now detect and handle this specific failure.

### Fix B: Poll Instead of Sleep

Replace the 500ms `setTimeout` with a `pollUntil` function that calls `getGroups` every 200ms until an expected condition is met or a 3-second deadline passes.

```typescript
async function pollUntil(
  condition: (response: GroupsResponse) => boolean,
  deadlineMs: number = 3000,
  intervalMs: number = 200,
): Promise<GroupsResponse | null>
```

Used after every topology-mutating step:
- After `createGroup([coordinator.id])` → poll until coordinator appears as solo group
- After removing source coordinator (shuffle step 2) → poll until target appears as coordinator
- If deadline passes, proceed anyway with a warning log (not a hard error)

### Fix C: Retry on Coordinator Redirect

A `withRetry` helper wraps commands that can fail with stale groupIds:

```typescript
async function withRetry(
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CommandError && err.code === 'groupCoordinatorChanged') {
      await refreshAndSnapshot();  // updates handle groupIds via closures
      await fn();                  // retry once — second failure propagates
    } else {
      throw err;
    }
  }
}
```

Used for:
- `modifyGroupMembers` in `simpleGroup` (adding/removing members)
- `modifyGroupMembers` in `transferAudio` step 4 (adding remaining members)
- NOT used for shuffle step 2 (removing coordinator) — that always "fails" and is caught separately

### Fix D: Extract GroupingEngine

Move all grouping logic from `SonosHousehold` into a dedicated class with injected dependencies.

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/household/GroupingEngine.ts` | All grouping logic: group, ungroup, ungroupAll, transfer |
| `src/household/TopologySnapshot.ts` | Read-only query object over topology state |

### Modified Files

| File | Change |
|------|--------|
| `src/client/SonosConnection.ts` | Error code extraction fallback (one line) |
| `src/household/SonosHousehold.ts` | Delegate grouping to engine, remove simpleGroup/transferAudio/resolveAudioSource |

### Unchanged

All player wrappers, namespace classes, SonosClient, error classes, types.

## TopologySnapshot

A pure value object — no async, no I/O. Constructed from `GroupsResponse` and the player handles map. Passed into grouping functions so they query a consistent point-in-time view rather than `this._groups` which can mutate between await points.

```typescript
class TopologySnapshot {
  readonly groups: readonly Group[];
  readonly players: ReadonlyMap<string, PlayerHandle>;

  constructor(response: GroupsResponse, players: ReadonlyMap<string, PlayerHandle>);

  /** Finds the group containing a player. */
  findGroupOf(playerId: string): Group | undefined;

  /** Returns the coordinator ID for a player's group. */
  coordinatorOf(playerId: string): string | undefined;

  /** Whether a player is the only member of its group. */
  isAloneInGroup(playerId: string): boolean;
}
```

## GroupingEngine

### Constructor

```typescript
class GroupingEngine {
  constructor(
    private readonly householdGroups: GroupsNamespace,
    private readonly refreshTopology: () => Promise<GroupsResponse>,
    private readonly players: ReadonlyMap<string, PlayerHandle>,
    private readonly log: Logger,
  )
}
```

`householdGroups` is the household-scoped `GroupsNamespace` (no groupId/playerId — for `createGroup` and `getGroups`). `refreshTopology` is the callback that calls `getGroups`, updates all handles, and returns the response. `players` is the live map of handles.

### group(players, options?)

```
1. refreshAndSnapshot()  // fresh topology, all handles updated
2. Short-circuit: already in desired configuration? → return
3. resolveAudioSource(snapshot) → source
4. IF source exists AND source !== desired coordinator:
     transferAudio(source, coordinator, memberIds)
   ELSE:
     simpleGroup(coordinator, memberIds)
5. refreshAndSnapshot()  // final cleanup
```

### simpleGroup(coordinator, memberIds)

```
1. snapshot = refreshAndSnapshot()
2. IF coordinator is not coordinator of its group:
     householdGroups.createGroup([coordinator.id])
     pollUntil(coordinator is solo in a group, 3s)
     snapshot = refreshAndSnapshot()
3. withRetry(() =>
     // Recompute delta inside the closure so it uses fresh state after retry's refresh
     snap = refreshAndSnapshot()
     coordGroup = snap.findGroupOf(coordinator.id)
     toAdd = memberIds NOT in coordGroup (excluding coordinator)
     toRemove = coordGroup members NOT in memberIds
     IF toAdd or toRemove:
       coordinator.groups.modifyGroupMembers(toAdd, toRemove)
   )
```

### transferAudio(source, targetCoordinator, allMemberIds)

```
1. snapshot = refreshAndSnapshot()
2. sourceGroup = snapshot.findGroupOf(source.id)
3. sourceCoord = players.get(sourceGroup.coordinatorId)

4. IF target not in sourceGroup:
     withRetry(() => sourceCoord.groups.modifyGroupMembers([target.id]))

5. TRY sourceCoord.groups.modifyGroupMembers([], [sourceCoord.id])
   CATCH: groupCoordinatorChanged or TimeoutError → expected, continue
          anything else → throw

6. pollUntil(target.id is coordinatorId of some group, 3s)
7. snapshot = refreshAndSnapshot()

8. // Add desired members and remove bystanders in one call
   withRetry(() =>
     snap = refreshAndSnapshot()
     targetGroup = snap.findGroupOf(target.id)
     toAdd = allMemberIds NOT in targetGroup (excluding target)
     toRemove = targetGroup members NOT in allMemberIds (excluding target)
     IF toAdd or toRemove:
       target.groups.modifyGroupMembers(toAdd, toRemove)
   )
```

Note: Step 8 removes "bystander" members — players that were in the source group but are not in the desired target group. Without this cleanup, they'd remain in the target group after the shuffle.

### resolveAudioSource(targetPlayers, transfer, snapshot)

Same priority logic as the current implementation, but adapted to read from the `snapshot` parameter instead of `this._groups` and `this._players`:

1. If `transfer` is a `{ id }` object → find that player, throw `NO_CONTENT` if idle
2. If `transfer` is `true`:
   - Phase 1: PLAYING among target players (array order)
   - Phase 2: PAUSED among target players (array order)
   - Phase 3: PLAYING elsewhere in household
   - Phase 4: PAUSED elsewhere in household
   - Nothing found → return undefined (group silently)

### ungroup(player)

```
IF player is already solo → no-op
householdGroups.createGroup([player.id])
refreshAndSnapshot()
```

### ungroupAll()

```
snapshot = refreshAndSnapshot()
FOR each multi-player group in snapshot:
  FOR each non-coordinator member:
    householdGroups.createGroup([member.id])
refreshAndSnapshot()
```

### pollUntil(condition, deadlineMs, intervalMs)

```
start = Date.now()
LOOP:
  response = householdGroups.getGroups()  // sequential: await each response
  IF condition(response): return response
  IF elapsed >= deadlineMs: return null
  sleep(min(intervalMs, remaining time))  // sleep AFTER response, not on fixed timer
```

Returns `null` on timeout. Callers log a warning but continue — the subsequent `refreshAndSnapshot()` will get whatever state the device has.

**Important:** The return value is a readiness signal only. It must NOT be used for groupId-dependent operations. The authoritative state always comes from the subsequent `refreshAndSnapshot()` call, which updates all handles. Between the poll success and the refresh, topology may have changed again.

### withRetry(fn)

```
TRY fn()
CATCH err:
  IF err.code === 'groupCoordinatorChanged':
    refreshAndSnapshot()   // updates all handle groupIds
    fn()                   // retry once
  ELSE: throw
```

### refreshAndSnapshot()

```
response = refreshTopology()   // updates all handles
return new TopologySnapshot(response, players)
```

## SonosHousehold Changes

`SonosHousehold` creates the engine in its constructor:

```typescript
this.engine = new GroupingEngine(
  this.householdGroups,
  () => this.refreshTopology(),
  this._players,
  this.log,
);
```

Methods become one-liners:

```typescript
async group(players, options?) { await this.engine.group(players, options); }
async ungroup(player) { await this.engine.ungroup(player); }
async ungroupAll() { await this.engine.ungroupAll(); }
```

Delete: `simpleGroup()`, `transferAudio()`, `resolveAudioSource()`, the 500ms sleep.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `modifyGroupMembers` returns `groupCoordinatorChanged` | `withRetry` refreshes topology, retries once |
| Shuffle step 2 returns `groupCoordinatorChanged` or timeout | Expected — caught and continued |
| `pollUntil` deadline expires | Log warning, proceed with `refreshAndSnapshot()` |
| Second retry also fails with `groupCoordinatorChanged` | Propagate error to caller — structural problem |
| `getGroups` fails during `pollUntil` | Propagate error — connection is broken |
| `player('Unknown')` | Throw `PLAYER_NOT_FOUND` (unchanged) |
| `transfer: bedroom` but bedroom is idle | Throw `NO_CONTENT` (unchanged) |

## Concurrency Note

`SonosHousehold.handleMessage()` triggers an async `refreshTopology()` on every `groupCoordinatorChanged` event. During engine operations, this event-driven refresh can race with the engine's own `refreshAndSnapshot()` calls. Both update handle groupIds via `updateGroup()`. This race is benign because:

1. The last `updateGroup()` call wins, and it comes from the most recent topology data.
2. If the event-driven refresh causes a handle's groupId to become "too new" relative to the engine's snapshot, the next `withRetry` or `refreshAndSnapshot()` will catch up.
3. The engine always uses `TopologySnapshot` for decisions (not live `this._groups`), so mid-operation mutations to `this._groups` don't affect logic already in progress.

No synchronization mechanism (mutex, flag) is needed.

## Verification

1. `npx tsc --noEmit` — clean
2. `npx vitest run` — all tests pass
3. Live test: `group([arc, bedroom])` — simple group, verify topology
4. Live test: `group([arc, bedroom], { transfer: true })` with Bedroom playing — audio transfers to Arc, both speakers in group
5. Live test: `ungroup(bedroom)` — Bedroom goes solo
6. Live test: volume command after grouping — no `groupCoordinatorChanged` error
7. Neurotto: `sonos group arc,bedroom` — works from CLI
8. Neurotto: `sonos 5` (volume) after grouping — returns actual volume, not undefined

## Scope

**In scope:**
- GroupingEngine extraction with TopologySnapshot
- pollUntil replacing 500ms sleep
- withRetry for coordinator redirect recovery
- Error code extraction fix in SonosConnection
- Neurotto live verification

**Out of scope:**
- Multi-connection support (connecting to each coordinator's WebSocket)
- Volume/playback on remote speakers (requires multi-connection — future work)
- New test coverage (separate follow-up)
