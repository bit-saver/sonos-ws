import type { SonosConnection } from '../client/SonosConnection.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';

export interface NamespaceContext {
  connection: SonosConnection;
  getHouseholdId: () => string | undefined;
  getGroupId: () => string | undefined;
  getPlayerId: () => string | undefined;
}

export abstract class BaseNamespace {
  protected readonly context: NamespaceContext;
  abstract readonly namespace: string;

  private subscribed = false;

  constructor(context: NamespaceContext) {
    this.context = context;
  }

  get isSubscribed(): boolean {
    return this.subscribed;
  }

  async subscribe(): Promise<void> {
    await this.send('subscribe');
    this.subscribed = true;
  }

  async unsubscribe(): Promise<void> {
    await this.send('unsubscribe');
    this.subscribed = false;
  }

  async resubscribe(): Promise<void> {
    if (this.subscribed) {
      await this.send('subscribe');
    }
  }

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
