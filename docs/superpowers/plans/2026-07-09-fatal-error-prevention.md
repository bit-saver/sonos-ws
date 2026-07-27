# Fatal Error Prevention Implementation Plan

> **STATUS: COMPLETE** — all 5 tasks landed 2026-07-09. Verified 2026-07-27.
>
> **Landed in sonos-ws:** `1f2ac34` safety-net listeners (T1) · `8f4bb6f` retry initial connect (T2) · `27205e1` initial setup via `handleReconnected` (T3) · `fa2b357` per-speaker map retention (T4) · `43db839` + `ed25902` dist rebuilds (T5). Three changes beyond the plan were made during execution: `4ea3ddc` extends the safety-net listener to `SonosClient`, `71852b5` propagates initial-setup errors so `connect()` rejects instead of hanging, and `96b51c4` prevents a double `scheduleReconnect` on retry failure.
>
> **Landed in neurotto:** `a85e361` maps `RECONNECT_EXHAUSTED` to a dispatcher notification (T5). The implementation guards with `'code' in e` before reading `e.code`, which the plan did not specify.
>
> **Evidence:** safety-net listeners at `SonosConnection.ts:101`, `SonosHousehold.ts:119`, `SonosClient.ts:68` · `scheduleReconnect()` in the initial-connect `onError` at `SonosConnection.ts:184` · `_initialConnectDone` / `initialSetupPromise` at `SonosHousehold.ts:71,152` · store-before-await at `SonosHousehold.ts:355` · `maxAttempts: 20` and the live error listener at `neurotto/src/classes/utility/Sonos.ts:46,51` · neurotto's `package-lock.json` pins sonos-ws to `ed25902`, which is this repo's HEAD. Suite: 7 files / 55 tests pass. `npx tsc --noEmit` exits 0.
>
> **The `- [ ]` boxes below are left as authored, unticked.** They are per-step instructions rather than deliverables — 5 of the 35 are red-phase steps ("run the test to verify it fails") whose evidence is not recoverable after the fact. Task-level completion is what the evidence above establishes. No plan in any House of Auto repo uses ticked boxes; this is the convention, not an oversight.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent sonos-ws from crashing host apps with uncaught exceptions when connections fail, and enable graceful auto-recovery from initial connection failures.

**Architecture:** Layered defensive fixes in existing SonosConnection and SonosHousehold classes. Add safety-net error listeners so `emit('error')` never throws. Trigger `scheduleReconnect` on initial connect failure so the connection self-heals when the network recovers. Refactor `handleReconnected` to run initial setup whenever the first successful `'connected'` event fires. Store per-speaker connections in the map before awaiting connect so their reconnect loops keep running on failure. Update Neurotto's Sonos wrapper to react to `RECONNECT_EXHAUSTED` errors.

**Tech Stack:** TypeScript, ws 8.x (WebSocket), vitest, Node/Bun runtime

## Global Constraints

- No `Co-Authored-By` lines in commit messages.
- All changes must preserve existing test suite passing (44 tests).
- Follow TDD: write failing tests before implementation.
- SonosConnection is at `/home/bitsaver/workspace/sonos-ws/src/client/SonosConnection.ts`.
- SonosHousehold is at `/home/bitsaver/workspace/sonos-ws/src/household/SonosHousehold.ts`.
- Neurotto Sonos wrapper is at `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts`.

---

### Task 1: Safety-net error listeners

**Files:**
- Modify: `src/client/SonosConnection.ts:91` (constructor)
- Modify: `src/household/SonosHousehold.ts:85` (constructor)
- Modify: `tests/client/SonosConnection.test.ts` (add tests)
- Modify: `tests/household/SonosHousehold.test.ts` (add tests)

**Interfaces:**
- Produces: Guarantee that `SonosConnection` and `SonosHousehold` instances always have at least one `'error'` event listener attached from construction time. All downstream tasks assume `emit('error', ...)` will not throw.

- [ ] **Step 1: Write failing test in SonosConnection.test.ts**

Append this describe block to `tests/client/SonosConnection.test.ts`:

