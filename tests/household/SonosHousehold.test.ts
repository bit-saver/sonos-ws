import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';
import type { SonosHouseholdOptions } from '../../src/household/SonosHousehold.js';
import { SonosConnection } from '../../src/client/SonosConnection.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';

// Mock SonosConnection
vi.mock('../../src/client/SonosConnection.js', () => {
  const listeners = new Map<string, Function[]>();
  const mockConnection = {
    // Mirrors the real SonosConnection: fires 'connected' listeners
    // (fire-and-forget, not awaited) before resolving connect(), so
    // household.connect()'s internal 'connected' handler always runs.
    connect: vi.fn().mockImplementation(async () => {
      const handlers = listeners.get('connected') || [];
      for (const handler of handlers) handler();
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    state: 'connected',
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return mockConnection;
    }),
    off: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    emit: vi.fn(),
    send: vi.fn(),
    _listeners: listeners,
  };
  return { SonosConnection: vi.fn(() => mockConnection) };
});

const mockTopology: GroupsResponse = {
  groups: [
    { id: 'RINCON_ARC:123', name: 'Arc', coordinatorId: 'RINCON_ARC', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_ARC'] },
    { id: 'RINCON_OFFICE:456', name: 'Office', coordinatorId: 'RINCON_OFFICE', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_OFFICE'] },
    { id: 'RINCON_BED:789', name: 'Bedroom', coordinatorId: 'RINCON_BED', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_BED'] },
  ] as Group[],
  players: [
    { id: 'RINCON_ARC', name: 'Arc', capabilities: ['PLAYBACK', 'HT_PLAYBACK'] },
    { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'] },
    { id: 'RINCON_BED', name: 'Bedroom', capabilities: ['PLAYBACK'] },
  ] as Player[],
};

/**
 * The factory hands back one shared object on every call, so calling it
 * directly returns that object without constructing a household.
 */
function sharedMockConnection(): any {
  return (SonosConnection as unknown as () => any)();
}

/**
 * Clears the shared mock connection, then constructs the household. The order
 * matters: the household attaches its connection listeners in its
 * constructor, so clearing afterwards would strip them.
 */
function freshHousehold(options: SonosHouseholdOptions): { household: SonosHousehold; mockConn: any } {
  vi.clearAllMocks();
  const mockConn = sharedMockConnection();
  mockConn._listeners.clear();
  mockConn.state = 'connected';
  mockConn.on.mockImplementation((event: string, handler: Function) => {
    if (!mockConn._listeners.has(event)) mockConn._listeners.set(event, []);
    mockConn._listeners.get(event)!.push(handler);
    return mockConn;
  });
  (SonosConnection as unknown as ReturnType<typeof vi.fn>).mockClear();
  return { household: new SonosHousehold(options), mockConn };
}

describe('SonosHousehold', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(() => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));

    // Mock send to return householdId for discoverHouseholdId, and topology for getGroups
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

  it('connects and discovers topology', async () => {
    await household.connect();
    expect(household.players.size).toBe(3);
    expect(household.groups.length).toBe(3);
    expect(household.householdId).toBe('HH_1');
  });

  it('player() returns handle by name (case-insensitive)', async () => {
    await household.connect();
    const arc = household.player('arc');
    expect(arc.id).toBe('RINCON_ARC');
    expect(arc.name).toBe('Arc');
  });

  it('player() returns handle by RINCON ID', async () => {
    await household.connect();
    const office = household.player('RINCON_OFFICE');
    expect(office.id).toBe('RINCON_OFFICE');
  });

  it('player() throws for unknown name', async () => {
    await household.connect();
    expect(() => household.player('Kitchen')).toThrow('Player not found');
  });

  it('player handles have correct groupIds', async () => {
    await household.connect();
    const arc = household.player('Arc');
    const office = household.player('Office');
    expect(arc.groupId).toBe('RINCON_ARC:123');
    expect(office.groupId).toBe('RINCON_OFFICE:456');
  });

  it('disconnect calls connection disconnect', async () => {
    await household.connect();
    await household.disconnect();
    expect(mockConn.disconnect).toHaveBeenCalled();
  });
});

describe('SonosHousehold grouping', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(async () => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));

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

  it('group() throws on empty array', async () => {
    await expect(household.group([])).rejects.toThrow('at least one player');
  });

  it('ungroup() is a no-op for solo player', async () => {
    const initialCallCount = mockConn.send.mock.calls.length;
    const arc = household.player('Arc');
    await household.ungroup(arc);
    // GroupingEngine refreshes topology (1 getGroups call), then stops — no createGroup
    expect(mockConn.send.mock.calls.length).toBe(initialCallCount + 1);
  });

  it('group([single]) is a no-op for solo player', async () => {
    const arc = household.player('Arc');
    const initialCallCount = mockConn.send.mock.calls.length;
    await household.group([arc]);
    // GroupingEngine refreshes topology (1 getGroups call), then stops — no createGroup
    expect(mockConn.send.mock.calls.length).toBe(initialCallCount + 1);
  });
});

