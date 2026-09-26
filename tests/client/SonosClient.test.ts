import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosClient } from '../../src/client/SonosClient.js';
import { CommandError } from '../../src/errors/CommandError.js';

const conns: any[] = [];

vi.mock('../../src/client/SonosConnection.js', () => ({
  SonosConnection: vi.fn(() => {
    const listeners = new Map<string, Function[]>();
    const inst: any = {
      state: 'disconnected',
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return inst;
      }),
      off: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      removeAllListeners: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      // Mirrors the real SonosConnection: already-connected returns at once with no
      // 'connected' event, and an in-flight handshake is shared by concurrent callers.
      connect: vi.fn(() => {
        if (inst.state === 'connected') return Promise.resolve();
        if (!inst._connecting) {
          inst._connecting = (async () => {
            for (const h of listeners.get('connected') ?? []) await h();
            inst.state = 'connected';
            inst._connecting = undefined;
          })();
        }
        return inst._connecting;
      }),
      disconnect: vi.fn(async () => {
        inst.state = 'disconnected';
        inst._connecting = undefined;
      }),
      send: vi.fn(),
      _listeners: listeners,
    };
    conns.push(inst);
    return inst;
  }),
}));

describe('SonosClient safety-net error listener', () => {
  it('does not throw when emit("error") fires with no user listener attached', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = new SonosClient({ host: '192.168.68.96', logger });

    const emit = (client as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit.bind(client);

    expect(() => emit('error', new Error('boom'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled client error: boom'),
    );
  });
});

const household = {
  groups: [
    { id: 'G_BED', name: 'Bedroom', coordinatorId: 'RINCON_BED', playerIds: ['RINCON_BED'] },
    { id: 'G_OFF', name: 'Office', coordinatorId: 'RINCON_OFFICE', playerIds: ['RINCON_OFFICE'] },
  ],
  players: [
    { id: 'RINCON_BED', name: 'Bedroom', capabilities: [], websocketUrl: 'wss://10.0.0.3:1443/websocket/api' },
    { id: 'RINCON_OFFICE', name: 'Office', capabilities: [], websocketUrl: 'wss://10.0.0.2:1443/websocket/api' },
  ],
};

/** Mirrors a real speaker: getGroups without a household ID is refused, but the refusal names the household. */
function speakerSend(request: any) {
  const [headers] = request;
  if (headers.command === 'getGroups' && !headers.householdId) {
    return Promise.reject(new CommandError('globalError', 'householdId required', {
      namespace: 'groups:1', command: 'getGroups', cmdId: headers.cmdId,
      cause: [{ namespace: 'groups:1', householdId: 'HH_1', success: false, type: 'globalError' }, {}],
    }));
  }
  if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, household]);
  return Promise.resolve([{ success: true }, { volume: 14, muted: false, fixed: false }]);
}

function newClient(host = '10.0.0.2') {
  conns.length = 0;
  const client = new SonosClient({ host });
  const conn = conns[0];
  conn.send.mockImplementation(speakerSend);
  return { client, conn };
}

describe('SonosClient against a speaker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds the player at its host and controls it', async () => {
    const { client, conn } = newClient('10.0.0.2');

    await client.connect();
    await client.volume.get();

    expect(client.householdId).toBe('HH_1');
    const last = conn.send.mock.calls.at(-1)[0][0];
    expect(last).toMatchObject({ namespace: 'playerVolume:1', command: 'getVolume', playerId: 'RINCON_OFFICE', groupId: 'G_OFF' });
  });

  it('emits connected once per connect', async () => {
    const { client } = newClient();
    const connected = vi.fn();
    client.on('connected', connected);

    await client.connect();

    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('rejects connect() when no player is at the configured host', async () => {
    const { client } = newClient('10.0.0.9');
    await expect(client.connect()).rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });

  it('attaches its connection listeners once', async () => {
    const { client, conn } = newClient();
    await client.connect();
    await client.disconnect();
    await client.connect();

    for (const event of ['connected', 'disconnected', 'reconnecting', 'error', 'message']) {
      expect(conn._listeners.get(event)).toHaveLength(1);
    }
  });

  it('keeps its handle across a reconnect and restores its subscriptions', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const volume = client.volume;
    await client.volume.subscribe();
    const subscribes = () => conn.send.mock.calls.filter(([r]: any) => r[0].namespace === 'playerVolume:1' && r[0].command === 'subscribe').length;

    await conn._listeners.get('connected')[0]();

    expect(client.volume).toBe(volume);
    expect(subscribes()).toBe(2);
  });

  it('tags events with their source', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const heard: unknown[][] = [];
    client.on('playerVolumeChanged', (...args) => heard.push(args));

    conn._listeners.get('message')[0]([
      { namespace: 'playerVolume:1', type: 'playerVolume', playerId: 'RINCON_OFFICE' },
      { _objectType: 'playerVolume', volume: 20, muted: false, fixed: false },
    ]);

    expect(heard[0]?.[1]).toEqual({ playerId: 'RINCON_OFFICE' });
  });

  it('overlapping connect() calls set up once and emit connected once', async () => {
    const { client, conn } = newClient();
    const connected = vi.fn();
    client.on('connected', connected);

    await Promise.all([client.connect(), client.connect()]);

    const scopedGetGroups = conn.send.mock.calls.filter(
      ([r]: any) => r[0].namespace === 'groups:1' && r[0].command === 'getGroups' && r[0].householdId,
    ).length;
    expect(scopedGetGroups).toBe(1);
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('connect() on a connected, set-up client does nothing', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const connected = vi.fn();
    client.on('connected', connected);
    const sendsBefore = conn.send.mock.calls.length;

    await client.connect();

    expect(conn.send.mock.calls.length).toBe(sendsBefore);
    expect(conn.connect).toHaveBeenCalledTimes(1);
    expect(connected).not.toHaveBeenCalled();
  });

  it('reconnect does not re-probe the household ID', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const unscopedGetGroups = () => conn.send.mock.calls.filter(
      ([r]: any) => r[0].namespace === 'groups:1' && r[0].command === 'getGroups' && !r[0].householdId,
    ).length;
    const before = unscopedGetGroups();

    await conn._listeners.get('connected')[0]();

    expect(unscopedGetGroups()).toBe(before);
  });
});
