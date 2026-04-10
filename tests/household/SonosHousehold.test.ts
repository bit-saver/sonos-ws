import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';
import { SonosClient } from '../../src/client/SonosClient.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';

// Mock SonosClient
vi.mock('../../src/client/SonosClient.js', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    householdId: 'HH_1',
    groupId: 'RINCON_ARC:123',
    playerId: 'RINCON_ARC',
    rawConnection: {},
    groups: {
      getGroups: vi.fn(),
    },
  };
  return { SonosClient: vi.fn(() => mockClient) };
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

describe('SonosHousehold', () => {
  let household: SonosHousehold;

  beforeEach(() => {
    vi.clearAllMocks();
    household = new SonosHousehold({ host: '192.168.68.96' });
    const mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockClient.groups.getGroups.mockResolvedValue(mockTopology);
  });

  it('connects and discovers topology', async () => {
    await household.connect();
    expect(household.players.size).toBe(3);
    expect(household.groups.length).toBe(3);
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

  it('disconnect calls client disconnect', async () => {
    await household.connect();
    await household.disconnect();
    const mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});

describe('SonosHousehold grouping', () => {
  let household: SonosHousehold;
  let mockClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    household = new SonosHousehold({ host: '192.168.68.96' });
    mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockClient.groups.getGroups.mockResolvedValue(mockTopology);
    await household.connect();
  });

  it('group() throws on empty array', async () => {
    await expect(household.group([])).rejects.toThrow('INVALID_PARAMETER');
  });

  it('ungroup() is a no-op for solo player', async () => {
    const initialCallCount = mockClient.groups.getGroups.mock.calls.length;
    const arc = household.player('Arc');
    await household.ungroup(arc);
    // Should not call getGroups again since arc is already solo
    expect(mockClient.groups.getGroups.mock.calls.length).toBe(initialCallCount);
  });

  it('group([single]) is a no-op for solo player', async () => {
    const arc = household.player('Arc');
    await household.group([arc]);
    // Should not make any group modification API calls
  });
});
