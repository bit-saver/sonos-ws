# Group-Move Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GroupingEngine.transferAudio()` moves the source group itself to the target with `setGroupMembers`, instead of copying its audio with `createGroup`'s music context, which Sonos refuses for a bare Spotify Connect session.

**Architecture:** The source group's coordinator sends `setGroupMembers([target])`; the group keeps its own session, the target becomes its coordinator, and the players it drops end up solo and idle. A poll waits until the target coordinates a group holding none of them; `simpleGroup` then adds any other requested members. The leftover split from 10-03 goes away.

**Tech Stack:** TypeScript (ESM), vitest, tsup. Node ≥ 18.

**Spec:** `docs/superpowers/specs/2026-10-03-music-context-transfer-design.md` — the "2026-10-04 addendum" at its end is binding; the sections above it are history.

## What already exists

- `src/household/GroupingEngine.ts:271-312` — `transferAudio()`: Step 1 `createGroup([target], sourceGroup.id)` inside `withRetry`, Step 2 poll, Step 3 `simpleGroup`, Step 4 leftover split through `ungroupMembers()`.
- `src/namespaces/GroupsNamespace.ts` — `setGroupMembers(playerIds): Promise<void>` already exists. `PlayerHandle.groups` stamps the handle's current group ID, which `refreshAndSnapshot()` keeps fresh.
- `GroupingEngine.ts` — `ungroupMembers()` stays: `ungroupAll()` and `group()`'s lone-coordinator branch use it. The guard in `resolveAudioSourceExcluding()` stays.
- `src/types/groups.ts:97` — the `GroupOptions.transfer` JSDoc line "Moving audio leaves the source's group paused (Sonos's behavior)."
- `tests/household/GroupingEngine.test.ts` — `mockHandle` :14 (no `setGroupMembers` yet); `describe('transfer')` :98 with the fake (`without`, `createGroup`, `modifyGroupMembers`, `state`, `makeGroup`, `startWith`) and five tests.

## New names and files

None.

## Global Constraints

- No new dependencies. ESM with `.js` import suffixes; `import type` for types.
- Comments brief and present-tense: what a reader needs now. No incident history or dates in code comments — those go in commit messages. Wrap code at 120 columns.
- Failures: `SonosError` subclasses with an `ErrorCode`.
- `npx vitest run` and `npx tsc --noEmit` clean before every commit (198 tests at the start, 198 after).
- Conventional commit prefixes; no `Co-Authored-By` line. Do not touch `dist/`.
- A mutation check that does not fail exactly as stated is a finding: stop and report it, never explain it away.

---

### Task 1: Move the group, don't copy its audio

**Files:**
- Modify: `src/household/GroupingEngine.ts:271-312`
- Modify: `src/types/groups.ts:97`
- Test: `tests/household/GroupingEngine.test.ts` (`mockHandle` :14-26, `describe('transfer')` :98-197)

**Interfaces:**
- Consumes: `GroupsNamespace.setGroupMembers(playerIds: string[]): Promise<void>` (exists).
- Produces: no new names.

- [ ] **Step 1: Update the tests (they fail against the current code)**

In `mockHandle`, add `setGroupMembers` to `groups`:

```ts
    groups: {
      modifyGroupMembers: vi.fn().mockResolvedValue({ group: {} }),
      createGroup: vi.fn().mockResolvedValue({ group: {} }),
      setGroupMembers: vi.fn().mockResolvedValue(undefined),
    },
```

In `describe('transfer')`, replace the header comment and the `createGroup` fake, add a `setGroupMembers` fake, wire it in `beforeEach`, and replace the first three tests. The full block from `describe('transfer', () => {` down to the guard tests becomes:

