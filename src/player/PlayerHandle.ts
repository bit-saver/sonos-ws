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
  private _speakerConnection: SonosConnection;

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

  constructor(
    player: Player,
    group: Group,
    householdId: string,
    speakerConnection: SonosConnection,
    groupsConnection: SonosConnection,
  ) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;
    this._speakerConnection = speakerConnection;

    // Speaker context — reads connection from mutable field so
    // setSpeakerConnection() immediately affects all namespaces.
    const self = this;
    const speakerContext: NamespaceContext = {
      get connection() { return self._speakerConnection; },
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    // Groups context — uses the primary connection (group commands
    // work from any speaker in the household).
    const groupsContext: NamespaceContext = {
      connection: groupsConnection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.volume = new VolumeControl(speakerContext);
    this.playback = new PlaybackControl(speakerContext);
    this.favorites = new FavoritesAccess(speakerContext);
    this.playlists = new PlaylistsAccess(speakerContext);
    this.audioClip = new AudioClipControl(speakerContext);
    this.homeTheater = new HomeTheaterControl(speakerContext);
    this.settings = new SettingsControl(speakerContext);
    this.groups = new GroupsNamespace(groupsContext);
  }

  /**
   * Updates the speaker connection for this handle.
   * Called by SonosHousehold after establishing per-speaker connections.
   * @internal
   */
  setSpeakerConnection(connection: SonosConnection): void {
    this._speakerConnection = connection;
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
