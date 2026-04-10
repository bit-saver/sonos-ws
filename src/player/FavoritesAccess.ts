import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { FavoritesNamespace } from '../namespaces/FavoritesNamespace.js';
import type { FavoritesResponse, LoadFavoriteOptions } from '../types/favorites.js';

/** Access and load Sonos favorites. */
export class FavoritesAccess {
  private readonly ns: FavoritesNamespace;
  constructor(context: NamespaceContext) { this.ns = new FavoritesNamespace(context); }

  /** Retrieves the list of Sonos favorites. */
  async get(): Promise<FavoritesResponse> { return this.ns.getFavorites(); }

  /**
   * Loads a favorite into the queue.
   * @param id - Favorite ID.
   * @param options - Queue action and playback options.
   */
  async load(id: string, options?: LoadFavoriteOptions): Promise<void> { return this.ns.loadFavorite(id, options); }
}
