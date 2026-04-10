import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosConnection } from './SonosConnection.js';
import type { ReconnectOptions } from './SonosConnection.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import type { SonosEvents } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { PlaybackNamespace } from '../namespaces/PlaybackNamespace.js';
import { PlaybackMetadataNamespace } from '../namespaces/PlaybackMetadataNamespace.js';
import { FavoritesNamespace } from '../namespaces/FavoritesNamespace.js';
import { PlaylistsNamespace } from '../namespaces/PlaylistsNamespace.js';
import { AudioClipNamespace } from '../namespaces/AudioClipNamespace.js';
import { HomeTheaterNamespace } from '../namespaces/HomeTheaterNamespace.js';
import { SettingsNamespace } from '../namespaces/SettingsNamespace.js';
import type { BaseNamespace } from '../namespaces/BaseNamespace.js';

/**
 * Configuration options for creating a {@link SonosClient} instance.
 */
export interface SonosClientOptions {
  /** IP address or hostname of the Sonos speaker to connect to. */
  host: string;
  /** WebSocket port on the Sonos device. @defaultValue 1443 */
  port?: number;
  /** Sonos household ID. Auto-discovered from the device if omitted. */
  householdId?: string;
  /** Target group ID. Auto-discovered from group topology if omitted. */
  groupId?: string;
  /** Target player ID. Auto-discovered from group topology if omitted. */
  playerId?: string;
  /**
   * Reconnection configuration. Pass `true` to enable with default settings,
   * `false` to disable, or a partial {@link ReconnectOptions} object to
   * override specific defaults.
   */
  reconnect?: Partial<ReconnectOptions> | boolean;
  /** Custom logger implementation. Falls back to a silent no-op logger if omitted. */
  logger?: Logger;
  /** Timeout in milliseconds for commands sent to the speaker. @defaultValue 5000 */
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: Infinity,
};

/**
 * Main entry point for the sonos-ws library.
 *
 * `SonosClient` manages the WebSocket connection to a Sonos speaker and
 * exposes namespace accessors for controlling volume, playback, groups,
 * favorites, and more.
 *
 * @example
 * ```typescript
 * const client = new SonosClient({ host: '192.168.68.96' });
 * await client.connect();
 * await client.groupVolume.setRelativeVolume(5);
 * await client.disconnect();
 * ```
 */