```typescript
describe('SonosConnection safety-net error listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when emit("error") fires with no user listener attached', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const conn = new SonosConnection({
      host: '192.168.68.96',
      port: 1443,
      reconnect: {
        enabled: true,
        initialDelay: 100,
        maxDelay: 1000,
        factor: 2,
        maxAttempts: 3,
        pingInterval: 0,
        pongTimeout: 200,
      },
      requestTimeout: 5000,
      logger,
    });

    // Access protected emit via type cast for test purposes
    const emit = (conn as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit.bind(conn);

    expect(() => emit('error', new Error('boom'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled connection error: boom'),
    );
  });

  it('user listener still fires alongside the safety-net listener', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const conn = new SonosConnection({
      host: '192.168.68.96',
      port: 1443,
      reconnect: {
        enabled: true,
        initialDelay: 100,
        maxDelay: 1000,
        factor: 2,
        maxAttempts: 3,
        pingInterval: 0,
        pongTimeout: 200,
      },
      requestTimeout: 5000,
      logger,
    });

    const userHandler = vi.fn();
    conn.on('error', userHandler);

    const emit = (conn as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit.bind(conn);
    emit('error', new Error('boom'));

    expect(userHandler).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL — first test throws because no safety-net listener exists yet.

- [ ] **Step 3: Add safety-net listener to SonosConnection constructor**

In `src/client/SonosConnection.ts`, modify the constructor (currently at line 91) to add a safety-net listener immediately after `this.correlator = new MessageCorrelator(options.requestTimeout);`.

The full constructor should look like:

```typescript
  constructor(options: ConnectionOptions) {
    super();
    this.options = options;
    this.log = options.logger ?? noopLogger;
    this.correlator = new MessageCorrelator(options.requestTimeout);

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside.
    this.on('error', (err) => {
      this.log.error(`Unhandled connection error: ${err.message}`);
    });
  }
```

- [ ] **Step 4: Write failing test in SonosHousehold.test.ts**

Append this describe block to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('SonosHousehold safety-net error listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const Constructor = SonosConnection as unknown as ReturnType<typeof vi.fn>;
    Constructor.mockClear();
  });

  it('does not throw when emit("error") fires with no user listener attached', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const household = new SonosHousehold({ host: '192.168.68.96', logger });

    const emit = (household as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit.bind(household);

    expect(() => emit('error', new Error('boom'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled household error: boom'),
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — no safety-net listener on household yet.

- [ ] **Step 6: Add safety-net listener to SonosHousehold constructor**

In `src/household/SonosHousehold.ts`, modify the constructor (currently at line 85). Find this passage near the end of the constructor:

```typescript
    this.householdGroups = new GroupsNamespace(householdContext);
    this.engine = new GroupingEngine(
      this.householdGroups,
      () => this.refreshTopology(),
      this._players,
      this.log,
    );
  }
