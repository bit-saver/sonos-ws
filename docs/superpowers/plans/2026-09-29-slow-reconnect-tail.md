# Slow Reconnect Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `slowAfter` fast attempts, a socket's reconnect ladder retries every `slowDelay` ms and signals `RECONNECT_SLOWED` once per outage; speaker sockets log their failures quietly and never reach the household's `'error'`.

**Architecture:** `SonosConnection.scheduleReconnect()` picks each attempt's delay from the exponential ladder or, past `slowAfter`, from `slowDelay`, arms the timer, then logs and emits. The connection validates the new options in its constructor. `SonosHousehold` owns each speaker socket's `'error'` listener (warn once per outage, debug after, never forwarded).

**Tech Stack:** TypeScript (NodeNext, strict), vitest 2 with fake timers, `ws` mocked in `tests/client/SonosConnection.test.ts`, `SonosConnection` mocked per host in `tests/household/SonosHousehold.multi.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md`, section "Addendum 2026-09-29 — slow reconnect tail". Read it before starting any task.

## Global Constraints

- **Both `slowAfter` and `slowDelay` unset = today's ladder exactly**: same delays, same attempt count, same `RECONNECT_EXHAUSTED`, same log levels on the primary. Pinned by tests in Tasks 3 and 4.
- `RECONNECT_SLOWED` is a `ConnectionError` (so an `Error`) with `code === 'RECONNECT_SLOWED'` and the exact message `Reconnect slowed after <slowAfter> attempts; retrying every <slowDelay>ms`. The Neurotto session has been told this shape; do not change it.
- Do not weaken the `ws` mock's throw-on-unlistened-`'error'` in `tests/client/SonosConnection.test.ts` (`CLAUDE.md`, Testing).
- **Mutation-verify every test that guards an invariant**: break the named line, run the test, see exactly that test fail, restore. Each task names the mutation. Record the result in the task report.
- Every handler inside `connect()` acts on its own captured `socket`; at most one reconnect ladder (`scheduleReconnect()` clears the pending timer first). Do not break either (`CLAUDE.md`, Invariants).
- Do NOT touch `dist/`. It is rebuilt once, in Task 7.
- Commit messages: conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). No `Co-Authored-By` line.
- American spelling in comments. Match the surrounding comment density and style; source lines stay under ~120 characters.
- Run tests with `npx vitest run <file>`; the whole suite with `npx vitest run`; types with `npx tsc --noEmit` (covers `src/` only).
- Baseline before Task 1: 158 tests pass, `tsc` clean.

---

### Task 1: Options, validation and the new error code

**Files:**
- Modify: `src/types/errors.ts` (enum + header comment)
- Modify: `src/errors/ConnectionError.ts` (constructor code union + class doc)
- Modify: `src/client/SonosConnection.ts:34-51` (`ReconnectOptions`), constructor (~line 136), new module-level `validateReconnectOptions`
- Modify: `docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md` (Validation paragraph of the 09-29 addendum: add the upper bound)
- Test: `tests/client/SonosConnection.test.ts` (new `describe` at the end)

