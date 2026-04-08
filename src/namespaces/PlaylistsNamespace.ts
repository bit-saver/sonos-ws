import { BaseNamespace } from './BaseNamespace.js';
import type { PlaylistsResponse, PlaylistResponse, LoadPlaylistOptions } from '../types/playlists.js';

export class PlaylistsNamespace extends BaseNamespace {
  readonly namespace = 'playlists:1';

  async getPlaylists(): Promise<PlaylistsResponse> {
    const response = await this.send('getPlaylists');
    return this.body(response) as unknown as PlaylistsResponse;
  }

  async getPlaylist(playlistId: string): Promise<PlaylistResponse> {
    const response = await this.send('getPlaylist', { playlistId });
    return this.body(response) as unknown as PlaylistResponse;
  }

  async loadPlaylist(playlistId: string, options?: LoadPlaylistOptions): Promise<void> {
    await this.send('loadPlaylist', { playlistId, ...options });
  }
}