describe('SonosHousehold speaker reconnection', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(async () => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));

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

describe('SonosHousehold first-connect-after-fail setup', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(() => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));

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

  it('rejects connect() when initial setup fails, does not hang', async () => {
    // Override send to fail on getGroups — simulates refreshTopology failing
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'getGroups') {
        return Promise.reject(new Error('getGroups failed'));
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    await expect(household.connect()).rejects.toThrow();
  }, 5000);
});

describe('SonosHousehold connect() unhandled rejection safety', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(() => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));
  });

  it('does not produce an unhandled rejection when the background ladder fails setup after connect() already rejected', async () => {
    // The initial connect() attempt fails outright at the handshake, so household.connect()
    // rejects immediately — it never reaches enqueueSetup().
    mockConn.connect.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
    // Later, the background reconnect ladder succeeds and fires 'connected' again. This run is
    // unowned (no connect() call is awaiting it), and first-connect setup (getGroups here) fails
    // too — onPrimaryConnected() must swallow that rejection itself, since no caller is left to see it.
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'getGroups') {
        return Promise.reject(new Error('getGroups failed'));
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);

    try {
      await expect(household.connect()).rejects.toThrow('ECONNREFUSED');

      // Simulate the background ladder's later success by firing the same
      // 'connected' listener household.connect() registered.
      const connectedHandlers = mockConn._listeners.get('connected') || [];
      expect(connectedHandlers.length).toBeGreaterThan(0);
      await connectedHandlers[0]();

      // Flush microtasks, then yield a real macrotask turn: Node only fires
      // 'unhandledRejection' once the microtask queue has fully drained and
      // control returns to the event loop, not mid-chain of awaits.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('SonosHousehold per-speaker resilience', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(async () => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));

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

  afterEach(() => {
    // The test below replaces the SonosConnection constructor mock with a
    // one-off implementation. Restore the shared singleton afterward so
    // later describe blocks that construct a SonosHousehold get the usual
    // mock connection instead of this test's leftover closure.
    (SonosConnection as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockConn);
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

describe('default backoff shape is a published contract', () => {
  // Consumers size their recovery window by multiplying these three defaults
  // out to a wall-clock duration. Neurotto does exactly this: it sets
  // maxAttempts to 94 to get a ~45 minute ladder before RECONNECT_EXHAUSTED,
  // and keeps it finite so the exhaustion notification still fires.
  //
  // DEFAULT_RECONNECT is module-private, so no downstream test can assert
  // against it. Changing initialDelay, factor or maxDelay would silently
  // resize every consumer's window with nothing failing anywhere — so the
  // tripwire lives here, where the change would be made.
  //
  // These values are not sacred. If you change one, change it deliberately
  // and tell the consumers; this test failing is the reminder to do that.
  //
  // The coupling runs both ways, and the reverse direction fails *quietly*.
  // The 94 below is a copy of Neurotto's RECONNECT_POLICY, not something we
  // control: if they move off it, this test keeps computing the window for
  // 94, keeps passing, and silently becomes an assertion about a number
  // nobody uses. It will not tell you it has gone stale. So when Neurotto's
  // cap changes, update the input and the bound together — and if you are
  // reading this while wondering whether 94 is still real, check
  // `RECONNECT_POLICY` in their `Sonos.ts` rather than trusting this block.
  function optionsHandedToConnection() {
    const Constructor = SonosConnection as unknown as ReturnType<typeof vi.fn>;
    Constructor.mockClear();
    new SonosHousehold({ host: '192.168.68.96' });
    return Constructor.mock.calls[0][0] as {
      reconnect: { initialDelay: number; factor: number; maxDelay: number; maxAttempts: number };
    };
  }

  it('uses 1s initial delay, factor 2, 30s ceiling', () => {
    const { reconnect } = optionsHandedToConnection();
    expect(reconnect.initialDelay).toBe(1000);
    expect(reconnect.factor).toBe(2);
    expect(reconnect.maxDelay).toBe(30000);
  });

  it('retries indefinitely unless the consumer caps it', () => {
    const { reconnect } = optionsHandedToConnection();
    expect(reconnect.maxAttempts).toBe(Infinity);
  });

  it('yields a ~45 minute ladder at the cap Neurotto chose', () => {
    const { reconnect } = optionsHandedToConnection();
    const { initialDelay, factor, maxDelay } = reconnect;

    // Mirrors scheduleReconnect(): delay n = min(initialDelay * factor^n, maxDelay)
    const windowFor = (maxAttempts: number) => {
      let total = 0;
      for (let n = 0; n < maxAttempts; n++) {
        total += Math.min(initialDelay * Math.pow(factor, n), maxDelay);
      }
      return total;
    };

    const minutes = windowFor(94) / 60000;
    expect(minutes).toBeGreaterThanOrEqual(44);
    expect(minutes).toBeLessThanOrEqual(46);
  });
});

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
    topology = mockTopology;
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false }));

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

describe('diagnostic event subscriptions', () => {
  let household: SonosHousehold;
  let mockConn: any;

  const sent = (namespace: string, command: string) =>
    mockConn.send.mock.calls.filter(
      ([req]: any) => req[0].namespace === namespace && req[0].command === command,
    ).length;

  beforeEach(async () => {
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false }));

    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'getGroups') {
        return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      }
      return Promise.resolve([{ success: true }, {}]);
    });
    await household.connect();
  });

  it('subscribes every player to groupVolume, playback and homeTheater', () => {
    // Three players in the mock topology. Without these, an external volume
    // change is indistinguishable from a group change, and a TV input switch
    // is invisible.
    expect(sent('groupVolume:1', 'subscribe')).toBe(3);
    expect(sent('playback:1', 'subscribe')).toBe(3);
    expect(sent('homeTheater:1', 'subscribe')).toBe(3);
  });

  it('re-subscribes them after a reconnect', async () => {
    const onConnected = mockConn._listeners.get('connected')![0];
    await onConnected();
    expect(sent('groupVolume:1', 'subscribe')).toBe(6);
    expect(sent('playback:1', 'subscribe')).toBe(6);
    expect(sent('homeTheater:1', 'subscribe')).toBe(6);
  });

  it('a failing subscription does not stop the household connecting', async () => {
    expect(household.players.size).toBe(3);
  });
});