**Interfaces:**
- Produces: `ReconnectOptions.slowAfter?: number`, `ReconnectOptions.slowDelay?: number`; `ErrorCode.RECONNECT_SLOWED = 'RECONNECT_SLOWED'`; `ConnectionError` accepts `ErrorCode.RECONNECT_SLOWED`; `new SonosConnection(...)` throws `RangeError` for invalid slow options.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/SonosConnection.test.ts`:

```ts
describe('SonosConnection reconnect option checks', () => {
  it.each([
    [{ slowAfter: 3 }, 'must be set together'],
    [{ slowDelay: 5000 }, 'must be set together'],
    [{ slowAfter: 0, slowDelay: 5000 }, 'slowAfter must be a positive integer'],
    [{ slowAfter: -1, slowDelay: 5000 }, 'slowAfter must be a positive integer'],
    [{ slowAfter: 1.5, slowDelay: 5000 }, 'slowAfter must be a positive integer'],
    [{ slowAfter: NaN, slowDelay: 5000 }, 'slowAfter must be a positive integer'],
    [{ slowAfter: 3, slowDelay: 0 }, 'slowDelay must be'],
    [{ slowAfter: 3, slowDelay: -1 }, 'slowDelay must be'],
    [{ slowAfter: 3, slowDelay: NaN }, 'slowDelay must be'],
    [{ slowAfter: 3, slowDelay: Infinity }, 'slowDelay must be'],
    // Node clamps a timer delay above 2^31-1 to 1 ms: a "5-day" slowDelay would retry in a hot loop.
    [{ slowAfter: 3, slowDelay: 2_147_483_648 }, 'slowDelay must be'],
  ])('rejects %o', (reconnect, message) => {
    expect(() => new SonosConnection(makeOptions(reconnect))).toThrow(RangeError);
    expect(() => new SonosConnection(makeOptions(reconnect))).toThrow(message);
  });

  it('accepts the pair, and accepts neither', () => {
    expect(() => new SonosConnection(makeOptions({ slowAfter: 94, slowDelay: 300_000 }))).not.toThrow();
    expect(() => new SonosConnection(makeOptions({ slowAfter: 1, slowDelay: 2_147_483_647 }))).not.toThrow();
    expect(() => new SonosConnection(makeOptions())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "reconnect option checks"`
Expected: the `rejects` cases FAIL (nothing throws); `accepts the pair` passes.

- [ ] **Step 3: Implement**

`src/types/errors.ts` — header comment: "The first four codes" → "The first five codes". After `RECONNECT_EXHAUSTED` add:

```ts
  /**
   * The reconnect ladder passed `slowAfter` attempts and now retries every `slowDelay` ms. Emitted once per outage;
   * the ladder keeps going.
   */
  RECONNECT_SLOWED = 'RECONNECT_SLOWED',
```

`src/errors/ConnectionError.ts` — add to the class doc list:

```ts
 * - {@link ErrorCode.RECONNECT_SLOWED} -- the reconnect ladder switched to its slow phase (it keeps retrying)
```

and widen the constructor parameter:

```ts
    code:
      | ErrorCode.CONNECTION_FAILED
      | ErrorCode.CONNECTION_LOST
      | ErrorCode.RECONNECT_EXHAUSTED
      | ErrorCode.RECONNECT_SLOWED,
```

`src/client/SonosConnection.ts` — in `ReconnectOptions`, after `maxAttempts`:

```ts
  /**
   * Attempts on the exponential ladder before the slow phase. From attempt `slowAfter + 1` every delay is
   * `slowDelay`, and `'error'` fires once with `RECONNECT_SLOWED`. Unset: no slow phase. Set together with
   * `slowDelay`.
   */
  slowAfter?: number;
  /** Milliseconds between attempts in the slow phase. Set together with `slowAfter`. */
  slowDelay?: number;
```

Add below `DEFAULT_CONNECT_TIMEOUT`:

```ts
/** The longest delay a timer honors. Node runs a longer one after 1 ms, which would turn a slow ladder into a hot loop. */
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * Rejects slow-phase options that would misbehave rather than fail: half a pair, a phase that starts at attempt 0 or
 * a fractional one, a delay a timer cannot hold.
 */
function validateReconnectOptions({ slowAfter, slowDelay }: ReconnectOptions): void {
  if ((slowAfter === undefined) !== (slowDelay === undefined)) {
    throw new RangeError('reconnect.slowAfter and reconnect.slowDelay must be set together');
  }
  if (slowAfter !== undefined && !(Number.isInteger(slowAfter) && slowAfter > 0)) {
    throw new RangeError(`reconnect.slowAfter must be a positive integer, got ${slowAfter}`);
  }
  if (slowDelay !== undefined && !(Number.isFinite(slowDelay) && slowDelay > 0 && slowDelay <= MAX_TIMER_DELAY)) {
    throw new RangeError(`reconnect.slowDelay must be a number of ms above 0 and at most ${MAX_TIMER_DELAY}, got ${slowDelay}`);
  }
}
```

(If that last line exceeds ~120 characters, break the template literal argument onto its own line.)

In the constructor, first statement after `super();`:

```ts
    validateReconnectOptions(options.reconnect);
```

Spec: in the addendum's "### Validation" paragraph, change "or when `slowDelay` is not a finite number above 0" to "or when `slowDelay` is not a number above 0 and at most 2147483647 ms (Node runs a longer timer after 1 ms)".

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/client/SonosConnection.test.ts` then `npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 5: Mutation-verify**

Delete the both-or-neither `if` block; run the file; expect exactly the two `must be set together` cases to fail. Restore. Change `slowDelay <= MAX_TIMER_DELAY` to `true`; expect exactly the `2_147_483_648` case to fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/types/errors.ts src/errors/ConnectionError.ts src/client/SonosConnection.ts tests/client/SonosConnection.test.ts docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md
git commit -m "feat: add slowAfter/slowDelay reconnect options and RECONNECT_SLOWED, validated at construction"
```

---

### Task 2: A listener that disconnects stops the ladder

Today `scheduleReconnect()` emits `'reconnecting'` before arming its timer. A listener that calls `disconnect()` clears nothing, the timer is armed afterwards, and its `connect()` resets `intentionalClose` — the ladder outlives the disconnect. Task 3 adds an `'error'` emit at the same spot, so fix the order first.

**Files:**
- Modify: `src/client/SonosConnection.ts` (`scheduleReconnect()`, ~lines 486-522)
- Test: `tests/client/SonosConnection.test.ts` (new `describe` at the end)

**Interfaces:**
- Consumes: nothing new.
- Produces: `scheduleReconnect()` arms `this.reconnectTimer` before any log line or emit. Task 3 builds on this order.

- [ ] **Step 1: Write the failing test**

Append to `tests/client/SonosConnection.test.ts`:

```ts
describe('SonosConnection reconnect ladder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disconnect() from a 'reconnecting' listener stops the ladder", async () => {
    const conn = new SonosConnection(makeOptions({ pingInterval: 0, maxAttempts: Infinity }));
    conn.on('error', () => {});
    conn.on('reconnecting', () => { void conn.disconnect(); });

    conn.connect().catch(() => {});
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(getLastMockWs()).toBe(ws1);
    expect(conn.state).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "reconnecting' listener"`
Expected: FAIL — a second socket is created after 100 ms.

- [ ] **Step 3: Implement**

In `scheduleReconnect()`, move the `setTimeout` above the log line and the emit, with a comment. The tail of the method becomes:

```ts
    this.reconnectAttempt++;

    // Armed before it is announced, so a listener's disconnect() can cancel it.
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // onError already scheduled the next reconnect attempt for this
        // failure — do not schedule again here or we double-emit
        // RECONNECT_EXHAUSTED and halve the effective maxAttempts.
      }
    }, delay);

    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.emit('reconnecting', this.reconnectAttempt, delay);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run` (whole suite — the order change must not disturb any existing ladder test)
Expected: all pass.

- [ ] **Step 5: Mutation-verify**

Move the `setTimeout` back below the emit; expect exactly the new test to fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: arm the next reconnect before announcing it, so a listener's disconnect() stops the ladder"
```

---

### Task 3: The slow phase and `RECONNECT_SLOWED`

**Files:**
- Modify: `src/client/SonosConnection.ts` (`scheduleReconnect()`; new private `slowPhaseDelay()`)
- Test: `tests/client/SonosConnection.test.ts` (helpers near `makeOptions`; tests inside the `SonosConnection reconnect ladder` describe from Task 2)

**Interfaces:**
- Consumes: Task 1's `slowAfter`/`slowDelay`/`ErrorCode.RECONNECT_SLOWED`; Task 2's arm-then-announce order.
- Produces: `private slowPhaseDelay(attempt: number): number | undefined` — `slowDelay` when `attempt > slowAfter`, else `undefined`. Task 4 uses it in `connect()`. Test helpers `recordAttempts`, `startRefused`, `refuseUntil` (Task 4 uses them).

- [ ] **Step 1: Add the test helpers**

Below `makeOptions` in `tests/client/SonosConnection.test.ts`:

```ts
/** Records each attempt the ladder schedules, as [attempt, delay]. */
function recordAttempts(conn: SonosConnection): Array<[number, number]> {
  const scheduled: Array<[number, number]> = [];
  conn.on('reconnecting', (attempt, delay) => scheduled.push([attempt, delay]));
  return scheduled;
}

/** Starts `conn` against a speaker that refuses it: the first attempt fails and the ladder begins. */
function startRefused(conn: SonosConnection): void {
  conn.connect().catch(() => {});
  getLastMockWs()._emit('error', new Error('ECONNREFUSED'));
}

/**
 * Lets the ladder run, refusing every attempt it makes, until `scheduled` holds `count` attempts or the ladder
 * stops scheduling (exhausted). Each step advances exactly the last attempt's delay, so its socket exists.
 */
async function refuseUntil(scheduled: Array<[number, number]>, count: number): Promise<void> {
  while (scheduled.length > 0 && scheduled.length < count) {
    const before = scheduled.length;
    await vi.advanceTimersByTimeAsync(scheduled[before - 1]![1]);
    getLastMockWs()._emit('error', new Error('ECONNREFUSED'));
    if (scheduled.length === before) return;
  }
}
```

Add `import { ConnectionError } from '../../src/errors/ConnectionError.js';` to the imports.

- [ ] **Step 2: Write the tests**

Inside the `SonosConnection reconnect ladder` describe (after Task 2's test). `makeOptions` defaults: `initialDelay 100`, `maxDelay 1000`, `factor 2`.

```ts
  it('with slowAfter and slowDelay unset, the ladder is exactly the exponential one and exhausts at maxAttempts', async () => {
    const conn = new SonosConnection(makeOptions({ pingInterval: 0, maxAttempts: 6 }));
    const codes: string[] = [];
    conn.on('error', (e: any) => codes.push(e.code));
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 20);

    expect(scheduled).toEqual([[1, 100], [2, 200], [3, 400], [4, 800], [5, 1000], [6, 1000]]);
    expect(codes.filter((c) => c === 'RECONNECT_EXHAUSTED')).toHaveLength(1);
    expect(codes).not.toContain('RECONNECT_SLOWED');
  });

  it('past slowAfter every attempt waits slowDelay, and with maxAttempts Infinity nothing exhausts', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 3, slowDelay: 5000 }),
    );
    const codes: string[] = [];
    conn.on('error', (e: any) => codes.push(e.code));
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 8);

    expect(scheduled).toEqual([[1, 100], [2, 200], [3, 400], [4, 5000], [5, 5000], [6, 5000], [7, 5000], [8, 5000]]);
    expect(codes).not.toContain('RECONNECT_EXHAUSTED');
    expect(conn.state).toBe('reconnecting');
  });

  it('signals RECONNECT_SLOWED once, as a ConnectionError, just before attempt slowAfter + 1', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 3, slowDelay: 5000 }),
    );
    const slowed: unknown[] = [];
    const events: string[] = [];
    conn.on('error', (e: any) => {
      if (e.code !== 'RECONNECT_SLOWED') return;
      slowed.push(e);
      events.push(`slowed: ${e.message}`);
    });
    conn.on('reconnecting', (attempt) => events.push(`attempt ${attempt}`));
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 7);

    expect(events).toEqual([
      'attempt 1', 'attempt 2', 'attempt 3',
      'slowed: Reconnect slowed after 3 attempts; retrying every 5000ms',
      'attempt 4', 'attempt 5', 'attempt 6', 'attempt 7',
    ]);
    expect(slowed[0]).toBeInstanceOf(ConnectionError);
  });

  it('an external connect() that fails in the slow phase does not signal again', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 2, slowDelay: 5000 }),
    );
    const slowed: unknown[] = [];
    conn.on('error', (e: any) => { if (e.code === 'RECONNECT_SLOWED') slowed.push(e); });
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 4);
    // Something outside the ladder tries while attempt 4 waits; that fails too.
    conn.connect().catch(() => {});
    getLastMockWs()._emit('error', new Error('ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduled.at(-1)).toEqual([5, 5000]);
    expect(slowed).toHaveLength(1);
  });

  it('a successful open resets the ladder: the next outage starts fast and signals again', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 2, slowDelay: 5000 }),
    );
    const slowed: unknown[] = [];
    conn.on('error', (e: any) => { if (e.code === 'RECONNECT_SLOWED') slowed.push(e); });
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 3);
    await vi.advanceTimersByTimeAsync(5000);
    getLastMockWs()._emit('open'); // attempt 3 answers
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.state).toBe('connected');

    // A second outage.
    scheduled.length = 0;
    getLastMockWs()._emit('close', 1006, Buffer.from(''));
    await refuseUntil(scheduled, 3);

    expect(scheduled).toEqual([[1, 100], [2, 200], [3, 5000]]);
    expect(slowed).toHaveLength(2);
  });

  it('a finite maxAttempts above slowAfter slows first, then exhausts once', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: 4, slowAfter: 2, slowDelay: 5000 }),
    );
    const codes: string[] = [];
    conn.on('error', (e: any) => { if (e.code !== 'CONNECTION_FAILED') codes.push(e.code); });
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 20);

    expect(scheduled).toEqual([[1, 100], [2, 200], [3, 5000], [4, 5000]]);
    expect(codes).toEqual(['RECONNECT_SLOWED', 'RECONNECT_EXHAUSTED']);
  });

  it('a maxAttempts at or below slowAfter exhausts without ever slowing', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: 2, slowAfter: 2, slowDelay: 5000 }),
    );
    const codes: string[] = [];
    conn.on('error', (e: any) => { if (e.code !== 'CONNECTION_FAILED') codes.push(e.code); });
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 20);

    expect(scheduled).toEqual([[1, 100], [2, 200]]);
    expect(codes).toEqual(['RECONNECT_EXHAUSTED']);
  });

  it('keeps retrying past where a cap of slowAfter would have exhausted, and reconnects when the speaker answers', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 3, slowDelay: 5000 }),
    );
    conn.on('error', () => {});
    const connected = vi.fn();
    conn.on('connected', connected);
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 10);
    // Without a slow phase an Infinity ladder also keeps going; the delay is what says this one is slow.
    expect(scheduled.at(-1)).toEqual([10, 5000]);
    await vi.advanceTimersByTimeAsync(5000); // attempt 10 builds its socket
    getLastMockWs()._emit('open');

    expect(connected).toHaveBeenCalledTimes(1);
    expect(conn.state).toBe('connected');
  });

  it('disconnect() from a RECONNECT_SLOWED listener stops the ladder', async () => {
    const conn = new SonosConnection(
      makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 2, slowDelay: 5000 }),
    );
    conn.on('error', (e: any) => { if (e.code === 'RECONNECT_SLOWED') void conn.disconnect(); });
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 2);
    await vi.advanceTimersByTimeAsync(200); // attempt 2 builds its socket
    const last = getLastMockWs();
    last._emit('error', new Error('ECONNREFUSED')); // attempt 3 would be the first slow one

    await vi.advanceTimersByTimeAsync(60_000);

    expect(getLastMockWs()).toBe(last);
    expect(scheduled).toEqual([[1, 100], [2, 200]]);
    expect(conn.state).toBe('disconnected');
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "reconnect ladder"`
Expected: the unset-pin test and `a maxAttempts at or below slowAfter` PASS already (they are pins; Step 6 proves they bite). Every other new test FAILS (no slow phase, no signal).

- [ ] **Step 4: Implement**

Add the helper to `SonosConnection` (next to `clearReconnectTimer()`):

```ts
  /** The delay before ladder attempt `attempt` if it falls in the slow phase; undefined on the exponential ladder. */
  private slowPhaseDelay(attempt: number): number | undefined {
    const { slowAfter, slowDelay } = this.options.reconnect;
    return slowAfter !== undefined && attempt > slowAfter ? slowDelay : undefined;
  }
