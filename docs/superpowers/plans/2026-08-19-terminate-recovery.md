# Ping-Timeout Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make ping-timeout recovery independent of the WebSocket `'close'` event so Sonos connections heal on Bun (where `terminate()` doesn't reliably fire `'close'`).

**Architecture:** Modify the pong-timeout handler in `SonosConnection.startPing()` to detach ws listeners, nullify ws, and call `handleClose(1006, 'ping timeout')` directly. Add a regression test that mocks a ws whose `terminate()` does not fire `'close'`.

**Tech Stack:** TypeScript, ws 8.x, vitest, Bun runtime.

## Global Constraints

- No `Co-Authored-By` lines in commit messages.
- All 55 existing tests must still pass.
- Follow TDD: write the failing test first, verify it fails, then implement.
- Do not modify anything outside `SonosConnection.startPing()` and the test file.

---

### Task 1: Ping-timeout drives recovery directly

**Files:**
- Modify: `src/client/SonosConnection.ts` (pong-timeout body inside `startPing()`)
- Modify: `tests/client/SonosConnection.test.ts` (add regression test)

**Interfaces:**
- Produces: When `pongTimeout` expires with no pong, `_state` transitions to `'reconnecting'` and a reconnect timer is scheduled regardless of whether the underlying WebSocket ever fires `'close'`.

- [ ] **Step 1: Write the failing regression test**

Append this describe block to `tests/client/SonosConnection.test.ts`:

```typescript
describe('SonosConnection ping timeout recovery (terminate-close independent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers when terminate() does not fire the close event', async () => {
    // pingInterval 200ms, pongTimeout 100ms, reconnect initialDelay 50ms
    const conn = new SonosConnection(makeOptions({
      pingInterval: 200,
      pongTimeout: 100,
      initialDelay: 50,
    }));
    conn.on('error', () => {}); // consume potential errors safely

    // Connect first
    const p = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await p;
    expect(conn.state).toBe('connected');

    // Trigger a ping (advance to interval boundary)
    vi.advanceTimersByTime(200);
    expect(ws1.ping).toHaveBeenCalled();

    // Simulate a runtime where terminate() does NOT fire 'close'.
    // The mock's terminate is a plain vi.fn() with no side effects — good,
    // that already models "close never fires". We advance past pongTimeout.
    vi.advanceTimersByTime(100);
    expect(ws1.terminate).toHaveBeenCalled();

    // Even though 'close' never fired, state must transition to 'reconnecting'
    // and a reconnect timer must be scheduled.
    expect(conn.state).toBe('reconnecting');

    // Advance past the reconnect delay — connect() should construct a new ws
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    const ws2 = getLastMockWs();
    expect(ws2).not.toBe(ws1); // new WebSocket constructed
  });

  it('is safe against a late close event after ping-timeout recovery', async () => {
    const conn = new SonosConnection(makeOptions({
      pingInterval: 200,
      pongTimeout: 100,
      initialDelay: 50,
      maxAttempts: 1,
    }));
    const errors: any[] = [];
    const disconnects: string[] = [];
    conn.on('error', (e: any) => errors.push(e));
    conn.on('disconnected', (r: string) => disconnects.push(r));

    const p = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await p;

    // Ping + pong-timeout fires our recovery path
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(100);
    expect(conn.state).toBe('reconnecting');

    // Simulate ws1 belatedly firing close after our recovery already ran.
    // The recovery must have removed listeners so this is a no-op:
    // no extra scheduleReconnect, no extra emissions.
    const attemptsBefore = errors.filter((e) => e?.code === 'RECONNECT_EXHAUSTED').length;
    ws1._emit('close', 1006, Buffer.from('ping timeout'));
    await vi.advanceTimersByTimeAsync(0);

    // Advance through reconnect attempts to exhaustion (maxAttempts=1)
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);
    const ws2 = getLastMockWs();
    ws2._emit('error', new Error('still no route'));
    await vi.advanceTimersByTimeAsync(0);

    const exhausted = errors.filter((e) => e?.code === 'RECONNECT_EXHAUSTED');
    const exhaustedDisconnects = disconnects.filter((r) => r === 'reconnect exhausted');
    // Exactly one exhaustion event — no double-fire from a late close.
    expect(exhausted.length - attemptsBefore).toBe(1);
    expect(exhaustedDisconnects.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL on the first new test (`recovers when terminate() does not fire the close event`) — `conn.state` will still be `'connected'` after the pong timeout because the current code only calls `terminate()` and waits for `'close'`.

- [ ] **Step 3: Apply the fix in `startPing()`**

In `/home/bitsaver/workspace/sonos-ws/src/client/SonosConnection.ts`, find the `startPing()` method (currently around line 369). Replace the `setTimeout` body inside it:

FROM:

```typescript
      this.pongDeadlineTimer = setTimeout(() => {
        this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
        this.ws?.terminate();
      }, pongTimeout);
