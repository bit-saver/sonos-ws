import { SonosClient } from '../client/SonosClient.js';
import type { SonosClientOptions } from '../client/SonosClient.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosHouseholdEvents } from '../types/events.js';
import type { Group, Player, GroupsResponse, GroupOptions } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ErrorCode } from '../types/errors.js';
import { TimeoutError } from '../errors/TimeoutError.js';
import { PlayerHandle } from './PlayerHandle.js';

/**
 * Configuration options for creating a {@link SonosHousehold} instance.
 */
export interface SonosHouseholdOptions {
  /** IP or hostname of any Sonos speaker in the household. */
  host: string;
  /** WebSocket port. @defaultValue 1443 */
  port?: number;
  /** Reconnection config. @defaultValue true */
  reconnect?: SonosClientOptions['reconnect'];
  /** Custom logger. */
  logger?: Logger;
  /** Command timeout in ms. @defaultValue 5000 */
  requestTimeout?: number;
}

/**
 * Top-level API for controlling an entire Sonos household.
 *
 * Uses a single WebSocket connection (via {@link SonosClient}) and exposes
 * {@link PlayerHandle} objects for targeting individual speakers. Automatically
 * tracks group topology changes and provides high-level grouping operations.
 *
 * @example
 * ```typescript
 * const household = new SonosHousehold({ host: '192.168.68.96' });
 * await household.connect();
 *
 * const arc = household.player('Arc');
 * await arc.groupVolume.setRelativeVolume(5);
 *
 * const office = household.player('Office');
 * await household.group([arc, office], { transfer: true });
 * ```
 */
export class SonosHousehold extends TypedEventEmitter<SonosHouseholdEvents> {
  private readonly client: SonosClient;
  private readonly log: Logger;
  private readonly _players = new Map<string, PlayerHandle>();
  private _groups: Group[] = [];
  private _rawPlayers: Player[] = [];
  private _initialConnectDone = false;

  constructor(options: SonosHouseholdOptions) {
    super();
    this.log = options.logger ?? noopLogger;

    this.client = new SonosClient({
      host: options.host,
      port: options.port,
      reconnect: options.reconnect,
      logger: options.logger,
      requestTimeout: options.requestTimeout,
    });

    // Forward all client events
    this.client.on('connected', () => {
      // On reconnect (not initial connect), refresh topology automatically
      if (this._initialConnectDone) {
        this.refreshTopology().catch((err) => {
          this.log.warn('Failed to refresh topology on reconnect', err);
        });
      }
      this.emit('connected');
    });
    this.client.on('disconnected', (reason) => this.emit('disconnected', reason));
    this.client.on('reconnecting', (attempt, delay) => this.emit('reconnecting', attempt, delay));
    this.client.on('error', (err) => this.emit('error', err));
    this.client.on('rawMessage', (msg) => this.emit('rawMessage', msg));
    this.client.on('groupVolumeChanged', (data) => this.emit('groupVolumeChanged', data));
    this.client.on('playerVolumeChanged', (data) => this.emit('playerVolumeChanged', data));
    this.client.on('groupsChanged', (data) => this.emit('groupsChanged', data));
    this.client.on('playbackStatusChanged', (data) => this.emit('playbackStatusChanged', data));
    this.client.on('metadataStatusChanged', (data) => this.emit('metadataStatusChanged', data));
    this.client.on('favoritesChanged', (data) => this.emit('favoritesChanged', data));
    this.client.on('playlistsChanged', (data) => this.emit('playlistsChanged', data));
    this.client.on('homeTheaterChanged', (data) => this.emit('homeTheaterChanged', data));
    this.client.on('groupCoordinatorChanged', (data) => {
      this.emit('groupCoordinatorChanged', data);
      this.refreshTopology().catch((err) => {
        this.log.warn('Failed to refresh topology after coordinator change', err);
      });
    });
  }

  /** All discovered players in the household, keyed by RINCON player ID. */
  get players(): ReadonlyMap<string, PlayerHandle> {
    return this._players;
  }

  /** All current groups in the household. */
  get groups(): readonly Group[] {
    return this._groups;
  }

  /** The Sonos household ID. */
  get householdId(): string | undefined {
    return this.client.householdId;
  }

  /** Whether the WebSocket connection is currently open. */
  get connected(): boolean {
    return this.client.connected;
  }

  /**
   * Connects to the Sonos speaker and discovers the household topology.
   * Populates {@link players} and {@link groups}.
   */
  async connect(): Promise<void> {
    await this.client.connect();
    await this.refreshTopology();
    this._initialConnectDone = true;
  }

