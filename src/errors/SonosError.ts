import type { ErrorCode } from '../types/errors.js';

export class SonosError extends Error {
  readonly code: ErrorCode | string;
  readonly namespace?: string;
  readonly command?: string;
  readonly cmdId?: string;

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
