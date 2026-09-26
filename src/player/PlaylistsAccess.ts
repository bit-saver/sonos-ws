import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { PlaylistsNamespace } from '../namespaces/PlaylistsNamespace.js';
import type { PlaylistsResponse, PlaylistResponse, LoadPlaylistOptions } from '../types/playlists.js';

/** Access and load Sonos playlists. */
export class PlaylistsAccess {
  private readonly ns: PlaylistsNamespace;
  private readonly groupNs: PlaylistsNamespace;

  /**
   * @param context — for reading playlists, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context: NamespaceContext, coordinatorContext: NamespaceContext = context) {
    this.ns = new PlaylistsNamespace(context);
    this.groupNs = new PlaylistsNamespace(coordinatorContext);
  }

  /** Retrieves all Sonos playlists. */
  async get(): Promise<PlaylistsResponse> { return this.ns.getPlaylists(); }

  /**
   * Retrieves a specific playlist with its tracks.
   * @param id - Playlist ID.
   */
  async getPlaylist(id: string): Promise<PlaylistResponse> { return this.ns.getPlaylist(id); }

  /**
   * Loads a playlist into the queue.
   * @param id - Playlist ID.
   * @param options - Playback options.
   */
  async load(id: string, options?: LoadPlaylistOptions): Promise<void> { return this.groupNs.loadPlaylist(id, options); }
}
