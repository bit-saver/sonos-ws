import type { SonosResponse } from '../types/messages.js';
import { TimeoutError } from '../errors/TimeoutError.js';

interface PendingRequest {
  resolve: (value: SonosResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  namespace: string;
  command: string;
}

/**
 * Matches outgoing Sonos WebSocket requests to their incoming responses
 * using the `cmdId` field. Each registered request is given a configurable
 * timeout; if no matching response arrives in time, the promise is rejected
 * with a {@link TimeoutError}.
 */
export class MessageCorrelator {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeout: number;

  /**
   * @param timeout - Maximum time in milliseconds to wait for a response
   *   before rejecting with a {@link TimeoutError}. Defaults to 5000.
   */
  constructor(timeout: number = 5000) {
    this.timeout = timeout;
  }

  /**
   * Registers a pending request and returns a promise that resolves when the
   * matching response arrives (via {@link resolve}), or rejects on timeout.
   *
   * @param cmdId - Unique command ID used to correlate the response.
   * @param namespace - Sonos API namespace (used in timeout error messages).
   * @param command - Sonos API command name (used in timeout error messages).
   * @returns A promise that resolves with the correlated {@link SonosResponse}.
   */
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

  /**
   * Resolves a pending request with the received response.
   *
   * @param cmdId - The command ID of the response to match.
   * @param response - The response received from the speaker.
   * @returns `true` if a matching pending request was found and resolved,
   *   `false` otherwise.
   */
  resolve(cmdId: string, response: SonosResponse): boolean {
    const entry = this.pending.get(cmdId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(cmdId);
    entry.resolve(response);
    return true;
  }

  /**
   * Rejects a specific pending request with the given error.
   *
   * @param cmdId - The command ID of the request to reject.
   * @param error - The error to reject the pending promise with.
   * @returns `true` if a matching pending request was found and rejected,
   *   `false` otherwise.
   */
  reject(cmdId: string, error: Error): boolean {
    const entry = this.pending.get(cmdId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(cmdId);
    entry.reject(error);
    return true;
  }

  /**
   * Rejects all pending requests with the given error.
   *
   * Typically called when the connection is closed or intentionally
   * disconnected, so that no promises are left hanging.
   *
   * @param error - The error to reject every pending promise with.
   */
  rejectAll(error: Error): void {
    for (const [cmdId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /** Number of requests currently awaiting a response. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clears all pending requests and their associated timers without
   * rejecting the promises. Use {@link rejectAll} if callers need to be
   * notified of cancellation.
   */
  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}
