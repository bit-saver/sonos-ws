import type { Group, Player, GroupsResponse } from '../types/groups.js';

/**
 * A read-only, point-in-time view of the household topology.
 *
 * Used by {@link GroupingEngine} to make decisions against a consistent
 * snapshot rather than live state that can mutate between await points.
 * This is a pure value object — no async, no I/O.
 */
export class TopologySnapshot {
  readonly groups: readonly Group[];
  readonly players: readonly Player[];

  constructor(response: GroupsResponse) {
    this.groups = response.groups;
    this.players = response.players;
  }

  /** Finds the group containing a player. */
  findGroupOf(playerId: string): Group | undefined {
    return this.groups.find((g) => g.playerIds.includes(playerId));
  }

  /** Returns the coordinator ID for a player's group. */
  coordinatorOf(playerId: string): string | undefined {
    return this.findGroupOf(playerId)?.coordinatorId;
  }

  /** Whether a player is the only member of its group. */
  isAloneInGroup(playerId: string): boolean {
    const group = this.findGroupOf(playerId);
    return group !== undefined && group.playerIds.length === 1;
  }
}
