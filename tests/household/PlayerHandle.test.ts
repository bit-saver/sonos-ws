import { describe, it, expect, vi } from 'vitest';
import { PlayerHandle } from '../../src/household/PlayerHandle.js';
import type { Player, Group } from '../../src/types/groups.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function mockConnection(): SonosConnection {
  return {
    send: vi.fn().mockResolvedValue([{}, {}]),
    state: 'connected',
  } as unknown as SonosConnection;
}

const arcPlayer: Player = {
  id: 'RINCON_ARC',
  name: 'Arc',
  capabilities: ['PLAYBACK', 'HT_PLAYBACK'],
};

const officePlayer: Player = {
  id: 'RINCON_OFFICE',
  name: 'Office',
  capabilities: ['PLAYBACK'],
};

const arcGroup: Group = {
  id: 'RINCON_ARC:123',
  name: 'Arc',
  coordinatorId: 'RINCON_ARC',
  playerIds: ['RINCON_ARC'],
};

describe('PlayerHandle', () => {
  it('exposes player id and name', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.id).toBe('RINCON_ARC');
    expect(handle.name).toBe('Arc');
  });

  it('returns correct groupId', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupId).toBe('RINCON_ARC:123');
  });

  it('isCoordinator returns true when player is coordinator', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.isCoordinator).toBe(true);
  });

  it('isCoordinator returns false when player is not coordinator', () => {
    const conn = mockConnection();
    const groupedGroup: Group = {
      id: 'RINCON_ARC:123',
      name: 'Arc + 1',
      coordinatorId: 'RINCON_ARC',
      playerIds: ['RINCON_ARC', 'RINCON_OFFICE'],
    };
    const handle = new PlayerHandle(officePlayer, groupedGroup, 'HH_1', conn);
    expect(handle.isCoordinator).toBe(false);
  });

  it('updates groupId when updateGroup is called', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupId).toBe('RINCON_ARC:123');

    const newGroup: Group = { id: 'RINCON_ARC:789', name: 'Arc + 1', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] };
    handle.updateGroup(newGroup);
    expect(handle.groupId).toBe('RINCON_ARC:789');
  });

  it('has namespace accessors that use player-scoped context', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupVolume).toBeDefined();
    expect(handle.playerVolume).toBeDefined();
    expect(handle.playback).toBeDefined();
    expect(handle.playbackMetadata).toBeDefined();
    expect(handle.favorites).toBeDefined();
    expect(handle.playlists).toBeDefined();
    expect(handle.audioClip).toBeDefined();
    expect(handle.homeTheater).toBeDefined();
    expect(handle.settings).toBeDefined();
  });

  it('capabilities reflects player capabilities', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.capabilities).toEqual(['PLAYBACK', 'HT_PLAYBACK']);
  });
});
