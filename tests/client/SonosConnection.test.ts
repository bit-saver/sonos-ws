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
