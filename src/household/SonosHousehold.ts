import { SonosConnection, resolveReconnectOptions } from '../client/SonosConnection.js';
import type { ReconnectOptions } from '../client/SonosConnection.js';
import { ConnectionSetup } from '../client/ConnectionSetup.js';
import { discoverHouseholdId } from '../client/discoverHouseholdId.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosHouseholdEvents, GroupCoordinatorChangedEvent } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import { sourceOf } from '../util/eventSource.js';
import type { Group, Player, GroupsResponse, GroupOptions } from '../types/groups.js';
import type { SonosResponse } from '../types/messages.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ConnectionError } from '../errors/ConnectionError.js';
import { ErrorCode } from '../types/errors.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import { GroupingEngine } from './GroupingEngine.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';

/**
 * A regroup emits several groups:1 events in quick succession, and a read
 * taken between them can catch players in no group at all. Waiting for the
 * burst to go quiet means the one read that follows sees the settled state.
 */
const TOPOLOGY_EVENT_DEBOUNCE_MS = 250;

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
  /** Command timeout in ms. @defaultValue 120000 */
  requestTimeout?: number;
  /**
   * Connect to all speakers at startup. @defaultValue true
   *
   * With `false` every command goes through the primary, so group-level commands for a group led by another speaker fail
   * with `groupCoordinatorChanged`.
   */
  autoConnect?: boolean;
}

