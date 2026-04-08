import { BaseNamespace } from './BaseNamespace.js';
import type { FavoritesResponse, LoadFavoriteOptions } from '../types/favorites.js';

export class FavoritesNamespace extends BaseNamespace {
  readonly namespace = 'favorites:1';

  async getFavorites(): Promise<FavoritesResponse> {
    const response = await this.send('getFavorites');
    return this.body(response) as unknown as FavoritesResponse;
  }

  async loadFavorite(favoriteId: string, options?: LoadFavoriteOptions): Promise<void> {
    await this.send('loadFavorite', { favoriteId, ...options });
  }
}
