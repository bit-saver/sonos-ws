# Copy-First Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GroupingEngine.transferAudio()` copies the source group's audio to the target (`createGroup` with a music context, ~1–3 s) and falls back to moving the group itself (`setGroupMembers`, ~8 s) only when Sonos refuses the copy with `ERROR_PLAYBACK_FAILED`.

**Architecture:** Inside the existing `withRetry` closure, the copy is tried first; on `ERROR_PLAYBACK_FAILED` the source coordinator's handle sends `setGroupMembers([target])`. The poll and `simpleGroup` stay. The 10-03 leftover split returns as Step 4: a copy leaves the source group's other players grouped; after a move they are already solo, so it finds nothing.

**Tech Stack:** TypeScript (ESM), vitest, tsup. Node ≥ 18.

**Spec:** `docs/superpowers/specs/2026-10-03-music-context-transfer-design.md` — the "2026-10-04 second addendum" at its end is binding; the earlier sections are history.

## What already exists

- `src/household/GroupingEngine.ts:271-307` — `transferAudio()` on this branch: Step 1 `setGroupMembers` inside `withRetry` (variable `removed`), Step 2 poll, Step 3 `simpleGroup`. `ungroupMembers()` (:~350) still exists. `CommandError` is already imported (`withRetry` compares `err.code === 'groupCoordinatorChanged'` as a string literal — the same idiom for `'ERROR_PLAYBACK_FAILED'`).
- The 10-03 leftover split (commit `6b24572`, `git show 6b24572:src/household/GroupingEngine.ts`, its Step 4) — restored here.
- `src/types/groups.ts:97` — the `GroupOptions.transfer` line "Moving audio leaves the players it moves away from solo and idle."
- `tests/household/GroupingEngine.test.ts:99-258` — `describe('transfer')`: the fake (`without`, `solo`, `createGroup` without a music context, `modifyGroupMembers`, `setGroupMembers`), seven tests.
- `src/errors/CommandError.ts` — `new CommandError(code, message, options?)`.

## New names and files

None.

## Global Constraints

- No new dependencies. ESM `.js` suffixes; `import type` for types.
- Comments brief, present tense, no history or dates. Wrap code at 120 columns.
- `npx vitest run` and `npx tsc --noEmit` clean before committing (200 tests at the start; 201 after).
- Conventional commit prefix; no `Co-Authored-By`; stage files by name; do not touch `dist/`.
- A mutation check that does not fail exactly as stated is a finding: stop and report it.

---

### Task 1: Copy first, move when Sonos refuses

**Files:**
- Modify: `src/household/GroupingEngine.ts` (`transferAudio()`)
- Modify: `src/types/groups.ts:97`
- Test: `tests/household/GroupingEngine.test.ts` (imports; `describe('transfer')`)

**Interfaces:**
- Consumes: `GroupsNamespace.createGroup(playerIds, musicContextGroupId?)`, `GroupsNamespace.setGroupMembers(playerIds)` (both exist).
- Produces: no new names.

- [ ] **Step 1: Update the tests**

Add the import `import { CommandError } from '../../src/errors/CommandError.js';` next to the `SonosError` import.

In `describe('transfer')`:

(a) Replace the header comment with:

```ts
    // Sonos's grouping as live probes observed it: createGroup with a music context copies the source group's audio
    // into the new group and leaves the source group paused, its other players still grouped — unless Sonos cannot
    // copy that session, which it refuses with ERROR_PLAYBACK_FAILED. setGroupMembers keeps the group's session and
    // makes the group exactly the named players, coordinated by the first; every player it removes ends up solo, idle.
```

(b) Add, after `let nextGroup = 0;`:

```ts
    // Groups whose audio Sonos cannot copy (a bare Spotify Connect session).
    let uncopyable: string[] = [];
```

(c) Replace the `createGroup` fake with:

```ts
    function createGroup(playerIds: string[], musicContextGroupId?: string) {
      const source = topology.groups.find((g) => g.id === musicContextGroupId);
      if (source && uncopyable.includes(source.id)) {
        return Promise.reject(new CommandError('ERROR_PLAYBACK_FAILED', 'music context content cannot be copied'));
      }
      const rest = without(playerIds)
        .map((g) => (g.id === source?.id ? { ...g, playbackState: 'PLAYBACK_STATE_PAUSED' } : g));
      const playbackState = source?.playbackState ?? 'PLAYBACK_STATE_IDLE';
      topology.groups = [...rest, { ...solo(playerIds[0]!), playerIds, playbackState }];
      return Promise.resolve({ group: {} });
    }
```

(d) In `beforeEach`, add `uncopyable = [];` as its first line.

(e) Replace the first three tests ('moves the source group to the target in one command…', 'pulls a target out of the playing group it belongs to', 'adds the other requested members after an explicit transfer') with:

```ts
    it('copies the audio to the target and splits the source group it leaves behind', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B'], [['C']]]);
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
    });

    it('moves the source group when Sonos cannot copy its audio', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      uncopyable = ['G_B'];

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('lets any other error from the copy through, without moving', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      householdGroups.createGroup.mockRejectedValueOnce(new CommandError('ERROR_INVALID_PARAMETER', 'bad group'));

      await expect(engine.group([players.get('A')!], { transfer: true })).rejects.toMatchObject({
        code: 'ERROR_INVALID_PARAMETER',
      });
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
    });

    it('pulls a target out of the playing group it belongs to', async () => {
      startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
    });

    it('adds the other requested members after an explicit transfer', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!, players.get('C')!], { transfer: { id: 'B' } });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(players.get('A')!.groups.modifyGroupMembers).toHaveBeenCalledWith(['C'], undefined);
      expect(state()).toEqual(['A+C:PLAYING', 'B:PAUSED']);
    });
```

