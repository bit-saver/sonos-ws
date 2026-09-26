import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { FavoritesNamespace } from '../namespaces/FavoritesNamespace.js';
import type { FavoritesResponse, LoadFavoriteOptions } from '../types/favorites.js';

/** Access and load Sonos favorites. */
export class FavoritesAccess {
  private readonly ns: FavoritesNamespace;
  private readonly groupNs: FavoritesNamespace;

  /**
   * @param context — for reading favorites, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context: NamespaceContext, coordinatorContext: NamespaceContext = context) {
    this.ns = new FavoritesNamespace(context);
    this.groupNs = new FavoritesNamespace(coordinatorContext);
  }

  /** Retrieves the list of Sonos favorites. */
  async get(): Promise<FavoritesResponse> { return this.ns.getFavorites(); }

  /**
   * Loads a favorite into the queue.
   * @param id - Favorite ID.
   * @param options - Queue action and playback options.
   */
  async load(id: string, options?: LoadFavoriteOptions): Promise<void> { return this.groupNs.loadFavorite(id, options); }
}
