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

export interface SonosClientOptions {
  host: string;
  port?: number;
  householdId?: string;
  groupId?: string;
  playerId?: string;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: Infinity,
};

export class SonosClient extends TypedEventEmitter<SonosEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private readonly allNamespaces: BaseNamespace[];

  householdId: string | undefined;
  groupId: string | undefined;
  playerId: string | undefined;
  coordinatorId: string | undefined;

  readonly groupVolume: GroupVolumeNamespace;
  readonly playerVolume: PlayerVolumeNamespace;
  readonly groups: GroupsNamespace;
  readonly playback: PlaybackNamespace;
  readonly playbackMetadata: PlaybackMetadataNamespace;
  readonly favorites: FavoritesNamespace;
  readonly playlists: PlaylistsNamespace;
  readonly audioClip: AudioClipNamespace;
  readonly homeTheater: HomeTheaterNamespace;
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

  get connected(): boolean {
    return this.connection.state === 'connected';
  }

  get connectionState() {
    return this.connection.state;
  }

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

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  async refreshGroups() {
    const result = await this.groups.getGroups();
    this.log.debug('Refreshing group topology');

    const firstGroup = result.groups[0];
    if (firstGroup) {
      if (!this.groupId) this.groupId = firstGroup.id;
      if (!this.coordinatorId) this.coordinatorId = firstGroup.coordinatorId;
      if (!this.playerId) this.playerId = firstGroup.coordinatorId;

      // Derive householdId from the group ID (format: "RINCON_xxx:nnn")
      // or from the response if available
      if (!this.householdId) {
        const responseHouseholdId = (result as unknown as Record<string, unknown>).householdId as string | undefined;
        if (responseHouseholdId) {
          this.householdId = responseHouseholdId;
        }
      }

      this.log.debug(
        `Topology: household=${this.householdId ?? 'unknown'} group=${this.groupId} player=${this.playerId}`,
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
