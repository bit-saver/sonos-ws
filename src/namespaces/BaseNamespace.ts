import { randomUUID } from 'node:crypto';
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

  /**
   * Whether events for this namespace are wanted. An intent, not proof a subscription is live: a reconnect or a regroup
   * can drop it, and {@link resubscribe} puts it back.
   */
  get isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * Subscribes to real-time events for this namespace.
   *
   * The intent is recorded before sending, so a failed attempt is retried by the next {@link resubscribe}; the promise still rejects.
   */
  async subscribe(): Promise<void> {
    this.subscribed = true;
    await this.send('subscribe');
  }

  /**
   * Unsubscribes from real-time events for this namespace. The intent is dropped before sending.
   *
   * Sonos keeps one subscription per socket and target, so for a group-level namespace this also stops the events other
   * handles in the group asked for, until their next {@link resubscribe}.
   */
  async unsubscribe(): Promise<void> {
    this.subscribed = false;
    await this.send('unsubscribe');
  }

  /**
   * Sends the subscribe again if events are wanted. Safe on a live subscription (Sonos keeps one per socket and target),
   * so owners call it after any change that may have dropped one.
   */
  async resubscribe(): Promise<void> {
    if (this.subscribed) await this.send('subscribe');
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
        cmdId: randomUUID(),
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
