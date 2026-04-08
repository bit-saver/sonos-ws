import { BaseNamespace } from './BaseNamespace.js';
import type { GroupsResponse, CreateGroupResponse, ModifyGroupResponse } from '../types/groups.js';

export class GroupsNamespace extends BaseNamespace {
  readonly namespace = 'groups:1';

  async getGroups(): Promise<GroupsResponse> {
    const response = await this.send('getGroups');
    return this.body(response) as unknown as GroupsResponse;
  }

  async createGroup(playerIds: string[]): Promise<CreateGroupResponse> {
    const response = await this.send('createGroup', { playerIds });
    return this.body(response) as unknown as CreateGroupResponse;
  }

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

  async setGroupMembers(playerIds: string[]): Promise<void> {
    await this.send('setGroupMembers', { playerIds });
  }
}
