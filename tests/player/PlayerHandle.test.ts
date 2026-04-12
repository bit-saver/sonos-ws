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
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn, conn);
    expect(handle.id).toBe('RINCON_ARC');
    expect(handle.name).toBe('Arc');
    expect(handle.capabilities).toEqual(['PLAYBACK', 'HT_PLAYBACK']);
  });

  it('returns correct groupId', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn, conn);
    expect(handle.groupId).toBe('RINCON_ARC:123');
  });

  it('isCoordinator returns true when player is coordinator', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn, conn);
    expect(handle.isCoordinator).toBe(true);
  });

  it('updates groupId when updateGroup is called', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn, conn);
    const newGroup: Group = { id: 'RINCON_ARC:789', name: 'Arc + 1', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] };
    handle.updateGroup(newGroup);
    expect(handle.groupId).toBe('RINCON_ARC:789');
  });

  it('has wrapper namespace accessors', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn, conn);
    expect(handle.volume).toBeDefined();
    expect(handle.playback).toBeDefined();
    expect(handle.favorites).toBeDefined();
    expect(handle.playlists).toBeDefined();
    expect(handle.audioClip).toBeDefined();
    expect(handle.homeTheater).toBeDefined();
    expect(handle.settings).toBeDefined();
    expect(handle.groups).toBeDefined();
  });

  it('volume.set sends command via the speaker connection', async () => {
    const speakerConn = mockConnection();
    const groupsConn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', speakerConn, groupsConn);
    await handle.volume.set(50);
    const speakerSend = speakerConn.send as ReturnType<typeof vi.fn>;
    const groupsSend = groupsConn.send as ReturnType<typeof vi.fn>;
    expect(speakerSend.mock.calls.length).toBeGreaterThan(0);
    expect(groupsSend.mock.calls.length).toBe(0);
    const [headers, body] = speakerSend.mock.calls[0][0];
    expect(headers.groupId).toBe('RINCON_ARC:123');
    expect(headers.playerId).toBe('RINCON_ARC');
    expect(headers.command).toBe('setVolume');
    expect(body.volume).toBe(50);
  });

  it('groups namespace uses the groups connection, not the speaker connection', () => {
    const speakerConn = mockConnection();
    const groupsConn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', speakerConn, groupsConn);

    // Call a groups method — getGroups sends via the groups connection
    handle.groups.getGroups();
    const speakerSend = speakerConn.send as ReturnType<typeof vi.fn>;
    const groupsSend = groupsConn.send as ReturnType<typeof vi.fn>;
    expect(groupsSend.mock.calls.length).toBeGreaterThan(0);
    expect(speakerSend.mock.calls.length).toBe(0);
  });

  it('setSpeakerConnection updates the connection used by speaker namespaces', async () => {
    const originalConn = mockConnection();
    const groupsConn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', originalConn, groupsConn);

    const newConn = mockConnection();
    handle.setSpeakerConnection(newConn);

    await handle.volume.set(30);
    const originalSend = originalConn.send as ReturnType<typeof vi.fn>;
    const newSend = newConn.send as ReturnType<typeof vi.fn>;
    expect(originalSend.mock.calls.length).toBe(0);
    expect(newSend.mock.calls.length).toBeGreaterThan(0);
  });
});
