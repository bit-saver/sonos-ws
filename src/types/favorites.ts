import type { PlayModes } from './playback.js';
import type { ServiceInfo } from './metadata.js';

/** A Sonos favorite (saved item such as a playlist, station, or album). */
export interface Favorite {
  /** Unique identifier for the favorite. */
  id: string;
  /** Display name of the favorite. */
  name: string;
  /** Optional description of the favorite. */
  description?: string;
  /** URL to the favorite's cover art or image. */
  imageUrl?: string;
  /** The music service this favorite originates from. */
  service?: ServiceInfo;
}

/** Response containing the user's Sonos favorites list. */
export interface FavoritesResponse {
  /** Version string for cache invalidation; changes when favorites are added or removed. */
  version?: string;
  /** The list of saved favorites. */
  items: Favorite[];
}

/** Determines how content is added to the playback queue. */
export enum QueueAction {
  /** Clear the existing queue and add the new content. */
  REPLACE = 'REPLACE',
  /** Add to the end of the existing queue. */
  APPEND = 'APPEND',
  /** Insert at the current position in the queue. */
  INSERT = 'INSERT',
  /** Insert immediately after the currently playing track. */
  INSERT_NEXT = 'INSERT_NEXT',
}

/** Options when loading a favorite into the playback queue. */
export interface LoadFavoriteOptions {
  /** How to add the favorite to the queue. Defaults to {@link QueueAction.REPLACE}. */
  action?: QueueAction;
  /** Playback mode overrides to apply (shuffle, repeat, crossfade). */
  playModes?: Partial<PlayModes>;
  /** Whether to begin playback automatically after the favorite is loaded. */
  playOnCompletion?: boolean;
}
