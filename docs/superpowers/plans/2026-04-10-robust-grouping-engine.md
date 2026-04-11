# Robust Grouping Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile grouping logic with a robust GroupingEngine that uses topology polling, coordinator-redirect retries, and snapshot-based state management.

**Architecture:** `TopologySnapshot` provides consistent point-in-time topology queries. `GroupingEngine` owns all grouping logic with `pollUntil` (replacing 500ms sleep), `withRetry` (handling stale groupId errors), and proper error code detection. `SonosHousehold` delegates to the engine.

**Tech Stack:** TypeScript, tsup (build), vitest (tests), Node.js ws library

**Spec:** `docs/superpowers/specs/2026-04-10-robust-grouping-engine.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/client/SonosConnection.ts` | Error code extraction fix | Modify (1 line) |
| `src/household/TopologySnapshot.ts` | Read-only topology query object | Create |
| `src/household/GroupingEngine.ts` | All grouping logic | Create |
| `src/household/SonosHousehold.ts` | Delegates grouping to engine | Modify (remove grouping methods) |
| `tests/household/TopologySnapshot.test.ts` | Snapshot unit tests | Create |
| `tests/household/GroupingEngine.test.ts` | Engine unit tests | Create |

---

### Task 1: Fix Error Code Extraction in SonosConnection

**Files:**
- Modify: `src/client/SonosConnection.ts`

This one-line fix makes `groupCoordinatorChanged` responses produce a detectable error code instead of `'UNKNOWN'`.

- [ ] **Step 1: Fix the error code fallback chain**

In `src/client/SonosConnection.ts`, find line 235:

```typescript
      const errorCode = (resBody?.errorCode as string) ?? resHeaders.response ?? 'UNKNOWN';
```

Replace with:

```typescript
      const errorCode = (resBody?.errorCode as string)
        ?? resHeaders.type
        ?? resHeaders.response
        ?? 'UNKNOWN';
```

- [ ] **Step 2: Typecheck and test**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx tsc --noEmit && npx vitest run`
Expected: Clean typecheck, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/client/SonosConnection.ts
git commit -m "fix: use resHeaders.type as error code fallback in SonosConnection

groupCoordinatorChanged responses have no errorCode in the body. The
type field in the headers carries the meaningful identifier. This makes
CommandError.code === 'groupCoordinatorChanged' instead of 'UNKNOWN'.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create TopologySnapshot

**Files:**
- Create: `src/household/TopologySnapshot.ts`
- Create: `tests/household/TopologySnapshot.test.ts`

A pure value object for consistent topology queries. No async, no I/O.

- [ ] **Step 1: Write TopologySnapshot tests**

Create `tests/household/TopologySnapshot.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TopologySnapshot } from '../../src/household/TopologySnapshot.js';
import type { Group, Player, GroupsResponse } from '../../src/types/groups.js';

const groups: Group[] = [
  { id: 'G_ARC', name: 'Arc', coordinatorId: 'P_ARC', playerIds: ['P_ARC'], playbackState: 'PLAYBACK_STATE_PLAYING' },
  { id: 'G_BED', name: 'Bedroom', coordinatorId: 'P_BED', playerIds: ['P_BED', 'P_OFF'], playbackState: 'PLAYBACK_STATE_IDLE' },
];

const players: Player[] = [
  { id: 'P_ARC', name: 'Arc', capabilities: ['PLAYBACK'] },
  { id: 'P_BED', name: 'Bedroom', capabilities: ['PLAYBACK'] },
  { id: 'P_OFF', name: 'Office', capabilities: ['PLAYBACK'] },
];

const response: GroupsResponse = { groups, players };

