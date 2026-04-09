/** Available log levels, from most to least severe. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Pluggable logging interface for sonos-ws.
 *
 * Supply a custom implementation via the `logger` option in `SonosClientOptions`
 * to integrate with your application's logging framework. Two built-in
 * implementations are provided: {@link noopLogger} and {@link consoleLogger}.
 */
export interface Logger {
  /** Log an error-level message. */
  error(message: string, ...args: unknown[]): void;
  /** Log a warning-level message. */
  warn(message: string, ...args: unknown[]): void;
  /** Log an informational message. */
  info(message: string, ...args: unknown[]): void;
  /** Log a debug-level message. */
  debug(message: string, ...args: unknown[]): void;
}

/** A logger that silently discards all messages. This is the default logger. */
export const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/** A logger that writes all messages to the console with a `[sonos-ws]` prefix. */
export const consoleLogger: Logger = {
  error: (msg, ...args) => console.error(`[sonos-ws] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[sonos-ws] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[sonos-ws] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[sonos-ws] ${msg}`, ...args),
};
