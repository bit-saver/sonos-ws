import type { Track, Container } from './metadata.js';

/** Summary information for a Sonos playlist. */
export interface Playlist {
  /** Unique identifier for the playlist. */
  id: string;
  /** Display name of the playlist. */
  name: string;
  /** Number of tracks in the playlist. */
  trackCount?: number;
  /** Optional description of the playlist. */
  description?: string;
}

/** A track within a playlist, with its optional containing album or collection. */
export interface PlaylistTrack {
  /** The track metadata. */
  track: Track;
  /** The container (album, collection) the track belongs to, if any. */
  container?: Container;
}

/** Full playlist details including all tracks. */
export interface PlaylistResponse {
  /** Unique identifier for the playlist. */
  id: string;
  /** Display name of the playlist. */
  name: string;
  /** Ordered list of tracks in the playlist. */
  tracks: PlaylistTrack[];
}

/** Response containing all Sonos playlists in the household. */
export interface PlaylistsResponse {
  /** Version string for cache invalidation; changes when playlists are modified. */
  version?: string;
  /** The list of playlists. */
  playlists: Playlist[];
}

/** Options when loading a playlist into the playback queue. */
export interface LoadPlaylistOptions {
  /** Whether to begin playback automatically after the playlist is loaded. */
  playOnCompletion?: boolean;
}