```

Replace `scheduleReconnect()` from `this._state = 'reconnecting';` to the end of the method with:

```ts
    this._state = 'reconnecting';
    const attempt = ++this.reconnectAttempt;
    const { initialDelay, factor, maxDelay, slowAfter } = this.options.reconnect;
    const slowDelay = this.slowPhaseDelay(attempt);
    const delay = slowDelay ?? Math.min(initialDelay * Math.pow(factor, attempt - 1), maxDelay);

    // Armed before it is announced, so a listener's disconnect() can cancel it.
    const timer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // onError already scheduled the next reconnect attempt for this
        // failure — do not schedule again here or we double-emit
        // RECONNECT_EXHAUSTED and halve the effective maxAttempts.
      }
    }, delay);
    this.reconnectTimer = timer;

    // The first slow attempt, so once per outage:
    // - the counter only rises within an outage and resets on open
    // - an external connect() that fails moves it past this value, never back onto it
    if (slowDelay !== undefined && attempt - 1 === slowAfter) {
      const message = `Reconnect slowed after ${slowAfter} attempts; retrying every ${slowDelay}ms`;
      this.log.info(message);
      this.emit('error', new ConnectionError(ErrorCode.RECONNECT_SLOWED, message));
      // A listener disconnected: nothing left to announce.
      if (this.reconnectTimer !== timer) return;
    }

    this.log.info(`Reconnecting in ${delay}ms (attempt ${attempt})`);
    this.emit('reconnecting', attempt, delay);
  }
