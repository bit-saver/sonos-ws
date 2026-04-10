/**
 * Capabilities a Sonos player can have.
 *
 * - `PLAYBACK` -- standard audio playback
 * - `CLOUD` -- cloud service connectivity
 * - `HT_PLAYBACK` -- home theater playback (e.g. Sonos Arc, Beam)
 * - `HT_POWER_STATE` -- home theater power state control
 * - `AIRPLAY` -- Apple AirPlay support
 * - `LINE_IN` -- analog or HDMI line-in input
 * - `AUDIO_CLIP` -- audio clip overlay playback
 * - `VOICE` -- voice assistant support
 * - `SPEAKER_DETECTION` -- surround speaker detection
 * - `FIXED_VOLUME` -- fixed volume mode support
 */
export type PlayerCapability =
  | 'PLAYBACK'
  | 'CLOUD'
  | 'HT_PLAYBACK'
  | 'HT_POWER_STATE'
  | 'AIRPLAY'
  | 'LINE_IN'
  | 'AUDIO_CLIP'
  | 'VOICE'
  | 'SPEAKER_DETECTION'
  | 'FIXED_VOLUME';

/** A Sonos player (speaker) on the local network. */
export interface Player {
  /** Unique player identifier. */
  id: string;
  /** Human-readable player name (e.g. "Living Room"). */
  name: string;
  /** WebSocket URL for direct communication with this player (wss://host:1443/...). */
  websocketUrl?: string;
  /** Current software version running on the player. */
  softwareVersion?: string;
  /** Sonos WebSocket API version supported by this player. */
  apiVersion?: string;
  /** Minimum API version supported by this player. */
  minApiVersion?: string;
  /** List of capabilities this player supports. */
  capabilities: PlayerCapability[];
  /** Hardware device IDs associated with this player. */
  deviceIds?: string[];
  /** URL to the player's icon image. */
  icon?: string;
}

/** A group of one or more Sonos players that play audio in sync. */
export interface Group {
  /** Unique group identifier. */
  id: string;
  /** Human-readable group name, derived from member player names. */
  name: string;
  /** Player ID of the group coordinator that controls playback for the group. */
  coordinatorId: string;
  /** Current playback state of the group. */
  playbackState?: string;
  /** Player IDs of all members in this group, including the coordinator. */
  playerIds: string[];
}

/** Response from the groups namespace containing all groups and players in the household. */
export interface GroupsResponse {
  /** All groups in the household. */
  groups: Group[];
  /** All players in the household. */
  players: Player[];
}

/** Response returned when a new group is created. */
export interface CreateGroupResponse {
  /** The newly created group. */
  group: Group;
}

/** Response returned when an existing group is modified (players added or removed). */
export interface ModifyGroupResponse {
  /** The modified group. */
  group: Group;
}

/**
 * Options for {@link SonosHousehold.group}.
 */
export interface GroupOptions {
  /**
   * Audio transfer behavior:
   * - `undefined` (default): just group; if a target player is playing, its audio continues.
   * - `true`: automatically find the active audio source and transfer it.
   *   Checks target players first (by array order), then the rest of the household.
   *   Prefers `PLAYING` over `PAUSED`. If nothing is playing anywhere, groups silently.
   * - A player handle reference: transfer audio from that specific player.
   *   Throws if that player is not actively playing or paused.
   */
  transfer?: boolean | { readonly id: string };
}
