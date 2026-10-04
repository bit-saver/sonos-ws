import type { GroupsResponse, GroupOptions, Group } from '../types/groups.js';
import type { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../player/PlayerHandle.js';
import type { Logger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { CommandError } from '../errors/CommandError.js';
import { ErrorCode } from '../types/errors.js';
import { TopologySnapshot } from './TopologySnapshot.js';

const POLL_INTERVAL_MS = 200;
const POLL_DEADLINE_MS = 8000;

/**
 * Manages Sonos speaker grouping operations with robust error handling.
 *
 * Uses {@link TopologySnapshot} for consistent state queries,
 * {@link pollUntil} instead of fixed-delay sleeps, and
 * {@link withRetry} for automatic recovery from stale-groupId errors.
 */
export class GroupingEngine {
  constructor(
    private readonly householdGroups: GroupsNamespace,
    private readonly refreshTopology: () => Promise<GroupsResponse>,
    private readonly players: ReadonlyMap<string, PlayerHandle>,
    private readonly log: Logger,
  ) {}

  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   */
  async group(playerHandles: PlayerHandle[], options?: GroupOptions): Promise<void> {
    if (playerHandles.length === 0) {
      throw new SonosError(ErrorCode.ERROR_INVALID_PARAMETER, 'group() requires at least one player');
    }

    let snap = await this.refreshAndSnapshot();

    // Single player
    if (playerHandles.length === 1) {
      const player = playerHandles[0]!;

      // With transfer: find audio elsewhere and move it to this player
      if (options?.transfer) {
        // For single-player transfer, look for audio on OTHER speakers.
        // Skip the target player itself — if it's already playing, that's
        // not what needs transferring. The intent is "bring me someone else's audio."
        const audioSource = this.resolveAudioSourceExcluding(player.id, options.transfer, snap);
        if (audioSource) {
          await this.transferAudio(audioSource, player, [player.id]);
          await this.refreshAndSnapshot();
          return;
        }
      }

      // Ensure player is solo
      if (snap.isAloneInGroup(player.id)) return;

      // If this player is the coordinator of its group, remove other members
      // instead of extracting the player. Extracting the coordinator via
      // createGroup causes the remaining members to inherit the audio source.
      const playerGroup = snap.findGroupOf(player.id);
      if (playerGroup && playerGroup.coordinatorId === player.id && playerGroup.playerIds.length > 1) {
        await this.ungroupMembers(playerGroup);
      } else {
        await this.householdGroups.createGroup([player.id]);
      }
      await this.refreshAndSnapshot();
      return;
    }

    const coordinator = playerHandles[0]!;
    const memberIds = playerHandles.map((p) => p.id);

    // Short-circuit: already in desired configuration
    if (this.isAlreadyGrouped(coordinator.id, memberIds, snap) && !options?.transfer) {
      return;
    }

    // Resolve audio source
    let audioSource: PlayerHandle | undefined;
    if (options?.transfer) {
      audioSource = this.resolveAudioSource(playerHandles, options.transfer, snap);
    }

    // Decide how to handle the audio source:
    // 1. Source IS the desired coordinator → simpleGroup (audio preserved naturally)
    // 2. Source is a target member but not coordinator → make source the coordinator
    //    (overrides user preference to preserve audio)
    // 3. Source is OUTSIDE the target group → transferAudio, but only for an explicit
    //    source; audio that auto-resolve finds outside the group stays where it is.
    if (audioSource && audioSource.id !== coordinator.id) {
      if (memberIds.includes(audioSource.id)) {
        // Audio source is a target member — make it the coordinator to preserve audio.
        this.log.info(`Audio source "${audioSource.name}" is in target group — using as coordinator to preserve audio`);
        await this.simpleGroup(audioSource, memberIds);
      } else if (typeof options?.transfer === 'object') {
        // Explicit transfer source outside the target group — move its audio to the coordinator.
        this.log.info(`Transferring audio from "${audioSource.name}" to "${coordinator.name}"`);
        await this.transferAudio(audioSource, coordinator, memberIds);
      } else {
        // Auto-resolve found audio outside the target group.
        // Don't transfer — just group the requested speakers. Audio stays where it is.
        this.log.info(`Audio on "${audioSource.name}" (not in target group) — grouping without transfer`);
        await this.simpleGroup(coordinator, memberIds);
      }
    } else {
      await this.simpleGroup(coordinator, memberIds);
    }

    await this.refreshAndSnapshot();
  }

  /** Removes a player from its current group. No-op if already solo. */
  async ungroup(player: PlayerHandle): Promise<void> {
    const snap = await this.refreshAndSnapshot();
    if (snap.isAloneInGroup(player.id)) return;
    await this.householdGroups.createGroup([player.id]);
    await this.refreshAndSnapshot();
  }

  /** Ungroups all players in the household. */
  async ungroupAll(): Promise<void> {
    const snap = await this.refreshAndSnapshot();
    const multiPlayerGroups = snap.groups.filter((g) => g.playerIds.length > 1);
    for (const group of multiPlayerGroups) {
      await this.ungroupMembers(group);
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshAndSnapshot();
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private isAlreadyGrouped(coordinatorId: string, memberIds: string[], snap: TopologySnapshot): boolean {
    const group = snap.findGroupOf(coordinatorId);
    return (
      group !== undefined
      && group.coordinatorId === coordinatorId
      && group.playerIds.length === memberIds.length
      && memberIds.every((id) => group.playerIds.includes(id))
    );
  }

  private resolveAudioSource(
    targetPlayers: PlayerHandle[],
    transfer: boolean | { readonly id: string },
    snap: TopologySnapshot,
  ): PlayerHandle | undefined {
    // Explicit source
    if (typeof transfer === 'object') {
      const source = this.players.get(transfer.id);
      if (!source) {
        throw new SonosError(ErrorCode.PLAYER_NOT_FOUND, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = snap.findGroupOf(source.id);
      if (
        !sourceGroup
        || (sourceGroup.playbackState !== 'PLAYBACK_STATE_PLAYING'
          && sourceGroup.playbackState !== 'PLAYBACK_STATE_PAUSED')
      ) {
        throw new SonosError(ErrorCode.ERROR_NO_CONTENT, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }

    // Auto-resolve by priority
    const targetIds = new Set(targetPlayers.map((p) => p.id));

    for (const phase of ['PLAYBACK_STATE_PLAYING', 'PLAYBACK_STATE_PAUSED'] as const) {
      // Check target players first (array order).
      // Audio belongs to the GROUP COORDINATOR, not any member.
      // If a target player is in a playing group, return the coordinator of that group.
      for (const player of targetPlayers) {
        const group = snap.findGroupOf(player.id);
        if (group?.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          return coord ?? player;
        }
      }
      // Then check rest of household
      for (const group of snap.groups) {
        if (group.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          if (coord && !targetIds.has(coord.id)) return coord;
        }
      }
    }

    return undefined;
  }

  /**
   * Like resolveAudioSource but skips a specific player.
   * Used for single-player transfer where the target player's own audio
   * is not what we want — we're looking for audio on OTHER speakers.
   */
  private resolveAudioSourceExcluding(
    excludePlayerId: string,
    transfer: boolean | { readonly id: string },
    snap: TopologySnapshot,
  ): PlayerHandle | undefined {
    // Explicit source — honor it regardless of exclude
    if (typeof transfer === 'object') {
      const source = this.players.get(transfer.id);
      if (!source) {
        throw new SonosError(ErrorCode.PLAYER_NOT_FOUND, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = snap.findGroupOf(source.id);
      if (
        !sourceGroup
        || (sourceGroup.playbackState !== 'PLAYBACK_STATE_PLAYING'
          && sourceGroup.playbackState !== 'PLAYBACK_STATE_PAUSED')
      ) {
        throw new SonosError(ErrorCode.ERROR_NO_CONTENT, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }

    // Auto-resolve — scan all groups, skipping the excluded player's group
    for (const phase of ['PLAYBACK_STATE_PLAYING', 'PLAYBACK_STATE_PAUSED'] as const) {
      for (const group of snap.groups) {
        if (group.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          if (coord && coord.id !== excludePlayerId) return coord;
        }
      }
    }

    return undefined;
  }

  private async simpleGroup(coordinator: PlayerHandle, memberIds: string[]): Promise<void> {
    let snap = await this.refreshAndSnapshot();
    const currentGroup = snap.findGroupOf(coordinator.id);
    if (!currentGroup) return;

    // Extract coordinator if it's not already the coordinator of its group
    if (currentGroup.coordinatorId !== coordinator.id) {
      await this.householdGroups.createGroup([coordinator.id]);
      await this.pollUntil(
        (res) => res.groups.some((g) => g.coordinatorId === coordinator.id && g.playerIds.length === 1),
      );
      snap = await this.refreshAndSnapshot();
    }

    // Add/remove members with retry (delta recomputed inside closure for fresh state)
    // Note: modifyGroupMembers handles cross-group moves atomically —
    // members are pulled directly from their current groups without
    // needing explicit extraction first.
    await this.withRetry(async () => {
      const retrySnap = await this.refreshAndSnapshot();
      const coordGroup = retrySnap.findGroupOf(coordinator.id);
      if (!coordGroup) return;

      const toAdd = memberIds.filter((id) => id !== coordinator.id && !coordGroup.playerIds.includes(id));
      const toRemove = coordGroup.playerIds.filter((id) => id !== coordinator.id && !memberIds.includes(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await coordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : undefined,
          toRemove.length > 0 ? toRemove : undefined,
        );
      }
    });
  }

  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    // Step 1: the target takes over the source group's audio. Sonos moves it: the source group is left paused,
    // its other members still grouped.
    let sourceMemberIds: string[] = [];
    await this.withRetry(async () => {
      const snap = await this.refreshAndSnapshot();
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup) {
        throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
      }
      sourceMemberIds = sourceGroup.playerIds;
      await this.householdGroups.createGroup([targetCoordinator.id], sourceGroup.id);
    });

    // Step 2: wait for the target to coordinate its new group
    const settled = await this.pollUntil(
      (res) => res.groups.some((g) => g.coordinatorId === targetCoordinator.id),
    );
    if (!settled) {
      this.log.warn(`Audio transfer did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 3: add the other requested members
    if (allMemberIds.length > 1) {
      await this.simpleGroup(targetCoordinator, allMemberIds);
    }

    // Step 4: split what is left of the source group, so its members end up solo
    const snap = await this.refreshAndSnapshot();
    const leftovers = new Map<string, Group>();
    for (const id of sourceMemberIds) {
      const group = snap.findGroupOf(id);
      if (group && group.playerIds.length > 1 && !allMemberIds.includes(id)) leftovers.set(group.id, group);
    }
    for (const group of leftovers.values()) {
      await this.ungroupMembers(group);
    }
  }

  /**
   * Polls getGroups until a condition is met or the deadline passes.
   * The return value is a readiness signal only — authoritative state
   * comes from the subsequent refreshAndSnapshot().
   */
  private async pollUntil(
    condition: (response: GroupsResponse) => boolean,
    deadlineMs: number = POLL_DEADLINE_MS,
    intervalMs: number = POLL_INTERVAL_MS,
  ): Promise<GroupsResponse | null> {
    const start = Date.now();
    while (true) {
      try {
        const response = await this.householdGroups.getGroups();
        if (condition(response)) return response;
      } catch {
        // Transient error (timeout, connection hiccup) — skip and retry
      }
      const elapsed = Date.now() - start;
      if (elapsed >= deadlineMs) return null;
      await new Promise((r) => setTimeout(r, Math.min(intervalMs, deadlineMs - elapsed)));
    }
  }

  /**
   * Wraps a function that can fail with a stale groupId.
   * On `groupCoordinatorChanged`, refreshes topology (updating handle
   * closures) and retries exactly once.
   */
  private async withRetry(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof CommandError && err.code === 'groupCoordinatorChanged') {
        this.log.debug('groupCoordinatorChanged — refreshing topology and retrying');
        await this.refreshAndSnapshot();
        await fn();
      } else {
        throw err;
      }
    }
  }

  /** Splits a group so every member is solo; the coordinator keeps the group and its audio. */
  private async ungroupMembers(group: Group): Promise<void> {
    for (const playerId of group.playerIds) {
      if (playerId !== group.coordinatorId) {
        await this.householdGroups.createGroup([playerId]);
      }
    }
  }

  private async refreshAndSnapshot(): Promise<TopologySnapshot> {
    const response = await this.refreshTopology();
    return new TopologySnapshot(response);
  }
}