```

The exhaustion block above it stays exactly as it is.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 6: Mutation-verify**

One at a time, each restored before the next:
- `Math.pow(factor, attempt - 1)` → `Math.pow(factor, attempt)`: the unset-pin test fails (as do other ladder tests — fine; the pin must be among them).
- `attempt - 1 === slowAfter` → `attempt > slowAfter!`: the `signals RECONNECT_SLOWED once` test and the external-connect test fail.
- Delete `this.reconnectAttempt = 0;` in `onOpen`: the reset test fails.
- Delete `if (this.reconnectTimer !== timer) return;`: the `RECONNECT_SLOWED listener` test fails.
- In `slowPhaseDelay`, return `undefined` always: the `past slowAfter` and self-heal tests fail.

- [ ] **Step 7: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "feat: slow reconnect phase past slowAfter, with one RECONNECT_SLOWED per outage"
```

---

### Task 4: Quiet the ladder's log lines in the slow phase

**Files:**
- Modify: `src/client/SonosConnection.ts` (`connect()`'s `Connecting to` line, ~line 174; `scheduleReconnect()`'s `Reconnecting in` line)
- Test: `tests/client/SonosConnection.test.ts` (inside the `SonosConnection reconnect ladder` describe)

**Interfaces:**
- Consumes: Task 3's `slowPhaseDelay(attempt)` and the test helpers `recordAttempts`, `startRefused`, `refuseUntil`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

