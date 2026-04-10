import type { SonosConnection } from '../client/SonosConnection.js';
import type { Player, Group } from '../types/groups.js';
import type { PlayerCapability } from '../types/groups.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
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

/**
 * A lightweight handle for controlling a single Sonos player within a household.
 *
 * `PlayerHandle` does not own a WebSocket connection — it routes all commands
 * through the shared {@link SonosHousehold} connection, using this player's
 * current `groupId` and `playerId` in the request headers.
 *
 * Obtain instances via {@link SonosHousehold.player}.
 */
export class PlayerHandle {
  /** RINCON player ID. */
  readonly id: string;
  /** Display name (e.g. "Arc", "Office"). */
  readonly name: string;
  /** Player capabilities from the Sonos API. */
  readonly capabilities: PlayerCapability[];

  private _group: Group;
  private readonly householdId: string;
  private readonly context: NamespaceContext;

  /** Group volume control — targets this player's group. */
  readonly groupVolume: GroupVolumeNamespace;
  /** Individual player volume control. */
  readonly playerVolume: PlayerVolumeNamespace;
  /** Group topology management. */
  readonly groups: GroupsNamespace;
  /** Playback control — targets this player's group. */
  readonly playback: PlaybackNamespace;
  /** Playback metadata — targets this player's group. */
  readonly playbackMetadata: PlaybackMetadataNamespace;
  /** Favorites access. */
  readonly favorites: FavoritesNamespace;
  /** Playlists access. */
  readonly playlists: PlaylistsNamespace;
  /** Audio clip playback. */
  readonly audioClip: AudioClipNamespace;
  /** Home theater settings (only meaningful for HT players like Arc). */
  readonly homeTheater: HomeTheaterNamespace;
  /** Player settings. */
  readonly settings: SettingsNamespace;

  constructor(player: Player, group: Group, householdId: string, connection: SonosConnection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;

    this.context = {
      connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.groupVolume = new GroupVolumeNamespace(this.context);
    this.playerVolume = new PlayerVolumeNamespace(this.context);
    this.groups = new GroupsNamespace(this.context);
    this.playback = new PlaybackNamespace(this.context);
    this.playbackMetadata = new PlaybackMetadataNamespace(this.context);
    this.favorites = new FavoritesNamespace(this.context);
    this.playlists = new PlaylistsNamespace(this.context);
    this.audioClip = new AudioClipNamespace(this.context);
    this.homeTheater = new HomeTheaterNamespace(this.context);
    this.settings = new SettingsNamespace(this.context);
  }

  /** Current group ID this player belongs to. Updated automatically on topology changes. */
  get groupId(): string {
    return this._group.id;
  }

  /** Whether this player is the coordinator of its current group. */
  get isCoordinator(): boolean {
    return this._group.coordinatorId === this.id;
  }

  /**
   * Updates the group this player belongs to.
   * Called internally by {@link SonosHousehold} when topology changes.
   * @internal
   */
  updateGroup(group: Group): void {
    this._group = group;
  }
}
