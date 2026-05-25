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
