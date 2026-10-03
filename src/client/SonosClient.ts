import { randomUUID } from 'node:crypto';
import { SonosConnection, resolveReconnectOptions } from './SonosConnection.js';
import type { ReconnectOptions } from './SonosConnection.js';
import { ConnectionSetup } from './ConnectionSetup.js';
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
  private readonly setup: ConnectionSetup;

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
    // crash the host app. User-attached listeners still fire alongside; it
    // logs only when nothing else handles the error.
    this.on('error', (err) => {
      if (this.listenerCount('error') > 1) return;
      this.log.error(`Unhandled client error: ${err.message}`);
    });

    // Attached once: attaching in connect() stacked another copy on every call.
    this.setup = new ConnectionSetup(this.connection, () => this.setUp(), () => this.emit('connected'), this.log);
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
   *
   * Same `'connected'` contract as `SonosHousehold.connect()`: attach listeners before calling this, since on a
   * first attempt that succeeds `'connected'` fires before this promise resolves; `disconnect()` cancels the ladder
   * and no `'connected'` follows it. The reconnect ladder mentioned there only keeps trying while reconnect is
   * enabled and not exhausted; this call can also reject with a `CONNECTION_LOST` "Disconnected during setup" error
   * if the socket drops mid-setup without a `disconnect()` call (the ladder still recovers and emits `'connected'`),
   * and a setup failure on an otherwise healthy socket (e.g. a failed player lookup) rejects with no automatic retry.
   */
  async connect(): Promise<void> {
    await this.setup.connect();
  }

  async disconnect(): Promise<void> {
    this.setup.noteDisconnect();
    await this.connection.disconnect();
  }

  /** Finds this speaker. Logs and rethrows a failure; ConnectionSetup announces success. */
  private async setUp(): Promise<void> {
    try {
      await this.locatePlayer();
    } catch (err) {
      this.log.warn('Setup after connect failed', err);
      throw err;
    }
  }

  /**
   * Finds this speaker by host and builds its handle. On a reconnect, moves the existing handle to its current group and
   * restores its subscriptions, which died with the old socket.
   */
  private async locatePlayer(): Promise<void> {
    const householdId = this._householdId ?? (await discoverHouseholdId(this.connection));
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
      this.setup.runAfterSetup(() => this.locatePlayer()).catch((err: unknown) =>
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
