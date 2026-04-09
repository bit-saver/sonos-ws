import { ErrorCode } from '../types/errors.js';
import { SonosError } from './SonosError.js';

/**
 * Thrown for WebSocket connection failures, unexpected disconnections,
 * and reconnect exhaustion.
 *
 * The {@link SonosError.code} will be one of:
 * - {@link ErrorCode.CONNECTION_FAILED} -- initial connection could not be established
 * - {@link ErrorCode.CONNECTION_LOST} -- an existing connection was unexpectedly lost
 * - {@link ErrorCode.RECONNECT_EXHAUSTED} -- all automatic reconnect attempts failed
 */
export class ConnectionError extends SonosError {
  /**
   * @param code - One of the connection-related {@link ErrorCode} values.
   * @param message - Human-readable description of the connection failure.
   * @param options - Optional context.
   * @param options.cause - The underlying error that caused the connection failure.
   */
  constructor(
    code: ErrorCode.CONNECTION_FAILED | ErrorCode.CONNECTION_LOST | ErrorCode.RECONNECT_EXHAUSTED,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = 'ConnectionError';
  }
}