  /** Gracefully closes the WebSocket connection. */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Gets a player handle by display name (case-insensitive) or RINCON ID.
   *
   * @param nameOrId - Player display name (e.g. "Arc") or RINCON ID.
   * @returns The player handle.
   * @throws {SonosError} With code `PLAYER_NOT_FOUND` if not found.
   */
  player(nameOrId: string): PlayerHandle {
    // Try by ID first
    const byId = this._players.get(nameOrId);
    if (byId) return byId;

    // Try by name (case-insensitive)
    const lower = nameOrId.toLowerCase();
    for (const handle of this._players.values()) {
      if (handle.name.toLowerCase() === lower) return handle;
    }

    throw new SonosError(
      ErrorCode.PLAYER_NOT_FOUND,
      `Player not found: "${nameOrId}". Available: ${[...this._players.values()].map((p) => p.name).join(', ')}`,
    );
  }

  /**
   * Refreshes the household topology from the Sonos device.
   * Updates all player handles with their current group assignments.
   * @internal
   */
  async refreshTopology(): Promise<GroupsResponse> {
    const result = await this.client.groups.getGroups();
    this._groups = result.groups;
    this._rawPlayers = result.players;

    const connection = this.client.rawConnection;
    const householdId = this.client.householdId ?? '';

    // Create or update player handles
    for (const player of result.players) {
      const group = result.groups.find((g) => g.playerIds.includes(player.id));
      if (!group) continue;

      const existing = this._players.get(player.id);
      if (existing) {
        existing.updateGroup(group);
      } else {
        this._players.set(player.id, new PlayerHandle(player, group, householdId, connection));
      }
    }

    // Remove players that no longer exist
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }

    this.emit('topologyChanged', this._groups, this._rawPlayers);
    this.log.debug(`Topology refreshed: ${this._players.size} players, ${this._groups.length} groups`);