describe('TopologySnapshot', () => {
  it('findGroupOf returns the group containing a player', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.findGroupOf('P_ARC')?.id).toBe('G_ARC');
    expect(snap.findGroupOf('P_OFF')?.id).toBe('G_BED');
    expect(snap.findGroupOf('P_UNKNOWN')).toBeUndefined();
  });

  it('coordinatorOf returns the coordinator ID for a player', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.coordinatorOf('P_ARC')).toBe('P_ARC');
    expect(snap.coordinatorOf('P_OFF')).toBe('P_BED');
    expect(snap.coordinatorOf('P_UNKNOWN')).toBeUndefined();
  });

  it('isAloneInGroup returns true for solo players', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.isAloneInGroup('P_ARC')).toBe(true);
    expect(snap.isAloneInGroup('P_BED')).toBe(false);
    expect(snap.isAloneInGroup('P_OFF')).toBe(false);
  });

  it('groups is a readonly array', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.groups).toHaveLength(2);
  });

  it('players is a readonly array', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.players).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/household/TopologySnapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TopologySnapshot**

Create `src/household/TopologySnapshot.ts`:

```typescript
import type { Group, Player, GroupsResponse } from '../types/groups.js';

/**
 * A read-only, point-in-time view of the household topology.
 *
 * Used by {@link GroupingEngine} to make decisions against a consistent
 * snapshot rather than live state that can mutate between await points.
 * This is a pure value object — no async, no I/O.
 */
export class TopologySnapshot {
  readonly groups: readonly Group[];
  readonly players: readonly Player[];

  constructor(response: GroupsResponse) {
    this.groups = response.groups;
    this.players = response.players;
  }

  /** Finds the group containing a player. */
  findGroupOf(playerId: string): Group | undefined {
    return this.groups.find((g) => g.playerIds.includes(playerId));
  }

  /** Returns the coordinator ID for a player's group. */
  coordinatorOf(playerId: string): string | undefined {
    return this.findGroupOf(playerId)?.coordinatorId;
  }

  /** Whether a player is the only member of its group. */
  isAloneInGroup(playerId: string): boolean {
    const group = this.findGroupOf(playerId);
    return group !== undefined && group.playerIds.length === 1;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/household/TopologySnapshot.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/household/TopologySnapshot.ts tests/household/TopologySnapshot.test.ts
git commit -m "feat: add TopologySnapshot for consistent topology queries

Pure value object with findGroupOf, coordinatorOf, and isAloneInGroup.
Used by GroupingEngine to avoid reading live state between await points.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create GroupingEngine

**Files:**
- Create: `src/household/GroupingEngine.ts`
- Create: `tests/household/GroupingEngine.test.ts`

This is the core task. The engine implements `group()`, `ungroup()`, `ungroupAll()` with `pollUntil`, `withRetry`, and snapshot-based state management.

- [ ] **Step 1: Write GroupingEngine tests**

Create `tests/household/GroupingEngine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupingEngine } from '../../src/household/GroupingEngine.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';
import type { GroupsNamespace } from '../../src/namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../../src/player/PlayerHandle.js';
import type { Logger } from '../../src/util/logger.js';
import { noopLogger } from '../../src/util/logger.js';
import { SonosError } from '../../src/errors/SonosError.js';

function makeTopology(groups: Group[], players: Player[]): GroupsResponse {
  return { groups, players };
}

function mockHandle(id: string, name: string, groupId: string): PlayerHandle {
  return {
    id,
    name,
    groupId,
    isCoordinator: true,
    capabilities: ['PLAYBACK'],
    groups: {
      modifyGroupMembers: vi.fn().mockResolvedValue({ group: {} }),
      createGroup: vi.fn().mockResolvedValue({ group: {} }),
    },
  } as unknown as PlayerHandle;
}

