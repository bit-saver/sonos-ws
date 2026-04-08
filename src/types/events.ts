import type { GroupVolumeStatus, PlayerVolumeStatus } from './volume.js';
import type { GroupsResponse } from './groups.js';
import type { PlaybackStatus } from './playback.js';
import type { MetadataStatus } from './metadata.js';
import type { FavoritesResponse } from './favorites.js';
import type { PlaylistsResponse } from './playlists.js';
import type { HomeTheaterOptions } from './homeTheater.js';
import type { SonosResponse } from './messages.js';
import type { SonosError } from '../errors/SonosError.js';

export interface SonosEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, delay: number) => void;
  error: (error: SonosError | Error) => void;

  groupVolumeChanged: (data: GroupVolumeStatus) => void;
  playerVolumeChanged: (data: PlayerVolumeStatus) => void;
  groupsChanged: (data: GroupsResponse) => void;
  playbackStatusChanged: (data: PlaybackStatus) => void;
  metadataStatusChanged: (data: MetadataStatus) => void;
  favoritesChanged: (data: FavoritesResponse) => void;
  playlistsChanged: (data: PlaylistsResponse) => void;
  homeTheaterChanged: (data: HomeTheaterOptions) => void;

  rawMessage: (message: SonosResponse) => void;
}

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
