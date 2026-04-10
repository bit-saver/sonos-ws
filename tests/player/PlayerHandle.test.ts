import { describe, it, expect, vi } from 'vitest';
import { PlayerHandle } from '../../src/player/PlayerHandle.js';
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

const arcGroup: Group = {
  id: 'RINCON_ARC:123',
  name: 'Arc',
  coordinatorId: 'RINCON_ARC',
  playerIds: ['RINCON_ARC'],
};

describe('PlayerHandle', () => {
  it('exposes player id, name, and capabilities', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.id).toBe('RINCON_ARC');
    expect(handle.name).toBe('Arc');
    expect(handle.capabilities).toEqual(['PLAYBACK', 'HT_PLAYBACK']);
  });

  it('returns correct groupId', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.groupId).toBe('RINCON_ARC:123');
  });

  it('isCoordinator returns true when player is coordinator', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.isCoordinator).toBe(true);
  });

  it('updates groupId when updateGroup is called', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    const newGroup: Group = { id: 'RINCON_ARC:789', name: 'Arc + 1', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] };
    handle.updateGroup(newGroup);
    expect(handle.groupId).toBe('RINCON_ARC:789');
  });

  it('has wrapper namespace accessors', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.volume).toBeDefined();
    expect(handle.playback).toBeDefined();
    expect(handle.favorites).toBeDefined();
    expect(handle.playlists).toBeDefined();
    expect(handle.audioClip).toBeDefined();
    expect(handle.homeTheater).toBeDefined();
    expect(handle.settings).toBeDefined();
    expect(handle.groups).toBeDefined();
  });

  it('volume.set sends command with correct groupId', async () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    await handle.volume.set(50);
    const send = conn.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.groupId).toBe('RINCON_ARC:123');
    expect(headers.playerId).toBe('RINCON_ARC');
    expect(headers.command).toBe('setVolume');
    expect(body.volume).toBe(50);
  });
});