```ts
  const URL_LINE = 'Connecting to wss://192.168.68.96:1443/websocket/api';

  /** The ladder's own lines a logger method received, in order. */
  const ladderLines = (logger: any, level: 'info' | 'debug') =>
    logger[level].mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((line: string) => /^(Connecting to|Reconnecting in|Reconnect slowed)/.test(line));

  it('with slowAfter unset, every ladder line stays at info', async () => {
    const options = makeOptions({ pingInterval: 0, maxAttempts: 3 });
    const conn = new SonosConnection(options);
    conn.on('error', () => {});
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 20);

    expect(ladderLines(options.logger, 'info')).toEqual([
      URL_LINE, 'Reconnecting in 100ms (attempt 1)',
      URL_LINE, 'Reconnecting in 200ms (attempt 2)',
      URL_LINE, 'Reconnecting in 400ms (attempt 3)',
      URL_LINE,
    ]);
    expect(ladderLines(options.logger, 'debug')).toEqual([]);
  });

  it('logs the fast phase at info, the switch once at info, and the slow phase at debug', async () => {
    const options = makeOptions({ pingInterval: 0, maxAttempts: Infinity, slowAfter: 2, slowDelay: 5000 });
    const conn = new SonosConnection(options);
    conn.on('error', () => {});
    const scheduled = recordAttempts(conn);

    startRefused(conn);
    await refuseUntil(scheduled, 4);

    expect(ladderLines(options.logger, 'info')).toEqual([
      URL_LINE, 'Reconnecting in 100ms (attempt 1)',
      URL_LINE, 'Reconnecting in 200ms (attempt 2)',
      URL_LINE, 'Reconnect slowed after 2 attempts; retrying every 5000ms',
    ]);
    expect(ladderLines(options.logger, 'debug')).toEqual([
      'Reconnecting in 5000ms (attempt 3)',
      URL_LINE, 'Reconnecting in 5000ms (attempt 4)',
    ]);
  });
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "ladder line|slow phase at debug"`
Expected: `with slowAfter unset` PASSES (a pin); `logs the fast phase…` FAILS (slow lines are still at info).

- [ ] **Step 3: Implement**

In `connect()`, replace `this.log.info(\`Connecting to ${url}\`);` with:

```ts
      // Slow-phase attempts repeat this for as long as the speaker is away.
      const level = this.slowPhaseDelay(this.reconnectAttempt) === undefined ? 'info' : 'debug';
      this.log[level](`Connecting to ${url}`);
```

(The ladder increments `reconnectAttempt` before its timer calls `connect()`, so the counter names the attempt being made.)

In `scheduleReconnect()`, replace `this.log.info(\`Reconnecting in ${delay}ms (attempt ${attempt})\`);` with:

```ts
    this.log[slowDelay === undefined ? 'info' : 'debug'](`Reconnecting in ${delay}ms (attempt ${attempt})`);
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 5: Mutation-verify**

Change the `connect()` level to always `'info'`: `logs the fast phase…` fails. Restore. Change the `Reconnecting in` level to always `'debug'`: both tests fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "feat: log the slow reconnect phase at debug"
```

---

### Task 5: The household owns its speaker sockets' errors

**Files:**
- Modify: `src/household/SonosHousehold.ts` — `createSpeakerConnection()` (~lines 494-507, signature gains `player`), its call in `connectToSpeaker()` (~line 473), the `Initial connect …` warn in `connectToSpeaker()` (~line 485) and the `Failed to reconnect speaker` warn in `reconnectSpeakers()` (~line 583)
- Test: `tests/household/SonosHousehold.multi.test.ts`

**Interfaces:**
- Consumes: `ErrorCode.RECONNECT_SLOWED` (Task 1); `ConnectionError` and `ErrorCode` are already imported in `SonosHousehold.ts`.
- Produces: `private createSpeakerConnection(player: Player, url: URL): SonosConnection`. Speaker errors are logged as `Speaker <name> (<host>): <message>` and never emitted on the household.

- [ ] **Step 1: Extend the test file's mock and helper**

In the `vi.mock` factory of `tests/household/SonosHousehold.multi.test.ts`, add `opts,` to the `inst` object (after `host: opts.host,`) so a test can read the options a socket was built with.

Change `connectedHousehold` to accept options:

```ts
async function connectedHousehold(
  start: GroupsResponse,
  options: Partial<SonosHouseholdOptions> = {},
): Promise<SonosHousehold> {
  instances.length = 0;
  topology = start;
  const household = new SonosHousehold({ host: PRIMARY, ...options });
  await household.connect();
  return household;
}
```

Imports to add:

```ts
import type { SonosHouseholdOptions } from '../../src/household/SonosHousehold.js';
import { ConnectionError } from '../../src/errors/ConnectionError.js';
import { ErrorCode } from '../../src/types/errors.js';
```

- [ ] **Step 2: Write the tests**

Append:

```ts
describe('speaker socket errors', () => {
  const refused = () => new ConnectionError(ErrorCode.CONNECTION_FAILED, 'Failed to connect: ECONNREFUSED');
  const slowed = () =>
    new ConnectionError(ErrorCode.RECONNECT_SLOWED, 'Reconnect slowed after 94 attempts; retrying every 300000ms');
  const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const officeLines = (log: any, level: 'warn' | 'debug') =>
    log[level].mock.calls.map((call: unknown[]) => String(call[0])).filter((l: string) => l.startsWith('Speaker Office'));

  it("forwards the primary's RECONNECT_SLOWED to the household, and never a speaker's", async () => {
    const household = await connectedHousehold(solo);
    const heard: string[] = [];
    household.on('error', (e: any) => heard.push(e.code));

    socket(OFFICE_IP)._emit('error', slowed());
    socket(BED_IP)._emit('error', slowed());
    socket(PRIMARY)._emit('error', slowed());

    expect(heard).toEqual(['RECONNECT_SLOWED']);
  });

  it("logs a speaker's failed attempts at warn once per outage, the rest at debug, and nothing at error", async () => {
    const log = logger();
    await connectedHousehold(solo, { logger: log });

    socket(OFFICE_IP)._emit('error', refused());
    socket(OFFICE_IP)._emit('error', refused());
    socket(OFFICE_IP)._emit('error', refused());
    socket(OFFICE_IP)._emit('error', slowed());
    socket(OFFICE_IP)._emit('error', refused());

    expect(officeLines(log, 'warn')).toEqual([
      `Speaker Office (${OFFICE_IP}): Failed to connect: ECONNREFUSED`,
      `Speaker Office (${OFFICE_IP}): Reconnect slowed after 94 attempts; retrying every 300000ms`,
    ]);
    expect(officeLines(log, 'debug')).toHaveLength(3);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("warns again for a speaker's next outage once its socket has connected", async () => {
    const log = logger();
    await connectedHousehold(solo, { logger: log });

    socket(OFFICE_IP)._emit('error', refused());
    socket(OFFICE_IP)._emit('error', refused());
    socket(OFFICE_IP)._emit('connected');
    socket(OFFICE_IP)._emit('error', refused());

    expect(officeLines(log, 'warn')).toHaveLength(2);
    expect(officeLines(log, 'debug')).toHaveLength(1);
  });

  it("hands every speaker socket the household's reconnect options, slow tail included", async () => {
    const reconnect = { maxAttempts: Infinity, slowAfter: 94, slowDelay: 300_000 };
    await connectedHousehold(solo, { reconnect });

    for (const host of [PRIMARY, OFFICE_IP, BED_IP]) {
      expect(socket(host).opts.reconnect).toMatchObject(reconnect);
    }
  });
});
```