    return result;
  }

  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   *
   * @param players - Players to group. First player becomes coordinator.
   * @param options - Grouping options including audio transfer behavior.
   * @throws {SonosError} With code `INVALID_PARAMETER` if players array is empty.
   */
  async group(players: PlayerHandle[], options?: GroupOptions): Promise<void> {
    if (players.length === 0) {
      throw new SonosError(ErrorCode.ERROR_INVALID_PARAMETER, 'INVALID_PARAMETER: group() requires at least one player');
    }

    // Single player — just ensure they're solo
    if (players.length === 1) {
      const player = players[0]!;
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group && group.playerIds.length === 1) return; // already solo
      await this.client.groups.createGroup([player.id]);
      await this.refreshTopology();
      return;
    }

    const desiredCoordinator = players[0]!;
    const desiredMemberIds = players.map((p) => p.id);

    // Check if already in the desired configuration
    const currentGroup = this._groups.find((g) => g.playerIds.includes(desiredCoordinator.id));
    if (currentGroup
      && currentGroup.coordinatorId === desiredCoordinator.id
      && currentGroup.playerIds.length === desiredMemberIds.length
      && desiredMemberIds.every((id) => currentGroup.playerIds.includes(id))) {
      // Already grouped as desired — handle transfer option even in this case
      if (!options?.transfer) return;
    }

    // Resolve audio source if transfer is requested
    let audioSource: PlayerHandle | undefined;
    if (options?.transfer) {
      audioSource = this.resolveAudioSource(players, options.transfer);
    }

    // If we have an audio source and it needs to become coordinator via shuffle
    if (audioSource && audioSource.id !== desiredCoordinator.id) {
      await this.transferAudio(audioSource, desiredCoordinator, desiredMemberIds);
    } else {
      // Simple grouping: make desiredCoordinator the coordinator, add others
      await this.simpleGroup(desiredCoordinator, desiredMemberIds);
    }

    await this.refreshTopology();
  }

  /**
   * Removes a player from its current group. No-op if already solo.
   *
   * @param player - The player to ungroup.
   */
  async ungroup(player: PlayerHandle): Promise<void> {
    const group = this._groups.find((g) => g.playerIds.includes(player.id));
    if (!group || group.playerIds.length === 1) return; // already solo

    await this.client.groups.createGroup([player.id]);
    await this.refreshTopology();
  }

  /**
   * Ungroups all players in the household. Each becomes its own group.
   */
  async ungroupAll(): Promise<void> {
    const multiPlayerGroups = this._groups.filter((g) => g.playerIds.length > 1);
    for (const group of multiPlayerGroups) {
      // Pull out all non-coordinator members
      for (const playerId of group.playerIds) {
        if (playerId !== group.coordinatorId) {
          await this.client.groups.createGroup([playerId]);
        }
      }
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshTopology();
    }
  }

  /**
   * Resolves the audio source player based on the `transfer` option.
   * @returns The player with audio, or undefined if nothing is playing.
   */
  private resolveAudioSource(
    targetPlayers: PlayerHandle[],
    transfer: boolean | { readonly id: string },
  ): PlayerHandle | undefined {
    // Explicit player specified
    if (typeof transfer === 'object') {
      const source = this._players.get(transfer.id);
      if (!source) {
        throw new SonosError(ErrorCode.PLAYER_NOT_FOUND, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = this._groups.find((g) => g.playerIds.includes(source.id));
      if (!sourceGroup
        || (sourceGroup.playbackState !== 'PLAYBACK_STATE_PLAYING'
          && sourceGroup.playbackState !== 'PLAYBACK_STATE_PAUSED')) {
        throw new SonosError(ErrorCode.ERROR_NO_CONTENT, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }

    // Auto-resolve: check target players first (by array order)
    const targetIds = new Set(targetPlayers.map((p) => p.id));

    // Phase 1: PLAYING among target players
    for (const player of targetPlayers) {
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group?.playbackState === 'PLAYBACK_STATE_PLAYING') return player;
    }

    // Phase 2: PAUSED among target players
    for (const player of targetPlayers) {
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group?.playbackState === 'PLAYBACK_STATE_PAUSED') return player;
    }

    // Phase 3: PLAYING elsewhere in household
    for (const group of this._groups) {
      if (group.playbackState === 'PLAYBACK_STATE_PLAYING') {
        const coordinatorHandle = this._players.get(group.coordinatorId);
        if (coordinatorHandle && !targetIds.has(coordinatorHandle.id)) return coordinatorHandle;
      }
    }

    // Phase 4: PAUSED elsewhere in household
    for (const group of this._groups) {
      if (group.playbackState === 'PLAYBACK_STATE_PAUSED') {
        const coordinatorHandle = this._players.get(group.coordinatorId);
        if (coordinatorHandle && !targetIds.has(coordinatorHandle.id)) return coordinatorHandle;
      }
    }

    // Nothing playing anywhere
    return undefined;
  }

  /**
   * Performs a simple group operation: ensures the coordinator owns a group
   * with exactly the desired members.
   */
  private async simpleGroup(coordinator: PlayerHandle, memberIds: string[]): Promise<void> {
    const currentGroup = this._groups.find((g) => g.playerIds.includes(coordinator.id));
    if (!currentGroup) return;

    // If coordinator is not the coordinator of its current group, pull it out first
    if (currentGroup.coordinatorId !== coordinator.id) {
      await this.client.groups.createGroup([coordinator.id]);
      await this.refreshTopology();
    }

    // Now add the other members to the coordinator's group
    const othersToAdd = memberIds.filter((id) => id !== coordinator.id);
    if (othersToAdd.length > 0) {
      // Target the coordinator's group for the modifyGroupMembers call
      const coordGroup = this._groups.find((g) => g.coordinatorId === coordinator.id);
      if (coordGroup) {
        // Use raw connection to target the correct group
        const currentGroupId = this.client.groupId;
        this.client.groupId = coordGroup.id;
        try {
          // Remove members that shouldn't be in the group
          const currentMembers = coordGroup.playerIds.filter((id) => id !== coordinator.id);
          const toRemove = currentMembers.filter((id) => !memberIds.includes(id));
          const toAdd = othersToAdd.filter((id) => !coordGroup.playerIds.includes(id));

          if (toAdd.length > 0 || toRemove.length > 0) {
            await this.client.groups.modifyGroupMembers(
              toAdd.length > 0 ? toAdd : undefined,
              toRemove.length > 0 ? toRemove : undefined,
            );
          }
        } finally {
          this.client.groupId = currentGroupId;
        }
      }
    }
  }

  /**
   * Transfers audio from a source player to a target coordinator using
   * the coordinator shuffle technique.
   *
   * 1. Add target to source's group
   * 2. Remove source from group (expected ~8s timeout)
   * 3. Target inherits audio
   * 4. Add remaining members
   */
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    const sourceGroup = this._groups.find((g) => g.playerIds.includes(source.id));

    if (!sourceGroup) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Could not find group for source player "${source.name}"`);
    }

    // The shuffle must operate on the actual coordinator, not a non-coordinator member
    const actualSourceId = sourceGroup.coordinatorId;

    // Step 1: Add target coordinator to the source's group
    const savedGroupId = this.client.groupId;
    this.client.groupId = sourceGroup.id;
    try {
      if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
        await this.client.groups.modifyGroupMembers([targetCoordinator.id]);
      }

      // Step 2: Remove the source coordinator — this triggers the transfer
      // Expected to timeout (~8s) as the response comes as an event, not a command response
      try {
        await this.client.groups.modifyGroupMembers([], [actualSourceId]);
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
        // Timeout is expected during coordinator shuffle — continue
        this.log.debug('Expected timeout during coordinator transfer');
      }
    } finally {
      this.client.groupId = savedGroupId;
    }

    // Step 3: Refresh topology to find the new group
    await this.refreshTopology();

    // Step 4: Add remaining members to the target's new group
    const remaining = allMemberIds.filter((id) => id !== targetCoordinator.id && id !== actualSourceId);
    if (remaining.length > 0) {
      const targetGroup = this._groups.find((g) => g.coordinatorId === targetCoordinator.id);
      if (targetGroup) {
        const toAdd = remaining.filter((id) => !targetGroup.playerIds.includes(id));
        if (toAdd.length > 0) {
          this.client.groupId = targetGroup.id;
          try {
            await this.client.groups.modifyGroupMembers(toAdd);
          } finally {
            this.client.groupId = savedGroupId;
          }
        }
      }
    }
  }
}
