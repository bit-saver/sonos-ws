import { ErrorCode } from '../types/errors.js';
import { SonosError } from './SonosError.js';

export class ConnectionError extends SonosError {
  constructor(
    code: ErrorCode.CONNECTION_FAILED | ErrorCode.CONNECTION_LOST | ErrorCode.RECONNECT_EXHAUSTED,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = 'ConnectionError';
  }
}
