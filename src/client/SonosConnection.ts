import WebSocket from 'ws';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import { MessageCorrelator } from './MessageCorrelator.js';
import { ConnectionError } from '../errors/ConnectionError.js';
import { CommandError } from '../errors/CommandError.js';
import { ErrorCode } from '../types/errors.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface ConnectionEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, delay: number) => void;
  message: (data: SonosResponse) => void;
  error: (error: Error) => void;
}

export interface ReconnectOptions {
  enabled: boolean;
  initialDelay: number;
  maxDelay: number;
  factor: number;
  maxAttempts: number;
}

export interface ConnectionOptions {
  host: string;
  port: number;
  reconnect: ReconnectOptions;
  requestTimeout: number;
  logger: Logger;
}

const SUB_PROTOCOL = 'v1.api.smartspeaker.audio';
const API_KEY = '123e4567-e89b-12d3-a456-426655440000';

export class SonosConnection extends TypedEventEmitter<ConnectionEvents> {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private readonly correlator: MessageCorrelator;
  private readonly options: ConnectionOptions;
  private readonly log: Logger;
  private connectPromise: Promise<void> | null = null;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(options: ConnectionOptions) {
    super();
    this.options = options;
    this.log = options.logger ?? noopLogger;
    this.correlator = new MessageCorrelator(options.requestTimeout);
  }

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return;
    if (this.connectPromise) return this.connectPromise;

    this.intentionalClose = false;
    this._state = 'connecting';

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = `wss://${this.options.host}:${this.options.port}/websocket/api`;
      this.log.info(`Connecting to ${url}`);

      this.ws = new WebSocket(url, SUB_PROTOCOL, {
        rejectUnauthorized: false,
        headers: {
          'X-Sonos-Api-Key': API_KEY,
        },
      });

      const onOpen = () => {
        cleanup();
        this._state = 'connected';
        this.reconnectAttempt = 0;
        this.connectPromise = null;
        this.log.info('Connected');

        this.ws!.on('error', (err: Error) => {
          this.log.error('WebSocket error', err.message);
          this.emit('error', err);
        });

        this.emit('connected');
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        this._state = 'disconnected';
        this.connectPromise = null;

        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws = null;
        }

        const connErr = new ConnectionError(
          ErrorCode.CONNECTION_FAILED,
          `Failed to connect: ${err.message}`,
          { cause: err },
        );
        this.emit('error', connErr);
        reject(connErr);
      };

      const cleanup = () => {
        this.ws?.removeListener('open', onOpen);
        this.ws?.removeListener('error', onError);
      };

      this.ws.once('open', onOpen);
      this.ws.once('error', onError);

      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.handleClose(code, reason.toString());
      });
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.connectPromise = null;
    this.correlator.rejectAll(
      new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'),
    );

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'client disconnect');
      }
      this.ws.removeAllListeners();
      this.ws = null;
    }

    this._state = 'disconnected';
    this.emit('disconnected', 'client disconnect');
  }

  async send(request: SonosRequest): Promise<SonosResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Not connected');
    }

    const [headers, body] = request;
    const { cmdId, namespace, command } = headers;

    if (!cmdId || !namespace || !command) {
      throw new Error('Request must include cmdId, namespace, and command');
    }

    const promise = this.correlator.register(cmdId, namespace, command);

    this.log.debug(`Sending ${namespace}.${command} [${cmdId}]`);
    this.ws.send(JSON.stringify(request));

    const response = await promise;
    const [resHeaders, resBody] = response;

    // Emit the response so listeners can extract metadata (e.g., householdId)
    // even from error responses
    this.emit('message', response);

    if (resHeaders.success === false) {
      const errorCode = (resBody?.errorCode as string) ?? resHeaders.response ?? 'UNKNOWN';
      const reason = (resBody?.reason as string) ?? `Command failed: ${namespace}.${command}`;
      throw new CommandError(errorCode, reason, { namespace, command, cmdId });
    }

    return response;
  }

  private handleMessage(data: WebSocket.Data): void {
    let parsed: SonosResponse;
    try {
      parsed = JSON.parse(data.toString()) as SonosResponse;
    } catch {
      this.log.warn('Received non-JSON message', data.toString().substring(0, 200));
      return;
    }

    if (!Array.isArray(parsed) || parsed.length < 2) {
      this.log.warn('Unexpected message format', data.toString().substring(0, 200));
      return;
    }

    const [headers] = parsed;
    const cmdId = headers?.cmdId;

    if (cmdId && this.correlator.resolve(cmdId, parsed)) {
      this.log.debug(`Response for ${headers.namespace}.${headers.command ?? headers.response} [${cmdId}]`);
      return;
    }

    this.log.debug(`Event: ${headers?.namespace}.${headers?.type ?? headers?.command}`);
    this.emit('message', parsed);
  }

  private handleClose(code: number, reason: string): void {
    this.log.info(`Connection closed: ${code} ${reason}`);
    this.correlator.rejectAll(
      new ConnectionError(ErrorCode.CONNECTION_LOST, `Connection closed: ${code} ${reason}`),
    );

    if (this.intentionalClose) {
      this._state = 'disconnected';
      this.emit('disconnected', reason);
      return;
    }

    if (this.options.reconnect.enabled) {
      this.scheduleReconnect();
    } else {
      this._state = 'disconnected';
      this.emit('disconnected', reason);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.options.reconnect.maxAttempts) {
      this._state = 'disconnected';
      const err = new ConnectionError(
        ErrorCode.RECONNECT_EXHAUSTED,
        `Reconnection failed after ${this.reconnectAttempt} attempts`,
      );
      this.emit('error', err);
      this.emit('disconnected', 'reconnect exhausted');
      return;
    }

    this._state = 'reconnecting';
    const delay = Math.min(
      this.options.reconnect.initialDelay * Math.pow(this.options.reconnect.factor, this.reconnectAttempt),
      this.options.reconnect.maxDelay,
    );

    this.reconnectAttempt++;
    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.emit('reconnecting', this.reconnectAttempt, delay);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
