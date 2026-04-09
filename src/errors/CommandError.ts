import { SonosError } from './SonosError.js';

/**
 * Thrown when a Sonos device returns an error response to a command.
 *
 * The {@link SonosError.code} contains the Sonos API error code string
 * (e.g. "ERROR_COMMAND_FAILED", "ERROR_INVALID_PARAMETER").
 * The {@link SonosError.namespace}, {@link SonosError.command}, and
 * {@link SonosError.cmdId} identify which request failed.
 */
export class CommandError extends SonosError {
  /**
   * @param code - Sonos API error code string from the device response.
   * @param message - Human-readable error description from the device.
   * @param options - Context about the command that failed.
   * @param options.namespace - Sonos API namespace of the failed command.
   * @param options.command - Name of the failed command.
   * @param options.cmdId - Command ID for request/response correlation.
   * @param options.cause - The underlying error, if any.
   */
  constructor(
    code: string,
    message: string,
    options?: {
      namespace?: string;
      command?: string;
      cmdId?: string;
      cause?: unknown;
    },
  ) {
    super(code, message, options);
    this.name = 'CommandError';
  }
}
