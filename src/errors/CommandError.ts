import { SonosError } from './SonosError.js';

export class CommandError extends SonosError {
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
