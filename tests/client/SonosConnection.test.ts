import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonosConnection } from '../../src/client/SonosConnection.js';
import type { ReconnectOptions } from '../../src/client/SonosConnection.js';
import WebSocket from 'ws';

vi.mock('ws', () => {
  const MockWebSocket = vi.fn(() => {
    const listeners = new Map<string, Function[]>();
    return {
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
        const handlers = [...(listeners.get(event) || [])];
        // Mirror Node's EventEmitter: an 'error' event with no listener
        // throws rather than being silently dropped. Without this the mock
        // cannot reproduce the uncaughtException that an abandoned-but-live
        // socket causes, which is exactly the bug these tests guard.
        if (event === 'error' && handlers.length === 0) {
          const err = args[0];
          throw new Error(
            `Unhandled error. (${err instanceof Error ? err.message : String(err)})`,
          );
        }
        for (const h of handlers) h(...args);
      },
    };
  });
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

    // Simulate pong to clear the pong deadline timer
    ws._emit('pong');

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

    // Suppress error events so they don't leak as unhandled
    conn.on('error', () => {});

    // Connect first
    const connectPromise = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await connectPromise;

    // Simulate connection close
    ws1._emit('close', 1000, Buffer.from(''));
    expect(conn.state).toBe('reconnecting');

    // Start a send that will wait
    const sendResult = conn.send([
      { cmdId: '1', namespace: 'test:1', command: 'test' },
      {},
    ]);

    // Attach rejection handler early to prevent unhandled rejection warning
    const sendPromise = expect(sendResult).rejects.toThrow();

    // Advance past reconnect delay
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // Reconnect attempt — make it fail
    const ws2 = getLastMockWs();
    ws2._emit('error', new Error('Connection refused'));

    // maxAttempts exhausted — state goes to disconnected
    await vi.advanceTimersByTimeAsync(0);

    await sendPromise;
  });
});

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

  it('emits RECONNECT_EXHAUSTED exactly once when maxAttempts is reached', async () => {
    const errors: any[] = [];
    const disconnects: string[] = [];
    const conn = new SonosConnection(makeOptions({ maxAttempts: 1, initialDelay: 50 }));
    conn.on('error', (e: any) => errors.push(e));
    conn.on('disconnected', (r: string) => disconnects.push(r));

    // First connect fails
    const p1 = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));
    await expect(p1).rejects.toThrow();

    // A reconnect is scheduled (attempt 1). Advance and let it fire.
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // Fail the retry attempt
    const ws2 = getLastMockWs();
    ws2._emit('error', new Error('ECONNREFUSED'));
    // Let microtasks settle for onError -> emit -> catches
    await vi.advanceTimersByTimeAsync(0);

    // Expected: exactly one RECONNECT_EXHAUSTED and one 'reconnect exhausted' disconnect.
    const exhausted = errors.filter((e) => e?.code === 'RECONNECT_EXHAUSTED');
    const exhaustedDisconnects = disconnects.filter((r) => r === 'reconnect exhausted');
    expect(exhausted.length).toBe(1);
    expect(exhaustedDisconnects.length).toBe(1);
  });
});

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

describe('abandoned sockets never leave an unlistened error emitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('absorbs a late error after an initial connect failure', async () => {
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));
    await expect(pending).rejects.toThrow(/Failed to connect/);

    // The socket is still alive inside ws and can emit 'error' again — Bun
    // does exactly this, with a browser-style ErrorEvent. Nothing is
    // listening, so Node's EventEmitter throws and kills the host process.
    expect(() => ws1._emit('error', new Error('late ECONNRESET'))).not.toThrow();
  });

  it("logs a Bun ErrorEvent's message rather than [object ErrorEvent]", async () => {
    // Bun hands 'error' listeners a browser-style ErrorEvent, not an Error.
    // Production logged "Ignoring error from abandoned socket: [object
    // ErrorEvent]" — true, and useless for diagnosis.
    const options = makeOptions();
    const conn = new SonosConnection(options);
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('error', new Error('ECONNREFUSED'));
    await expect(pending).rejects.toThrow(/Failed to connect/);

    const errorEvent = { type: 'error', isTrusted: true, message: 'Failed to connect' };
    ws1._emit('error', errorEvent);

    expect(options.logger.debug).toHaveBeenCalledWith(
      'Ignoring error from abandoned socket: Failed to connect',
    );
  });

  it('absorbs a late error after an intentional disconnect', async () => {
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await pending;

    await conn.disconnect();

    expect(() => ws1._emit('error', new Error('late error after close'))).not.toThrow();
  });

  it('keeps reconnecting when a socket closes before it ever opens', async () => {
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {});

    // Never awaited: if the bug is present this promise never settles.
    conn.connect().catch(() => {});
    const ws1 = getLastMockWs();

    // The socket dies mid-handshake: 'close' arrives with no preceding
    // 'open' and no 'error', so neither of the two paths that clear
    // connectPromise ever runs.
    ws1._emit('close', 1006, Buffer.from('handshake aborted'));
    await vi.advanceTimersByTimeAsync(0);

    // The reconnect ladder must build a genuinely new socket. With a stale
    // connectPromise still set, connect() short-circuits and returns it,
    // so no second socket is ever constructed and the ladder goes silent.
    await vi.advanceTimersByTimeAsync(200);
    const ws2 = getLastMockWs();

    expect(ws2).not.toBe(ws1);
  });

  it('absorbs a late error after a ping timeout terminates the socket', async () => {
    const conn = new SonosConnection(makeOptions({ maxAttempts: 1 }));
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await pending;

    // Drive one ping, then let the pong deadline lapse so the pong-timeout
    // path detaches and terminates the socket.
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(200);
    expect(ws1.terminate).toHaveBeenCalled();

    expect(() => ws1._emit('error', new Error('late error after terminate'))).not.toThrow();
  });
});

