import { BaseNamespace } from './BaseNamespace.js';
import type { PlaylistsResponse, PlaylistResponse, LoadPlaylistOptions } from '../types/playlists.js';

/**
 * Accesses and loads Sonos playlists.
 *
 * Maps to the Sonos WebSocket Control API `playlists:1` namespace.
 */
export class PlaylistsNamespace extends BaseNamespace {
  readonly namespace = 'playlists:1';

  /**
   * Retrieves all Sonos playlists.
   *
   * @returns The list of available playlists.
   */
  async getPlaylists(): Promise<PlaylistsResponse> {
    const response = await this.send('getPlaylists');
    return this.body(response) as unknown as PlaylistsResponse;
  }

  /**
   * Retrieves a specific playlist with its tracks.
   *
   * @param playlistId - The ID of the playlist to retrieve.
   * @returns The playlist details including its track listing.
   */
  async getPlaylist(playlistId: string): Promise<PlaylistResponse> {
    const response = await this.send('getPlaylist', { playlistId });
    return this.body(response) as unknown as PlaylistResponse;
  }

  /**
   * Loads a playlist into the queue and optionally begins playback.
   *
   * @param playlistId - The ID of the playlist to load.
   * @param options - Optional playback and queue behavior settings.
   */
  async loadPlaylist(playlistId: string, options?: LoadPlaylistOptions): Promise<void> {
    await this.send('loadPlaylist', { playlistId, ...options });
  }
}