export class SonosClient extends TypedEventEmitter<SonosEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private readonly allNamespaces: BaseNamespace[];

  /** Sonos household ID. Populated during {@link connect} if not provided in options. */
  householdId: string | undefined;
  /** Target group ID. Populated during {@link connect} if not provided in options. */
  groupId: string | undefined;
  /** Target player ID. Populated during {@link connect} if not provided in options. */
  playerId: string | undefined;
  /** Coordinator player ID for the active group. Populated during {@link refreshGroups}. */
  coordinatorId: string | undefined;

  /** Provides access to the group volume namespace (get/set volume for the entire group). */
  readonly groupVolume: GroupVolumeNamespace;
  /** Provides access to the player volume namespace (get/set volume for an individual player). */
  readonly playerVolume: PlayerVolumeNamespace;
  /** Provides access to the groups namespace (group topology and management). */
  readonly groups: GroupsNamespace;
  /** Provides access to the playback namespace (play, pause, skip, seek, etc.). */
  readonly playback: PlaybackNamespace;
  /** Provides access to the playback metadata namespace (current track info). */
  readonly playbackMetadata: PlaybackMetadataNamespace;
  /** Provides access to the favorites namespace (list and load Sonos favorites). */
  readonly favorites: FavoritesNamespace;
  /** Provides access to the playlists namespace (list and load Sonos playlists). */
  readonly playlists: PlaylistsNamespace;
  /** Provides access to the audio clip namespace (play notification sounds). */
  readonly audioClip: AudioClipNamespace;
  /** Provides access to the home theater namespace (night mode, dialog enhancement, etc.). */
  readonly homeTheater: HomeTheaterNamespace;
  /** Provides access to the settings namespace (player settings and properties). */
  readonly settings: SettingsNamespace;

  constructor(options: SonosClientOptions) {
    super();
    this.log = options.logger ?? noopLogger;

    const reconnectOpts = resolveReconnectOptions(options.reconnect);

    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: reconnectOpts,
      requestTimeout: options.requestTimeout ?? 5000,
      logger: this.log,
    });

    this.householdId = options.householdId;
    this.groupId = options.groupId;
    this.playerId = options.playerId;

    const context = {
      connection: this.connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this.groupId,
      getPlayerId: () => this.playerId,
    };

    this.groupVolume = new GroupVolumeNamespace(context);
    this.playerVolume = new PlayerVolumeNamespace(context);
    this.groups = new GroupsNamespace(context);
    this.playback = new PlaybackNamespace(context);
    this.playbackMetadata = new PlaybackMetadataNamespace(context);
    this.favorites = new FavoritesNamespace(context);
    this.playlists = new PlaylistsNamespace(context);
    this.audioClip = new AudioClipNamespace(context);
    this.homeTheater = new HomeTheaterNamespace(context);
    this.settings = new SettingsNamespace(context);

    this.allNamespaces = [
      this.groupVolume,
      this.playerVolume,
      this.groups,
      this.playback,
      this.playbackMetadata,
      this.favorites,
      this.playlists,
      this.audioClip,
      this.homeTheater,
      this.settings,
    ];

    this.connection.on('connected', () => this.handleConnected());
    this.connection.on('disconnected', (reason) => this.emit('disconnected', reason));
    this.connection.on('reconnecting', (attempt, delay) => this.emit('reconnecting', attempt, delay));
    this.connection.on('error', (err) => this.emit('error', err));
    this.connection.on('message', (msg) => this.handleEvent(msg));
  }

  /** Whether the WebSocket connection is currently open and ready. */
  get connected(): boolean {
    return this.connection.state === 'connected';
  }

  /** Current connection state (`disconnected`, `connecting`, `connected`, or `reconnecting`). */
  get connectionState() {
    return this.connection.state;
  }

  /**
   * Connects to the Sonos speaker over WebSocket.
   *
   * If `householdId`, `groupId`, or `playerId` were not provided in the
   * constructor options, they are automatically discovered from the device
   * during this call.
   */
  async connect(): Promise<void> {
    await this.connection.connect();

    if (!this.householdId) {
      await this.discoverHouseholdId();
    }

    if (!this.groupId || !this.playerId) {
      await this.refreshGroups();
    }
  }

  private async discoverHouseholdId(): Promise<void> {
    this.log.debug('Discovering householdId...');

    // Use the raw connection to send a command. Even if it fails (missing
    // householdId), the response headers always include the householdId.
    const request: SonosRequest = [
      {
        namespace: 'groups:1',
        command: 'getGroups',
        cmdId: crypto.randomUUID(),
      },
      {},
    ];

    try {
      const [headers] = await this.connection.send(request);
      if (headers.householdId) {
        this.householdId = headers.householdId;
      }
    } catch {
      // Expected — the command fails without householdId.
      // householdId may have been captured from the handleEvent path.
    }

    if (this.householdId) {
      this.log.debug(`Discovered householdId: ${this.householdId}`);
    } else {
      this.log.warn('Could not discover householdId — provide it in SonosClientOptions');
    }
  }

  /** Gracefully closes the WebSocket connection to the Sonos speaker. */
  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  /**
   * Re-fetches the group topology from the speaker and updates
   * {@link groupId}, {@link playerId}, and {@link coordinatorId}.
   *
   * Finds the group containing the connected player (by {@link playerId}).
   * If no player ID is known yet, falls back to the first group.
   *
   * @returns The groups response from the device.
   */
  async refreshGroups() {
    const result = await this.groups.getGroups();
    this.log.debug('Refreshing group topology');

    // Find the group containing our player, or fall back to the first group
    const targetGroup = this.playerId
      ? result.groups.find((g) => g.playerIds.includes(this.playerId!))
      : undefined;
    const group = targetGroup ?? result.groups[0];

    if (group) {
      const oldGroupId = this.groupId;
      this.groupId = group.id;
      this.coordinatorId = group.coordinatorId;
      if (!this.playerId) this.playerId = group.coordinatorId;

      if (!this.householdId) {
        const responseHouseholdId = (result as unknown as Record<string, unknown>).householdId as string | undefined;
        if (responseHouseholdId) {
          this.householdId = responseHouseholdId;
        }
      }

      if (oldGroupId && oldGroupId !== this.groupId) {
        this.log.info(`Group changed: ${oldGroupId} → ${this.groupId}`);
      }

      this.log.debug(
        `Topology: household=${this.householdId ?? 'unknown'} group=${this.groupId} coordinator=${this.coordinatorId} player=${this.playerId}`,
      );
    }

    return result;
  }

  private async handleConnected(): Promise<void> {
    this.emit('connected');

    for (const ns of this.allNamespaces) {
      try {
        await ns.resubscribe();
      } catch (err) {
        this.log.warn(`Failed to resubscribe to ${ns.namespace}`, err);
      }
    }
  }

  private handleEvent(message: SonosResponse): void {
    this.emit('rawMessage', message);

    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;

    // Capture householdId from any response if we don't have it yet
    if (!this.householdId && headers.householdId) {
      this.householdId = headers.householdId;
      this.log.debug(`Discovered householdId: ${this.householdId}`);
    }

    // Handle group coordinator changes — refresh topology automatically
    const objectType = body?._objectType as string | undefined;
    if (objectType === 'groupCoordinatorChanged') {
      this.log.info(`Group coordinator changed: ${body?.groupStatus} — refreshing topology`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.emit as any)('groupCoordinatorChanged', body);
      this.refreshGroups().catch((err) => {
        this.log.warn('Failed to refresh groups after coordinator change', err);
      });
      return;
    }

    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.emit as any)(eventName, body);
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