```

TO:

```typescript
      this.pongDeadlineTimer = setTimeout(() => {
        this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
        const dead = this.ws;
        if (dead) {
          // Detach BEFORE terminate so a late 'close' event has no listener
          // and cannot double-fire handleClose / scheduleReconnect.
          dead.removeAllListeners();
          dead.terminate();
          this.ws = null;
        }
        // Drive recovery directly. In some runtimes (Bun) terminate() does
        // not reliably fire 'close', which leaves _state stuck at 'connected'
        // while the socket is dead.
        this.handleClose(1006, 'ping timeout');
      }, pongTimeout);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite and typecheck**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run && npx tsc --noEmit`
Expected: All 57 tests pass (55 pre-existing + 2 new), no type errors.

- [ ] **Step 6: Commit source changes**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: drive reconnect from ping timeout independent of close event"
```

---

### Task 2: Build sonos-ws, push, and refresh Neurotto

**Files:**
- Modify: `dist/` (rebuild)
- No Neurotto source changes — the fix is transparent to callers.

**Interfaces:**
- Consumes: Task 1's committed source change.
- Produces: sonos-ws HEAD pushed to origin/main, Neurotto's `node_modules/sonos-ws` refreshed to that HEAD, container restarted, all 3 speaker WebSocket connections verified ESTABLISHED.

- [ ] **Step 1: Build sonos-ws**

Run: `cd /home/bitsaver/workspace/sonos-ws && npm run build`
Expected: Clean build. `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` regenerated.

- [ ] **Step 2: Commit dist**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add dist/
git commit -m "chore: rebuild dist with ping-timeout recovery fix"
```

- [ ] **Step 3: Push to origin/main**

Run: `cd /home/bitsaver/workspace/sonos-ws && git push origin main`
Expected: Push succeeds (no force-push needed).

- [ ] **Step 4: Refresh sonos-ws in Neurotto**

Run: `cd /home/bitsaver/workspace/neurotto && npm update sonos-ws --legacy-peer-deps`
Expected: `node_modules/sonos-ws` updates to the just-pushed HEAD. Verify:

```bash
grep "resolved.*sonos-ws" /home/bitsaver/workspace/neurotto/package-lock.json | head -1
```

Expected: Shows the HEAD SHA from step 3.

- [ ] **Step 5: Rebuild Neurotto**

Run: `cd /home/bitsaver/workspace/neurotto && npm run build`
Expected: Clean build.

- [ ] **Step 6: Restart the container**

The current production container is `neurotto` (not `neurotto-dev`). Restart it:

```bash
docker restart neurotto
```

Wait for it to come back up (up to ~30s for full init).

- [ ] **Step 7: Verify Sonos connections are healthy**

Run:

```bash
docker exec neurotto sh -c 'netstat -tn 2>/dev/null' | grep ":1443"
```

Expected: 3 ESTABLISHED connections to `.96`, `.225`, `.90` on port 1443.

Also check no immediate error flood in logs:

```bash
docker logs neurotto --since 60s 2>&1 | grep -iE "(RECONNECT_EXHAUSTED|Reconnection did not|ping timeout)" | head -5
```

Expected: no matches (or only benign lines).
