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

describe('PlayerHandle routing for a grouped non-coordinator', () => {
  const officePlayer: Player = { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'] };
  const underBedroom: Group = {
    id: 'RINCON_BED:1',
    name: 'Bedroom + 1',
    coordinatorId: 'RINCON_BED',
    playerIds: ['RINCON_BED', 'RINCON_OFFICE'],
  };

  function office() {
    const speaker = mockConnection();
    const groups = mockConnection();
    const coordinator = mockConnection();
    const handle = new PlayerHandle(officePlayer, underBedroom, 'HH_1', speaker, groups);
    handle.setCoordinatorConnectionResolver(() => coordinator);
    return { handle, speaker, coordinator };
  }

  const sentOn = (conn: SonosConnection) =>
    (conn.send as ReturnType<typeof vi.fn>).mock.calls.map(([req]: any) => req[0]);

  it('exposes its coordinator', () => {
    const { handle } = office();
    expect(handle.coordinatorId).toBe('RINCON_BED');
    expect(handle.isCoordinator).toBe(false);
  });

  it.each([
    ['playback.pause', (h: PlayerHandle) => h.playback.pause(), 'playback:1', 'pause'],
    ['playback.getStatus', (h: PlayerHandle) => h.playback.getStatus(), 'playback:1', 'getPlaybackStatus'],
    ['playback.getMetadata', (h: PlayerHandle) => h.playback.getMetadata(), 'playbackMetadata:1', 'getMetadataStatus'],
    ['favorites.load', (h: PlayerHandle) => h.favorites.load('F1'), 'favorites:1', 'loadFavorite'],
    ['playlists.load', (h: PlayerHandle) => h.playlists.load('PL1'), 'playlists:1', 'loadPlaylist'],
  ])('%s goes through the coordinator socket', async (_name, call, namespace, command) => {
    const { handle, speaker, coordinator } = office();
    await call(handle);
    expect(sentOn(speaker)).toHaveLength(0);
    expect(sentOn(coordinator)).toEqual([
      expect.objectContaining({ namespace, command, groupId: 'RINCON_BED:1', playerId: 'RINCON_OFFICE' }),
    ]);
  });

  it.each([
    ['volume.set', (h: PlayerHandle) => h.volume.set(20), 'playerVolume:1', 'setVolume'],
    ['favorites.get', (h: PlayerHandle) => h.favorites.get(), 'favorites:1', 'getFavorites'],
    ['playlists.get', (h: PlayerHandle) => h.playlists.get(), 'playlists:1', 'getPlaylists'],
    ['homeTheater.get', (h: PlayerHandle) => h.homeTheater.get(), 'homeTheater:1', 'getOptions'],
    ['settings.get', (h: PlayerHandle) => h.settings.get(), 'settings:1', 'getPlayerSettings'],
  ])('%s stays on the player socket', async (_name, call, namespace, command) => {
    const { handle, speaker, coordinator } = office();
    await call(handle);
    expect(sentOn(coordinator)).toHaveLength(0);
    expect(sentOn(speaker)).toEqual([expect.objectContaining({ namespace, command })]);
  });
});
