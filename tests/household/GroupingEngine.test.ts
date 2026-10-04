import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupingEngine } from '../../src/household/GroupingEngine.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';
import type { GroupsNamespace } from '../../src/namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../../src/player/PlayerHandle.js';
import type { Logger } from '../../src/util/logger.js';
import { noopLogger } from '../../src/util/logger.js';
import { SonosError } from '../../src/errors/SonosError.js';

function makeTopology(groups: Group[], players: Player[]): GroupsResponse {
  return { groups, players };
}

function mockHandle(id: string, name: string, groupId: string): PlayerHandle {
  return {
    id,
    name,
    groupId,
    isCoordinator: true,
    capabilities: ['PLAYBACK'],
    groups: {
      modifyGroupMembers: vi.fn().mockResolvedValue({ group: {} }),
      createGroup: vi.fn().mockResolvedValue({ group: {} }),
      setGroupMembers: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PlayerHandle;
}

describe('GroupingEngine', () => {
  let engine: GroupingEngine;
  let householdGroups: any;
  let refreshTopology: ReturnType<typeof vi.fn>;
  let players: Map<string, PlayerHandle>;
  let topology: GroupsResponse;

  beforeEach(() => {
    topology = makeTopology(
      [
        { id: 'G_A', name: 'Arc', coordinatorId: 'A', playerIds: ['A'], playbackState: 'PLAYBACK_STATE_IDLE' },
        { id: 'G_B', name: 'Bedroom', coordinatorId: 'B', playerIds: ['B'], playbackState: 'PLAYBACK_STATE_IDLE' },
        { id: 'G_C', name: 'Office', coordinatorId: 'C', playerIds: ['C'], playbackState: 'PLAYBACK_STATE_IDLE' },
      ] as Group[],
      [
        { id: 'A', name: 'Arc', capabilities: ['PLAYBACK'] },
        { id: 'B', name: 'Bedroom', capabilities: ['PLAYBACK'] },
        { id: 'C', name: 'Office', capabilities: ['PLAYBACK'] },
      ] as Player[],
    );

    players = new Map([
      ['A', mockHandle('A', 'Arc', 'G_A')],
      ['B', mockHandle('B', 'Bedroom', 'G_B')],
      ['C', mockHandle('C', 'Office', 'G_C')],
    ]);

    householdGroups = {
      getGroups: vi.fn().mockResolvedValue(topology),
      createGroup: vi.fn().mockResolvedValue({ group: {} }),
    };

    refreshTopology = vi.fn().mockResolvedValue(topology);

    engine = new GroupingEngine(householdGroups, refreshTopology, players, noopLogger);
  });

  it('group() throws on empty array', async () => {
    await expect(engine.group([])).rejects.toThrow();
  });

  it('group([single]) is a no-op for solo player', async () => {
    const a = players.get('A')!;
    await engine.group([a]);
    expect(householdGroups.createGroup).not.toHaveBeenCalled();
  });

  it('ungroup() is a no-op for solo player', async () => {
    const a = players.get('A')!;
    await engine.ungroup(a);
    expect(householdGroups.createGroup).not.toHaveBeenCalled();
  });

  it('ungroup() calls createGroup for grouped player', async () => {
    // Make B grouped with A
    topology.groups[0]!.playerIds = ['A', 'B'];
    topology.groups.splice(1, 1); // remove B's solo group
    const b = players.get('B')!;
    await engine.ungroup(b);
    expect(householdGroups.createGroup).toHaveBeenCalledWith(['B']);
  });

  it('group([A, B]) calls simpleGroup when no transfer', async () => {
    const a = players.get('A')!;
    const b = players.get('B')!;
    await engine.group([a, b]);
    // Should call modifyGroupMembers on A's handle to add B
    expect(a.groups.modifyGroupMembers).toHaveBeenCalled();
  });

  describe('transfer', () => {
    // Sonos's grouping as live probes observed it: setGroupMembers keeps the group's session and makes the group
    // exactly the named players, coordinated by the first; every player it removes ends up solo and idle.
    let nextGroup = 0;

    function without(ids: string[]): Group[] {
      return topology.groups
        .map((g) => {
          const rest = g.playerIds.filter((id) => !ids.includes(id));
          return { ...g, playerIds: rest, coordinatorId: rest.includes(g.coordinatorId) ? g.coordinatorId : rest[0]! };
        })
        .filter((g) => g.playerIds.length > 0);
    }

    const solo = (id: string): Group => ({
      id: `G_new${++nextGroup}`, name: '', coordinatorId: id, playerIds: [id], playbackState: 'PLAYBACK_STATE_IDLE',
    });

    function createGroup(playerIds: string[]) {
      topology.groups = [...without(playerIds), { ...solo(playerIds[0]!), playerIds }];
      return Promise.resolve({ group: {} });
    }

    function modifyGroupMembers(coordinatorId: string, add: string[] = [], remove: string[] = []) {
      const groups = without(add);
      const own = groups.find((g) => g.coordinatorId === coordinatorId)!;
      own.playerIds = [...own.playerIds.filter((id) => !remove.includes(id)), ...add];
      topology.groups = [...groups, ...remove.map(solo)];
      return Promise.resolve({ group: {} });
    }

    function setGroupMembers(coordinatorId: string, playerIds: string[]) {
      const own = topology.groups.find((g) => g.coordinatorId === coordinatorId)!;
      const removed = own.playerIds.filter((id) => !playerIds.includes(id));
      const moved = { ...own, coordinatorId: playerIds[0]!, playerIds };
      topology.groups = [...without(playerIds).filter((g) => g.id !== own.id), moved, ...removed.map(solo)];
      return Promise.resolve();
    }

    const state = () => topology.groups
      .map((g) => `${g.playerIds.join('+')}:${g.playbackState!.replace('PLAYBACK_STATE_', '')}`)
      .sort();

    const makeGroup = (id: string, playerIds: string[], playback: string): Group =>
      ({ id, name: '', coordinatorId: playerIds[0]!, playerIds, playbackState: `PLAYBACK_STATE_${playback}` });

    function startWith(...groups: Group[]) {
      topology.groups = groups;
    }

    beforeEach(() => {
      householdGroups.createGroup.mockImplementation(createGroup);
      for (const [id, handle] of players) {
        vi.mocked(handle.groups.modifyGroupMembers).mockImplementation(
          (add?: string[], remove?: string[]) => modifyGroupMembers(id, add, remove) as any);
        vi.mocked(handle.groups.setGroupMembers).mockImplementation(
          (playerIds: string[]) => setGroupMembers(id, playerIds));
      }
    });

    it('moves the source group to the target in one command, leaving the players it removes idle', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('pulls a target out of the playing group it belongs to', async () => {
      startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('adds the other requested members after an explicit transfer', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!, players.get('C')!], { transfer: { id: 'B' } });

      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(players.get('A')!.groups.modifyGroupMembers).toHaveBeenCalledWith(['C'], undefined);
      expect(state()).toEqual(['A+C:PLAYING', 'B:IDLE']);
    });

    it('leaves a playing target alone rather than pulling in paused audio from elsewhere', async () => {
      startWith(makeGroup('G_A', ['A'], 'PLAYING'), makeGroup('G_B', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PAUSED'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:PAUSED']);
    });

    it("splits a playing target's own group instead of pulling in paused audio", async () => {
      startWith(makeGroup('G_A', ['A', 'B'], 'PLAYING'), makeGroup('G_C', ['C'], 'PAUSED'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['B']]]);
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:PAUSED']);
    });
  });
});
