import type { ErrorCode } from '../types/errors.js';

/**
 * Base error class for all sonos-ws errors.
 *
 * Extends the standard `Error` with Sonos-specific context such as the
 * error code, API namespace, command name, and command ID. All other
 * error classes in sonos-ws ({@link ConnectionError}, {@link CommandError},
 * {@link TimeoutError}) extend this class.
 */
export class SonosError extends Error {
  /** The {@link ErrorCode} or Sonos API error string identifying what went wrong. */
  readonly code: ErrorCode | string;
  /** The Sonos API namespace where the error occurred (e.g. "groupVolume:1"). */
  readonly namespace?: string;
  /** The command that triggered the error (e.g. "setVolume"). */
  readonly command?: string;
  /** The unique command ID for correlating the error with its originating request. */
  readonly cmdId?: string;

  /**
   * @param code - Error code identifying the type of failure.
   * @param message - Human-readable error description.
   * @param options - Optional context about the command that caused the error.
   * @param options.namespace - Sonos API namespace (e.g. "playback:1").
   * @param options.command - Command name (e.g. "play").
   * @param options.cmdId - Unique command ID for request/response correlation.
   * @param options.cause - The underlying error that caused this one, if any.
   */
  constructor(
    code: ErrorCode | string,
    message: string,
    options?: {
      namespace?: string;
      command?: string;
      cmdId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'SonosError';
    this.code = code;
    this.namespace = options?.namespace;
    this.command = options?.command;
    this.cmdId = options?.cmdId;
  }
}
