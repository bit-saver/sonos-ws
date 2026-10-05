# Copy Done When Playing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A copy in `GroupingEngine.transferAudio()` counts as done once the target plays it, instead of waiting for Sonos's answer, which Sonos can hold ~20 s while it releases the source group.

**Architecture:** A private `copyAudio()` helper sends the copy, waits up to 1 s for the answer, then races the answer against a poll for the target coordinating a PLAYING group without the source's other players. A refusal still reaches Step 1's fallback; a late failure after the target started playing is logged, not thrown.

**Tech Stack:** TypeScript (ESM), vitest, tsup. Node ≥ 18.

**Spec:** `docs/superpowers/specs/2026-10-03-music-context-transfer-design.md` — the "2026-10-04 third addendum" at its end is binding.

## What already exists

- `src/household/GroupingEngine.ts:271-330` — `transferAudio()`: Step 1 inside `withRetry` (copy at :292, fallback move at :293-299), Step 2 poll, Step 3 `simpleGroup`, Step 4 leftover split. `pollUntil(condition, deadlineMs?, intervalMs?)` returns the matching response or `null` at the deadline; it sleeps inline with `new Promise((r) => setTimeout(r, …))`. Module constants `POLL_INTERVAL_MS`, `POLL_DEADLINE_MS` at :11-12.
- `tests/household/GroupingEngine.test.ts` — `describe('transfer')` with the fakes (`createGroup` honoring `uncopyable`, `modifyGroupMembers`, `setGroupMembers`), `makeGroup`, `startWith`, `state`; tests use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync` (see 'waits for the move to land…' :221 and 'leaves a move that outlasts the settle wait alone' :264). The engine is built in the outer `beforeEach` (:64) with `noopLogger`.

## New names and files

- `GroupingEngine.copyAudio(target, sourceGroup, sourceMemberIds)` (private) — Step 1's copy now has its own waiting logic; inline it would bury the fallback.
- `COPY_ANSWER_GRACE_MS` (module constant, 1000) — how long a copy's answer is awaited before the target's playback is watched instead.

## Global Constraints

- No new dependencies; `.js` import suffixes; `import type`.
- Comments brief, present tense, no history or dates; ≤120 columns; module constants UPPER_SNAKE with a doc comment.
- Best-effort async is caught and logged, never rethrown: `.catch((err: unknown) => this.log.warn('…', err))`.
- `npx vitest run` and `npx tsc --noEmit` clean before committing (203 at the start, 205 after).
- Conventional commit; no `Co-Authored-By`; stage by name; not `dist/`.
- A mutation check that does not fail exactly as stated is a finding: stop and report it.

---

### Task 1: The copy is done once the target plays it

**Files:**
- Modify: `src/household/GroupingEngine.ts` (constants; Step 1's copy call; new `copyAudio`)
- Test: `tests/household/GroupingEngine.test.ts` (`describe('transfer')`)

- [ ] **Step 1: Write the failing tests** — append inside `describe('transfer')`:

```ts
    // Sonos plays the copy at once but answers only when the source group stops, here 20 s later.
    function slowCopy(outcome: 'answers' | 'fails') {
      householdGroups.createGroup.mockImplementationOnce((playerIds: string[], musicContextGroupId?: string) => {
        const source = topology.groups.find((g) => g.id === musicContextGroupId)!;
        topology.groups = [...without(playerIds), { ...solo(playerIds[0]!), playerIds, playbackState: source.playbackState }];
        return new Promise((resolve, reject) => setTimeout(() => {
          topology.groups = topology.groups.map((g) => (g.id === source.id ? { ...g, playbackState: 'PLAYBACK_STATE_PAUSED' } : g));
          if (outcome === 'answers') resolve({ group: {} });
          else reject(new CommandError('ERROR_COMMAND_FAILED', 'late failure'));
        }, 20000));
      });
    }

    it('counts a copy as done once the target plays it, before Sonos answers', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      slowCopy('answers');
      vi.useFakeTimers();
      try {
        let done = false;
        const grouping = engine.group([players.get('A')!], { transfer: true }).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(3000);
        expect(done).toBe(true);
        expect(state()).toEqual(['A:PLAYING', 'B:PLAYING', 'C:IDLE']);
        await vi.advanceTimersByTimeAsync(20000);
        await grouping;
        expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a copy that fails after the target started playing', async () => {
      const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      engine = new GroupingEngine(householdGroups, refreshTopology, players, log);
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      slowCopy('fails');
      vi.useFakeTimers();
      try {
        await Promise.all([engine.group([players.get('A')!], { transfer: true }), vi.advanceTimersByTimeAsync(3000)]);
        await vi.advanceTimersByTimeAsync(20000);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('failed after it started playing'), expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });
```

Wrap lines over 120 columns in the repo's style; keep the logic as written.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/household/GroupingEngine.test.ts`
Expected FAIL: the first (`done` is false at 3 s — the current code waits for the 20 s answer); the second (the late
rejection rejects `group()` instead of being logged — under fake timers this may surface as a rejection; note how).

- [ ] **Step 3: Implement**

Add next to the poll constants:

```ts
/** How long a copy's answer is awaited before the target's playback is watched instead. */
const COPY_ANSWER_GRACE_MS = 1000;
```

In Step 1 replace `await this.householdGroups.createGroup([targetCoordinator.id], sourceGroup.id);` with
`await this.copyAudio(targetCoordinator, sourceGroup, sourceMemberIds);`.

Add the helper after `transferAudio()`:

```ts
  /**
   * Copies a group's audio to the target. Sonos plays a copy within a second but may answer only once the source group
   * stops (about 20 s for an Alexa-started Spotify session), so after a short wait the copy counts as done once the
   * target coordinates a playing group without the source's other players. A refusal arrives at once and is thrown;
   * a failure after the target started playing is logged.
   */
  private async copyAudio(target: PlayerHandle, sourceGroup: Group, sourceMemberIds: string[]): Promise<void> {
    let answered = false;
    const answer = this.householdGroups.createGroup([target.id], sourceGroup.id).finally(() => {
      answered = true;
    });
    const grace = new Promise<void>((r) => setTimeout(r, COPY_ANSWER_GRACE_MS));
    await Promise.race([answer, grace]);
    if (answered) {
      await answer;
      return;
    }

    const playing = await Promise.race([
      answer.then(() => null),
      this.pollUntil((res) => answered || res.groups.some(
        (g) => g.coordinatorId === target.id && g.playbackState === 'PLAYBACK_STATE_PLAYING'
          && !g.playerIds.some((id) => sourceMemberIds.includes(id)),
      )),
    ]);
    if (playing && !answered) {
      answer.catch((err: unknown) => this.log.warn(`Copy to "${target.name}" failed after it started playing`, err));
      return;
    }
    await answer;
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 205 pass, no type errors, no unhandled-rejection warnings in the output.

- [ ] **Step 5: Mutation-check**

Replace the whole body after `const answer = …;` with `await answer;` (wait for Sonos's answer, as before) → exactly
'counts a copy as done once the target plays it…' and 'logs a copy that fails…' fail. Restore; green.

- [ ] **Step 6: Commit**

```bash
git add src/household/GroupingEngine.ts tests/household/GroupingEngine.test.ts
git commit -m "feat: a copy counts as done once the target plays it

Sonos plays a copy within a second but may answer only when the source group stops — 20 s for the Alexa morning
session — so the morning 'group arc' still outlasted HA's 10 s call."
```

---

### Task 2: Fit review

- [ ] **Step 1:** Invoke `fit-review` over `git diff <plan base>`; fix drift in its own commits.

---

## Finish (controller)

Single-seat whole-branch review; rebuild the scratch build; live check with the Alexa morning case (the owner says the
command); sha and timings to House of Auto; `npm run build`, dist commit, merge, push, deploy; `CLAUDE.md`, memory,
vault.

---

### Task 3 (added after House of Auto's review): a source Sonos is still releasing is not a source

**Why:** after a copy counts as done, the source group keeps PLAYING until Sonos answers (≤ ~20 s). A second
single-player `group arc` in that window would find it as a PLAYING source and copy it onto the Arc again.

**Files:** `src/household/GroupingEngine.ts` (field, `copyAudio`, `resolveAudioSourceExcluding`); test file.

- [ ] **Step 1: Failing test** — append inside `describe('transfer')`:

```ts
    it('skips a source Sonos is still releasing after a copy', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      slowCopy('answers');
      vi.useFakeTimers();
      try {
        await Promise.all([engine.group([players.get('A')!], { transfer: true }), vi.advanceTimersByTimeAsync(3000)]);
        await engine.group([players.get('A')!], { transfer: true });
        expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B'], [['C']]]);
        expect(state()).toEqual(['A:PLAYING', 'B:PLAYING', 'C:IDLE']);
        await vi.advanceTimersByTimeAsync(20000);
      } finally {
        vi.useRealTimers();
      }
    });
