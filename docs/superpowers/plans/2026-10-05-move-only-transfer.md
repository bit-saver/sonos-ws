# Move-Only Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GroupingEngine.transferAudio()` only moves the source group (`setGroupMembers([target])`), returning once Sonos has added a single target; the copy path and its machinery are removed.

**Architecture:** Back to the reviewed move version of 10-04 (commit `dad3c58`), minus the settle poll for a single target. Several targets still poll, then `simpleGroup`.

**Tech Stack:** TypeScript (ESM), vitest, tsup.

**Spec:** `docs/superpowers/specs/2026-10-03-music-context-transfer-design.md` — the "2026-10-05 fourth addendum" is binding.

## What already exists

- `src/household/GroupingEngine.ts` at HEAD: `transferAudio()` (copy first, move fallback, Steps 2–4), `copyAudio()`, `COPY_ANSWER_GRACE_MS`, the `releasing` field, `releasing` checks in `resolveAudioSource` and `resolveAudioSourceExcluding`, the `targetPlaying` flag.
- The move-era code and tests: `git show dad3c58:src/household/GroupingEngine.ts` and `git show dad3c58:tests/household/GroupingEngine.test.ts` (with 68bb5ad's names: `removed`).
- `src/types/groups.ts` `GroupOptions.transfer` JSDoc (currently describes copy and move); `src/namespaces/GroupsNamespace.ts` JSDoc (keep as is).

## New names and files

None.

## Global Constraints

- No new dependencies; `.js` suffixes; `import type`; brief present-tense comments; ≤120 columns.
- Keep f087e48's wording fixes ("transfer" for transfers in general, "move" only for `setGroupMembers`) and the paused-audio guard in `resolveAudioSourceExcluding` (without the `releasing` clause).
- `npx vitest run` and `npx tsc --noEmit` clean; conventional commit; no `Co-Authored-By`; stage by name; not `dist/`.
- A mutation check that does not fail exactly as stated is a finding: stop and report it.

---

### Task 1: Move only

**Files:** `src/household/GroupingEngine.ts`, `src/types/groups.ts`, `tests/household/GroupingEngine.test.ts`.

- [ ] **Step 1: Tests.** In `describe('transfer')`:
  - Remove the `uncopyable` variable, the copy branch of the `createGroup` fake (it goes back to the plain
    `createGroup(playerIds)` of dad3c58), `slowCopy`, `refusedCopy`, and every test about copies, refusals, late
    answers, releasing sources, a playing target waiting for an answer, and 'leaves a move that outlasts the settle
    wait alone'.
  - The transfer tests become exactly (bodies as in dad3c58 unless stated):
    1. 'moves the source group to the target in one command, leaving the players it removes idle'
    2. 'pulls a target out of the playing group it belongs to'
    3. 'adds the other requested members after an explicit transfer'
    4. 'waits for the move to land before adding the other requested members' (as at HEAD, minus `uncopyable`)
    5. "sends the move from the source group's coordinator, not the named source" (as at HEAD, minus `uncopyable`)
    6. new — below
    7. 'leaves a playing target alone rather than pulling in paused audio from elsewhere' (unchanged)
    8. "splits a playing target's own group instead of pulling in paused audio" (unchanged)

  New test 6:

```ts
    it('returns once Sonos has added a single target, without waiting for the handoff', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      // Sonos adds A and removes C at once; B hands A the coordinator role only seconds later.
      vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
        startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));
        return Promise.resolve();
      });
      vi.useFakeTimers();
      try {
        let done = false;
        const grouping = engine.group([players.get('A')!], { transfer: true }).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(100);
        expect(done).toBe(true);
        await grouping;
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['B+A:PLAYING', 'C:IDLE']);
      } finally {
        vi.useRealTimers();
      }
    });
```

- [ ] **Step 2:** Run the file; expect test 6 and the restored move tests to fail against HEAD (it copies first).
- [ ] **Step 3: Implement.** Remove `COPY_ANSWER_GRACE_MS`, the `releasing` field, `copyAudio()`, the `releasing` clauses
  in both source searches, and the `targetPlaying` computation. `transferAudio()` becomes:

```ts
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: move the source group itself to the target. The group keeps its session, so nothing is copied. Sonos
    // adds the target at once and hands it the coordinator role seconds later; the players it removes end up idle.
    let removed: string[] = [];
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
      removed = sourceGroup.playerIds.filter((id) => id !== targetCoordinator.id);
      await sourceCoord.groups.setGroupMembers([targetCoordinator.id]);
    });

    // A single target already plays in sync; the handoff finishes on Sonos's side.
    if (allMemberIds.length === 1) return;

    // Step 2: before adding the other requested members, wait until the target coordinates a group holding none of
    // the removed players
    const settled = await this.pollUntil(
      (res) => res.groups.some(
        (g) => g.coordinatorId === targetCoordinator.id && !g.playerIds.some((id) => removed.includes(id)),
      ),
    );
    if (!settled) {
      this.log.warn(`Audio transfer did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 3: add the other requested members
    await this.simpleGroup(targetCoordinator, allMemberIds);
  }
```

  Remove the `CommandError` import only if nothing else uses it (`withRetry` does — keep it). Keep `Group` only if still
  used (`ungroupMembers` uses it).

  In `src/types/groups.ts`, replace the two JSDoc lines about copying and moving with:

```ts
   * Transferring moves the source group itself to the target; the call returns once Sonos has added the target, and
   * the players the audio leaves end up solo and idle when Sonos finishes the handoff a few seconds later.
```

- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit` — report the count (expect 201: dad3c58 had 200, plus test 6).
- [ ] **Step 5: Mutations** (one at a time, restore after each):
  1. Send the move from `targetCoordinator.groups` instead of `sourceCoord.groups` → tests 1–5 fail (report exactly).
  2. Delete `if (allMemberIds.length === 1) return;` → exactly test 6 fails.
  3. Drop `&& !g.playerIds.some((id) => removed.includes(id))` → exactly test 4 fails.
- [ ] **Step 6: Commit** — `fix: transfer by moving the source group only, done once Sonos has added the target`
  (body: copying a Spotify Connect session failed live three ways — refused, held answers queueing later commands,
  stray leftovers; the move was clean and the target plays at once).

---

### Task 2: Fit review — invoke `fit-review` over `git diff <plan base>`; fix drift in its own commits.

## Finish (controller)

Single-seat review; live check (morning content → Arc; second `group arc` and a volume read during the handoff; end
state; home-theater options); sha and timings to House of Auto; build, dist commit, merge, push, deploy; `CLAUDE.md`,
memory, vault. Stop and wrap at the context ceiling.