The speaker self-heal HOA asked to see pinned is this chain, each link tested: a speaker socket gets the slow-tail options (the last test above); a socket with them keeps retrying past `slowAfter` and reconnects when the speaker answers (Task 3, `keeps retrying past where a cap…`); a speaker socket's own `'connected'` re-sends its subscriptions without the primary reconnecting (existing test `restores a speaker's subscriptions when its own socket reconnects`). Name all three in the task report.

- [ ] **Step 3: Run to verify**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "speaker socket errors"`
Expected: `forwards the primary's…` PASSES (a pin: speaker errors are not forwarded today); `hands every speaker socket…` PASSES (a pin: the options are shared today); the two logging tests FAIL (no listener logs anything).

- [ ] **Step 4: Implement**

Replace `createSpeakerConnection()`:

```ts
  /**
   * Builds and wires a speaker's connection. Its events reach listeners like the primary's; its errors are only
   * logged, because the household's 'error' is about the primary.
   */
  private createSpeakerConnection(player: Player, url: URL): SonosConnection {
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });
    const who = `Speaker ${player.name} (${url.hostname})`;
    // One warn per outage, the rest at debug; reset when the socket connects.
    let failing = false;
    conn.on('message', (msg) => this.handleMessage(msg));
    // A reconnected socket holds no subscriptions.
    conn.on('connected', () => {
      failing = false;
      void this.resubscribeAll();
    });
    conn.on('error', (err) => {
      if (err instanceof ConnectionError && err.code === ErrorCode.CONNECTION_FAILED) {
        if (failing) {
          this.log.debug(`${who}: ${err.message}`);
          return;
        }
        failing = true;
      }
      this.log.warn(`${who}: ${err.message}`);
    });
    return conn;
  }
```

In `connectToSpeaker()`: `const conn = existing ?? this.createSpeakerConnection(url);` → `const conn = existing ?? this.createSpeakerConnection(player, url);`, and the catch's `this.log.warn(\`Initial connect to ${player.name} failed; reconnect loop will retry\`, err);` → `this.log.debug(…)` (same arguments; the speaker's error listener already warned for this failure).

In `reconnectSpeakers()`: `this.log.warn(\`Failed to reconnect speaker ${playerId}:\`, err)` → `this.log.debug(…)` (same reason).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; tsc clean. If an existing test asserted either demoted warn line, update it to `debug` and say so in the report.

- [ ] **Step 6: Mutation-verify**

- Add `this.emit('error', err);` at the end of the speaker `'error'` listener: `forwards the primary's…` fails. Restore.
- Delete `failing = false;` in the speaker `'connected'` listener: `warns again…` fails. Restore.
- In `createSpeakerConnection`, pass `reconnect: { ...this.reconnectOptions, slowAfter: undefined, slowDelay: undefined }`: `hands every speaker socket…` fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "feat: the household logs its speaker sockets' errors quietly and never forwards them

A speaker's failed attempts now log one warn per outage and debug after it,
instead of an 'Unhandled connection error' at ERROR on every attempt. This
applies with slowAfter unset too: production logs less, and does the same."
```

---

### Task 6: The published backoff contract, README and project guide

**Files:**
- Modify: `tests/household/SonosHousehold.test.ts:492-552` (`default backoff shape is a published contract`)
- Modify: `README.md` (new `### Reconnection` section after `### Events`, before `### Discovery`)
- Modify: `CLAUDE.md` (Invariants; Known-open follow-ups)

**Interfaces:**
- Consumes: everything above.
- Produces: docs only, plus the moved contract test.

- [ ] **Step 1: Update the contract test**

In the describe's comment block, replace the first paragraph ("Consumers size their recovery window … still fires.") with:

```ts
  // Consumers size their recovery window by multiplying these three defaults
  // out to a wall-clock duration. Neurotto does exactly this: it sets
  // slowAfter to 94 to get a ~45 minute fast ladder before RECONNECT_SLOWED
  // (its "Sonos may be offline" alert), then retries every slowDelay with
  // maxAttempts Infinity, so it never gives up.
  //
  // The 45 minutes are waits only: a handshake that hangs adds connectTimeout
  // (10 s) per attempt, ~61 minutes in all.
```

In the "coupling runs both ways" paragraph: "The 94 below is a copy of Neurotto's RECONNECT_POLICY" → "The 94 below is a copy of Neurotto's RECONNECT_POLICY.slowAfter", and "when Neurotto's cap changes" → "when Neurotto's slowAfter changes". Leave the rest of the block as it is.

Widen the cast in `optionsHandedToConnection()`:

```ts
        reconnect: {
          initialDelay: number; factor: number; maxDelay: number; maxAttempts: number;
          slowAfter?: number; slowDelay?: number;
        };
```

