import type { SonosConnection } from '../client/SonosConnection.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';

/**
 * Shared context passed to all namespace instances, providing the WebSocket
 * connection and accessor functions for the current household, group, and player IDs.
 */
export interface NamespaceContext {
  /** The active WebSocket connection to the Sonos device. */
  connection: SonosConnection;
  /** Returns the current household ID, or `undefined` if not yet resolved. */
  getHouseholdId: () => string | undefined;
  /** Returns the current group ID, or `undefined` if not yet resolved. */
  getGroupId: () => string | undefined;
  /** Returns the current player ID, or `undefined` if not yet resolved. */
  getPlayerId: () => string | undefined;
}

/**
 * Abstract base class for all Sonos API namespaces.
 *
 * Each subclass targets a specific Sonos WebSocket Control API namespace
 * (e.g. `"groupVolume:1"`, `"playback:1"`). This base class handles
 * command sending and subscription lifecycle so that subclasses only need
 * to define their namespace string and expose typed API methods.
 */
export abstract class BaseNamespace {
  /** The shared connection and ID context for this namespace. */
  protected readonly context: NamespaceContext;

  /** The Sonos API namespace string (e.g. `"groupVolume:1"`). */
  abstract readonly namespace: string;

  private subscribed = false;

  constructor(context: NamespaceContext) {
    this.context = context;
  }

  /** Whether this namespace is currently subscribed to real-time events. */
  get isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * Subscribes to real-time events for this namespace.
   *
   * Once subscribed, the Sonos device will push event notifications
   * whenever the state managed by this namespace changes.
   */
  async subscribe(): Promise<void> {
    await this.send('subscribe');
    this.subscribed = true;
  }

  /**
   * Unsubscribes from real-time events for this namespace.
   *
   * After calling this method, no further event notifications will be
   * received for this namespace until {@link subscribe} is called again.
   */
  async unsubscribe(): Promise<void> {
    await this.send('unsubscribe');
    this.subscribed = false;
  }

  /**
   * Re-subscribes to events after a WebSocket reconnection.
   *
   * This is a no-op if the namespace was not previously subscribed.
   * Called internally by the client during reconnection to restore
   * event subscriptions transparently.
   */
  async resubscribe(): Promise<void> {
    if (this.subscribed) {
      await this.send('subscribe');
    }
  }

  /**
   * Sends a command to the Sonos API within this namespace.
   *
   * Automatically attaches the current `householdId`, `groupId`, and
   * `playerId` from the namespace context. A unique command ID is
   * generated for each request.
   *
   * @param command - The Sonos API command name (e.g. `"setVolume"`, `"subscribe"`).
   * @param bodyElements - Optional key-value pairs to include in the request body.
   * @returns The parsed response from the Sonos device.
   */
  protected async send(
    command: string,
    bodyElements: Record<string, unknown> = {},
  ): Promise<SonosResponse> {
    const request: SonosRequest = [
      {
        namespace: this.namespace,
        command,
        cmdId: crypto.randomUUID(),
        householdId: this.context.getHouseholdId(),
        groupId: this.context.getGroupId(),
        playerId: this.context.getPlayerId(),
      },
      bodyElements,
    ];

    return this.context.connection.send(request);
  }

  /** Extract the body (second element) from a response. */
  protected body(response: SonosResponse): Record<string, unknown> {
    return response[1];
  }
}