```

RED: the second `group()` copies B again (a second `[['A'], 'G_B']` call).

- [ ] **Step 2: Implement**

Field, next to the constructor's parameters' use (a private instance field with a doc comment):

```ts
  /** Coordinators of source groups whose audio already plays on a transfer's target, until Sonos answers the copy. */
  private readonly releasing = new Set<string>();
```

In `copyAudio`, the early return becomes:

```ts
    if (playing && !answered) {
      this.releasing.add(sourceGroup.coordinatorId);
      answer
        .catch((err: unknown) => this.log.warn(`Copy to "${target.name}" failed after it started playing`, err))
        .finally(() => this.releasing.delete(sourceGroup.coordinatorId));
      return;
    }
```

In `resolveAudioSourceExcluding`'s auto-resolve loop, skip such groups: the condition
`if (group.playbackState === phase)` becomes `if (group.playbackState === phase && !this.releasing.has(group.coordinatorId))`.
(The explicit `{ id }` source and the multi-player `resolveAudioSource` are unchanged.)

- [ ] **Step 3:** `npx vitest run && npx tsc --noEmit` → 206 pass.
- [ ] **Step 4: Mutation** — drop `&& !this.releasing.has(group.coordinatorId)` → exactly the new test fails. Restore.
- [ ] **Step 5: Commit** — `fix: a source Sonos is still releasing after a copy is not a transfer source` (body: a
  second 'group arc' in the release window would copy the still-playing source again).
