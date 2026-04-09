import { BaseNamespace } from './BaseNamespace.js';
import type { GroupsResponse, CreateGroupResponse, ModifyGroupResponse } from '../types/groups.js';

/**
 * Manages Sonos player groups (grouping and ungrouping speakers).
 *
 * Maps to the Sonos WebSocket Control API `groups:1` namespace.
 */
export class GroupsNamespace extends BaseNamespace {
  readonly namespace = 'groups:1';

  /**
   * Gets all groups and players in the household.
   *
   * @returns The complete list of groups, their member players, and all known players.
   */
  async getGroups(): Promise<GroupsResponse> {
    const response = await this.send('getGroups');
    return this.body(response) as unknown as GroupsResponse;
  }

  /**
   * Creates a new group from the specified player IDs.
   *
   * @param playerIds - The IDs of the players to include in the new group.
   * @returns The newly created group's details.
   */
  async createGroup(playerIds: string[]): Promise<CreateGroupResponse> {
    const response = await this.send('createGroup', { playerIds });
    return this.body(response) as unknown as CreateGroupResponse;
  }

  /**
   * Adds or removes players from the current group.
   *
   * @param playerIdsToAdd - Player IDs to add to the group.
   * @param playerIdsToRemove - Player IDs to remove from the group.
   * @returns The modified group's details.
   */
  async modifyGroupMembers(
    playerIdsToAdd?: string[],
    playerIdsToRemove?: string[],
  ): Promise<ModifyGroupResponse> {
    const body: Record<string, unknown> = {};
    if (playerIdsToAdd) body.playerIdsToAdd = playerIdsToAdd;
    if (playerIdsToRemove) body.playerIdsToRemove = playerIdsToRemove;
    const response = await this.send('modifyGroupMembers', body);
    return this.body(response) as unknown as ModifyGroupResponse;
  }

  /**
   * Replaces all members of the current group with the specified players.
   *
   * @param playerIds - The player IDs that should form the new membership of the group.
   */
  async setGroupMembers(playerIds: string[]): Promise<void> {
    await this.send('setGroupMembers', { playerIds });
  }
}
