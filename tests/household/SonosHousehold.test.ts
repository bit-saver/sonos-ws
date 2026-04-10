import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';
import { SonosConnection } from '../../src/client/SonosConnection.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';

// Mock SonosConnection
vi.mock('../../src/client/SonosConnection.js', () => {
  const listeners = new Map<string, Function[]>();
  const mockConnection = {
    connect: vi.fn().mockResolvedValue(undefined),
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

function getMockConnection(): any {
  return (SonosConnection as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
}

describe('SonosHousehold', () => {
  let household: SonosHousehold;
  let mockConn: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the listeners map
    const Constructor = SonosConnection as unknown as ReturnType<typeof vi.fn>;
    Constructor.mockClear();

    household = new SonosHousehold({ host: '192.168.68.96' });
    mockConn = getMockConnection();

    // Reset listeners
    mockConn._listeners.clear();
    // Re-wire the on mock to track listeners
    mockConn.on.mockImplementation((event: string, handler: Function) => {
      if (!mockConn._listeners.has(event)) mockConn._listeners.set(event, []);
      mockConn._listeners.get(event)!.push(handler);
      return mockConn;
    });

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

  it('group() throws on empty array', async () => {
    await expect(household.group([])).rejects.toThrow('INVALID_PARAMETER');
  });

  it('ungroup() is a no-op for solo player', async () => {
    const initialCallCount = mockConn.send.mock.calls.length;
    const arc = household.player('Arc');
    await household.ungroup(arc);
    // Should not call send again since arc is already solo
    expect(mockConn.send.mock.calls.length).toBe(initialCallCount);
  });

  it('group([single]) is a no-op for solo player', async () => {
    const arc = household.player('Arc');
    const initialCallCount = mockConn.send.mock.calls.length;
    await household.group([arc]);
    // Should not make any additional API calls
    expect(mockConn.send.mock.calls.length).toBe(initialCallCount);
  });
});
