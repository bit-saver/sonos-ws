# Connection Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent idle WebSocket disconnections from Sonos speakers and recover gracefully when connections drop for any reason.

**Architecture:** Three layered fixes in existing classes. SonosConnection gains keepalive pings and send-during-reconnect waiting. SonosHousehold gains per-speaker connection recovery on primary reconnect. No new abstractions.

**Tech Stack:** TypeScript, ws (WebSocket library with native ping/pong), vitest

---

### Task 1: Add pingInterval and pongTimeout to ReconnectOptions

**Files:**
- Modify: `src/client/SonosConnection.ts:36-47` (ReconnectOptions interface)
- Modify: `src/household/SonosHousehold.ts:17-23` (DEFAULT_RECONNECT)

- [ ] **Step 1: Add fields to ReconnectOptions interface**

In `src/client/SonosConnection.ts`, add two optional fields to `ReconnectOptions`:

```typescript
/** Configuration for automatic reconnection behavior. */
export interface ReconnectOptions {
  /** Whether auto-reconnect is active. */
  enabled: boolean;
  /** Base delay in milliseconds before the first reconnect attempt. */
  initialDelay: number;
  /** Maximum delay in milliseconds between reconnect attempts. */
  maxDelay: number;
  /** Exponential backoff multiplier applied to the delay after each attempt. */
  factor: number;
  /** Maximum number of reconnect attempts before giving up. Use `Infinity` for unlimited. */
  maxAttempts: number;
  /** Milliseconds between WebSocket pings. Set to 0 to disable keepalive. */
  pingInterval: number;
  /** Milliseconds to wait for a pong reply before declaring the connection dead. */
  pongTimeout: number;
}
```

- [ ] **Step 2: Update DEFAULT_RECONNECT in SonosHousehold**

In `src/household/SonosHousehold.ts`, update the default:

```typescript
const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: Infinity,
  pingInterval: 30000,
  pongTimeout: 10000,
};
```

- [ ] **Step 3: Run typecheck**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx tsc --noEmit`
Expected: PASS (no type errors — existing callers pass partials which still work)

- [ ] **Step 4: Commit**

```bash
git add src/client/SonosConnection.ts src/household/SonosHousehold.ts
git commit -m "feat: add pingInterval and pongTimeout to ReconnectOptions"
```

---

### Task 2: Implement keepalive ping/pong in SonosConnection

**Files:**
- Modify: `src/client/SonosConnection.ts` (add startPing, stopPing, pong handler, new private fields)
- Create: `tests/client/SonosConnection.test.ts`

- [ ] **Step 1: Write failing tests for keepalive**

Create `tests/client/SonosConnection.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonosConnection } from '../../src/client/SonosConnection.js';
import type { ReconnectOptions } from '../../src/client/SonosConnection.js';
import WebSocket from 'ws';