Add after `retries indefinitely unless the consumer caps it`:

```ts
    it('has no slow phase unless the consumer asks for one', () => {
      const { reconnect } = optionsHandedToConnection();
      expect(reconnect.slowAfter).toBeUndefined();
      expect(reconnect.slowDelay).toBeUndefined();
    });
```

Rename `yields a ~45 minute ladder at the cap Neurotto chose` → `yields a ~45 minute fast phase at the slowAfter Neurotto chose`; in its body rename the helper `windowFor(maxAttempts)` → `windowFor(attempts)` (loop bound included) and keep `windowFor(94)` and the 44–46 bounds.

- [ ] **Step 2: Run and mutation-verify**

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: PASS. Mutation: in `src/household/SonosHousehold.ts` `DEFAULT_RECONNECT`, add `slowAfter: 94, slowDelay: 300_000,`; `has no slow phase…` fails. Restore. (The `maxDelay` mutation from the 2026-09-12 lesson still applies to the window test; no need to repeat it.)

- [ ] **Step 3: README**

Insert before `### Discovery`:

````markdown
### Reconnection

Every socket reconnects by itself after a drop, backing off exponentially. Tune it with `reconnect` (every field optional), or turn it off with `reconnect: false`:

| Option | Default | Meaning |
|---|---|---|
| `initialDelay` | `1000` | ms before the first retry |
| `factor` | `2` | backoff multiplier per retry |
| `maxDelay` | `30000` | ceiling on the backoff, ms |
| `maxAttempts` | `Infinity` | give up after this many retries, with `'error'` `RECONNECT_EXHAUSTED` |
| `slowAfter` | unset | after this many retries, switch to one retry every `slowDelay`, with `'error'` `RECONNECT_SLOWED` once per outage |
| `slowDelay` | unset | ms between retries in the slow phase; set together with `slowAfter` |
| `pingInterval` | `30000` | ms between keepalive pings; `0` disables them |
| `pongTimeout` | `10000` | ms to wait for a pong before treating the socket as dead |

```typescript
// Retry fast for ~45 minutes, then every 5 minutes for as long as it takes; hear about it once.
const household = new SonosHousehold({
  host: '192.168.1.100',
  reconnect: { maxAttempts: Infinity, slowAfter: 94, slowDelay: 300_000 },
});
household.on('error', (err) => {
  if (err instanceof ConnectionError && err.code === ErrorCode.RECONNECT_SLOWED) {
    // The primary speaker has been unreachable for a while; retries continue.
  }
});
```

Every speaker's socket uses the same options. Speaker sockets log their errors (one warning per outage) rather than emitting them, so the household's `'error'` is always about the primary speaker. A connection attempt that hangs mid-handshake also spends up to 10 s failing, so the slow phase can start later than the waits alone suggest.
````

- [ ] **Step 4: CLAUDE.md**

Under "## Invariants worth not breaking", append:

```markdown
- `RECONNECT_SLOWED` fires once per outage: the attempt counter only rises within an outage and resets only on open, and the signal fires as it crosses `slowAfter`. `scheduleReconnect()` arms the next timer before it logs or emits, so a listener's `disconnect()` cancels it. With `slowAfter`/`slowDelay` unset the ladder is exactly the pre-09-29 one (pinned).
- The household's `'error'` is its primary's. Speaker sockets' errors are the household's to log (one warn per outage), never to emit — Neurotto alerts on `RECONNECT_SLOWED`, and a speaker must not trigger it.
```

In "## Known-open follow-ups", replace the sentence beginning "**Pending design (not built):** a slow reconnect tail" through "…are in the 2026-09-28 handoff." with:

```markdown
The slow reconnect tail (`slowAfter`/`slowDelay`, `RECONNECT_SLOWED`) is built per the 09-29 addendum to the resilience spec; two follow-ups from it: after a long whole-house outage `reconnectSpeakers()` kicks only `'disconnected'` speakers, so a slow-phase speaker can lag the primary by up to `slowDelay`; and a speaker that leaves the topology keeps its socket retrying (closing it needs a reopen-on-return path the household lacks).
```

(Do not touch "## Current state" — the deploy updates it.)

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add tests/household/SonosHousehold.test.ts README.md CLAUDE.md
git commit -m "docs: the backoff contract moves to slowAfter; document reconnection and the slow tail"
```

---

### Task 7: Rebuild dist

**Files:**
- Modify: `dist/**` (generated)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: tsup completes with no errors.

- [ ] **Step 2: Check the diff is dist-only and carries the feature**

Run: `git status --porcelain` — only `dist/` paths. Run: `grep -c RECONNECT_SLOWED dist/index.js dist/index.cjs 2>/dev/null; ls dist` — the code is present in the built output (adjust file names to what `ls dist` shows).

- [ ] **Step 3: Full verification**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all pass (158 + the new tests); tsc clean.

- [ ] **Step 4: Commit**

```bash
git add dist
git commit -m "chore: rebuild dist with the slow reconnect tail"
```
