import type { Track, Container } from './metadata.js';

export interface Playlist {
  id: string;
  name: string;
  trackCount?: number;
  description?: string;
}

export interface PlaylistTrack {
  track: Track;
  container?: Container;
}

export interface PlaylistResponse {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
}

export interface PlaylistsResponse {
  version?: string;
  playlists: Playlist[];
}

export interface LoadPlaylistOptions {
  playOnCompletion?: boolean;
}
