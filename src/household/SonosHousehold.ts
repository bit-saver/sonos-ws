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
      this.refreshTopology().catch((err) => {
        this.log.warn('Failed to refresh topology on reconnect', err);
      });
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
    // Implemented in Task 5
    throw new Error('Not implemented');
  }

  /**
   * Removes a player from its current group. No-op if already solo.
   *
   * @param player - The player to ungroup.
   */
  async ungroup(player: PlayerHandle): Promise<void> {
    // Implemented in Task 5
    throw new Error('Not implemented');
  }

  /**
   * Ungroups all players in the household. Each becomes its own group.
   */
  async ungroupAll(): Promise<void> {
    // Implemented in Task 5
    throw new Error('Not implemented');
  }
}
