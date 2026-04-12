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
import { PlayerHandle } from '../player/PlayerHandle.js';
import { GroupingEngine } from './GroupingEngine.js';
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
  /** Connect to all speakers at startup. @defaultValue true */
  autoConnect?: boolean;
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
  private _lastTopologyKey = '';

  /** Per-speaker WebSocket connections. Key is player ID. */
  private readonly speakerConnections = new Map<string, SonosConnection>();
  private readonly primaryHost: string;
  private readonly reconnectOptions: ReconnectOptions;
  private readonly requestTimeoutMs: number;
  private readonly autoConnectSpeakers: boolean;

  /** Household-scoped GroupsNamespace for createGroup calls (no groupId/playerId). */
  private readonly householdGroups: GroupsNamespace;
  private readonly engine: GroupingEngine;

  constructor(options: SonosHouseholdOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.primaryHost = options.host;
    this.reconnectOptions = resolveReconnectOptions(options.reconnect);
    this.requestTimeoutMs = options.requestTimeout ?? 120000;
    this.autoConnectSpeakers = options.autoConnect ?? true;

    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });

    const householdContext: NamespaceContext = {
      connection: this.connection,
      getHouseholdId: () => this._householdId,
      getGroupId: () => undefined,
      getPlayerId: () => undefined,
    };
    this.householdGroups = new GroupsNamespace(householdContext);
    this.engine = new GroupingEngine(
      this.householdGroups,
      () => this.refreshTopology(),
      this._players,
      this.log,
    );
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
    if (this.autoConnectSpeakers) {
      await this.connectAllSpeakers();
    }
    this._initialConnectDone = true;
  }

  /** Gracefully closes all WebSocket connections. */
  async disconnect(): Promise<void> {
    // Close all per-speaker connections first
    for (const [, conn] of this.speakerConnections) {
      try { await conn.disconnect(); } catch { /* best effort */ }
    }
    this.speakerConnections.clear();
    // Close primary connection
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
        this._players.set(
          player.id,
          new PlayerHandle(player, group, householdId, this.connection, this.connection),
        );
      }
    }

    // Remove players that no longer exist
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }

    // Only emit topologyChanged if the topology actually differs from last time.
    // Multiple refreshTopology() calls during a single group operation would
    // otherwise flood listeners with duplicate events.
    const topologyKey = result.groups
      .map((g) => `${g.id}:${g.coordinatorId}:${g.playerIds.join(',')}:${g.playbackState ?? ''}`)
      .sort()
      .join('|');
    if (topologyKey !== this._lastTopologyKey) {
      this._lastTopologyKey = topologyKey;
      this.emit('topologyChanged', this._groups, this._rawPlayers);
    }
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
    await this.engine.group(players, options);
  }

  /**
   * Removes a player from its current group. No-op if already solo.
   *
   * @param player - The player to ungroup.
   */
  async ungroup(player: PlayerHandle): Promise<void> {
    await this.engine.ungroup(player);
  }

  /**
   * Ungroups all players in the household. Each becomes its own group.
   */
  async ungroupAll(): Promise<void> {
    await this.engine.ungroupAll();
  }

  /**
   * Opens connections to all discovered speakers in parallel.
   * The primary speaker reuses the existing connection.
   */
  private async connectAllSpeakers(): Promise<void> {
    const promises = this._rawPlayers.map(async (player) => {
      try {
        const conn = await this.connectToSpeaker(player);
        const handle = this._players.get(player.id);
        if (handle) {
          handle.setSpeakerConnection(conn);
          // Set coordinator resolver — dynamically looks up the coordinator's connection
          // so group volume commands route through the correct speaker.
          handle.setCoordinatorConnectionResolver(() => {
            const coordId = handle['_group']?.coordinatorId;
            if (coordId) {
              const coordConn = this.speakerConnections.get(coordId);
              if (coordConn) return coordConn;
            }
            // Fallback to primary connection
            return this.connection;
          });
        }
      } catch (err) {
        this.log.warn(`Failed to connect to ${player.name}:`, err);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Gets or creates a connection to a specific speaker.
   * Returns the primary connection if the speaker is the primary host.
   */
  private async connectToSpeaker(player: Player): Promise<SonosConnection> {
    // If this speaker is the primary host, reuse the primary connection
    if (player.websocketUrl) {
      try {
        const url = new URL(player.websocketUrl);
        if (url.hostname === this.primaryHost) {
          return this.connection;
        }
      } catch { /* fall through to create new connection */ }
    }

    // Return existing connection if already connected
    const existing = this.speakerConnections.get(player.id);
    if (existing && existing.state === 'connected') {
      return existing;
    }

    // Parse host from the player's WebSocket URL
    if (!player.websocketUrl) {
      this.log.warn(`No websocketUrl for player ${player.name} — using primary connection`);
      return this.connection;
    }

    const url = new URL(player.websocketUrl);
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });

    await conn.connect();
    this.speakerConnections.set(player.id, conn);
    this.log.info(`Connected to ${player.name} at ${url.hostname}`);
    return conn;
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