vi.mock('ws', () => {
  const listeners = new Map<string, Function[]>();
  const MockWebSocket = vi.fn(() => ({
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    once: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    removeListener: vi.fn((event: string, handler: Function) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    _listeners: listeners,
    _emit(event: string, ...args: any[]) {
      const handlers = listeners.get(event) || [];
      for (const h of handlers) h(...args);
    },
  }));
  (MockWebSocket as any).OPEN = 1;
  return { default: MockWebSocket };
});

function getLastMockWs(): any {
  const calls = (WebSocket as unknown as ReturnType<typeof vi.fn>).mock.results;
  return calls[calls.length - 1]?.value;
}

function makeOptions(overrides?: Partial<ReconnectOptions>): any {
  return {
    host: '192.168.68.96',
    port: 1443,
    reconnect: {
      enabled: true,
      initialDelay: 100,
      maxDelay: 1000,
      factor: 2,
      maxAttempts: 3,
      pingInterval: 500,
      pongTimeout: 200,
      ...overrides,
    },
    requestTimeout: 5000,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('SonosConnection keepalive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends pings at the configured interval after connecting', async () => {
    const conn = new SonosConnection(makeOptions());
    const connectPromise = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await connectPromise;

    expect(ws.ping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(ws.ping).toHaveBeenCalledTimes(2);
  });

  it('does not send pings when pingInterval is 0', async () => {
    const conn = new SonosConnection(makeOptions({ pingInterval: 0 }));
    const connectPromise = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await connectPromise;

    vi.advanceTimersByTime(5000);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('terminates connection when pong is not received in time', async () => {
    const conn = new SonosConnection(makeOptions());
    const connectPromise = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await connectPromise;

    // Trigger ping
    vi.advanceTimersByTime(500);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    // Wait for pong timeout without sending pong
    vi.advanceTimersByTime(200);
    expect(ws.terminate).toHaveBeenCalled();
  });

  it('does not terminate when pong is received in time', async () => {
    const conn = new SonosConnection(makeOptions());
    const connectPromise = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await connectPromise;

    // Trigger ping
    vi.advanceTimersByTime(500);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    // Simulate pong
    ws._emit('pong');

    // Wait past pong timeout
    vi.advanceTimersByTime(200);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('stops pings on disconnect', async () => {
    const conn = new SonosConnection(makeOptions());
    const connectPromise = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await connectPromise;

    await conn.disconnect();

    // Clear mock call counts
    ws.ping.mockClear();
    vi.advanceTimersByTime(2000);
    expect(ws.ping).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL — SonosConnection doesn't call ws.ping() yet

- [ ] **Step 3: Implement keepalive in SonosConnection**

In `src/client/SonosConnection.ts`, add three private fields after line 83 (`private intentionalClose = false;`):

```typescript
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
```

Add `startPing()` method after `clearReconnectTimer()`:

```typescript
  private startPing(): void {
    const { pingInterval, pongTimeout } = this.options.reconnect;
    if (!pingInterval || !this.ws) return;

    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
      this.pongDeadlineTimer = setTimeout(() => {
        this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
        this.ws?.terminate();
      }, pongTimeout);
    }, pingInterval);
  }
```

Add `stopPing()` method after `startPing()`:

```typescript
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongDeadlineTimer) {
      clearTimeout(this.pongDeadlineTimer);
      this.pongDeadlineTimer = null;
    }
  }
```

In the `onOpen` handler (inside `connect()`), after `this.emit('connected');` and before `resolve();`, add the pong listener and start ping:

```typescript
        this.ws!.on('pong', () => {
          if (this.pongDeadlineTimer) {
            clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
          }
        });

        this.startPing();
```

At the top of `handleClose()`, before the existing `this.log.info(...)` line, add:

```typescript
    this.stopPing();
```

In `disconnect()`, before the `if (this.ws)` block, add:

```typescript
    this.stopPing();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "feat: add WebSocket keepalive ping/pong to SonosConnection"
```

---

### Task 3: Implement send-during-reconnect waiting

**Files:**
- Modify: `src/client/SonosConnection.ts` (add waitForReconnect, update send)
- Modify: `tests/client/SonosConnection.test.ts`

- [ ] **Step 1: Write failing tests for send-during-reconnect**

Append to `tests/client/SonosConnection.test.ts`:

```typescript
describe('SonosConnection send-during-reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws immediately when state is disconnected', async () => {
    const conn = new SonosConnection(makeOptions({ enabled: false }));
    await expect(conn.send([
      { cmdId: '1', namespace: 'test:1', command: 'test' },
      {},
    ])).rejects.toThrow('Not connected');
  });

  it('waits for reconnection and then sends when state is reconnecting', async () => {
    const conn = new SonosConnection(makeOptions());

    // Connect first
    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await connectPromise;

    // Simulate connection close (triggers reconnect)
    ws1._emit('close', 1000, Buffer.from(''));

    // State should be 'reconnecting' now
    expect(conn.state).toBe('reconnecting');

    // Start a send — it should wait, not throw
    const sendPromise = conn.send([
      { cmdId: 'abc', namespace: 'test:1', command: 'getTest' },
      {},
    ]);

    // Advance past reconnect delay
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // The reconnect fires connect(), creating a new ws
    const ws2 = getLastMockWs();
    ws2.readyState = 1;
    ws2._emit('open');

    // Allow microtasks to settle
    await vi.advanceTimersByTimeAsync(0);

    // The send should now have gone through
    expect(ws2.send).toHaveBeenCalled();

    // Resolve the correlator to complete the send
    const sentData = JSON.parse(ws2.send.mock.calls[0][0]);
    const [headers] = sentData;
    expect(headers.cmdId).toBe('abc');
  });

  it('rejects when reconnection fails permanently', async () => {
    const conn = new SonosConnection(makeOptions({ maxAttempts: 1, initialDelay: 50 }));

    // Connect first
    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await connectPromise;

    // Simulate connection close
    ws1._emit('close', 1000, Buffer.from(''));
    expect(conn.state).toBe('reconnecting');

    // Start a send that will wait
    const sendPromise = conn.send([
      { cmdId: '1', namespace: 'test:1', command: 'test' },
      {},
    ]);

    // Advance past reconnect delay
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // Reconnect attempt — make it fail
    const ws2 = getLastMockWs();
    ws2._emit('error', new Error('Connection refused'));

    // maxAttempts exhausted — state goes to disconnected
    await vi.advanceTimersByTimeAsync(0);

    await expect(sendPromise).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL — send() still throws immediately during reconnecting state

- [ ] **Step 3: Implement waitForReconnect and update send()**

In `src/client/SonosConnection.ts`, add `waitForReconnect()` method after `stopPing()`:

```typescript
  private waitForReconnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new ConnectionError(
          ErrorCode.CONNECTION_LOST,
          `Reconnection did not complete within ${this.options.requestTimeout}ms`,
        ));
      }, this.options.requestTimeout);

      const onConnected = () => {
        cleanup();
        resolve();
      };

      const onDisconnected = () => {
        cleanup();
        reject(new ConnectionError(
          ErrorCode.CONNECTION_LOST,
          'Connection lost during reconnection',
        ));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('connected', onConnected);
        this.off('disconnected', onDisconnected);
      };

      this.on('connected', onConnected);
      this.on('disconnected', onDisconnected);
    });
  }
```

Update `send()` — replace the existing guard at the top of the method body (lines 214-217) with:

```typescript
  async send(request: SonosRequest): Promise<SonosResponse> {
    if (this._state === 'reconnecting') {
      await this.waitForReconnect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Not connected');
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "feat: send() waits for reconnection instead of throwing immediately"
```

---

### Task 4: Implement per-speaker connection recovery in SonosHousehold

**Files:**
- Modify: `src/household/SonosHousehold.ts:406-416` (handleReconnected)
- Modify: `tests/household/SonosHousehold.test.ts`

- [ ] **Step 1: Write failing tests for speaker reconnection**

Append to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('SonosHousehold speaker reconnection', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const Constructor = SonosConnection as unknown as ReturnType<typeof vi.fn>;
    Constructor.mockClear();

    household = new SonosHousehold({ host: '192.168.68.96' });
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
        return Promise.resolve([
          { householdId: 'HH_1', success: true },
          mockTopology,
        ]);
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    await household.connect();
  });

  it('reconnects dead speaker connections when primary reconnects', async () => {
    // Simulate per-speaker connections in the map
    const speakerConnections = (household as any).speakerConnections as Map<string, any>;

    const deadConn = {
      state: 'disconnected',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
    };
    const aliveConn = {
      state: 'connected',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
    };

    speakerConnections.set('RINCON_OFFICE', deadConn);
    speakerConnections.set('RINCON_BED', aliveConn);

    // Trigger handleReconnected via the 'connected' event listener
    const connectedHandlers = mockConn._listeners.get('connected') || [];
    expect(connectedHandlers.length).toBeGreaterThan(0);
    await connectedHandlers[0]();

    // Dead connection should have been reconnected
    expect(deadConn.connect).toHaveBeenCalled();
    // Alive connection should have been left alone
    expect(aliveConn.connect).not.toHaveBeenCalled();
  });

  it('does not interfere with connections that are already reconnecting', async () => {
    const speakerConnections = (household as any).speakerConnections as Map<string, any>;

    const reconnectingConn = {
      state: 'reconnecting',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
    };

    speakerConnections.set('RINCON_OFFICE', reconnectingConn);

    const connectedHandlers = mockConn._listeners.get('connected') || [];
    await connectedHandlers[0]();

    expect(reconnectingConn.connect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — handleReconnected does not reconnect speaker connections

- [ ] **Step 3: Implement speaker reconnection in handleReconnected**

Replace the `handleReconnected()` method in `src/household/SonosHousehold.ts` (lines 406-416) with:

```typescript
  private async handleReconnected(): Promise<void> {
    if (this._initialConnectDone) {
      await this.refreshTopology().catch((err) =>
        this.log.warn('Failed to refresh topology on reconnect', err));

      await this.reconnectSpeakers();

      for (const handle of this._players.values()) {
        try { await handle.volume.subscribe(); } catch { /* best effort */ }
      }
    }
    this.emit('connected');
  }
```

Add a new `reconnectSpeakers()` method directly above `handleReconnected()`:

```typescript
  private async reconnectSpeakers(): Promise<void> {
    const reconnectPromises: Promise<void>[] = [];

    for (const [playerId, conn] of this.speakerConnections) {
      if (conn.state === 'disconnected') {
        this.log.info(`Reconnecting speaker ${playerId}`);
        reconnectPromises.push(
          conn.connect().catch((err: unknown) =>
            this.log.warn(`Failed to reconnect speaker ${playerId}:`, err)),
        );
      }
    }

    // Connect any newly discovered players not in the map
    for (const player of this._rawPlayers) {
      if (!this.speakerConnections.has(player.id)) {
        reconnectPromises.push(
          this.connectToSpeaker(player)
            .then((conn) => {
              const handle = this._players.get(player.id);
              if (handle) handle.setSpeakerConnection(conn);
            })
            .catch((err: unknown) =>
              this.log.warn(`Failed to connect new speaker ${player.name}:`, err)),
        );
      }
    }

    await Promise.allSettled(reconnectPromises);

    // Re-wire coordinator resolvers for all handles (topology may have changed)
    for (const handle of this._players.values()) {
      handle.setCoordinatorConnectionResolver(() => {
        const coordId = handle['_group']?.coordinatorId;
        if (coordId) {
          const coordConn = this.speakerConnections.get(coordId);
          if (coordConn) return coordConn;
        }
        return this.connection;
      });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite and typecheck**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run && npx tsc --noEmit`
Expected: All tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: reconnect per-speaker connections on primary reconnect"
```

---

### Task 5: Build and verify

**Files:**
- Modify: `dist/` (rebuilt output)

- [ ] **Step 1: Run full test suite one final time**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Typecheck**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build**

Run: `cd /home/bitsaver/workspace/sonos-ws && npm run build`
Expected: Clean build, dist/ updated

- [ ] **Step 4: Commit build output**

```bash
git add dist/
git commit -m "chore: rebuild dist with connection resilience"
```
