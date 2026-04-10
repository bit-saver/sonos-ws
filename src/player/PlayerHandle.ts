import type { SonosConnection } from '../client/SonosConnection.js';
import type { Player, Group } from '../types/groups.js';
import type { PlayerCapability } from '../types/groups.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { VolumeControl } from './VolumeControl.js';
import { PlaybackControl } from './PlaybackControl.js';
import { FavoritesAccess } from './FavoritesAccess.js';
import { PlaylistsAccess } from './PlaylistsAccess.js';
import { AudioClipControl } from './AudioClipControl.js';
import { HomeTheaterControl } from './HomeTheaterControl.js';
import { SettingsControl } from './SettingsControl.js';

/**
 * A lightweight handle for controlling a single Sonos player.
 *
 * Routes all commands through a shared WebSocket connection using this
 * player's `groupId` and `playerId` in the request headers.
 *
 * Obtain instances via {@link SonosHousehold.player} or internally
 * from {@link SonosClient}.
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

  /** Unified volume control (group volume + per-speaker volume). */
  readonly volume: VolumeControl;
  /** Playback and metadata control. */
  readonly playback: PlaybackControl;
  /** Sonos favorites. */
  readonly favorites: FavoritesAccess;
  /** Sonos playlists. */
  readonly playlists: PlaylistsAccess;
  /** Audio clip playback. */
  readonly audioClip: AudioClipControl;
  /** Home theater settings. */
  readonly homeTheater: HomeTheaterControl;
  /** Player settings. */
  readonly settings: SettingsControl;
  /** Raw group operations (used internally by SonosHousehold for grouping). */
  readonly groups: GroupsNamespace;

  constructor(player: Player, group: Group, householdId: string, connection: SonosConnection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;

    const context: NamespaceContext = {
      connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.volume = new VolumeControl(context);
    this.playback = new PlaybackControl(context);
    this.favorites = new FavoritesAccess(context);
    this.playlists = new PlaylistsAccess(context);
    this.audioClip = new AudioClipControl(context);
    this.homeTheater = new HomeTheaterControl(context);
    this.settings = new SettingsControl(context);
    this.groups = new GroupsNamespace(context);
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
   * Called internally by SonosHousehold when topology changes.
   * @internal
   */
  updateGroup(group: Group): void {
    this._group = group;
  }
}
