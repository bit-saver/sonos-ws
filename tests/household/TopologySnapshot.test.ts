import { describe, it, expect } from 'vitest';
import { TopologySnapshot } from '../../src/household/TopologySnapshot.js';
import type { Group, Player, GroupsResponse } from '../../src/types/groups.js';

const groups: Group[] = [
  { id: 'G_ARC', name: 'Arc', coordinatorId: 'P_ARC', playerIds: ['P_ARC'], playbackState: 'PLAYBACK_STATE_PLAYING' },
  { id: 'G_BED', name: 'Bedroom', coordinatorId: 'P_BED', playerIds: ['P_BED', 'P_OFF'], playbackState: 'PLAYBACK_STATE_IDLE' },
];

const players: Player[] = [
  { id: 'P_ARC', name: 'Arc', capabilities: ['PLAYBACK'] },
  { id: 'P_BED', name: 'Bedroom', capabilities: ['PLAYBACK'] },
  { id: 'P_OFF', name: 'Office', capabilities: ['PLAYBACK'] },
];

const response: GroupsResponse = { groups, players };

describe('TopologySnapshot', () => {
  it('findGroupOf returns the group containing a player', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.findGroupOf('P_ARC')?.id).toBe('G_ARC');
    expect(snap.findGroupOf('P_OFF')?.id).toBe('G_BED');
    expect(snap.findGroupOf('P_UNKNOWN')).toBeUndefined();
  });

  it('coordinatorOf returns the coordinator ID for a player', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.coordinatorOf('P_ARC')).toBe('P_ARC');
    expect(snap.coordinatorOf('P_OFF')).toBe('P_BED');
    expect(snap.coordinatorOf('P_UNKNOWN')).toBeUndefined();
  });

  it('isAloneInGroup returns true for solo players', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.isAloneInGroup('P_ARC')).toBe(true);
    expect(snap.isAloneInGroup('P_BED')).toBe(false);
    expect(snap.isAloneInGroup('P_OFF')).toBe(false);
  });

  it('groups is a readonly array', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.groups).toHaveLength(2);
  });

  it('players is a readonly array', () => {
    const snap = new TopologySnapshot(response);
    expect(snap.players).toHaveLength(3);
  });
});
