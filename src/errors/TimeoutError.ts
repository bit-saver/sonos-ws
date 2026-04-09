import { ErrorCode } from '../types/errors.js';
import { SonosError } from './SonosError.js';

/**
 * Thrown when a command does not receive a response from the Sonos device
 * within the configured timeout period.
 *
 * The {@link SonosError.code} is always {@link ErrorCode.REQUEST_TIMEOUT}.
 */
export class TimeoutError extends SonosError {
  /**
   * @param message - Human-readable description of the timeout.
   * @param options - Context about the command that timed out.
   * @param options.namespace - Sonos API namespace of the timed-out command.
   * @param options.command - Name of the timed-out command.
   * @param options.cmdId - Command ID for request/response correlation.
   */
  constructor(
    message: string,
    options?: {
      namespace?: string;
      command?: string;
      cmdId?: string;
    },
  ) {
    super(ErrorCode.REQUEST_TIMEOUT, message, options);
    this.name = 'TimeoutError';
  }
}
