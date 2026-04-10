// Household API (recommended)
export { SonosHousehold } from './household/SonosHousehold.js';
export type { SonosHouseholdOptions } from './household/SonosHousehold.js';

// Player
export { PlayerHandle } from './player/PlayerHandle.js';
export { VolumeControl } from './player/VolumeControl.js';
export { PlaybackControl } from './player/PlaybackControl.js';
export { FavoritesAccess } from './player/FavoritesAccess.js';
export { PlaylistsAccess } from './player/PlaylistsAccess.js';
export { AudioClipControl } from './player/AudioClipControl.js';
export { HomeTheaterControl } from './player/HomeTheaterControl.js';
export { SettingsControl } from './player/SettingsControl.js';

// Simple single-speaker API
export { SonosClient } from './client/SonosClient.js';
export type { SonosClientOptions } from './client/SonosClient.js';
export type { ReconnectOptions, ConnectionState } from './client/SonosConnection.js';

// Discovery
export { SonosDiscovery } from './discovery/SsdpDiscovery.js';
export type { DiscoveryOptions, DiscoveredDevice } from './discovery/SsdpDiscovery.js';

// Errors
export { SonosError } from './errors/SonosError.js';
export { ConnectionError } from './errors/ConnectionError.js';
export { CommandError } from './errors/CommandError.js';
export { TimeoutError } from './errors/TimeoutError.js';

// Utilities
export type { Logger, LogLevel } from './util/logger.js';
export { consoleLogger, noopLogger } from './util/logger.js';

// Types
export * from './types/index.js';