(f) In 'waits for the move to land before adding the other requested members', add `uncopyable = ['G_B'];` right after its
`startWith(…)` line. In "sends the move from the source group's coordinator, not the named source", add
`uncopyable = ['G_C'];` right after its `startWith(…)` line. Both guard tests stay as they are.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected FAIL — the five tests from (e): the current code never calls `createGroup` with a context (so the copy tests and
the refused-copy test's call list differ) and never rejects on a copy error. The settle-wait, coordinator-choice and
guard tests pass.

- [ ] **Step 3: Implement**

Replace `transferAudio()` in `src/household/GroupingEngine.ts` with:

```ts
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: the target takes over the source group's audio. A copy is fastest and leaves the source group paused;
    // Sonos cannot copy some sessions (a bare Spotify Connect one), and then the group itself moves to the target,
    // leaving the players it removes idle.
    let sourceMembers: string[] = [];
    await this.withRetry(async () => {
      const snap = await this.refreshAndSnapshot();
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
      }
      const sourceCoord = this.players.get(sourceGroup.coordinatorId);
      if (!sourceCoord) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find coordinator for source "${source.name}"`);
      }
      sourceMembers = sourceGroup.playerIds.filter((id) => id !== targetCoordinator.id);
      try {
        await this.householdGroups.createGroup([targetCoordinator.id], sourceGroup.id);
      } catch (err) {
        if (!(err instanceof CommandError && err.code === 'ERROR_PLAYBACK_FAILED')) throw err;
        this.log.info(`Sonos cannot copy the audio of "${source.name}"; moving its group to "${targetCoordinator.name}"`);
        await sourceCoord.groups.setGroupMembers([targetCoordinator.id]);
      }
    });

    // Step 2: wait until the target coordinates a group holding none of the source group's other players
    const settled = await this.pollUntil(
      (res) => res.groups.some(
        (g) => g.coordinatorId === targetCoordinator.id && !g.playerIds.some((id) => sourceMembers.includes(id)),
      ),
    );
    if (!settled) {
      this.log.warn(`Audio transfer did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 3: add the other requested members
    if (allMemberIds.length > 1) {
      await this.simpleGroup(targetCoordinator, allMemberIds);
    }

    // Step 4: split what is left of the source group; a copy leaves its other players grouped, a move leaves them solo
    const snap = await this.refreshAndSnapshot();
    const leftovers = new Map<string, Group>();
    for (const id of sourceMembers) {
      const group = snap.findGroupOf(id);
      if (group && group.playerIds.length > 1 && !allMemberIds.includes(id)) leftovers.set(group.id, group);
    }
    for (const group of leftovers.values()) {
      await this.ungroupMembers(group);
    }
  }
```

If the `this.log.info(...)` line exceeds 120 columns, break it after `(` per the repo's style (one argument per line,
trailing comma).

In `src/types/groups.ts`, replace ` * Moving audio leaves the players it moves away from solo and idle.` with:

```ts
   * Audio Sonos can copy leaves the source's group paused; audio it cannot copy (a bare Spotify Connect session)
   * moves with its group, leaving those players idle.
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 201 pass, no type errors.

- [ ] **Step 5: Mutation-check** (one at a time; run the test file; restore; confirm green)

1. Replace the `if (!(err instanceof CommandError && err.code === 'ERROR_PLAYBACK_FAILED')) throw err;` line with
   `throw err;` → exactly 'moves the source group when Sonos cannot copy its audio', 'waits for the move to land…' and
   "sends the move from the source group's coordinator…" fail.
2. Delete that line (fall back on any error) → exactly 'lets any other error from the copy through, without moving'
   fails.
3. Delete the Step 4 `for (const group of leftovers.values())` loop → exactly 'copies the audio to the target and
   splits the source group it leaves behind' fails.

- [ ] **Step 6: Commit**

```bash
git add src/household/GroupingEngine.ts src/types/groups.ts tests/household/GroupingEngine.test.ts
git commit -m "feat: copy the audio first and move the group only when Sonos refuses the copy

A copy takes 0.5-3 s; moving a playing group hands its coordinator role over, ~7 s for the Arc. Sonos refuses to copy
a bare Spotify Connect session (ERROR_PLAYBACK_FAILED), so that case still moves the group."
```

---

### Task 2: Fit review

- [ ] **Step 1:** Invoke the `fit-review` skill over `git diff <plan base>` and fix any drift, each fix in its own commit.

---

## Finish (controller)

1. Whole-branch review (single seat), fix wave if needed.
2. Live: the morning's own audio (the owner says the Alexa command; Office grouped in) → Arc through the scratch build's
   `household.group([arc], { transfer: true })`, logging whether Sonos copied or moved; plus the 09:24 playlist result.
   Arc home-theater state unchanged. Sha and timings to House of Auto before deploying.
3. `npm run build`, `chore: rebuild dist …`, merge to `main`, push; deploy per memory
   `feedback_deploy_sonos_ws_to_neurotto`; `CLAUDE.md`, memory, vault.
