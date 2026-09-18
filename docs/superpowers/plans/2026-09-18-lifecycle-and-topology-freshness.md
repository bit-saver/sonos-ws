# Connection Lifecycle and Topology Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining ways a `SonosConnection` can leave a caller waiting forever or run two reconnect ladders, and keep `SonosHousehold`'s group topology current after every regroup instead of freezing on a mid-transition snapshot.

**Architecture:** Three surgical fixes to `SonosConnection` (settle the caller on disconnect-mid-handshake; one reconnect timer at a time; every attempt's handlers act only on their own socket and a close abandons it), then one behaviour change to `SonosHousehold`: subscribe to `groups:1` and re-read topology, debounced, after any groups event. No public API changes.

**Tech Stack:** TypeScript 5.9, `ws` 8.x, vitest 2.x (fake timers), Bun 1.3 in production.

**Spec:** `docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md` — read the "Addendum 2026-09-18" section, especially "Stale topology after a regroup" and "Reviewer findings deferred to a planned follow-up". Each task below maps to one item there.

## Global Constraints

- No `Co-Authored-By` lines in commit messages.
- TDD: write the failing test, run it and watch it fail for the stated reason, then write the minimal implementation.
- Every guard a test exists for must be **mutation-verified**: after the test passes, break the guarded line, confirm exactly that test fails, restore. A guard test never seen failing does not count.
- All existing tests must still pass (70 at the start of this plan); `npx tsc --noEmit` clean.
- Bun ignores `ws`'s own options, so every mechanism must be library-level (timers, listeners), never a `ws` constructor option.
- The ws mock's `_emit('error')` throws when no listener is attached, mirroring Node. Do not weaken that — it is what makes unlistened-emitter bugs reproducible.
- Do not touch anything outside `src/client/SonosConnection.ts`, `src/household/SonosHousehold.ts`, their test files, `dist/` (Task 5 only) and the spec (Task 5 only).
- Run tests with `npx vitest run <file> -t "<name>"` from the repo root `/home/bitsaver/workspace/sonos-ws`.

## File Structure

- `src/client/SonosConnection.ts` — Tasks 1–3. All three change the connection's own lifecycle: `connect()`'s executor, `disconnect()`, `scheduleReconnect()`.
- `tests/client/SonosConnection.test.ts` — Tasks 1–3 add one `describe('connection lifecycle')` block at the end of the file.
- `src/household/SonosHousehold.ts` — Task 4: subscription, debounced refresh, reconnect and disconnect wiring.
- `tests/household/SonosHousehold.test.ts` — Task 4 adds one `describe('topology follows group changes')` block at the end.

---

### Task 1: `disconnect()` during a handshake settles the caller and tears the socket down

**Why:** `disconnect()` sets `connectReject = null` without calling it, so a caller awaiting `connect()` waits forever. It also only closes sockets that are already OPEN, so a socket still handshaking keeps going in the background with no listeners and can open as an orphan connection. The handshake timer does not help: its identity guard sees `this.ws !== socket` and returns.

**Files:**
- Modify: `src/client/SonosConnection.ts` — `disconnect()`
- Test: `tests/client/SonosConnection.test.ts` — new `describe('connection lifecycle')` at end of file

**Interfaces:**
- Consumes: existing `ConnectionError`, `ErrorCode.CONNECTION_LOST`, `abandonSocket(ws)`.
- Produces: `disconnect()` now rejects a pending `connect()` with `ConnectionError(CONNECTION_LOST, 'Client disconnected')`. Tasks 2 and 3 add tests to the same `describe` block.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/client/SonosConnection.test.ts`:

```ts
describe('connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disconnect() during a handshake rejects the waiting caller and tears the socket down', async () => {
    // A long connectTimeout, so the rejection can only come from disconnect().
    const conn = new SonosConnection({ ...makeOptions({ pingInterval: 0 }), connectTimeout: 60_000 });
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1.readyState = 0; // CONNECTING — the mock defaults to OPEN
    const assertion = expect(pending).rejects.toThrow(/Client disconnected/);

    await conn.disconnect();

    await assertion;
    expect(ws1.terminate).toHaveBeenCalled();
    expect(ws1.close).not.toHaveBeenCalled();
    expect(conn.state).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "disconnect\(\) during a handshake"`
Expected: FAIL — `Test timed out in 5000ms` (the promise never settles). If it fails for any other reason, fix the test before continuing.

- [ ] **Step 3: Implement**

Replace the body of `disconnect()` in `src/client/SonosConnection.ts` with:

```ts
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();

    // A caller may still be awaiting a handshake. Settle it: nulling the
    // rejecter without calling it leaves that caller waiting forever.
    const rejectPending = this.connectReject;
    this.connectPromise = null;
    this.connectReject = null;
    rejectPending?.(new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'));

    this.correlator.rejectAll(
      new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'),
    );

    this.stopPing();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'client disconnect');
        this.abandonSocket(socket);
      } else {
        // Still handshaking: left alone it would finish in the background
        // and open as an orphan with no listeners. Abandon first so the
        // teardown's own 'error'/'close' land on the sink, then terminate.
        this.abandonSocket(socket);
        socket.terminate();
      }
    }

    this._state = 'disconnected';
    this.emit('disconnected', 'client disconnect');
  }
