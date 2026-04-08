export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

export const consoleLogger: Logger = {
  error: (msg, ...args) => console.error(`[sonos-ws] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[sonos-ws] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[sonos-ws] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[sonos-ws] ${msg}`, ...args),
};
