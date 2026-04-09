import { BaseNamespace } from './BaseNamespace.js';
import type { FavoritesResponse, LoadFavoriteOptions } from '../types/favorites.js';

/**
 * Accesses and loads Sonos favorites (My Sonos).
 *
 * Maps to the Sonos WebSocket Control API `favorites:1` namespace.
 */
export class FavoritesNamespace extends BaseNamespace {
  readonly namespace = 'favorites:1';

  /**
   * Retrieves the list of Sonos favorites.
   *
   * @returns The favorites collection including item details and version info.
   */
  async getFavorites(): Promise<FavoritesResponse> {
    const response = await this.send('getFavorites');
    return this.body(response) as unknown as FavoritesResponse;
  }

  /**
   * Loads a favorite into the queue and optionally begins playback.
   *
   * @param favoriteId - The ID of the favorite to load.
   * @param options - Optional playback and queue behavior settings.
   */
  async loadFavorite(favoriteId: string, options?: LoadFavoriteOptions): Promise<void> {
    await this.send('loadFavorite', { favoriteId, ...options });
  }
}
