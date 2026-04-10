import { SonosConnection } from '../client/SonosConnection.js';
import type { ReconnectOptions } from '../client/SonosConnection.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosHouseholdEvents, GroupCoordinatorChangedEvent } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import type { Group, Player, GroupsResponse, GroupOptions } from '../types/groups.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ErrorCode } from '../types/errors.js';
import { TimeoutError } from '../errors/TimeoutError.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: Infinity,
};

/**
 * Configuration options for creating a {@link SonosHousehold} instance.
 */
export interface SonosHouseholdOptions {
  /** IP or hostname of any Sonos speaker in the household. */
  host: string;
  /** WebSocket port. @defaultValue 1443 */
  port?: number;
  /** Reconnection config. @defaultValue true */
  reconnect?: Partial<ReconnectOptions> | boolean;
  /** Custom logger. */
  logger?: Logger;
  /** Command timeout in ms. @defaultValue 5000 */
  requestTimeout?: number;
}

/**
 * Top-level API for controlling an entire Sonos household.
 *
 * Owns a single {@link SonosConnection} and exposes {@link PlayerHandle}
 * objects for targeting individual speakers. Automatically tracks group
 * topology changes and provides high-level grouping operations.
 *
 * @example
 * ```typescript
 * const household = new SonosHousehold({ host: '192.168.68.96' });
 * await household.connect();
 *
 * const arc = household.player('Arc');
 * await arc.volume.relative(5);
 *
 * const office = household.player('Office');
 * await household.group([arc, office], { transfer: true });
 * ```
 */