describe('handshake timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('abandons a handshake that never opens, errors or closes, and keeps the ladder going', async () => {
    // Seen in production 2026-09-15: a reconnect logged "Connecting to" and
    // then produced no event of any kind for 77 minutes. With no timeout the
    // attempt — and the reconnect ladder awaiting it — never ended.
    // No connectTimeout passed: consumers get the protection by default.
    const conn = new SonosConnection(makeOptions());
    conn.on('error', () => {});
    const attempts: number[] = [];
    conn.on('reconnecting', (attempt) => attempts.push(attempt));

    const pending = conn.connect();
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    const ws1 = getLastMockWs();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(ws1.terminate).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(ws1.terminate).toHaveBeenCalled();
    expect(attempts).toEqual([1]);

    await vi.advanceTimersByTimeAsync(100);
    expect(getLastMockWs()).not.toBe(ws1);
  });

  it('abandons the socket before terminating it, so a synchronous teardown cannot re-enter', async () => {
    // Neither Bun nor Node emits synchronously from terminate() today, so this
    // pins the ordering against a runtime that does. Terminate-then-fail
    // would let the teardown's 'error' and 'close' reach live listeners and
    // schedule the reconnect more than once.
    const conn = new SonosConnection({
      ...makeOptions({ initialDelay: 5000, maxDelay: 5000 }),
      connectTimeout: 1000,
    });
    conn.on('error', () => {});
    const attempts: number[] = [];
    conn.on('reconnecting', (attempt) => attempts.push(attempt));

    conn.connect().catch(() => {});
    const ws1 = getLastMockWs();
    ws1.terminate.mockImplementation(() => {
      ws1._emit('error', new Error('WebSocket was closed before the connection was established'));
      ws1._emit('close', 1006, Buffer.from(''));
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toEqual([1]);
    expect(() => ws1._emit('error', new Error('late'))).not.toThrow();
  });

  it('a stale timer from a disconnected attempt does not touch a newer attempt', async () => {
    // Without the socket-identity guard the old attempt's timer, firing
    // during the new handshake, would run the failure path against the NEW
    // socket and leave its caller waiting forever.
    const conn = new SonosConnection({ ...makeOptions({ pingInterval: 0 }), connectTimeout: 1000 });
    conn.on('error', () => {});

    conn.connect().catch(() => {});
    await conn.disconnect();
    await vi.advanceTimersByTimeAsync(500);

    const second = conn.connect();
    const ws2 = getLastMockWs();
    // The first attempt's deadline (t=1000) passes; the second's (t=1500) has not.
    await vi.advanceTimersByTimeAsync(600);
    expect(ws2.removeAllListeners).not.toHaveBeenCalled();

    ws2._emit('open');
    await second;
    expect(conn.state).toBe('connected');
  });

  it('leaves a handshake that opened alone', async () => {
    const conn = new SonosConnection({ ...makeOptions({ pingInterval: 0 }), connectTimeout: 1000 });
    conn.on('error', () => {});

    const pending = conn.connect();
    const ws1 = getLastMockWs();
    ws1._emit('open');
    await pending;

    await vi.advanceTimersByTimeAsync(5000);
    expect(ws1.terminate).not.toHaveBeenCalled();
    expect(conn.state).toBe('connected');
  });

  it('does not double-schedule a reconnect when the socket closed before the deadline', async () => {
    // A close-before-open already schedules the next attempt. If the
    // handshake timer survives it, it fires later, fails the dead attempt a
    // second time and schedules a second reconnect — the double-schedule
    // class fixed in 96b51c4. A long backoff opens the window for it.
    const conn = new SonosConnection({
      ...makeOptions({ initialDelay: 5000, maxDelay: 5000 }),
      connectTimeout: 1000,
    });
    conn.on('error', () => {});
    const attempts: number[] = [];
    conn.on('reconnecting', (attempt) => attempts.push(attempt));

    conn.connect().catch(() => {});
    const ws1 = getLastMockWs();
    ws1._emit('close', 1006, Buffer.from('handshake aborted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([1]);

    // Past the stale handshake deadline, before the 5s backoff elapses.
    await vi.advanceTimersByTimeAsync(1500);
    expect(attempts).toEqual([1]);
  });
});

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
});