describe('GroupingEngine', () => {
  let engine: GroupingEngine;
  let householdGroups: any;
  let refreshTopology: ReturnType<typeof vi.fn>;
  let players: Map<string, PlayerHandle>;
  let topology: GroupsResponse;

  beforeEach(() => {
    topology = makeTopology(
      [
        { id: 'G_A', name: 'Arc', coordinatorId: 'A', playerIds: ['A'], playbackState: 'PLAYBACK_STATE_IDLE' },
        { id: 'G_B', name: 'Bedroom', coordinatorId: 'B', playerIds: ['B'], playbackState: 'PLAYBACK_STATE_IDLE' },
        { id: 'G_C', name: 'Office', coordinatorId: 'C', playerIds: ['C'], playbackState: 'PLAYBACK_STATE_IDLE' },
      ] as Group[],
      [
        { id: 'A', name: 'Arc', capabilities: ['PLAYBACK'] },
        { id: 'B', name: 'Bedroom', capabilities: ['PLAYBACK'] },
        { id: 'C', name: 'Office', capabilities: ['PLAYBACK'] },
      ] as Player[],
    );

    players = new Map([
      ['A', mockHandle('A', 'Arc', 'G_A')],
      ['B', mockHandle('B', 'Bedroom', 'G_B')],
      ['C', mockHandle('C', 'Office', 'G_C')],
    ]);

    householdGroups = {
      getGroups: vi.fn().mockResolvedValue(topology),
      createGroup: vi.fn().mockResolvedValue({ group: {} }),
    };

    refreshTopology = vi.fn().mockResolvedValue(topology);

    engine = new GroupingEngine(householdGroups, refreshTopology, players, noopLogger);
  });

  it('group() throws on empty array', async () => {
    await expect(engine.group([])).rejects.toThrow();
  });

  it('group([single]) is a no-op for solo player', async () => {
    const a = players.get('A')!;
    await engine.group([a]);
    expect(householdGroups.createGroup).not.toHaveBeenCalled();
  });

  it('ungroup() is a no-op for solo player', async () => {
    const a = players.get('A')!;
    await engine.ungroup(a);
    expect(householdGroups.createGroup).not.toHaveBeenCalled();
  });

  it('ungroup() calls createGroup for grouped player', async () => {
    // Make B grouped with A
    topology.groups[0]!.playerIds = ['A', 'B'];
    topology.groups.splice(1, 1); // remove B's solo group
    const b = players.get('B')!;
    await engine.ungroup(b);
    expect(householdGroups.createGroup).toHaveBeenCalledWith(['B']);
  });

  it('group([A, B]) calls simpleGroup when no transfer', async () => {
    const a = players.get('A')!;
    const b = players.get('B')!;
    await engine.group([a, b]);
    // Should call modifyGroupMembers on A's handle to add B
    expect(a.groups.modifyGroupMembers).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GroupingEngine**

Create `src/household/GroupingEngine.ts`:

```typescript
import type { GroupsResponse, GroupOptions, Group } from '../types/groups.js';
import type { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../player/PlayerHandle.js';
import type { Logger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { CommandError } from '../errors/CommandError.js';
import { TimeoutError } from '../errors/TimeoutError.js';
import { ErrorCode } from '../types/errors.js';
import { TopologySnapshot } from './TopologySnapshot.js';

const POLL_INTERVAL_MS = 200;
const POLL_DEADLINE_MS = 3000;

/**
 * Manages Sonos speaker grouping operations with robust error handling.
 *
 * Uses {@link TopologySnapshot} for consistent state queries,
 * {@link pollUntil} instead of fixed-delay sleeps, and
 * {@link withRetry} for automatic recovery from stale-groupId errors.
 */
export class GroupingEngine {
  constructor(
    private readonly householdGroups: GroupsNamespace,
    private readonly refreshTopology: () => Promise<GroupsResponse>,
    private readonly players: ReadonlyMap<string, PlayerHandle>,
    private readonly log: Logger,
  ) {}

  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   */
  async group(playerHandles: PlayerHandle[], options?: GroupOptions): Promise<void> {
    if (playerHandles.length === 0) {
      throw new SonosError(ErrorCode.ERROR_INVALID_PARAMETER, 'group() requires at least one player');
    }

    let snap = await this.refreshAndSnapshot();

    // Single player — ensure solo
    if (playerHandles.length === 1) {
      const player = playerHandles[0]!;
      if (snap.isAloneInGroup(player.id)) return;
      await this.householdGroups.createGroup([player.id]);
      await this.refreshAndSnapshot();
      return;
    }

    const coordinator = playerHandles[0]!;
    const memberIds = playerHandles.map((p) => p.id);

    // Short-circuit: already in desired configuration
    if (this.isAlreadyGrouped(coordinator.id, memberIds, snap) && !options?.transfer) {
      return;
    }

    // Resolve audio source
    let audioSource: PlayerHandle | undefined;
    if (options?.transfer) {
      audioSource = this.resolveAudioSource(playerHandles, options.transfer, snap);
    }

    // Transfer or simple group
    if (audioSource && audioSource.id !== coordinator.id) {
      await this.transferAudio(audioSource, coordinator, memberIds);
    } else {
      await this.simpleGroup(coordinator, memberIds);
    }

    await this.refreshAndSnapshot();
  }

  /** Removes a player from its current group. No-op if already solo. */
  async ungroup(player: PlayerHandle): Promise<void> {
    const snap = await this.refreshAndSnapshot();
    if (snap.isAloneInGroup(player.id)) return;
    await this.householdGroups.createGroup([player.id]);
    await this.refreshAndSnapshot();
  }

  /** Ungroups all players in the household. */
  async ungroupAll(): Promise<void> {
    const snap = await this.refreshAndSnapshot();
    const multiPlayerGroups = snap.groups.filter((g) => g.playerIds.length > 1);
    for (const group of multiPlayerGroups) {
      for (const playerId of group.playerIds) {
        if (playerId !== group.coordinatorId) {
          await this.householdGroups.createGroup([playerId]);
        }
      }
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshAndSnapshot();
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private isAlreadyGrouped(coordinatorId: string, memberIds: string[], snap: TopologySnapshot): boolean {
    const group = snap.findGroupOf(coordinatorId);
    return (
      group !== undefined
      && group.coordinatorId === coordinatorId
      && group.playerIds.length === memberIds.length
      && memberIds.every((id) => group.playerIds.includes(id))
    );
  }

  private resolveAudioSource(
    targetPlayers: PlayerHandle[],
    transfer: boolean | { readonly id: string },
    snap: TopologySnapshot,
  ): PlayerHandle | undefined {
    // Explicit source
    if (typeof transfer === 'object') {
      const source = this.players.get(transfer.id);
      if (!source) {
        throw new SonosError(ErrorCode.PLAYER_NOT_FOUND, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = snap.findGroupOf(source.id);
      if (
        !sourceGroup
        || (sourceGroup.playbackState !== 'PLAYBACK_STATE_PLAYING'
          && sourceGroup.playbackState !== 'PLAYBACK_STATE_PAUSED')
      ) {
        throw new SonosError(ErrorCode.ERROR_NO_CONTENT, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }

    // Auto-resolve by priority
    const targetIds = new Set(targetPlayers.map((p) => p.id));

    for (const phase of ['PLAYBACK_STATE_PLAYING', 'PLAYBACK_STATE_PAUSED'] as const) {
      // Check target players first (array order)
      for (const player of targetPlayers) {
        const group = snap.findGroupOf(player.id);
        if (group?.playbackState === phase) return player;
      }
      // Then check rest of household
      for (const group of snap.groups) {
        if (group.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          if (coord && !targetIds.has(coord.id)) return coord;
        }
      }
    }

    return undefined;
  }

  private async simpleGroup(coordinator: PlayerHandle, memberIds: string[]): Promise<void> {
    let snap = await this.refreshAndSnapshot();
    const currentGroup = snap.findGroupOf(coordinator.id);
    if (!currentGroup) return;

    // Extract coordinator if it's not already the coordinator of its group
    if (currentGroup.coordinatorId !== coordinator.id) {
      await this.householdGroups.createGroup([coordinator.id]);
      await this.pollUntil(
        (res) => res.groups.some((g) => g.coordinatorId === coordinator.id && g.playerIds.length === 1),
      );
      snap = await this.refreshAndSnapshot();
    }

    // Add/remove members with retry (delta recomputed inside closure for fresh state)
    await this.withRetry(async () => {
      const freshSnap = await this.refreshAndSnapshot();
      const coordGroup = freshSnap.findGroupOf(coordinator.id);
      if (!coordGroup) return;

      const toAdd = memberIds.filter((id) => id !== coordinator.id && !coordGroup.playerIds.includes(id));
      const toRemove = coordGroup.playerIds.filter((id) => id !== coordinator.id && !memberIds.includes(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await coordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : undefined,
          toRemove.length > 0 ? toRemove : undefined,
        );
      }
    });
  }

  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: Resolve the source group's actual coordinator
    let snap = await this.refreshAndSnapshot();
    const sourceGroup = snap.findGroupOf(source.id);
    if (!sourceGroup) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
    }

    const sourceCoord = this.players.get(sourceGroup.coordinatorId);
    if (!sourceCoord) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find coordinator for source group`);
    }

    // Step 2: Add target to source's group
    if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
      await this.withRetry(async () => {
        await sourceCoord.groups.modifyGroupMembers([targetCoordinator.id]);
      });
    }

    // Step 3: Remove source coordinator (the shuffle) — always "fails"
    try {
      await sourceCoord.groups.modifyGroupMembers([], [sourceCoord.id]);
    } catch (err) {
      if (this.isExpectedShuffleError(err)) {
        this.log.debug('Coordinator shuffle initiated (expected error)');
      } else {
        throw err;
      }
    }

    // Step 4: Poll until target becomes coordinator
    const settled = await this.pollUntil(
      (res) => res.groups.some((g) => g.coordinatorId === targetCoordinator.id),
    );
    if (!settled) {
      this.log.warn(`Coordinator shuffle did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 5: Refresh and add remaining members / remove bystanders
    await this.withRetry(async () => {
      const freshSnap = await this.refreshAndSnapshot();
      const targetGroup = freshSnap.findGroupOf(targetCoordinator.id);
      if (!targetGroup) return;

      const toAdd = allMemberIds.filter((id) => id !== targetCoordinator.id && !targetGroup.playerIds.includes(id));
      const toRemove = targetGroup.playerIds.filter((id) => id !== targetCoordinator.id && !allMemberIds.includes(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await targetCoordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : undefined,
          toRemove.length > 0 ? toRemove : undefined,
        );
      }
    });
  }

  /**
   * Polls getGroups until a condition is met or the deadline passes.
   * The return value is a readiness signal only — authoritative state
   * comes from the subsequent refreshAndSnapshot().
   */
  private async pollUntil(
    condition: (response: GroupsResponse) => boolean,
    deadlineMs: number = POLL_DEADLINE_MS,
    intervalMs: number = POLL_INTERVAL_MS,
  ): Promise<GroupsResponse | null> {
    const start = Date.now();
    while (true) {
      const response = await this.householdGroups.getGroups();
      if (condition(response)) return response;
      const elapsed = Date.now() - start;
      if (elapsed >= deadlineMs) return null;
      await new Promise((r) => setTimeout(r, Math.min(intervalMs, deadlineMs - elapsed)));
    }
  }

  /**
   * Wraps a function that can fail with a stale groupId.
   * On `groupCoordinatorChanged`, refreshes topology (updating handle
   * closures) and retries exactly once.
   */
  private async withRetry(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof CommandError && err.code === 'groupCoordinatorChanged') {
        this.log.debug('groupCoordinatorChanged — refreshing topology and retrying');
        await this.refreshAndSnapshot();
        await fn();
      } else {
        throw err;
      }
    }
  }

  private isExpectedShuffleError(err: unknown): boolean {
    return (
      (err instanceof CommandError && err.code === 'groupCoordinatorChanged')
      || err instanceof TimeoutError
    );
  }

  private async refreshAndSnapshot(): Promise<TopologySnapshot> {
    const response = await this.refreshTopology();
    return new TopologySnapshot(response);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add src/household/GroupingEngine.ts tests/household/GroupingEngine.test.ts
git commit -m "feat: implement GroupingEngine with pollUntil and withRetry

Robust grouping logic extracted from SonosHousehold. Uses TopologySnapshot
for consistent state queries, pollUntil for topology confirmation (replaces
500ms sleep), withRetry for coordinator-redirect recovery, and proper
bystander cleanup after audio transfers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire GroupingEngine into SonosHousehold

**Files:**
- Modify: `src/household/SonosHousehold.ts`

Remove all grouping methods from SonosHousehold and delegate to GroupingEngine.

- [ ] **Step 1: Rewrite SonosHousehold to use GroupingEngine**

In `src/household/SonosHousehold.ts`:

1. Add import at the top:
```typescript
import { GroupingEngine } from './GroupingEngine.js';
```

2. Add engine field after `householdGroups`:
```typescript
  private readonly engine: GroupingEngine;
```

3. Initialize engine at the end of the constructor (after `householdGroups` is created):
```typescript
    this.engine = new GroupingEngine(
      this.householdGroups,
      () => this.refreshTopology(),
      this._players,
      this.log,
    );
```

4. Replace the `group()` method (lines 206-252) with:
```typescript
  async group(players: PlayerHandle[], options?: GroupOptions): Promise<void> {
    await this.engine.group(players, options);
  }
```

5. Replace the `ungroup()` method (lines 259-265) with:
```typescript
  async ungroup(player: PlayerHandle): Promise<void> {
    await this.engine.ungroup(player);
  }
```

6. Replace the `ungroupAll()` method (lines 270-283) with:
```typescript
  async ungroupAll(): Promise<void> {
    await this.engine.ungroupAll();
  }
```

7. Delete these private methods entirely:
   - `resolveAudioSource` (lines 366-418)
   - `simpleGroup` (lines 424-453)
   - `transferAudio` (lines 464-512)

8. Remove unused imports: `TimeoutError` (no longer used in this file).

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (household tests + player tests + new engine tests)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add src/household/SonosHousehold.ts
git commit -m "refactor: delegate grouping from SonosHousehold to GroupingEngine

SonosHousehold.group(), ungroup(), ungroupAll() are now one-line
delegates to GroupingEngine. Removed simpleGroup, transferAudio,
resolveAudioSource, and the 500ms sleep.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Build, Push, Update Neurotto, and Live Test

**Files:**
- Build: `dist/` in sonos-ws
- Update: Neurotto dependency

- [ ] **Step 1: Build sonos-ws**

```bash
cd /home/bitsaver/workspace/sonos-ws && npm run build
```

Expected: Build succeeds

- [ ] **Step 2: Commit dist and push**

```bash
git add dist/
git commit -m "chore: rebuild dist with GroupingEngine

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: Update Neurotto**

```bash
cd /home/bitsaver/workspace/neurotto && bun update sonos-ws
```

- [ ] **Step 4: Restart Neurotto dev container**

```bash
./dev.sh restart
```

Check logs for successful initialization:
```bash
cat /home/bitsaver/docker/neurotto/data/neurotto.log | grep -i "sonos\|volume\|topology\|error" | tail -10
```

Expected: `Connected`, `Topology changed`, `Volume: XX`, `Initialized`. No errors.

- [ ] **Step 5: Live test — simple group**

Using the sonos-ws library directly:
```bash
cd /home/bitsaver/workspace/sonos-ws && NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
// ... connect, group([arc, bedroom]), verify topology shows Arc+1
"
```

- [ ] **Step 6: Live test — group with transfer**

Start music on Bedroom (from Sonos app). Then test:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
// ... connect, group([arc, bedroom], { transfer: true }), verify Arc+1 PLAYING
"
```

Expected: Arc + Bedroom grouped, Arc is PLAYING with Bedroom's audio.

- [ ] **Step 7: Live test — volume after grouping**

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
// ... connect, group speakers, then arc.volume.get(), arc.volume.relative(1)
"
```

Expected: Volume commands succeed (no `groupCoordinatorChanged` error).
