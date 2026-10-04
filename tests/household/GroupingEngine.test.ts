import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupingEngine } from '../../src/household/GroupingEngine.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';
import type { GroupsNamespace } from '../../src/namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../../src/player/PlayerHandle.js';
import type { Logger } from '../../src/util/logger.js';
import { noopLogger } from '../../src/util/logger.js';
import { SonosError } from '../../src/errors/SonosError.js';
import { CommandError } from '../../src/errors/CommandError.js';

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
    // Sonos's grouping as live probes observed it: createGroup with a music context copies the source group's audio
    // and pauses that group; setGroupMembers makes the group exactly the named players, and each one it removes
    // ends up solo and idle.
    let nextGroup = 0;
    // Groups whose audio Sonos cannot copy (a bare Spotify Connect session); createGroup refuses them.
    let uncopyable: string[] = [];

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

    function createGroup(playerIds: string[], musicContextGroupId?: string) {
      const source = topology.groups.find((g) => g.id === musicContextGroupId);
      if (source && uncopyable.includes(source.id)) {
        return Promise.reject(new CommandError('ERROR_PLAYBACK_FAILED', 'music context content cannot be copied'));
      }
      const rest = without(playerIds)
        .map((g) => (g.id === source?.id ? { ...g, playbackState: 'PLAYBACK_STATE_PAUSED' } : g));
      const playbackState = source?.playbackState ?? 'PLAYBACK_STATE_IDLE';
      topology.groups = [...rest, { ...solo(playerIds[0]!), playerIds, playbackState }];
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
      uncopyable = [];
      householdGroups.createGroup.mockImplementation(createGroup);
      for (const [id, handle] of players) {
        vi.mocked(handle.groups.modifyGroupMembers).mockImplementation(
          (add?: string[], remove?: string[]) => modifyGroupMembers(id, add, remove) as any);
        vi.mocked(handle.groups.setGroupMembers).mockImplementation(
          (playerIds: string[]) => setGroupMembers(id, playerIds));
      }
    });

    it('copies the audio to the target and splits the source group it leaves behind', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B'], [['C']]]);
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
    });

    it('moves the source group when Sonos cannot copy its audio', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      uncopyable = ['G_B'];

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('lets any other error from the copy through, without moving', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      householdGroups.createGroup.mockRejectedValueOnce(new CommandError('ERROR_INVALID_PARAMETER', 'bad group'));

      await expect(engine.group([players.get('A')!], { transfer: true })).rejects.toMatchObject({
        code: 'ERROR_INVALID_PARAMETER',
      });
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
    });

    it('pulls a target out of the playing group it belongs to', async () => {
      startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
    });

    it('adds the other requested members after an explicit transfer', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));

      await engine.group([players.get('A')!, players.get('C')!], { transfer: { id: 'B' } });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(players.get('A')!.groups.modifyGroupMembers).toHaveBeenCalledWith(['C'], undefined);
      expect(state()).toEqual(['A+C:PLAYING', 'B:PAUSED']);
    });

    it('waits for the move to land before adding the other requested members', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      uncopyable = ['G_B'];
      // The move first shows as ( A* + B + C ); Sonos drops B and C only on the third topology read after it.
      let reads: number | undefined;
      const read = () => {
        const seen = { ...topology };
        if (reads !== undefined && ++reads === 3) {
          const own = topology.groups.find((g) => g.coordinatorId === 'A')!;
          modifyGroupMembers('A', [], ['B', 'C'].filter((id) => own.playerIds.includes(id)));
        }
        return Promise.resolve(seen);
      };
      householdGroups.getGroups.mockImplementation(read);
      refreshTopology.mockImplementation(read);
      vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
        startWith(makeGroup('G_B', ['A', 'B', 'C'], 'PLAYING'));
        reads = 0;
        return Promise.resolve();
      });
      vi.useFakeTimers();
      try {
        const grouping = engine.group([players.get('A')!, players.get('C')!], { transfer: { id: 'B' } });
        await vi.advanceTimersByTimeAsync(2000);
        await grouping;
      } finally {
        vi.useRealTimers();
      }

      expect(state()).toEqual(['A+C:PLAYING', 'B:IDLE']);
    });

    it("sends the move from the source group's coordinator, not the named source", async () => {
      startWith(makeGroup('G_C', ['C', 'B'], 'PLAYING'), makeGroup('G_A', ['A'], 'IDLE'));
      uncopyable = ['G_C'];

      await engine.group([players.get('A')!], { transfer: { id: 'B' } });

      expect(players.get('C')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(players.get('B')!.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('leaves a move that outlasts the settle wait alone', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      uncopyable = ['G_B'];
      // The move is still handing the coordinator role over: B coordinates ( B + A ), C is already out.
      vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
        startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));
        return Promise.resolve();
      });
      vi.useFakeTimers();
      try {
        const grouping = engine.group([players.get('A')!], { transfer: true });
        await vi.advanceTimersByTimeAsync(9000);
        await grouping;
      } finally {
        vi.useRealTimers();
      }

      expect(householdGroups.createGroup.mock.calls).toEqual([[['A'], 'G_B']]);
      expect(state()).toEqual(['B+A:PLAYING', 'C:IDLE']);
    });

    it('leaves a playing target alone rather than pulling in paused audio from elsewhere', async () => {
      startWith(makeGroup('G_A', ['A'], 'PLAYING'), makeGroup('G_B', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PAUSED'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup).not.toHaveBeenCalled();
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:PAUSED']);
    });

    it("splits a playing target's own group instead of pulling in paused audio", async () => {
      startWith(makeGroup('G_A', ['A', 'B'], 'PLAYING'), makeGroup('G_C', ['C'], 'PAUSED'));

      await engine.group([players.get('A')!], { transfer: true });

      expect(householdGroups.createGroup.mock.calls).toEqual([[['B']]]);
      for (const handle of players.values()) expect(handle.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:PAUSED']);
    });

    // Sonos plays the copy at once but answers only when the source group stops, here 20 s later.
    function slowCopy(outcome: 'answers' | 'fails') {
      householdGroups.createGroup.mockImplementationOnce((playerIds: string[], musicContextGroupId?: string) => {
        const source = topology.groups.find((g) => g.id === musicContextGroupId)!;
        topology.groups = [
          ...without(playerIds),
          { ...solo(playerIds[0]!), playerIds, playbackState: source.playbackState },
        ];
        return new Promise((resolve, reject) => setTimeout(() => {
          topology.groups = topology.groups.map(
            (g) => (g.id === source.id ? { ...g, playbackState: 'PLAYBACK_STATE_PAUSED' } : g));
          if (outcome === 'answers') resolve({ group: {} });
          else reject(new CommandError('ERROR_COMMAND_FAILED', 'late failure'));
        }, 20000));
      });
    }

    it('counts a copy as done once the target plays it, before Sonos answers', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      slowCopy('answers');
      vi.useFakeTimers();
      try {
        let done = false;
        const grouping = engine.group([players.get('A')!], { transfer: true }).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(3000);
        expect(done).toBe(true);
        expect(state()).toEqual(['A:PLAYING', 'B:PLAYING', 'C:IDLE']);
        await vi.advanceTimersByTimeAsync(20000);
        await grouping;
        expect(state()).toEqual(['A:PLAYING', 'B:PAUSED', 'C:IDLE']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a copy that fails after the target started playing', async () => {
      const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      engine = new GroupingEngine(householdGroups, refreshTopology, players, log);
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      slowCopy('fails');
      vi.useFakeTimers();
      try {
        await Promise.all([
          engine.group([players.get('A')!], { transfer: true }),
          vi.advanceTimersByTimeAsync(3000),
        ]);
        await vi.advanceTimersByTimeAsync(20000);
        expect(log.warn).toHaveBeenCalledWith(
          expect.stringContaining('failed after it started playing'),
          expect.anything(),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
