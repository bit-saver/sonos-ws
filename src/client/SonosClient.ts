import { SonosConnection } from './SonosConnection.js';
import type { ReconnectOptions, ConnectionOptions } from './SonosConnection.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosEvents } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import type { GroupCoordinatorChangedEvent } from '../types/events.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import type { GroupsResponse } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import type { VolumeControl } from '../player/VolumeControl.js';
import type { PlaybackControl } from '../player/PlaybackControl.js';
import type { FavoritesAccess } from '../player/FavoritesAccess.js';
import type { PlaylistsAccess } from '../player/PlaylistsAccess.js';
import type { AudioClipControl } from '../player/AudioClipControl.js';
import type { HomeTheaterControl } from '../player/HomeTheaterControl.js';
import type { SettingsControl } from '../player/SettingsControl.js';

export interface SonosClientOptions {
  host: string;
  port?: number;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true, initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: Infinity,
};

/**
 * Simple single-speaker API for controlling one Sonos player.
 *
 * For multi-speaker control and grouping, use {@link SonosHousehold} instead.
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
  private _handle: PlayerHandle | undefined;
  private _householdId: string | undefined;

  constructor(options: SonosClientOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 120000,
      logger: this.log,
    });
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

  async connect(): Promise<void> {
    this.connection.on('connected', () => this.handleConnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));

    await this.connection.connect();
    await this.discoverAndCreateHandle();
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  private async discoverAndCreateHandle(): Promise<void> {
    // Discover householdId
    const request: SonosRequest = [
      { namespace: 'groups:1', command: 'getGroups', cmdId: crypto.randomUUID() },
      {},
    ];

    try {
      const [headers, body] = await this.connection.send(request);
      if (headers.householdId) this._householdId = headers.householdId;

      const result = body as unknown as GroupsResponse;
      const group = result.groups?.[0];
      const player = result.players?.find((p) => p.id === group?.coordinatorId) ?? result.players?.[0];

      if (group && player) {
        this._handle = new PlayerHandle(player, group, this._householdId ?? '', this.connection);
      }
    } catch {
      this.log.warn('Could not discover player — provide host of a specific speaker');
    }
  }

  private async handleConnected(): Promise<void> {
    // On reconnect, re-discover group topology
    if (this._handle) {
      try {
        await this.discoverAndCreateHandle();
      } catch (err) {
        this.log.warn('Failed to re-discover on reconnect', err);
      }
    }
    this.emit('connected');
  }

  private handleMessage(message: SonosResponse): void {
    this.emit('rawMessage', message);
    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;

    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent);
      this.discoverAndCreateHandle().catch((err) =>
        this.log.warn('Failed to refresh after coordinator change', err));
      return;
    }

    if (!objectType) return;

    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body);
    }
  }
}

function resolveReconnectOptions(
  input: Partial<ReconnectOptions> | boolean | undefined,
): ReconnectOptions {
  if (input === false) return { ...DEFAULT_RECONNECT, enabled: false };
  if (input === true || input === undefined) return { ...DEFAULT_RECONNECT };
  return { ...DEFAULT_RECONNECT, ...input };
}
