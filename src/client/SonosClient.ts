import { randomUUID } from 'node:crypto';
import { SonosConnection } from './SonosConnection.js';
import type { ReconnectOptions } from './SonosConnection.js';
import { discoverHouseholdId } from './discoverHouseholdId.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import { sourceOf } from '../util/eventSource.js';
import type { SonosEvents, GroupCoordinatorChangedEvent } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import type { SonosResponse } from '../types/messages.js';
import type { GroupsResponse } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ErrorCode } from '../types/errors.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import type { VolumeControl } from '../player/VolumeControl.js';
import type { PlaybackControl } from '../player/PlaybackControl.js';
import type { FavoritesAccess } from '../player/FavoritesAccess.js';
import type { PlaylistsAccess } from '../player/PlaylistsAccess.js';
import type { AudioClipControl } from '../player/AudioClipControl.js';
import type { HomeTheaterControl } from '../player/HomeTheaterControl.js';
import type { SettingsControl } from '../player/SettingsControl.js';

export interface SonosClientOptions {
  /** The speaker's IP address, as Sonos reports it. Host names are not matched. */
  host: string;
  port?: number;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true, initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: Infinity,
  pingInterval: 30000, pongTimeout: 10000,
};

/**
 * Simple single-speaker API for controlling one Sonos player.
 *
 * Everything goes through this speaker's socket, so while it is grouped under another speaker, group-level commands
 * (group volume, playback, loading a favorite or playlist) fail with `groupCoordinatorChanged`. Use
 * {@link SonosHousehold} for grouped speakers.
 *
 * @example
 * ```typescript
 * const client = new SonosClient({ host: '192.168.68.96' });
 * await client.connect();
 * await client.volume.set(50);
 * await client.disconnect();
 * ```
 */
export class SonosClient extends TypedEventEmitter<SonosEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private readonly host: string;
  private _handle: PlayerHandle | undefined;
  private _householdId: string | undefined;
  /** Setup runs, chained so each starts after the previous one settles. */
  private setupChain: Promise<void> = Promise.resolve();
  /** Handshakes a connect() call is awaiting: their setup is that call's to run, not the 'connected' listener's. */
  private ownedHandshakes = 0;

  constructor(options: SonosClientOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.host = options.host;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 120000,
      logger: this.log,
    });

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside.
    this.on('error', (err) => {
      this.log.error(`Unhandled client error: ${err.message}`);
    });

    // Attached once: attaching in connect() stacked another copy on every call.
    this.connection.on('connected', () => this.onConnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));
  }

  get connected(): boolean { return this.connection.state === 'connected'; }
  get connectionState() { return this.connection.state; }
  get householdId(): string | undefined { return this._householdId; }

  get volume(): VolumeControl { return this.handle.volume; }
  get playback(): PlaybackControl { return this.handle.playback; }
  get favorites(): FavoritesAccess { return this.handle.favorites; }
  get playlists(): PlaylistsAccess { return this.handle.playlists; }
  get audioClip(): AudioClipControl { return this.handle.audioClip; }
  get homeTheater(): HomeTheaterControl { return this.handle.homeTheater; }
  get settings(): SettingsControl { return this.handle.settings; }

  private get handle(): PlayerHandle {
    if (!this._handle) throw new Error('Not connected — call connect() first');
    return this._handle;
  }

  /**
   * Connects and finds this speaker in its household. Resolves once the
   * player controls are usable; rejects if the connection or the lookup fails.
   */
  async connect(): Promise<void> {
    this.ownedHandshakes++;
    try {
      await this.connection.connect();
    } finally {
      this.ownedHandshakes--;
    }
    await this.enqueue(() => this.setUp());
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  /** Runs work after any setup in flight. A failure rejects this call, never the chain. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.setupChain.then(task);
    this.setupChain = run.catch(() => {});
    return run;
  }

  /** Sets up after a handshake no connect() call awaits: the reconnect ladder's. Returns the run so tests can await it. */
  private onConnected(): Promise<void> {
    if (this.ownedHandshakes > 0) return Promise.resolve();
    // setUp() logs its own failure, and a background run has no caller to tell.
    return this.enqueue(() => this.setUp()).catch(() => {});
  }

  /** Finds this speaker, then emits `connected`. Logs and rethrows a failure. */
  private async setUp(): Promise<void> {
    try {
      await this.locatePlayer();
    } catch (err) {
      this.log.warn('Setup after connect failed', err);
      throw err;
    }
    this.emit('connected');
  }

  /**
   * Finds this speaker by host and builds its handle. On a reconnect, moves the existing handle to its current group and
   * restores its subscriptions, which died with the old socket.
   */
  private async locatePlayer(): Promise<void> {
    const householdId = await discoverHouseholdId(this.connection);
    if (!householdId) {
      throw new SonosError(ErrorCode.CONNECTION_FAILED, `Could not read the household ID from ${this.host}`);
    }
    this._householdId = householdId;

    const [, body] = await this.connection.send([
      { namespace: 'groups:1', command: 'getGroups', cmdId: randomUUID(), householdId },
      {},
    ]);
    const { groups = [], players = [] } = body as unknown as Partial<GroupsResponse>;
    const player = players.find((p) => hostOf(p.websocketUrl) === this.host);
    const group = player && groups.find((g) => g.playerIds.includes(player.id));
    if (!player || !group) {
      const known = players.map((p) => `${p.name} at ${hostOf(p.websocketUrl) ?? 'no address'}`).join(', ');
      throw new SonosError(
        ErrorCode.PLAYER_NOT_FOUND,
        `No player at ${this.host}. Sonos reports: ${known}. Use the speaker's IP address; host names are not matched.`,
      );
    }

    if (this._handle?.id === player.id) {
      this._handle.updateGroup(group);
      await this._handle.resubscribe().catch((err: unknown) =>
        this.log.warn('Failed to restore event subscriptions', err));
    } else {
      this._handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
    }
  }

  private handleMessage(message: SonosResponse): void {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit('rawMessage', message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;

    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent, source);
      this.enqueue(() => this.locatePlayer()).catch((err: unknown) =>
        this.log.warn('Failed to refresh after coordinator change', err));
      return;
    }

    if (!objectType) return;

    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body, source);
    }
  }
}

/** The hostname in a player's websocketUrl, or undefined if it has none. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function resolveReconnectOptions(
  input: Partial<ReconnectOptions> | boolean | undefined,
): ReconnectOptions {
  if (input === false) return { ...DEFAULT_RECONNECT, enabled: false };
  if (input === true || input === undefined) return { ...DEFAULT_RECONNECT };
  return { ...DEFAULT_RECONNECT, ...input };
}