export class SonosHousehold extends TypedEventEmitter<SonosHouseholdEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private readonly _players = new Map<string, PlayerHandle>();
  private _groups: Group[] = [];
  private _rawPlayers: Player[] = [];
  private _householdId: string | undefined;
  private _initialConnectDone = false;

  /** Household-scoped GroupsNamespace for createGroup calls (no groupId/playerId). */
  private readonly householdGroups: GroupsNamespace;

  constructor(options: SonosHouseholdOptions) {
    super();
    this.log = options.logger ?? noopLogger;

    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 5000,
      logger: this.log,
    });

    const householdContext: NamespaceContext = {
      connection: this.connection,
      getHouseholdId: () => this._householdId,
      getGroupId: () => undefined,
      getPlayerId: () => undefined,
    };
    this.householdGroups = new GroupsNamespace(householdContext);
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
    return this._householdId;
  }

  /** Whether the WebSocket connection is currently open. */
  get connected(): boolean {
    return this.connection.state === 'connected';
  }

  /**
   * Connects to the Sonos speaker and discovers the household topology.
   * Populates {@link players} and {@link groups}.
   */
  async connect(): Promise<void> {
    this._initialConnectDone = false;

    this.connection.on('connected', () => this.handleReconnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));

    await this.connection.connect();
    await this.discoverHouseholdId();
    await this.refreshTopology();
    this._initialConnectDone = true;
  }

  /** Gracefully closes the WebSocket connection. */
  async disconnect(): Promise<void> {
    await this.connection.disconnect();
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
    const result = await this.householdGroups.getGroups();
    this._groups = result.groups;
    this._rawPlayers = result.players;

    const householdId = this._householdId ?? '';

    // Create or update player handles
    for (const player of result.players) {
      const group = result.groups.find((g) => g.playerIds.includes(player.id));
      if (!group) continue;

      const existing = this._players.get(player.id);
      if (existing) {
        existing.updateGroup(group);
      } else {
        this._players.set(player.id, new PlayerHandle(player, group, householdId, this.connection));
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

    // Refresh topology to get current playback states — cached data may be stale
    await this.refreshTopology();

    // Single player — just ensure they're solo
    if (players.length === 1) {
      const player = players[0]!;
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group && group.playerIds.length === 1) return; // already solo
      await this.householdGroups.createGroup([player.id]);
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

    await this.householdGroups.createGroup([player.id]);
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
          await this.householdGroups.createGroup([playerId]);
        }
      }
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshTopology();
    }
  }

  /**
   * Discovers the householdId by sending a raw getGroups request.
   */
  private async discoverHouseholdId(): Promise<void> {
    this.log.debug('Discovering householdId...');
    try {
      const [headers] = await this.connection.send([
        { namespace: 'groups:1', command: 'getGroups', cmdId: crypto.randomUUID() },
        {},
      ]);
      if (headers.householdId) this._householdId = headers.householdId;
    } catch (err: unknown) {
      // Command fails without householdId — extract it from the error response.
      // The response is attached as the error's cause.
      if (err instanceof Error && err.cause && Array.isArray(err.cause)) {
        const [headers] = err.cause as SonosResponse;
        if (headers?.householdId) this._householdId = headers.householdId;
      }
    }

    if (this._householdId) {
      this.log.debug(`Discovered householdId: ${this._householdId}`);
    } else {
      this.log.warn('Could not auto-discover householdId');
    }
  }

  /**
   * Routes incoming unsolicited messages to typed events.
   * Filters by `_objectType` to avoid double-firing and Volume: undefined.
   */
  private handleMessage(message: SonosResponse): void {
    this.emit('rawMessage', message);
    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;

    // Capture householdId from any message
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    // Coordinator changes — refresh topology, don't route as volume event
    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent);
      this.refreshTopology().catch((err) => this.log.warn('Failed to refresh topology', err));
      return;
    }

    // Skip events with empty body (subscribe confirmations)
    if (!objectType) return;

    // Route to typed event
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body);
    }
  }

  /**
   * Handles reconnection events. Only refreshes topology on reconnect,
   * not on initial connect (which is handled by connect() directly).
   */
  private async handleReconnected(): Promise<void> {
    if (this._initialConnectDone) {
      await this.refreshTopology().catch((err) =>
        this.log.warn('Failed to refresh topology on reconnect', err));
      // Resubscribe all player handle namespaces
      for (const handle of this._players.values()) {
        try { await handle.volume.subscribe(); } catch { /* best effort */ }
      }
    }
    this.emit('connected');
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
      await coordinator.groups.createGroup([coordinator.id]);
      await this.refreshTopology();
    }

    // Now add the other members to the coordinator's group
    const othersToAdd = memberIds.filter((id) => id !== coordinator.id);
    if (othersToAdd.length > 0) {
      // Compute add/remove delta
      const currentMembers = this._groups
        .find((g) => g.coordinatorId === coordinator.id)
        ?.playerIds.filter((id) => id !== coordinator.id) ?? [];
      const toRemove = currentMembers.filter((id) => !memberIds.includes(id));
      const toAdd = othersToAdd.filter((id) =>
        !this._groups.find((g) => g.coordinatorId === coordinator.id)?.playerIds.includes(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        // Use the coordinator's handle — it has the correct groupId and playerId
        await coordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : undefined,
          toRemove.length > 0 ? toRemove : undefined,
        );
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
    const sourceCoordinator = this._players.get(actualSourceId);
    if (!sourceCoordinator) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Could not find coordinator for source group`);
    }

    // Step 1: Add target coordinator to the source's group
    if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
      await sourceCoordinator.groups.modifyGroupMembers([targetCoordinator.id]);
    }

    // Step 2: Remove the source coordinator — this triggers the transfer.
    // The Sonos device responds with a groupCoordinatorChanged message
    // (success: false, type: groupCoordinatorChanged) or a timeout.
    // Both are expected — the coordinator is moving, not failing.
    try {
      await sourceCoordinator.groups.modifyGroupMembers([], [actualSourceId]);
    } catch {
      // Expected: CommandError (coordinator redirect) or TimeoutError
      this.log.debug('Coordinator shuffle complete (expected error during transfer)');
    }

    // Step 3: Wait for topology to settle, then refresh
    await new Promise((r) => setTimeout(r, 500));
    await this.refreshTopology();

    this.log.debug(`After shuffle: target ${targetCoordinator.name} groupId=${targetCoordinator.groupId}`);
    const targetGroup = this._groups.find((g) => g.coordinatorId === targetCoordinator.id);
    this.log.debug(`Target group: ${targetGroup?.id} members=${targetGroup?.playerIds?.length}`);

    // Step 4: Add remaining members to the target's new group
    const remaining = allMemberIds.filter((id) => id !== targetCoordinator.id);
    this.log.debug(`Remaining to add: ${remaining.length} ids`);
    if (remaining.length > 0) {
      const toAdd = remaining.filter((id) => !targetGroup?.playerIds.includes(id));
      this.log.debug(`toAdd after filter: ${toAdd.length} ids`);
      if (toAdd.length > 0) {
        await targetCoordinator.groups.modifyGroupMembers(toAdd);
      }
    }
  }
}

function resolveReconnectOptions(
  input: Partial<ReconnectOptions> | boolean | undefined,
): ReconnectOptions {
  if (input === false) {
    return { ...DEFAULT_RECONNECT, enabled: false };
  }
  if (input === true || input === undefined) {
    return { ...DEFAULT_RECONNECT };
  }
  return { ...DEFAULT_RECONNECT, ...input };
}