```ts
  describe('transfer', () => {
    // Sonos's grouping as live probes observed it: setGroupMembers keeps the group's session and makes the group
    // exactly the named players, coordinated by the first; every player it drops ends up solo and idle.
    let nextGroup = 0;

    function without(ids: string[]): Group[] {
      return topology.groups
        .map((g) => {
          const rest = g.playerIds.filter((id) => !ids.includes(id));
          return { ...g, playerIds: rest, coordinatorId: rest.includes(g.coordinatorId) ? g.coordinatorId : rest[0]! };
        })
        .filter((g) => g.playerIds.length > 0);
    }

    const solo = (id: string): Group =>
      ({ id: `G_new${++nextGroup}`, name: '', coordinatorId: id, playerIds: [id], playbackState: 'PLAYBACK_STATE_IDLE' });

    function createGroup(playerIds: string[]) {
      topology.groups = [...without(playerIds), { ...solo(playerIds[0]!), playerIds }];
      return Promise.resolve({ group: {} });
    }

    function modifyGroupMembers(coordinatorId: string, add: string[] = [], remove: string[] = []) {
      const groups = without(add);
      const own = groups.find((g) => g.coordinatorId === coordinatorId)!;
      own.playerIds = [...own.playerIds.filter((id) => !remove.includes(id)), ...add];
      topology.groups = [...groups, ...remove.map(solo)];
      return Promise.resolve({ group: {} });
    }

    function setGroupMembers(coordinatorId: string, playerIds: string[]) {
      const own = topology.groups.find((g) => g.coordinatorId === coordinatorId)!;
      const dropped = own.playerIds.filter((id) => !playerIds.includes(id));
      const moved = { ...own, coordinatorId: playerIds[0]!, playerIds };
      topology.groups = [...without(playerIds).filter((g) => g.id !== own.id), moved, ...dropped.map(solo)];
      return Promise.resolve();
    }

    const state = () => topology.groups
      .map((g) => `${g.playerIds.join('+')}:${g.playbackState!.replace('PLAYBACK_STATE_', '')}`)
      .sort();

    const makeGroup = (id: string, playerIds: string[], playback: string): Group =>
      ({ id, name: '', coordinatorId: playerIds[0]!, playerIds, playbackState: `PLAYBACK_STATE_${playback}` });

    function startWith(...groups: Group[]) {
      topology.groups = groups;
    }

    beforeEach(() => {
      householdGroups.createGroup.mockImplementation(createGroup);
      for (const [id, handle] of players) {
        vi.mocked(handle.groups.modifyGroupMembers).mockImplementation(
          (add?: string[], remove?: string[]) => modifyGroupMembers(id, add, remove) as any);
        vi.mocked(handle.groups.setGroupMembers).mockImplementation((playerIds: string[]) => setGroupMembers(id, playerIds));
      }
    });

    it('moves the source group to the target in one command, leaving the players it drops idle', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('pulls a target out of the playing group it belongs to', async () => {
      startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('adds the other requested members after an explicit transfer', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!, players.get('C')!], { transfer: { id: 'B' } });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(players.get('A')!.groups.modifyGroupMembers).toHaveBeenCalledWith(['C'], undefined);
      expect(state()).toEqual(['A+C:PLAYING', 'B:IDLE']);
    });
```

The two guard tests that follow ('leaves a playing target alone…' and "splits a playing target's own group…") stay exactly as they are.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected: the first three `transfer` tests FAIL (`setGroupMembers` never called; the current code calls `createGroup` with a music context). The two guard tests pass.

- [ ] **Step 3: Implement**

Replace `transferAudio()` in `src/household/GroupingEngine.ts` with:

```ts
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: move the source group itself to the target. The group keeps its session, so nothing is copied;
    // the players it drops end up solo and idle.
    let dropped: string[] = [];
    await this.withRetry(async () => {
      const snap = await this.refreshAndSnapshot();
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
      }
      const sourceCoord = this.players.get(sourceGroup.coordinatorId);
      if (!sourceCoord) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find coordinator for source group`);
      }
      dropped = sourceGroup.playerIds.filter((id) => id !== targetCoordinator.id);
      await sourceCoord.groups.setGroupMembers([targetCoordinator.id]);
    });

    // Step 2: wait until the target coordinates a group holding none of the players it replaced
    const settled = await this.pollUntil((res) => res.groups.some((g) =>
      g.coordinatorId === targetCoordinator.id && !g.playerIds.some((id) => dropped.includes(id))));
    if (!settled) {
      this.log.warn(`Audio transfer did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 3: add the other requested members
    if (allMemberIds.length > 1) {
      await this.simpleGroup(targetCoordinator, allMemberIds);
    }
  }
```

In `src/types/groups.ts`, replace ` * Moving audio leaves the source's group paused (Sonos's behavior).` with
` * Moving audio leaves the players it moves away from solo and idle.`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 198 tests pass, no type errors. `grep -n 'musicContext\|ungroupMembers' src/household/GroupingEngine.ts` shows no `musicContext` and `ungroupMembers` only in `ungroupAll()`, `group()` and its own definition.

- [ ] **Step 5: Mutation-check**

Change `await sourceCoord.groups.setGroupMembers([targetCoordinator.id]);` to
`await targetCoordinator.groups.setGroupMembers([targetCoordinator.id]);`, run
`npx vitest run tests/household/GroupingEngine.test.ts`, confirm exactly the first three `transfer` tests fail. Restore;
re-run green.

- [ ] **Step 6: Commit**

```bash
git add src/household/GroupingEngine.ts src/types/groups.ts tests/household/GroupingEngine.test.ts
git commit -m "fix: transfer audio by moving the source group with setGroupMembers, not by copying its music context

Sonos refuses to copy a bare Spotify Connect session ('music context content cannot be copied'), so the morning
'group arc' failed outright. setGroupMembers keeps the group's own session; the players it drops end up idle."
```

---

### Task 2: Fit review

- [ ] **Step 1:** Invoke the `fit-review` skill over `git diff <plan base>` and fix any drift, each fix in its own commit
  with tests and `tsc` green.

---

## Finish (controller)

1. Final whole-branch review; fix wave if needed.
2. Live check on a scratch build when the owner says Spotify is ready (spec addendum "Testing"): bare Spotify Connect on
   `( Office + Bedroom )` → Arc, and a playlist → Arc, timed through `household.group([arc], { transfer: true })`; then
   the Arc's home-theater state. Sha and timings to House of Auto before deploying.
3. `npm run build`, `chore: rebuild dist …`, merge to `main`, push; deploy per memory
   `feedback_deploy_sonos_ws_to_neurotto`; `CLAUDE.md` and memory; vault republish.