/**
 * Top-level API for controlling an entire Sonos household.
 *
 * Owns a {@link SonosConnection} to the primary speaker and, unless `autoConnect` is false, one to each other speaker.
 * Exposes {@link PlayerHandle} objects for targeting individual speakers, tracks group topology changes, and provides
 * high-level grouping operations.
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
  /** Group IDs, coordinators and members, without playback state. */
  private _lastMembershipKey = '';
  /** Pending debounced topology re-read, armed by groups:1 events. */
  private topologyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly setup: ConnectionSetup;

  /** Handles whose diagnostics were declared; a re-run of first-connect setup skips them, so an unsubscribe() stays. */
  private readonly diagnosed = new WeakSet<PlayerHandle>();

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

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside; it
    // logs only when nothing else handles the error.
    this.on('error', (err) => {
      if (this.listenerCount('error') > 1) return;
      this.log.error(`Unhandled household error: ${err.message}`);
    });

    // Built once: building it in connect() would stack another 'connected' listener on every call.
    this.setup = new ConnectionSetup(this.connection, () => this.handleReconnected(), () => this.emit('connected'), this.log);
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));
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
   *
   * The contract, since Neurotto's own setup now runs off the `'connected'` event rather than this promise:
   * - Resolves once setup completes — {@link players} and {@link groups} are populated by then.
   * - If the first handshake fails, this call rejects while the reconnect ladder keeps trying in the background
   *   (while reconnect is enabled and not exhausted); a later success there runs setup and emits `'connected'`
   *   without anyone awaiting it.
   * - Can also reject with a `CONNECTION_LOST` "Disconnected during setup" error if the socket drops mid-setup
   *   without anyone calling {@link disconnect}; the ladder still recovers in the background and emits `'connected'`.
   * - A setup failure on an otherwise healthy socket (e.g. a failed topology read) rejects with no automatic retry.
   * - `'connected'` fires once per successful setup: on a first attempt that succeeds, it fires *before* this promise
   *   resolves, so attach `'connected'` listeners before calling `connect()`. It also fires after every reconnect.
   * - {@link disconnect} stops the ladder; no `'connected'` follows it, even if it lands mid-setup.
   */
  async connect(): Promise<void> {
    // A new socket gets first-connect setup; a live one may have a ladder run in flight, which this call just waits for.
    if (this.connection.state !== 'connected') this._initialConnectDone = false;
    await this.setup.connect();
  }

  /** Gracefully closes all WebSocket connections. */
  async disconnect(): Promise<void> {
    this.setup.noteDisconnect();
    // A topology read that lands from here on adopts nothing, so no socket opens after the map is cleared.
    this._initialConnectDone = false;
    if (this.topologyRefreshTimer) {
      clearTimeout(this.topologyRefreshTimer);
      this.topologyRefreshTimer = null;
    }
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
        const handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
        // Set at creation, so a handle made after setup (a new speaker) routes group commands correctly too.
        handle.setCoordinatorConnectionResolver(() => this.connectionForPlayer(handle.coordinatorId));
        this._players.set(player.id, handle);
        // Setup covers the handles it finds; one found later is adopted here.
        if (this._initialConnectDone) this.adopt(handle, player);
      }
    }

    // Remove players that no longer exist
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }

    // Membership, not playback state (which flips on every play/pause), decides whether subscriptions moved.
    // The first read has nothing to compare against; setup restores subscriptions itself.
    const membershipKey = result.groups
      .map((g) => `${g.id}:${g.coordinatorId}:${[...g.playerIds].sort().join(',')}`)
      .sort()
      .join('|');
    if (this._lastMembershipKey && membershipKey !== this._lastMembershipKey) {
      void this.resubscribeAll();
    }
    this._lastMembershipKey = membershipKey;

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
   * Re-reads topology once a burst of groups:1 events has gone quiet.
   * Each new event restarts the wait, so a regroup costs one read, taken
   * after it settles.
   */
  private scheduleTopologyRefresh(): void {
    if (this.topologyRefreshTimer) clearTimeout(this.topologyRefreshTimer);
    this.topologyRefreshTimer = setTimeout(() => {
      this.topologyRefreshTimer = null;
      this.refreshTopology().catch((err) => this.log.warn('Failed to refresh topology', err));
    }, TOPOLOGY_EVENT_DEBOUNCE_MS);
  }

  /**
   * Subscribes players to the events that say what an external controller did: group volume (a group set is
   * otherwise indistinguishable from a player set), playback, and home theater (a TV input switch).
   * Best effort and not awaited: a send to an offline speaker can wait out the whole request timeout, and diagnostics
   * must never stop or stall a household connecting. Each intent is recorded before its send, so an offline speaker's
   * are re-sent when its socket connects.
   * Declared once per handle; resubscribeAll() keeps them alive after.
   */
  private subscribeDiagnostics(handles: Iterable<PlayerHandle>): void {
    for (const handle of handles) {
      if (this.diagnosed.has(handle)) continue;
      this.diagnosed.add(handle);
      const subscriptions: [string, () => Promise<void>][] = [
        ['groupVolume', () => handle.volume.group.subscribe()],
        ['playback', () => handle.playback.subscribe()],
        ['homeTheater', () => handle.homeTheater.subscribe()],
      ];
      for (const [name, subscribe] of subscriptions) {
        void subscribe().catch(
          (err: unknown) => this.log.warn(`Failed to subscribe ${handle.name} to ${name} events`, err),
        );
      }
    }
  }

  /**
   * Re-sends every subscription the handles want. Runs wherever one may have died:
   * - the end of setup and of each primary reconnect
   * - a speaker's own socket reconnecting
   * - a membership change (a player that leaves a group gets a new group ID)
   * Re-sending a live subscription is harmless, so nothing tracks which ones died.
   */
  private async resubscribeAll(): Promise<void> {
    await Promise.all(
      [...this._players.values()].map((handle) =>
        handle.resubscribe().catch((err: unknown) =>
          this.log.warn(`Failed to restore event subscriptions for ${handle.name}`, err))),
    );
  }

  /**
   * Subscribes to household group changes, so topology follows every
   * regroup — including ones made from the Sonos app — instead of only
   * those this library performs. Best effort: a failure leaves the older
   * refresh triggers (reconnect, coordinator change, grouping calls) intact.
   */
  private async subscribeToTopology(): Promise<void> {
    try {
      await this.householdGroups.subscribe();
    } catch (err) {
      this.log.warn('Failed to subscribe to group changes', err);
    }
  }

  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   *
   * Grouping calls (this, {@link ungroup} and {@link ungroupAll}) run one at a time, and a call right after an audio
   * transfer first waits, up to 10 s, for Sonos to finish moving the group.
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
        }
      } catch (err) {
        this.log.warn(`Failed to connect to ${player.name}:`, err);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Gives a speaker discovered after setup what setup gives every speaker it finds: its own socket (with
   * `autoConnect`) and its diagnostics. Not awaited.
   */
  private adopt(handle: PlayerHandle, player: Player): void {
    if (this.autoConnectSpeakers) {
      void this.connectToSpeaker(player).catch(
        (err: unknown) => this.log.warn(`Failed to connect to ${player.name}:`, err),
      );
    }
    this.subscribeDiagnostics([handle]);
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

    if (!player.websocketUrl) {
      this.log.warn(`No websocketUrl for player ${player.name} — using primary connection`);
      return this.connection;
    }

    const url = new URL(player.websocketUrl);
    const conn = existing ?? this.createSpeakerConnection(player, url);

    // Store BEFORE awaiting connect so a failure still leaves the
    // reconnect loop running in the background. The connection's own
    // scheduleReconnect will keep trying until it succeeds or exhausts.
    this.speakerConnections.set(player.id, conn);
    // Before connecting: the socket's first 'connected' re-sends the handle's subscriptions, and they belong on it.
    this._players.get(player.id)?.setSpeakerConnection(conn);

    try {
      await conn.connect();
      this.log.info(`Connected to ${player.name} at ${url.hostname}`);
    } catch (err) {
      // CONNECTION_FAILED was already warned by the speaker's 'error' listener; a close before open emits no 'error'.
      const reported = err instanceof ConnectionError && err.code === ErrorCode.CONNECTION_FAILED;
      this.log[reported ? 'debug' : 'warn'](`Initial connect to ${player.name} failed; reconnect loop will retry`, err);
      // Do not rethrow — connection is in the map with reconnect scheduled.
    }

    return conn;
  }

  /**
   * Builds and wires a speaker's connection. Its events reach listeners like the primary's; its errors are only
   * logged, because the household's 'error' is about the primary.
   */
  private createSpeakerConnection(player: Player, url: URL): SonosConnection {
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });
    const who = `Speaker ${player.name} (${url.hostname})`;
    // One warn per outage, the rest at debug; reset when the socket connects.
    let failing = false;
    conn.on('message', (msg) => this.handleMessage(msg));
    // A reconnected socket holds no subscriptions.
    conn.on('connected', () => {
      failing = false;
      void this.resubscribeAll();
    });
    conn.on('error', (err) => {
      if (err instanceof ConnectionError && err.code === ErrorCode.CONNECTION_FAILED) {
        if (failing) {
          this.log.debug(`${who}: ${err.message}`);
          return;
        }
        failing = true;
      }
      this.log.warn(`${who}: ${err.message}`);
    });
    return conn;
  }

  /**
   * A player's own socket, else the primary. Right for the primary speaker, which has no entry of its own; under
   * `autoConnect: false` group commands for a group led elsewhere then fail, as documented on that option.
   */
  private connectionForPlayer(playerId: string): SonosConnection {
    return this.speakerConnections.get(playerId) ?? this.connection;
  }

  /**
   * Discovers the householdId by sending a raw getGroups request.
   */
  private async discoverHouseholdId(): Promise<void> {
    this.log.debug('Discovering householdId...');
    this._householdId = (await discoverHouseholdId(this.connection)) ?? this._householdId;

    if (this._householdId) {
      this.log.debug(`Discovered householdId: ${this._householdId}`);
    } else {
      this.log.warn('Could not auto-discover householdId');
    }
  }

  /**
   * Routes unsolicited messages from every socket to typed events, tagged with their source.
   * Filters by `_objectType` to avoid double-firing and Volume: undefined.
   */
  private handleMessage(message: SonosResponse): void {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit('rawMessage', message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;

    // Capture householdId from any message
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    // A regroup reports this on several sockets at once; one debounced read covers them.
    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent, source);
      this.scheduleTopologyRefresh();
      return;
    }

    // Skip events with empty body (subscribe confirmations)
    if (!objectType) return;

    // Any groups:1 event carrying an object triggers a re-read, whatever its
    // _objectType value (the empty-body check above already filtered out
    // subscribe confirmations, which have none).
    if (namespace === 'groups:1') this.scheduleTopologyRefresh();

    // Route to typed event
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body, source);
    }
  }

  /**
   * Reconnects any per-speaker connections that have dropped. Called as a safety net after the primary connection
   * reconnects; a speaker discovered meanwhile is adopted by refreshTopology().
   */
  private async reconnectSpeakers(): Promise<void> {
    const reconnectPromises: Promise<void>[] = [];

    for (const [playerId, conn] of this.speakerConnections) {
      if (conn.state === 'disconnected') {
        this.log.info(`Reconnecting speaker ${playerId}`);
        reconnectPromises.push(
          conn.connect().catch((err: unknown) =>
            this.log.debug(`Failed to reconnect speaker ${playerId}:`, err)),
        );
      }
    }

    await Promise.allSettled(reconnectPromises);
  }

  /**
   * Handles reconnection events. Runs full initial setup on the first
   * successful connect (whether that's the caller's first attempt or after
   * a background reconnect loop), and reconnect-specific work on every
   * subsequent reconnect. ConnectionSetup announces the result.
   */
  private async handleReconnected(): Promise<void> {
    if (!this._initialConnectDone) {
      // First successful connect — full initial setup. Runs either after
      // the caller's `await connect()` completes on first try OR after a
      // background reconnect loop (started by SonosConnection.onError)
      // eventually succeeds.
      try {
        await this.discoverHouseholdId();
        await this.refreshTopology();
        await this.subscribeToTopology();
        // subscribeToTopology() swallows its own errors (see its docstring),
        // including the ConnectionError a disconnect() mid-subscribe produces
        // via correlator.rejectAll. Without this check that swallow is
        // indistinguishable from "subscribe merely failed" and setup would
        // continue on to open per-speaker connections after teardown.
        if (this.connection.state !== 'connected') {
          throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Disconnected during setup');
        }
        if (this.autoConnectSpeakers) {
          await this.connectAllSpeakers();
        }
        // Restores intents on handles that outlived a disconnect(); fresh handles have none. Not awaited: a send to a
        // speaker whose socket is laddering would otherwise hold up this setup — that speaker's own 'connected'
        // listener re-sends its intents when its socket returns.
        void this.resubscribeAll();
        this.subscribeDiagnostics(this._players.values());
        this._initialConnectDone = true;
      } catch (err) {
        this.log.warn('Failed initial setup on connect', err);
        throw err;
      }
    } else {
      // Reconnect after prior success — reconnect-specific work.
      try {
        await this.refreshTopology().catch((err) =>
          this.log.warn('Failed to refresh topology on reconnect', err));
        await this.subscribeToTopology();

        // Same reasoning as the first-connect branch above: a disconnect that
        // lands while subscribeToTopology() is in flight must not let this
        // fall through into reconnecting per-speaker connections.
        if (this.connection.state !== 'connected') {
          throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Disconnected during setup');
        }

        await this.reconnectSpeakers();

        // The reconnected socket holds no subscriptions; re-send the wanted ones. Not awaited: a stuck send to a
        // laddering speaker must not hold up this reconnect run — its own 'connected' listener re-sends its intents
        // when its socket returns.
        void this.resubscribeAll();
      } catch (err) {
        this.log.warn('Failed reconnect setup', err);
        throw err;
      }
    }
  }

}