```

- [ ] **Step 4: Run it and watch it pass, then run the whole file**

Run: `npx vitest run tests/client/SonosConnection.test.ts`
Expected: all pass.

- [ ] **Step 5: Mutation-verify both guards**

1. Delete the line `rejectPending?.(new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'));` → re-run the Step 2 command → must FAIL (timeout). Restore.
2. Delete the line `socket.terminate();` → re-run → must FAIL on `expect(ws1.terminate).toHaveBeenCalled()`. Restore.

Run the whole file again: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: settle a pending connect() and terminate the socket on disconnect mid-handshake"
```

---

### Task 2: At most one reconnect ladder

**Why:** `scheduleReconnect()` overwrites `this.reconnectTimer` without clearing it. If `connect()` is called from outside while a ladder is waiting (`'reconnecting'`) and that attempt fails, `onError` schedules a second timer while the first is still pending: two interleaved ladders, and `RECONNECT_EXHAUSTED` emitted twice — so a consumer's "offline" notification fires twice. Reachable from `SonosHousehold.connectToSpeaker`, which calls `connect()` on any connection not `'connected'`.

**Files:**
- Modify: `src/client/SonosConnection.ts` — `scheduleReconnect()`
- Test: `tests/client/SonosConnection.test.ts` — add inside `describe('connection lifecycle')`

**Interfaces:**
- Consumes: existing `clearReconnectTimer()`.
- Produces: the invariant "at most one pending reconnect timer".

- [ ] **Step 1: Write the failing test**

Add inside `describe('connection lifecycle', …)`, after the Task 1 test:

```ts
  it('an external connect() while a ladder waits does not start a second ladder', async () => {
    // factor 2 staggers the two ladders' timers so they cannot merge into
    // one attempt by coincidence: ladder A's first retry lands at t=1000,
    // the external failure at t=500 schedules its retry for t=2500.
    const conn = new SonosConnection({
      ...makeOptions({ maxAttempts: 4, initialDelay: 1000, maxDelay: 16_000, factor: 2, pingInterval: 0 }),
      connectTimeout: 60_000,
    });
    const exhausted: unknown[] = [];
    conn.on('error', (e: any) => {
      if (e?.code === 'RECONNECT_EXHAUSTED') exhausted.push(e);
    });

    // Initial attempt fails at t=0: ladder retry scheduled for t=1000.
    conn.connect().catch(() => {});
    getLastMockWs()._emit('error', new Error('ECONNREFUSED'));

    // Something outside the ladder calls connect() while it waits; that fails too.
    await vi.advanceTimersByTimeAsync(500);
    conn.connect().catch(() => {});
    getLastMockWs()._emit('error', new Error('ECONNREFUSED'));

    // Fail every attempt that follows, until nothing is left scheduled.
    let seen = getLastMockWs();
    for (let t = 0; t < 120_000; t += 250) {
      await vi.advanceTimersByTimeAsync(250);
      const ws = getLastMockWs();
      if (ws !== seen) {
        seen = ws;
        ws._emit('error', new Error('ECONNREFUSED'));
      }
    }

    expect(exhausted).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "does not start a second ladder"`
Expected: FAIL — `expected [ …, … ] to have a length of 1 but got 2`.

- [ ] **Step 3: Implement**

In `scheduleReconnect()` in `src/client/SonosConnection.ts`, make the first statement of the method:

```ts
    // At most one ladder. A failure outside the ladder (an external
    // connect() while it waits) reaches here with the ladder's timer still
    // pending; overwriting it would leave both running and exhaust twice.
    this.clearReconnectTimer();
```

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run tests/client/SonosConnection.test.ts`
Expected: all pass.

- [ ] **Step 5: Mutation-verify**

Delete the `this.clearReconnectTimer();` line you added → re-run the Step 2 command → must FAIL with length 2. Restore. Run the whole file: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: keep a single reconnect ladder when a connect() fails outside it"
```

---

### Task 3: Each attempt's handlers act only on their own socket; a close abandons it

**Why:** After a close-before-open, `handleClose` fails the attempt and schedules the next — but the dead socket keeps its `onOpen` and `onError` listeners, because only `cleanup()` removes them and the close path never calls it. Those closures act on `this.ws`, which by then is the *next* attempt's socket. A late `'error'` from the dead socket therefore runs attempt 1's `onError` against attempt 2: it abandons attempt 2's socket, nulls attempt 2's `connectPromise` (its caller waits forever), and schedules a second ladder.

**Files:**
- Modify: `src/client/SonosConnection.ts` — `connect()` executor: `onOpen`, `onError`, `cleanup`, the `'close'` listener
- Test: `tests/client/SonosConnection.test.ts` — add inside `describe('connection lifecycle')`

**Interfaces:**
- Consumes: `abandonSocket(ws)`, `handleClose(code, reason)`.
- Produces: the invariant "no listener of a finished attempt can reach the current attempt".

- [ ] **Step 1: Write the failing test**

Add inside `describe('connection lifecycle', …)`:

```ts
  it('a late error from a socket that closed before opening does not touch the next attempt', async () => {
    const conn = new SonosConnection({ ...makeOptions({ pingInterval: 0 }), connectTimeout: 60_000 });
    conn.on('error', () => {});

    conn.connect().catch(() => {});
    const ws1 = getLastMockWs();
    ws1._emit('close', 1006, Buffer.from('handshake aborted'));

    // initialDelay is 100: the ladder's next attempt builds a new socket.
    await vi.advanceTimersByTimeAsync(100);
    const ws2 = getLastMockWs();
    expect(ws2).not.toBe(ws1);

    // The dead socket emits late, as Bun's do.
    expect(() => ws1._emit('error', new Error('late ECONNRESET'))).not.toThrow();
    expect(ws2.removeAllListeners).not.toHaveBeenCalled();

    // Attempt 2 must still be able to complete.
    ws2._emit('open');
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.state).toBe('connected');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts -t "closed before opening does not touch"`
Expected: FAIL on `expect(ws2.removeAllListeners).not.toHaveBeenCalled()`.

- [ ] **Step 3: Implement**

In `connect()`'s promise executor in `src/client/SonosConnection.ts`:

(a) Directly after the `this.ws = new WebSocket(url, SUB_PROTOCOL, { … });` statement, add:

```ts
      // Every handler below acts on THIS attempt's socket, never on
      // this.ws — which, by the time a late event arrives, may already be
      // the next attempt's socket.
      const socket = this.ws;
```

and delete the later line `const socket = this.ws;` that sits just above `const connectTimeout = …` (it is now declared earlier).

(b) In `onOpen`, change the two `this.ws!.on(` calls to `socket.on(`.

(c) In `onError`, replace

```ts
        if (this.ws) {
          this.abandonSocket(this.ws);
          this.ws = null;
        }
```

with

```ts
        this.abandonSocket(socket);
        if (this.ws === socket) this.ws = null;
```

(d) Replace `cleanup` with:

```ts
      const cleanup = () => {
        clearHandshakeTimer();
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
      };
```

(e) Replace the `'close'` listener with:

```ts
      socket.on('close', (code: number, reason: Buffer) => {
        // The socket is finished. Strip every listener of this attempt —
        // including onOpen/onError, which a close-before-open would otherwise
        // leave armed — so nothing late from it can reach the next attempt.
        // A surviving handshake timer would also double-schedule the
        // reconnect handleClose is about to schedule.
        cleanup();
        this.abandonSocket(socket);
        if (this.ws === socket) this.ws = null;
        this.handleClose(code, reason.toString());
      });
```

(f) Change the remaining `this.ws.once('open', …)`, `this.ws.once('error', …)` and `this.ws.on('message', …)` calls in the executor to `socket.…`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass. In particular the existing tests "does not double-schedule a reconnect when the socket closed before the deadline", "keeps reconnecting when a socket closes before it ever opens" and the ping-timeout tests must still pass — they exercise the same close path.

- [ ] **Step 5: Mutation-verify**

In the new `'close'` listener, delete the line `this.abandonSocket(socket);` → re-run the Step 2 command → must FAIL. Restore. Run `npx vitest run`: all pass.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — clean.

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: scope each connect attempt's handlers to its own socket and abandon it on close"
```

---

### Task 4: Keep topology current by following `groups:1` events

**Why:** On 2026-09-18 `refreshTopology()` adopted a mid-regroup `getGroups` snapshot (3 players, 1 group) and nothing re-read it for 38 minutes, because the household never subscribes to `groups:1`: topology is re-read only on a primary reconnect, a `groupCoordinatorChanged` reply, or a grouping call. Subscribing makes every later change — including regroups made from the Sonos app — trigger a fresh read. A regroup emits several events in quick succession, so the refresh is **debounced (trailing, 250 ms)**: one read after the burst, which reflects the settled state rather than a transition.

The refresh re-reads with `getGroups` rather than applying the event body: `getGroups` is authoritative and already the code path everything else uses, and the event's `_objectType` string is not pinned anywhere in this library's types, so the handler keys on the namespace alone.

**Files:**
- Modify: `src/household/SonosHousehold.ts` — new private field, two new private methods, `handleMessage()`, `handleReconnected()`, `disconnect()`
- Test: `tests/household/SonosHousehold.test.ts` — new `describe('topology follows group changes')` at end of file

**Interfaces:**
- Consumes: existing `this.householdGroups: GroupsNamespace` (has `subscribe()`), `refreshTopology()`, the mock connection's `_listeners` map and `send` mock in the test file.
- Produces: private `scheduleTopologyRefresh(): void`, private `subscribeToTopology(): Promise<void>`, module constant `TOPOLOGY_EVENT_DEBOUNCE_MS = 250`.

- [ ] **Step 1: Read the existing test harness**

Read `tests/household/SonosHousehold.test.ts` lines 1–90: the `vi.mock` of `SonosConnection`, `getMockConnection()`, `mockTopology`, and the first `describe`'s `beforeEach` (which re-wires `mockConn.on` to record listeners in `mockConn._listeners` and makes `send` answer `getGroups`). The new tests reuse all of it.

- [ ] **Step 2: Write the failing tests**

The file's first line imports `{ describe, it, expect, vi, beforeEach }` from vitest; add `afterEach` to that import. Then append to the end of `tests/household/SonosHousehold.test.ts`:

```ts
describe('topology follows group changes', () => {
  let household: SonosHousehold;
  let mockConn: any;
  let topology: GroupsResponse;

  const regrouped: GroupsResponse = {
    ...mockTopology,
    groups: [
      { id: 'RINCON_ARC:999', name: 'Arc + Office', coordinatorId: 'RINCON_ARC', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] },
      { id: 'RINCON_BED:789', name: 'Bedroom', coordinatorId: 'RINCON_BED', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_BED'] },
    ] as Group[],
  };

  const sent = (namespace: string, command: string) =>
    mockConn.send.mock.calls.filter(
      ([req]: any) => req[0].namespace === namespace && req[0].command === command,
    ).length;

  const groupsEvent = () => {
    const onMessage = mockConn._listeners.get('message')![0];
    onMessage([
      { namespace: 'groups:1', type: 'groups', householdId: 'HH_1' },
      { _objectType: 'groups', ...topology },
    ]);
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (SonosConnection as unknown as ReturnType<typeof vi.fn>).mockClear();

    topology = mockTopology;
    household = new SonosHousehold({ host: '192.168.68.96', autoConnect: false });
    mockConn = getMockConnection();
    mockConn._listeners.clear();
    mockConn.on.mockImplementation((event: string, handler: Function) => {
      if (!mockConn._listeners.has(event)) mockConn._listeners.set(event, []);
      mockConn._listeners.get(event)!.push(handler);
      return mockConn;
    });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'getGroups') {
        return Promise.resolve([{ householdId: 'HH_1', success: true }, topology]);
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    await household.connect();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to groups:1 once connected', () => {
    expect(sent('groups:1', 'subscribe')).toBe(1);
  });

  it('re-reads topology once after a burst of group events settles', async () => {
    const readsBefore = sent('groups:1', 'getGroups');
    topology = regrouped;

    groupsEvent();
    await vi.advanceTimersByTimeAsync(100);
    groupsEvent();
    await vi.advanceTimersByTimeAsync(100);
    groupsEvent();

    await vi.advanceTimersByTimeAsync(249);
    expect(sent('groups:1', 'getGroups')).toBe(readsBefore);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent('groups:1', 'getGroups')).toBe(readsBefore + 1);
    expect(household.groups).toHaveLength(2);
  });

  it('re-subscribes after a reconnect', async () => {
    const onConnected = mockConn._listeners.get('connected')![0];
    await onConnected();
    expect(sent('groups:1', 'subscribe')).toBe(2);
  });

  it('a pending refresh does not run after disconnect()', async () => {
    const readsBefore = sent('groups:1', 'getGroups');
    groupsEvent();
    await household.disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent('groups:1', 'getGroups')).toBe(readsBefore);
  });
});
```

If `SonosHousehold`'s options type does not accept `autoConnect`, check its name in `src/household/SonosHousehold.ts` (`options.autoConnect` is read in the constructor as of this plan) and use that.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/household/SonosHousehold.test.ts -t "topology follows group changes"`
Expected: FAIL — subscribe count 0; the burst causes no extra `getGroups`; re-subscribe count 0. ("a pending refresh does not run after disconnect()" may pass vacuously at this stage because nothing schedules a refresh yet — it becomes meaningful after Step 4 and is mutation-verified in Step 6.)

- [ ] **Step 4: Implement**

In `src/household/SonosHousehold.ts`:

(a) Below the existing `DEFAULT_RECONNECT` constant, add:

```ts
/**
 * A regroup emits several groups:1 events in quick succession, and a read
 * taken between them can catch players in no group at all. Waiting for the
 * burst to go quiet means the one read that follows sees the settled state.
 */
const TOPOLOGY_EVENT_DEBOUNCE_MS = 250;
```

(b) Among the private fields, add:

```ts
  /** Pending debounced topology re-read, armed by groups:1 events. */
  private topologyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
```

(c) Add two private methods (next to `refreshTopology()`):

```ts
  /**
   * Re-reads topology once a burst of groups:1 events has gone quiet.
   * Each new event restarts the wait, so a regroup costs one read, taken
   * after it settles.
   */
  private scheduleTopologyRefresh(): void {
    if (this.topologyRefreshTimer) clearTimeout(this.topologyRefreshTimer);
    this.topologyRefreshTimer = setTimeout(() => {
      this.topologyRefreshTimer = null;
      this.refreshTopology().catch((err) => this.log.warn('Failed to refresh topology', err));
    }, TOPOLOGY_EVENT_DEBOUNCE_MS);
  }

  /**
   * Subscribes to household group changes, so topology follows every
   * regroup — including ones made from the Sonos app — instead of only
   * those this library performs. Best effort: a failure leaves the older
   * refresh triggers (reconnect, coordinator change, grouping calls) intact.
   */
  private async subscribeToTopology(): Promise<void> {
    try {
      await this.householdGroups.subscribe();
    } catch (err) {
      this.log.warn('Failed to subscribe to group changes', err);
    }
  }
```

(d) In `handleMessage()`, directly after the existing `if (!objectType) return;` line, add:

```ts
    // Any groups:1 event means topology moved. Keyed on the namespace, not
    // on the event's _objectType, which this library does not pin.
    if (namespace === 'groups:1') this.scheduleTopologyRefresh();
```

(e) In `handleReconnected()`: in the first-connect branch, directly after `await this.refreshTopology();`, add `await this.subscribeToTopology();`. In the reconnect branch, directly after the `await this.refreshTopology().catch(…);` statement, add `await this.subscribeToTopology();`. A reconnect is a new socket, and subscriptions do not survive it.

(f) At the top of `disconnect()`, add:

```ts
    if (this.topologyRefreshTimer) {
      clearTimeout(this.topologyRefreshTimer);
      this.topologyRefreshTimer = null;
    }
```

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all pass. If an existing household test asserts an exact count of `send` calls, it will now see one more (the subscribe). Update such a count only after confirming the extra call is the `groups:1` subscribe, and say so in the commit message.

- [ ] **Step 6: Mutation-verify**

1. In `handleMessage()`, delete `if (namespace === 'groups:1') this.scheduleTopologyRefresh();` → "re-reads topology once after a burst" must FAIL. Restore.
2. In `scheduleTopologyRefresh()`, delete `if (this.topologyRefreshTimer) clearTimeout(this.topologyRefreshTimer);` → the burst test must FAIL (three reads instead of one). Restore.
3. In the reconnect branch of `handleReconnected()`, delete the `await this.subscribeToTopology();` you added → "re-subscribes after a reconnect" must FAIL. Restore.
4. In `disconnect()`, delete the timer-clearing block → "a pending refresh does not run after disconnect()" must FAIL. Restore.

Run `npx vitest run` and `npx tsc --noEmit`: all pass, clean.

- [ ] **Step 7: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: follow groups:1 events so topology cannot stay stale after a regroup"
```

---

### Task 5: Release, deploy, verify live (controller only — not delegated)

This task touches production and another session's workspace. The controlling session runs it; it is not handed to a subagent.

- [ ] **Step 1: Rebuild dist and commit**

```bash
npm run build
grep -c "Failed to subscribe to group changes" dist/index.js   # expect 1
git add dist && git commit -m "chore: rebuild dist with lifecycle and topology-freshness fixes"
git push origin main
```

- [ ] **Step 2: Update the spec**

In `docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md`, Addendum 2026-09-18: mark "Stale topology after a regroup" fixed (commit hash, the subscription design, debounce), and mark the first three deferred reviewer items fixed with their commit hashes. Leave `connectTimeout` validation and `send()` in `'connecting'` listed as still open. Commit and push.

- [ ] **Step 3: Deploy to Neurotto**

Follow memory `feedback_deploy_sonos_ws_to_neurotto` exactly: snapshot `bun.lock`; confirm a 0-path baseline delta; repoint the single sonos-ws lock line to the new short sha and `bun install`; diff the lock against the snapshot (one line); confirm the `rsync --dry-run -i` delta is `sonos-ws` only; set the `restarted` flag; rsync **node_modules only** — never `dist/`, `tsconfig.json` or `package.json`; `docker compose … up -d --force-recreate neurotto`.

- [ ] **Step 4: Verify live**

- `/health` → `phase: ready`; three `:1443` sockets ESTABLISHED; no `uncaughtException` / `CRASH LOOP` / `error [Sonos` since the recreate.
- In `neurotto.detail.log` after boot: `Sending groups:1.subscribe` followed by `Response for groups:1.subscribe`, and no `Failed to subscribe to group changes`.
- The regroup path cannot be exercised without an audible change in the house, so it is verified at the next regroup (the morning preset, or a grouping press): expect `Event: groups:1.…` lines followed ~250 ms later by exactly one `Topology refreshed`, and a `Topology:` line that lists all three speakers.

- [ ] **Step 5: Tell the Neurotto session** what was deployed, what the live checks showed, and what to look for at the next regroup.

## Self-review notes

- Spec coverage: disconnect-mid-handshake → Task 1; two ladders → Task 2; `onError` acting on `this.ws` and close-before-open leaving handlers armed → Task 3; stale topology → Task 4. `connectTimeout` validation (unreachable today) and `send()` in `'connecting'` (a UX decision) are deliberately out of scope, as the spec says.
- The ignored-setVolume episode has no task. It has no confirmed cause; Task 4 removes the only precondition it has been observed under. Neurotto now logs `Volume did not take on …` at warn, so a recurrence will be visible without log correlation.
