import type { SonosResponse } from '../types/messages.js';
import { TimeoutError } from '../errors/TimeoutError.js';

interface PendingRequest {
  resolve: (value: SonosResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  namespace: string;
  command: string;
}

export class MessageCorrelator {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeout: number;

  constructor(timeout: number = 5000) {
    this.timeout = timeout;
  }

  register(cmdId: string, namespace: string, command: string): Promise<SonosResponse> {
    return new Promise<SonosResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(cmdId)) return;
        reject(
          new TimeoutError(`Request timed out after ${this.timeout}ms: ${namespace}.${command}`, {
            namespace,
            command,
            cmdId,
          }),
        );
      }, this.timeout);

      this.pending.set(cmdId, { resolve, reject, timer, namespace, command });
    });
  }

  resolve(cmdId: string, response: SonosResponse): boolean {
    const entry = this.pending.get(cmdId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(cmdId);
    entry.resolve(response);
    return true;
  }

  reject(cmdId: string, error: Error): boolean {
    const entry = this.pending.get(cmdId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(cmdId);
    entry.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const [cmdId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}
