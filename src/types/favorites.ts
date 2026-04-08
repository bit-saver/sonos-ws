import type { PlayModes } from './playback.js';
import type { ServiceInfo } from './metadata.js';

export interface Favorite {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  service?: ServiceInfo;
}

export interface FavoritesResponse {
  version?: string;
  items: Favorite[];
}

export enum QueueAction {
  REPLACE = 'REPLACE',
  APPEND = 'APPEND',
  INSERT = 'INSERT',
  INSERT_NEXT = 'INSERT_NEXT',
}

export interface LoadFavoriteOptions {
  action?: QueueAction;
  playModes?: Partial<PlayModes>;
  playOnCompletion?: boolean;
}
