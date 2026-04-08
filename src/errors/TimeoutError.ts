import { ErrorCode } from '../types/errors.js';
import { SonosError } from './SonosError.js';

export class TimeoutError extends SonosError {
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
