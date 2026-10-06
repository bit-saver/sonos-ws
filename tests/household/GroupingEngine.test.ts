import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

    // Under fake timers: runs `call` and checks it has finished within `ms`.
    async function finishesWithin(ms: number, call: () => Promise<void>) {
      let done = false;
      const running = call().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(ms);
      expect(done).toBe(true);
      await running;
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

    it('waits for the move to land before adding the other requested members', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
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

      await engine.group([players.get('A')!], { transfer: { id: 'B' } });

      expect(players.get('C')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      expect(players.get('B')!.groups.setGroupMembers).not.toHaveBeenCalled();
      expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
    });

    it('returns once Sonos has added a single target, without waiting for the handoff', async () => {
      startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
      // Sonos adds A and removes C at once; B hands A the coordinator role only seconds later.
      vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
        startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));
        return Promise.resolve();
      });
      vi.useFakeTimers();
      try {
        await finishesWithin(100, () => engine.group([players.get('A')!], { transfer: true }));
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['B+A:PLAYING', 'C:IDLE']);
      } finally {
        vi.useRealTimers();
      }
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

    describe('the next call after a move', () => {
      const arc = () => players.get('A')!;
      const transferToArc = () => engine.group([arc()], { transfer: true });

      // Where every move here ends: A leads the playing group, B and C are idle.
      const settled = (): Group[] =>
        [makeGroup('G_B', ['A'], 'PLAYING'), makeGroup('G_x', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'IDLE')];

      // A leads the playing group, but the removed C still reports PLAYING.
      const cStillPlaying = (): Group[] =>
        [makeGroup('G_B', ['A'], 'PLAYING'), makeGroup('G_x', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PLAYING')];

      // B's move as Sonos shows it: `now` once Sonos answers, then each [ms, groups] that many ms after the move.
      function moveShows(now: Group[], ...later: Array<[number, Group[]]>) {
        vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
          startWith(...now);
          for (const [ms, groups] of later) setTimeout(() => startWith(...groups), ms);
          return Promise.resolve();
        });
      }

      beforeEach(() => {
        startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PLAYING'));
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('does not take a removed player that still reports PLAYING as a source', async () => {
        // As live: Sonos answers once A leads, and C reports PLAYING a moment longer.
        moveShows(cStillPlaying(), [800, settled()]);

        await transferToArc();
        await finishesWithin(2000, transferToArc);

        expect(players.get('C')!.groups.setGroupMembers).not.toHaveBeenCalled();
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('waits for the handoff when Sonos answers first, rather than splitting the playing group', async () => {
        // Sonos adds A and removes C at once; B hands A the coordinator role at 7 s and leaves at 7.5 s.
        moveShows(
          [makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE')],
          [7000, [makeGroup('G_B', ['A', 'B'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE')]],
          [7500, settled()],
        );

        await transferToArc();
        await finishesWithin(8000, transferToArc);

        expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledTimes(1);
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('waits for the handoff while the moved group reports BUFFERING', async () => {
        moveShows(
          [makeGroup('G_B', ['B', 'A'], 'BUFFERING'), makeGroup('G_C', ['C'], 'IDLE')],
          [1000, [makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE')]],
          [7000, settled()],
        );

        await transferToArc();
        await finishesWithin(8000, transferToArc);

        expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledTimes(1);
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it.each([
        ['ungroup(A)', () => engine.ungroup(arc())],
        ['ungroupAll()', () => engine.ungroupAll()],
      ])('%s waits for the handoff too', async (_, call) => {
        moveShows([makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE')], [7000, settled()]);

        await transferToArc();
        await finishesWithin(8000, call);

        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('runs a call sent before Sonos answers the move after it, once the move has settled', async () => {
        // Sonos adds A and removes C at once, but answers only once A leads, 5 s later.
        vi.mocked(players.get('B')!.groups.setGroupMembers).mockImplementation(() => {
          startWith(makeGroup('G_B', ['B', 'A'], 'PLAYING'), makeGroup('G_C', ['C'], 'IDLE'));
          return new Promise((resolve) => setTimeout(() => {
            startWith(...settled());
            resolve();
          }, 5000));
        });

        const first = transferToArc();
        await vi.advanceTimersByTimeAsync(1000);
        await finishesWithin(5000, transferToArc);
        await first;

        expect(players.get('B')!.groups.setGroupMembers).toHaveBeenCalledTimes(1);
        expect(householdGroups.createGroup).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('gives up when the move stops counting and takes a still-playing removed player as a source', async () => {
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        engine = new GroupingEngine(householdGroups, refreshTopology, players, log);
        moveShows(cStillPlaying());

        await transferToArc();
        await finishesWithin(10_500, transferToArc);

        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('did not settle'));
        expect(players.get('C')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      });

      it('waits on a move only once', async () => {
        moveShows(cStillPlaying(), [800, settled()]);

        await transferToArc();
        await finishesWithin(2000, transferToArc);
        const reads = householdGroups.getGroups.mock.calls.length;
        await finishesWithin(100, () => engine.ungroup(arc()));

        expect(householdGroups.getGroups.mock.calls.length).toBe(reads);
      });

      it('does not wait after a move Sonos refused', async () => {
        vi.mocked(players.get('B')!.groups.setGroupMembers)
          .mockRejectedValueOnce(new CommandError('ERROR_COMMAND_FAILED', 'refused'));

        await expect(transferToArc()).rejects.toThrow('refused');
        await finishesWithin(100, transferToArc);

        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('does not wait on a member an explicit transfer adds back', async () => {
        await engine.group([arc(), players.get('C')!], { transfer: { id: 'B' } });
        await finishesWithin(100, () => engine.ungroup(players.get('C')!));

        expect(state()).toEqual(['A:PLAYING', 'B:IDLE', 'C:IDLE']);
      });

      it('does not take a removed player that still reports PAUSED as a source after moving paused audio', async () => {
        startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B', 'C'], 'PAUSED'));
        moveShows(
          [makeGroup('G_B', ['A'], 'PAUSED'), makeGroup('G_x', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PAUSED')],
          [800, [makeGroup('G_B', ['A'], 'PAUSED'), makeGroup('G_x', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'IDLE')]],
        );

        await transferToArc();
        await finishesWithin(2000, transferToArc);

        expect(players.get('C')!.groups.setGroupMembers).not.toHaveBeenCalled();
        expect(state()).toEqual(['A:PAUSED', 'B:IDLE', 'C:IDLE']);
      });

      it('waits no longer than the move counts', async () => {
        await transferToArc();
        await vi.advanceTimersByTimeAsync(9000);
        startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PLAYING'));

        await finishesWithin(1500, transferToArc);

        expect(players.get('C')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      });

      it('takes a removed player as a source again once the move is old', async () => {
        await transferToArc();
        await vi.advanceTimersByTimeAsync(60_000);
        startWith(makeGroup('G_A', ['A'], 'IDLE'), makeGroup('G_B', ['B'], 'IDLE'), makeGroup('G_C', ['C'], 'PLAYING'));

        await finishesWithin(100, transferToArc);

        expect(householdGroups.getGroups).not.toHaveBeenCalled();
        expect(players.get('C')!.groups.setGroupMembers).toHaveBeenCalledWith(['A']);
      });
    });
  });
});
