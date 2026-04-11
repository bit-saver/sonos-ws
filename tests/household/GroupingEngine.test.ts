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
});
