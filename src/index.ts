export { SonosClient } from './client/SonosClient.js';
export type { SonosClientOptions } from './client/SonosClient.js';
export type { ReconnectOptions, ConnectionState } from './client/SonosConnection.js';

export { SonosDiscovery } from './discovery/SsdpDiscovery.js';
export type { DiscoveryOptions, DiscoveredDevice } from './discovery/SsdpDiscovery.js';

export { SonosError } from './errors/SonosError.js';
export { ConnectionError } from './errors/ConnectionError.js';
export { CommandError } from './errors/CommandError.js';
export { TimeoutError } from './errors/TimeoutError.js';

export type { Logger, LogLevel } from './util/logger.js';
export { consoleLogger, noopLogger } from './util/logger.js';

export * from './types/index.js';
