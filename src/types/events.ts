import type { GroupVolumeStatus, PlayerVolumeStatus } from './volume.js';
import type { Group, Player, GroupsResponse } from './groups.js';
import type { PlaybackStatus } from './playback.js';
import type { MetadataStatus } from './metadata.js';
import type { FavoritesResponse } from './favorites.js';
import type { PlaylistsResponse } from './playlists.js';
import type { HomeTheaterOptions } from './homeTheater.js';
import type { SonosResponse } from './messages.js';
import type { SonosError } from '../errors/SonosError.js';

/** Event data emitted when a group's coordinator changes (speakers grouped or ungrouped). */
export interface GroupCoordinatorChangedEvent {
  _objectType: 'groupCoordinatorChanged';
  /** Status of the group change (e.g. `"GROUP_STATUS_MOVED"`). */
  groupStatus: string;
  /** Name of the new group (e.g. `"Bedroom + 1"`). */
  groupName: string;
  /** WebSocket URL of the new group coordinator. */
  websocketUrl: string;
  /** Player ID of the new group coordinator. */
  playerId: string;
}

/**
 * All events emitted by {@link SonosClient}.
 *
 * Includes connection lifecycle events, real-time subscription updates
 * from the Sonos device, and a raw message event for debugging.
 */
export interface SonosEvents {
  /** Emitted when the WebSocket connection is established. */
  connected: () => void;
  /** Emitted when the WebSocket connection is lost, with a human-readable reason string. */
  disconnected: (reason: string) => void;
  /** Emitted before each reconnect attempt, with the attempt number and delay in milliseconds before the attempt. */
  reconnecting: (attempt: number, delay: number) => void;
  /** Emitted on connection or command errors. */
  error: (error: SonosError | Error) => void;

  /** Emitted when the group volume or mute state changes. */
  groupVolumeChanged: (data: GroupVolumeStatus) => void;
  /** Emitted when an individual player's volume or mute state changes. */
  playerVolumeChanged: (data: PlayerVolumeStatus) => void;
  /** Emitted when group membership or topology changes (players grouped/ungrouped). */
  groupsChanged: (data: GroupsResponse) => void;
  /** Emitted when the playback state, position, or play modes change. */
  playbackStatusChanged: (data: PlaybackStatus) => void;
  /** Emitted when the currently playing track or next track metadata changes. */
  metadataStatusChanged: (data: MetadataStatus) => void;
  /** Emitted when the user's favorites list is modified. */
  favoritesChanged: (data: FavoritesResponse) => void;
  /** Emitted when the user's playlists are modified. */
  playlistsChanged: (data: PlaylistsResponse) => void;
  /** Emitted when home theater settings (night mode, dialog enhancement) change. */
  homeTheaterChanged: (data: HomeTheaterOptions) => void;

  /**
   * Emitted when the group coordinator changes (e.g. speakers grouped/ungrouped).
   * The client automatically calls {@link SonosClient.refreshGroups} to update
   * its internal groupId. Listen to this event to react to topology changes.
   */
  groupCoordinatorChanged: (data: GroupCoordinatorChangedEvent) => void;

  /** Emitted for every raw WebSocket message received from the Sonos device. Useful for debugging. */
  rawMessage: (message: SonosResponse) => void;
}

/**
 * Events emitted by {@link SonosHousehold}.
 * Extends all {@link SonosEvents} and adds household-level topology events.
 */
export interface SonosHouseholdEvents extends SonosEvents {
  /** Emitted when group topology changes (groups/players added/removed/reorganized). */
  topologyChanged: (groups: Group[], players: Player[]) => void;
}

/**
 * Maps Sonos API namespace strings to their corresponding {@link SonosEvents} event names.
 *
 * Used internally to route subscription events from the WebSocket connection
 * to the appropriate typed event emitter.
 */
export const NAMESPACE_EVENT_MAP: Record<string, keyof SonosEvents> = {
  'groupVolume:1': 'groupVolumeChanged',
  'playerVolume:1': 'playerVolumeChanged',
  'groups:1': 'groupsChanged',
  'playback:1': 'playbackStatusChanged',
  'playbackMetadata:1': 'metadataStatusChanged',
  'favorites:1': 'favoritesChanged',
  'playlists:1': 'playlistsChanged',
  'homeTheater:1': 'homeTheaterChanged',
};
