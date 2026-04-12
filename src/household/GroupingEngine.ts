import type { GroupsResponse, GroupOptions, Group } from '../types/groups.js';
import type { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import type { PlayerHandle } from '../player/PlayerHandle.js';
import type { Logger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { CommandError } from '../errors/CommandError.js';
import { TimeoutError } from '../errors/TimeoutError.js';
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

      // With transfer: find audio and move it to this player
      if (options?.transfer) {
        const audioSource = this.resolveAudioSource(playerHandles, options.transfer, snap);
        if (audioSource && audioSource.id !== player.id) {
          // Audio is on another speaker — shuffle it to the target
          await this.transferAudio(audioSource, player, [player.id]);
          await this.refreshAndSnapshot();
          return;
        }
      }

      // No transfer or player already has audio — just ensure solo
      if (snap.isAloneInGroup(player.id)) return;
      await this.householdGroups.createGroup([player.id]);
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
    // 3. Source is OUTSIDE the target group → transferAudio (shuffle to pull it in)
    //    BUT: only if the source will end up in the final group. If the source
    //    is not in memberIds, the shuffle would remove it entirely — which doesn't
    //    reliably transfer audio (especially for the connected speaker). In that
    //    case, just do simpleGroup without transfer.
    if (audioSource && audioSource.id !== coordinator.id) {
      if (memberIds.includes(audioSource.id)) {
        // Audio source is a target member — make it the coordinator to preserve audio.
        this.log.info(`Audio source "${audioSource.name}" is in target group — using as coordinator to preserve audio`);
        await this.simpleGroup(audioSource, memberIds);
      } else if (typeof options?.transfer === 'object') {
        // Explicit transfer source outside the target group — shuffle to pull audio in.
        this.log.info(`Transferring audio from "${audioSource.name}" to "${coordinator.name}"`);
        await this.transferAudio(audioSource, coordinator, memberIds);
      } else {
        // Auto-resolve found audio outside the target group.
        // Don't shuffle — just group the requested speakers. Audio stays where it is.
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
      for (const playerId of group.playerIds) {
        if (playerId !== group.coordinatorId) {
          await this.householdGroups.createGroup([playerId]);
        }
      }
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
    await this.withRetry(async () => {
      const freshSnap = await this.refreshAndSnapshot();
      const coordGroup = freshSnap.findGroupOf(coordinator.id);
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
    // Step 1: Resolve the source group's actual coordinator
    let snap = await this.refreshAndSnapshot();
    const sourceGroup = snap.findGroupOf(source.id);
    if (!sourceGroup) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find group for source "${source.name}"`);
    }

    const sourceCoord = this.players.get(sourceGroup.coordinatorId);
    if (!sourceCoord) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Cannot find coordinator for source group`);
    }

    // Step 2: Add target to source's group
    if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
      await this.withRetry(async () => {
        await sourceCoord.groups.modifyGroupMembers([targetCoordinator.id]);
      });
    }

    // Step 3: Remove source coordinator (the shuffle) — always "fails"
    try {
      await sourceCoord.groups.modifyGroupMembers([], [sourceCoord.id]);
    } catch (err) {
      if (this.isExpectedShuffleError(err)) {
        this.log.debug('Coordinator shuffle initiated (expected error)');
      } else {
        throw err;
      }
    }

    // Step 4: Poll until target becomes coordinator
    const settled = await this.pollUntil(
      (res) => res.groups.some((g) => g.coordinatorId === targetCoordinator.id),
    );
    if (!settled) {
      this.log.warn(`Coordinator shuffle did not settle within ${POLL_DEADLINE_MS}ms`);
    }

    // Step 5: Refresh and add remaining members / remove bystanders
    await this.withRetry(async () => {
      const freshSnap = await this.refreshAndSnapshot();
      const targetGroup = freshSnap.findGroupOf(targetCoordinator.id);
      if (!targetGroup) return;

      const toAdd = allMemberIds.filter((id) => id !== targetCoordinator.id && !targetGroup.playerIds.includes(id));
      const toRemove = targetGroup.playerIds.filter((id) => id !== targetCoordinator.id && !allMemberIds.includes(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await targetCoordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : undefined,
          toRemove.length > 0 ? toRemove : undefined,
        );
      }
    });
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

  private isExpectedShuffleError(err: unknown): boolean {
    return (
      (err instanceof CommandError && err.code === 'groupCoordinatorChanged')
      || err instanceof TimeoutError
    );
  }

  private async refreshAndSnapshot(): Promise<TopologySnapshot> {
    const response = await this.refreshTopology();
    return new TopologySnapshot(response);
  }
}
