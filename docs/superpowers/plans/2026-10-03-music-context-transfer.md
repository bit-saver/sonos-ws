# Audio Transfer by Music Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `household.group(..., { transfer })` moves audio with Sonos's `createGroup(playerIds, musicContextGroupId)` instead of the coordinator shuffle, cutting the morning `group arc` from ~20 s to ~4 s.

**Architecture:** `GroupsNamespace.createGroup` gains an optional `musicContextGroupId`. `GroupingEngine.transferAudio()` asks Sonos to create the target's group with the source group's audio, waits for the target to coordinate, adds any other requested members, then splits what is left of the source group so its members end up solo (today's end state). The split already exists inline in `ungroupAll()`; it moves into a private helper both use.

**Tech Stack:** TypeScript (ESM), vitest, tsup. Node ≥ 18.

**Spec:** `docs/superpowers/specs/2026-10-03-music-context-transfer-design.md`

## What already exists

- `src/namespaces/GroupsNamespace.ts:28` — `createGroup(playerIds)`; `modifyGroupMembers` (:40) shows the
  optional-body-field pattern to copy.
- `src/household/GroupingEngine.ts:279` — `transferAudio()` (the shuffle at :303, the 8 s poll at :314, the second move
  at :322); `ungroupAll()` :129 (the split to extract); `simpleGroup` :244; `pollUntil` :345; `withRetry` :369;
  `isExpectedShuffleError` :383 (shuffle-only); `group()`'s case comment :89-97 and :104.
- `tests/household/GroupingEngine.test.ts` — `makeTopology` :10, `mockHandle` :14, three solo IDLE groups in
  `beforeEach` :35 (`A` Arc, `B` Bedroom, `C` Office). `householdGroups.getGroups` and `refreshTopology` both return the
  same `topology` object, so a test changes topology by assigning `topology.groups`.
- `tests/namespaces/BaseNamespace.test.ts:6` — `contextWith(send)`, the namespace-test context to copy.

## New names and files

- `GroupsNamespace.createGroup(playerIds, musicContextGroupId?)` — the field Sonos defines on the command.
- `GroupingEngine.ungroupMembers(group)` (private) — the split `ungroupAll()` does inline; `transferAudio()` needs it too.
- `tests/namespaces/GroupsNamespace.test.ts` — tests mirror `src/`; no file covers `GroupsNamespace` yet.

## Global Constraints

- No new dependencies. ESM with `.js` import suffixes; `import type` for types.
- Comments brief and present-tense: what a reader needs now. No incident history or dates in code comments — those go in
  commit messages. Wrap code at 120 columns, the repo's de facto width (no formatter config).
- Failures: `SonosError` subclasses with an `ErrorCode`; best-effort work logs and continues.
- Run `npx vitest run` and `npx tsc --noEmit` before every commit; both must be clean (191 tests at the start).
- Commit messages: conventional prefixes (`feat:`, `test:`, `refactor:`, `docs:`), no `Co-Authored-By` line.
- Do not touch `dist/`; it is rebuilt once at the end.

---

### Task 1: `createGroup` carries a music context

**Files:**
- Modify: `src/namespaces/GroupsNamespace.ts:22-31`
- Create: `tests/namespaces/GroupsNamespace.test.ts`

**Interfaces:**
- Produces: `GroupsNamespace.createGroup(playerIds: string[], musicContextGroupId?: string): Promise<CreateGroupResponse>`.
  The request body is `{ playerIds }`, plus `musicContextGroupId` only when given.

- [ ] **Step 1: Write the failing test**

Create `tests/namespaces/GroupsNamespace.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GroupsNamespace } from '../../src/namespaces/GroupsNamespace.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function contextWith(send: ReturnType<typeof vi.fn>): NamespaceContext {
  return {
    connection: { send } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => undefined,
    getPlayerId: () => undefined,
  };
}

describe('GroupsNamespace.createGroup', () => {
  const bodyOf = (send: ReturnType<typeof vi.fn>) => send.mock.calls[0][0][1];

  it('sends only the players when no music context is given', async () => {
    const send = vi.fn().mockResolvedValue([{}, { group: {} }]);

    await new GroupsNamespace(contextWith(send)).createGroup(['A']);

    expect(bodyOf(send)).toEqual({ playerIds: ['A'] });
  });

  it('sends the group whose audio the new group takes over', async () => {
    const send = vi.fn().mockResolvedValue([{}, { group: {} }]);

    await new GroupsNamespace(contextWith(send)).createGroup(['A'], 'G_B');

    expect(bodyOf(send)).toEqual({ playerIds: ['A'], musicContextGroupId: 'G_B' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/namespaces/GroupsNamespace.test.ts`
Expected: the second test FAILS — the body lacks `musicContextGroupId` (the first passes already).

- [ ] **Step 3: Implement**

Replace `createGroup` in `src/namespaces/GroupsNamespace.ts` with:

```ts
  /**
   * Creates a new group from the specified player IDs.
   *
   * @param playerIds - The IDs of the players to include in the new group.
   * @param musicContextGroupId - The group whose audio the new group takes over. Sonos moves it: that group is left
   *   paused, its other members still grouped. Omitted, the new group has no audio.
   * @returns The newly created group's details.
   */
  async createGroup(playerIds: string[], musicContextGroupId?: string): Promise<CreateGroupResponse> {
    const body: Record<string, unknown> = { playerIds };
    if (musicContextGroupId) body.musicContextGroupId = musicContextGroupId;
    const response = await this.send('createGroup', body);
    return this.body(response) as unknown as CreateGroupResponse;
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (193), no type errors.

- [ ] **Step 5: Mutation-check the guard**

Change `if (musicContextGroupId) body.musicContextGroupId = musicContextGroupId;` to
`body.musicContextGroupId = musicContextGroupId;`, run `npx vitest run tests/namespaces/GroupsNamespace.test.ts`, and
confirm exactly "sends only the players when no music context is given" fails. Restore the line and re-run: green.

- [ ] **Step 6: Commit**

```bash
git add src/namespaces/GroupsNamespace.ts tests/namespaces/GroupsNamespace.test.ts
git commit -m "feat: createGroup takes the music context group whose audio the new group takes over"
```

---

### Task 2: `transferAudio()` moves audio with the music context

**Files:**
- Modify: `src/household/GroupingEngine.ts` (imports :7, `group()` comments :89-97 and :104, `ungroupAll()` :129-142,
  `transferAudio()` :279-338, `isExpectedShuffleError()` :383-388)
- Test: `tests/household/GroupingEngine.test.ts`

**Interfaces:**
- Consumes: `GroupsNamespace.createGroup(playerIds: string[], musicContextGroupId?: string)` from Task 1.
- Produces: no new public names. Private `ungroupMembers(group: Group): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe('GroupingEngine', …)` in `tests/household/GroupingEngine.test.ts`, after the last
`it(…)`:

```ts
  describe('transfer', () => {
    // Sonos's grouping as the 2026-10-03 live probe observed it: createGroup with a music context moves the
    // source group's audio to the new group and leaves the source group paused, its other members still grouped.
    let nextGroup = 0;

    function without(ids: string[]): Group[] {
      return topology.groups
        .map((g) => {
          const rest = g.playerIds.filter((id) => !ids.includes(id));
          return { ...g, playerIds: rest, coordinatorId: rest.includes(g.coordinatorId) ? g.coordinatorId : rest[0]! };
        })
        .filter((g) => g.playerIds.length > 0);
    }

    function createGroup(playerIds: string[], musicContextGroupId?: string) {
      const source = topology.groups.find((g) => g.id === musicContextGroupId);
      const rest = without(playerIds).map((g) =>
        (g.id === source?.id ? { ...g, playbackState: 'PLAYBACK_STATE_PAUSED' } : g));
      const playbackState = source?.playbackState ?? 'PLAYBACK_STATE_IDLE';
      const created = { id: `G_new${++nextGroup}`, name: '', coordinatorId: playerIds[0]!, playerIds, playbackState };
      topology.groups = [...rest, created];
      return Promise.resolve({ group: {} });
    }

    function modifyGroupMembers(coordinatorId: string, add: string[] = [], remove: string[] = []) {
      const groups = without(add);
      const own = groups.find((g) => g.coordinatorId === coordinatorId)!;
      own.playerIds = [...own.playerIds.filter((id) => !remove.includes(id)), ...add];
      const solos = remove.map((id) => ({ id: `G_new${++nextGroup}`, name: '', coordinatorId: id, playerIds: [id],
        playbackState: 'PLAYBACK_STATE_IDLE' }));
      topology.groups = [...groups, ...solos];
      return Promise.resolve({ group: {} });
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
      }
    });

    it('moves the audio to the target in one command and splits the source group it leaves behind', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B'], [['C']]]);
      expect(players.get('B')!.groups.modifyGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
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
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected: the three `transfer` tests FAIL — today's code sends `modifyGroupMembers` from the source coordinator (the
shuffle) and never calls `createGroup` with a music context. Some fail by vitest's 5 s timeout, because the old code
waits out its 8 s settle poll; that still counts as the expected failure.

- [ ] **Step 3: Implement**

In `src/household/GroupingEngine.ts`:

(a) Remove the now-unused import `import { TimeoutError } from '../errors/TimeoutError.js';`.

(b) Replace the case comment in `group()` (:89-97) with:

```ts
    // Decide how to handle the audio source:
    // 1. Source IS the desired coordinator → simpleGroup (audio preserved naturally)
    // 2. Source is a target member but not coordinator → make source the coordinator
    //    (overrides user preference to preserve audio)
    // 3. Source is OUTSIDE the target group → transferAudio, but only for an explicit
    //    source; audio that auto-resolve finds outside the group stays where it is.
```

and the comment at :104 with `// Explicit transfer source outside the target group — move its audio to the coordinator.`

(c) In `ungroupAll()`, replace the inner loop over `group.playerIds` with a call to the new helper:

```ts
    for (const group of multiPlayerGroups) {
      await this.ungroupMembers(group);
    }
```

(d) Replace `transferAudio()` (:279-338) with:

```ts
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: the target takes over the source group's audio. Sonos moves it: the source group is left paused,
    // its other members still grouped.
    let sourceMemberIds: string[] = [];
    await this.withRetry(async () => {
      const snap = await this.refreshAndSnapshot();
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
      }
      sourceMemberIds = sourceGroup.playerIds;
      await this.householdGroups.createGroup([targetCoordinator.id], sourceGroup.id);
    });

    // Step 2: wait for the target to coordinate its new group
    const settled = await this.pollUntil(
      (res) => res.groups.some((g) => g.coordinatorId === targetCoordinator.id),
    );
    if (!settled) {
      this.log.warn(`Audio transfer did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 3: add the other requested members
    if (allMemberIds.length > 1) {
      await this.simpleGroup(targetCoordinator, allMemberIds);
    }

    // Step 4: split what is left of the source group, so its members end up solo
    const snap = await this.refreshAndSnapshot();
    const leftovers = new Map<string, Group>();
    for (const id of sourceMemberIds) {
      const group = snap.findGroupOf(id);
      if (group && group.playerIds.length > 1 && !allMemberIds.includes(id)) leftovers.set(group.id, group);
    }
    for (const group of leftovers.values()) {
      await this.ungroupMembers(group);
    }
  }
```

(e) Delete `isExpectedShuffleError()` (:383-388) and add the helper in its place:

```ts
  /** Splits a group so every member is solo; the coordinator keeps the group and its audio. */
  private async ungroupMembers(group: Group): Promise<void> {
    for (const playerId of group.playerIds) {
      if (playerId !== group.coordinatorId) {
        await this.householdGroups.createGroup([playerId]);
      }
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (196), no type errors. `grep -n -i shuffle src/household/GroupingEngine.ts` prints nothing.

- [ ] **Step 5: Mutation-check the guards**

Each change, one at a time: run `npx vitest run tests/household/GroupingEngine.test.ts`, confirm the named tests fail,
restore, confirm green.
1. `createGroup([targetCoordinator.id], sourceGroup.id)` → `createGroup([targetCoordinator.id])`: all three `transfer`
   tests fail.
2. Delete the Step 4 `for (const group of leftovers.values())` loop: exactly "moves the audio to the target in one
   command and splits the source group it leaves behind" fails.

- [ ] **Step 6: Commit**

```bash
git add src/household/GroupingEngine.ts tests/household/GroupingEngine.test.ts
git commit -m "feat: transfer audio with createGroup's music context instead of the coordinator shuffle

The shuffle let Sonos pick any remaining member as coordinator, so 'group arc' from (Office + Bedroom) burned the
8 s settle poll and made a second coordinator move: ~20 s. Live, the music-context transfer took 3.3 s."
```

---

### Task 3: Fit review

- [ ] **Step 1:** Invoke the `fit-review` skill over the branch diff (`git diff main...HEAD`) and fix any drift it
  reports, each fix in its own commit with tests and `tsc` green.

---

## Finish (controller, after the tasks)

1. Live check with the built branch: `npm run build`, then a scratchpad probe — `( Office + Bedroom )` playing (Spotify
   on Office plus `modifyGroupMembers`), time `household.group([Arc], { transfer: true })`, expect the Arc playing in
   under 5 s and three solo groups. Move the music back to Office afterwards.
2. `chore: rebuild dist with the music-context transfer` (the build from step 1); `CLAUDE.md` state and follow-ups
   (grouping fixed; drop the restore-warning item; add the `autoConnect: false` reconnect finding); spec status line.
3. `superpowers:finishing-a-development-branch` → merge to `main`, push.
4. Message the House of Auto session (sha, diff summary, tests), then bump Neurotto's pin and deploy per memory
   `feedback_deploy_sonos_ws_to_neurotto`.