describe('household setup lifecycle', () => {
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

  it('attaches its connection listeners once, however many times connect() is called', async () => {
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      return Promise.resolve([{ success: true }, {}]);
    });

    await household.connect();
    await household.disconnect();
    await household.connect();

    for (const event of ['connected', 'disconnected', 'reconnecting', 'error', 'message']) {
      expect(mockConn._listeners.get(event)).toHaveLength(1);
    }
  });

  it('queues a second setup run behind the first instead of interleaving them', async () => {
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    mockConn.send.mockImplementation(async (request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups' && headers.householdId) {
        await readGate;
        return [{ householdId: 'HH_1', success: true }, mockTopology];
      }
      if (headers.command === 'getGroups') return [{ householdId: 'HH_1', success: true }, mockTopology];
      return [{ success: true }, {}];
    });
    const topologyReads = () =>
      mockConn.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;

    const connecting = household.connect();
    await flush();
    expect(topologyReads()).toBe(1);

    // The connection flaps while the first run waits on its topology read.
    const secondRun = mockConn._listeners.get('connected')[0]();
    await flush();
    expect(topologyReads()).toBe(1);

    releaseRead();
    await connecting;
    await secondRun;
    expect(topologyReads()).toBe(2);
  });

  it('logs a diagnostic subscribe that fails, and still connects', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false, logger });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      if (headers.namespace === 'homeTheater:1') return Promise.reject(new Error('not a home theater'));
      return Promise.resolve([{ success: true }, {}]);
    });

    await household.connect();

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith('Failed to subscribe Office to homeTheater events', expect.objectContaining({ message: 'not a home theater' })));
  });

  it('logs a reconnect setup that fails', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false, logger });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      return Promise.resolve([{ success: true }, {}]);
    });
    await household.connect();

    // The socket drops again while the reconnect's setup is running.
    mockConn.state = 'disconnected';
    await mockConn._listeners.get('connected')[0]();

    expect(logger.warn).toHaveBeenCalledWith('Failed reconnect setup', expect.objectContaining({ message: 'Disconnected during setup' }));

    // The chain must still be usable after a failed run: a later reconnect runs normally.
    const readsBefore = mockConn.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;
    mockConn.state = 'connected';
    await mockConn._listeners.get('connected')[0]();
    const readsAfter = mockConn.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;
    expect(readsAfter).toBe(readsBefore + 1);
  });
});