```

Add the safety-net listener before the closing brace:

```typescript
    this.householdGroups = new GroupsNamespace(householdContext);
    this.engine = new GroupingEngine(
      this.householdGroups,
      () => this.refreshTopology(),
      this._players,
      this.log,
    );

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside.
    this.on('error', (err) => {
      this.log.error(`Unhandled household error: ${err.message}`);
    });
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add src/client/SonosConnection.ts src/household/SonosHousehold.ts tests/client/SonosConnection.test.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: add safety-net error listeners to prevent uncaught exceptions"
```

---

### Task 2: Retry initial connect failure

**Files:**
- Modify: `src/client/SonosConnection.ts:154-171` (onError handler in connect())
- Modify: `tests/client/SonosConnection.test.ts`

**Interfaces:**
- Consumes: safety-net error listener from Task 1 (so `emit('error')` in onError doesn't crash if no user listener).
- Produces: When initial `connect()` rejects, if `reconnect.enabled`, `scheduleReconnect()` is running. Future `'connected'` events will fire on retry success.

- [ ] **Step 1: Write failing test**

Append this describe block to `tests/client/SonosConnection.test.ts`:

```typescript
describe('SonosConnection retry initial connect failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts reconnect loop after initial connect failure when reconnect enabled', async () => {
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {}); // consume error so promise rejection is expected

    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();

    // Simulate WebSocket error before open — initial connect fails
    ws1._emit('error', new Error('ECONNREFUSED'));

    await expect(connectPromise).rejects.toThrow('Failed to connect');
    expect(conn.state).toBe('reconnecting');
  });

  it('does not start reconnect loop after initial failure when reconnect disabled', async () => {
    const conn = new SonosConnection(makeOptions({ enabled: false }));
    conn.on('error', () => {});

    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));

    await expect(connectPromise).rejects.toThrow('Failed to connect');
    expect(conn.state).toBe('disconnected');
  });

  it('reconnect loop eventually succeeds and fires "connected"', async () => {
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {});

    const connectedHandler = vi.fn();
    conn.on('connected', connectedHandler);

    // Initial connect fails
    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));
    await expect(connectPromise).rejects.toThrow();

    // Advance past reconnect delay — new connection attempted
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    const ws2 = getLastMockWs();
    ws2.readyState = 1;
    ws2._emit('open');
    await vi.advanceTimersByTimeAsync(0);

    expect(connectedHandler).toHaveBeenCalled();
    expect(conn.state).toBe('connected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL — after initial error, state stays 'disconnected' instead of 'reconnecting'.

- [ ] **Step 3: Add scheduleReconnect call in onError**

In `src/client/SonosConnection.ts`, modify the `onError` handler in `connect()`. Currently at lines 154-171, it ends with `reject(connErr);`. Replace the entire onError with:

```typescript
      const onError = (err: Error) => {
        cleanup();
        this._state = 'disconnected';
        this.connectPromise = null;

        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws = null;
        }

        const connErr = new ConnectionError(
          ErrorCode.CONNECTION_FAILED,
          `Failed to connect: ${err.message}`,
          { cause: err },
        );
        this.emit('error', connErr);
        reject(connErr);

        // Initial connect failed. If reconnect is enabled, start the loop
        // in the background so a later network recovery re-establishes the
        // connection. The rejected promise above informs the caller of the
        // initial failure immediately.
        if (this.options.reconnect.enabled && !this.intentionalClose) {
          this.scheduleReconnect();
        }
      };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/client/SonosConnection.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "feat: retry initial connect failure via scheduleReconnect"
```

---

### Task 3: First-connect-after-fail setup in SonosHousehold

**Files:**
- Modify: `src/household/SonosHousehold.ts:140-156` (connect method)
- Modify: `src/household/SonosHousehold.ts:456` (handleReconnected method)
- Modify: `tests/household/SonosHousehold.test.ts`

**Interfaces:**
- Consumes: Task 2's guarantee that reconnect loop runs after initial failure.
- Produces: `handleReconnected()` runs the full initial setup path (discoverHouseholdId → refreshTopology → connectAllSpeakers) whenever `_initialConnectDone` is false, whether that's on the first attempt or after N failed attempts. `connect()` awaits an internal `initialSetupPromise` that resolves when `_initialConnectDone` becomes true.

- [ ] **Step 1: Write failing test**

Append this describe block to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('SonosHousehold first-connect-after-fail setup', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(() => {
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
  });

  it('runs full initial setup when handleReconnected fires and _initialConnectDone is false', async () => {
    // Kick off connect
    const connectPromise = household.connect();

    // Simulate the connection successfully opening
    // (this fires the 'connected' handler that was registered in connect())
    const connectedHandlers = mockConn._listeners.get('connected') || [];
    expect(connectedHandlers.length).toBeGreaterThan(0);

    // Simulate mockConn.connect resolving
    await Promise.resolve();

    // Trigger the 'connected' event that handleReconnected listens to
    await connectedHandlers[0]();

    // Now connectPromise should be able to complete
    await connectPromise;

    // Household should have discovered topology
    expect(household.players.size).toBe(3);
    expect(household.householdId).toBe('HH_1');
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: Existing "connects and discovers topology" test still passes. The new test may pass or fail depending on mock timing; it exists to lock in the new behavior after refactor.

- [ ] **Step 3: Refactor handleReconnected and connect in SonosHousehold**

In `src/household/SonosHousehold.ts`, replace the `connect()` method (lines 140-156) with:

```typescript
  async connect(): Promise<void> {
    this._initialConnectDone = false;

    let resolveSetup!: () => void;
    let rejectSetup!: (err: unknown) => void;
    const initialSetupPromise = new Promise<void>((res, rej) => {
      resolveSetup = res;
      rejectSetup = rej;
    });

    this.connection.on('connected', async () => {
      try {
        await this.handleReconnected();
        if (this._initialConnectDone) resolveSetup();
      } catch (err) {
        rejectSetup(err);
      }
    });
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));

    await this.connection.connect();
    await initialSetupPromise;
  }
```

Then replace the `handleReconnected()` method (currently starts at line 456) with:

```typescript
  private async handleReconnected(): Promise<void> {
    if (!this._initialConnectDone) {
      // First successful connect — full initial setup. Runs either after
      // the caller's `await connect()` completes on first try OR after a
      // background reconnect loop (started by SonosConnection.onError)
      // eventually succeeds.
      try {
        await this.discoverHouseholdId();
        await this.refreshTopology();
        if (this.autoConnectSpeakers) {
          await this.connectAllSpeakers();
        }
        this._initialConnectDone = true;
      } catch (err) {
        this.log.warn('Failed initial setup on connect', err);
      }
    } else {
      // Reconnect after prior success — reconnect-specific work.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: All tests pass, including the pre-existing "connects and discovers topology" test and the new first-connect-after-fail test.

- [ ] **Step 5: Run full suite**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "refactor: run initial household setup via handleReconnected"
```

---

### Task 4: Per-speaker resilience in connectToSpeaker

**Files:**
- Modify: `src/household/SonosHousehold.ts:305-341` (connectToSpeaker)
- Modify: `tests/household/SonosHousehold.test.ts`

**Interfaces:**
- Consumes: Task 2's guarantee that SonosConnection self-heals via reconnect on initial connect failure.
- Produces: `connectToSpeaker` no longer throws; connection is stored in `speakerConnections` map even on initial failure, and its own reconnect loop keeps trying.

- [ ] **Step 1: Write failing test**

Append this describe block to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('SonosHousehold per-speaker resilience', () => {
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
          {
            groups: [
              { id: 'g1', name: 'Arc', coordinatorId: 'RINCON_ARC', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_ARC'] },
              { id: 'g2', name: 'Office', coordinatorId: 'RINCON_OFFICE', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_OFFICE'] },
            ],
            players: [
              { id: 'RINCON_ARC', name: 'Arc', capabilities: ['PLAYBACK'], websocketUrl: 'wss://192.168.68.96:1443/websocket/api' },
              { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'], websocketUrl: 'wss://192.168.68.225:1443/websocket/api' },
            ],
          },
        ]);
      }
      return Promise.resolve([{ success: true }, {}]);
    });
  });

  it('stores per-speaker connection in map even when initial connect rejects', async () => {
    // Make the second SonosConnection instance reject on connect
    const Constructor = SonosConnection as unknown as ReturnType<typeof vi.fn>;
    let callCount = 0;
    Constructor.mockImplementation(() => {
      callCount++;
      const listeners = new Map<string, Function[]>();
      const inst: any = {
        state: callCount === 1 ? 'connected' : 'disconnected',
        connect: vi.fn().mockImplementation(() => {
          if (callCount === 1) return Promise.resolve();
          return Promise.reject(new Error('ECONNREFUSED'));
        }),
        disconnect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Function) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(handler);
          return inst;
        }),
        off: vi.fn().mockReturnThis(),
        once: vi.fn().mockReturnThis(),
        removeAllListeners: vi.fn().mockReturnThis(),
        emit: vi.fn(),
        send: vi.fn(),
        _listeners: listeners,
      };
      return inst;
    });

    // Re-create household with new mock behavior
    household = new SonosHousehold({ host: '192.168.68.96' });
    const primaryMock = (SonosConnection as unknown as ReturnType<typeof vi.fn>).mock.results[
      (SonosConnection as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;

    primaryMock.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'getGroups') {
        return Promise.resolve([
          { householdId: 'HH_1', success: true },
          {
            groups: [
              { id: 'g1', name: 'Arc', coordinatorId: 'RINCON_ARC', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_ARC'] },
              { id: 'g2', name: 'Office', coordinatorId: 'RINCON_OFFICE', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_OFFICE'] },
            ],
            players: [
              { id: 'RINCON_ARC', name: 'Arc', capabilities: ['PLAYBACK'], websocketUrl: 'wss://192.168.68.96:1443/websocket/api' },
              { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'], websocketUrl: 'wss://192.168.68.225:1443/websocket/api' },
            ],
          },
        ]);
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    // Trigger connect flow, simulating 'connected' event
    const connectPromise = household.connect();
    const connectedHandlers = primaryMock._listeners.get('connected') || [];
    await connectedHandlers[0]();
    await connectPromise;

    // The Office connection failed but should still be in the map
    const speakerConnections = (household as any).speakerConnections as Map<string, any>;
    expect(speakerConnections.has('RINCON_OFFICE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — current code throws before storing, so Office is not in the map.

- [ ] **Step 3: Refactor connectToSpeaker**

In `src/household/SonosHousehold.ts`, replace the `connectToSpeaker` method (lines 305-341) with:

```typescript
  private async connectToSpeaker(player: Player): Promise<SonosConnection> {
    // If this speaker is the primary host, reuse the primary connection
    if (player.websocketUrl) {
      try {
        const url = new URL(player.websocketUrl);
        if (url.hostname === this.primaryHost) {
          return this.connection;
        }
      } catch { /* fall through to create new connection */ }
    }

    // Return existing connection if already connected
    const existing = this.speakerConnections.get(player.id);
    if (existing && existing.state === 'connected') {
      return existing;
    }

    if (!player.websocketUrl) {
      this.log.warn(`No websocketUrl for player ${player.name} — using primary connection`);
      return this.connection;
    }

    const url = new URL(player.websocketUrl);
    const conn = existing ?? new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });

    // Store BEFORE awaiting connect so a failure still leaves the
    // reconnect loop running in the background. The connection's own
    // scheduleReconnect will keep trying until it succeeds or exhausts.
    this.speakerConnections.set(player.id, conn);

    try {
      await conn.connect();
      this.log.info(`Connected to ${player.name} at ${url.hostname}`);
    } catch (err) {
      this.log.warn(`Initial connect to ${player.name} failed; reconnect loop will retry`, err);
      // Do not rethrow — connection is in the map with reconnect scheduled.
    }

    return conn;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run tests/household/SonosHousehold.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Run full suite and typecheck**

Run: `cd /home/bitsaver/workspace/sonos-ws && npx vitest run && npx tsc --noEmit`
Expected: All tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: keep per-speaker connections in map on initial failure"
```

---

### Task 5: Build sonos-ws dist, push, and update Neurotto

**Files:**
- Modify: `dist/` (rebuild)
- Modify: `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts:43-47`

**Interfaces:**
- Consumes: All previous tasks — SonosConnection and SonosHousehold changes need to be built into `dist/` before Neurotto can pick them up.
- Produces: Neurotto has a household error listener that notifies on `RECONNECT_EXHAUSTED`, and `maxAttempts: 20` is configured so exhaustion actually triggers.

- [ ] **Step 1: Build sonos-ws**

Run: `cd /home/bitsaver/workspace/sonos-ws && npm run build`
Expected: Clean build. `dist/index.js`, `dist/index.cjs`, and `dist/index.d.ts` updated.

- [ ] **Step 2: Commit dist**

```bash
cd /home/bitsaver/workspace/sonos-ws
git add dist/
git commit -m "chore: rebuild dist with fatal error prevention"
```

- [ ] **Step 3: Push sonos-ws**

Run: `cd /home/bitsaver/workspace/sonos-ws && git push origin main`
Expected: Push succeeds.

- [ ] **Step 4: Update sonos-ws in Neurotto**

Run: `cd /home/bitsaver/workspace/neurotto && npm update sonos-ws --legacy-peer-deps`
Expected: `node_modules/sonos-ws` updated to the latest commit. Verify:

```bash
grep "resolved.*sonos-ws" /home/bitsaver/workspace/neurotto/package-lock.json | head -1
```

Expected: Shows the latest sonos-ws commit hash from step 3.

- [ ] **Step 5: Update Neurotto Sonos.ts**

In `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts`, modify the `init()` method around lines 42-47.

Change the household construction (currently line 43):

```typescript
      this.household = new SonosHousehold({ host: '192.168.68.96', logger: houseLog });
```

To:

```typescript
      this.household = new SonosHousehold({
        host: '192.168.68.96',
        logger: houseLog,
        reconnect: { maxAttempts: 20 },
      });
```

Change the commented-out error listener (currently line 47):

```typescript
      // this.household.on('error', (e) => this.log.error('--- ERROR ---', e.message));
```

To an active error listener with notification on exhaustion:

```typescript
      this.household.on('error', (e) => {
        this.log.error('--- ERROR ---', e.message);
        if (e.code === 'RECONNECT_EXHAUSTED') {
          this.handlers.dispatcher.notify({
            title: 'Sonos WS Error',
            message: `Reconnect exhausted: ${e.message}. Sonos may be offline.`,
            category: 'neurotto',
          });
        }
      });
```

Leave the `connected` and `disconnected` listeners commented out (matches current preference).

- [ ] **Step 6: Rebuild Neurotto**

Run: `cd /home/bitsaver/workspace/neurotto && npm run build`
Expected: Clean build.

- [ ] **Step 7: Restart Neurotto container**

Run: `docker restart neurotto-dev`
Expected: Container restarts.

- [ ] **Step 8: Verify Sonos connections are established**

Wait ~15 seconds for initialization, then run:

```bash
docker exec neurotto-dev sh -c 'netstat -tn 2>/dev/null' | grep ":1443"
```

Expected: Three ESTABLISHED WebSocket connections to Sonos speakers on port 1443.

- [ ] **Step 9: Commit Neurotto changes**

```bash
cd /home/bitsaver/workspace/neurotto
git add src/classes/utility/Sonos.ts package.json package-lock.json
git commit -m "feat: handle RECONNECT_EXHAUSTED with dispatcher notification"
```
