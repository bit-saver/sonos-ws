import WebSocket from 'ws';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import { MessageCorrelator } from './MessageCorrelator.js';
import { ConnectionError } from '../errors/ConnectionError.js';
import { CommandError } from '../errors/CommandError.js';
import { ErrorCode } from '../types/errors.js';

/**
 * The four possible states of a {@link SonosConnection}.
 *
 * - `disconnected` -- no active connection
 * - `connecting` -- a connection attempt is in progress
 * - `connected` -- the WebSocket is open and ready
 * - `reconnecting` -- the connection was lost and a reconnect is pending
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Events emitted by {@link SonosConnection}. */
export interface ConnectionEvents {
  /** Fired when the WebSocket connection is successfully established. */
  connected: () => void;
  /** Fired when the connection is closed, with a human-readable reason. */
  disconnected: (reason: string) => void;
  /** Fired before each reconnect attempt, with the attempt number and delay in ms. */
  reconnecting: (attempt: number, delay: number) => void;
  /** Fired when an unsolicited message (event) is received from the speaker. */
  message: (data: SonosResponse) => void;
  /** Fired when a connection or WebSocket error occurs. */
  error: (error: Error) => void;
}

/** Configuration for automatic reconnection behavior. */
export interface ReconnectOptions {
  /** Whether auto-reconnect is active. */
  enabled: boolean;
  /** Base delay in milliseconds before the first reconnect attempt. */
  initialDelay: number;
  /** Maximum delay in milliseconds between reconnect attempts. */
  maxDelay: number;
  /** Exponential backoff multiplier applied to the delay after each attempt. */
  factor: number;
  /** Maximum number of reconnect attempts before giving up. Use `Infinity` for unlimited. */
  maxAttempts: number;
}

/** Low-level options passed to the {@link SonosConnection} constructor. */
export interface ConnectionOptions {
  /** IP address or hostname of the Sonos speaker. */
  host: string;
  /** WebSocket port on the Sonos device. */
  port: number;
  /** Reconnection configuration. */
  reconnect: ReconnectOptions;
  /** Timeout in milliseconds for individual request/response correlation. */
  requestTimeout: number;
  /** Logger instance for debug, info, warn, and error output. */
  logger: Logger;
}

const SUB_PROTOCOL = 'v1.api.smartspeaker.audio';
const API_KEY = '123e4567-e89b-12d3-a456-426655440000';

/**
 * Manages the WebSocket lifecycle for a single Sonos speaker.
 *
 * Handles TLS connection establishment (accepting the speaker's self-signed
 * certificate), exponential-backoff reconnection, and request/response
 * correlation via {@link MessageCorrelator}.
 */
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

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Establishes the WebSocket connection to the Sonos speaker over TLS.
   *
   * The speaker uses a self-signed certificate, so TLS verification is
   * intentionally disabled. If already connected, this method returns
   * immediately. If a connection attempt is already in progress, the
   * existing promise is returned.
   */
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

  /**
   * Intentionally closes the WebSocket connection.
   *
   * All pending requests are rejected with a {@link ConnectionError}, the
   * reconnect timer is cancelled, and no automatic reconnection will occur.
   */
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

  /**
   * Sends a request to the Sonos speaker and waits for the correlated response.
   *
   * The request headers must include `cmdId`, `namespace`, and `command`.
   * The response is matched by `cmdId` via {@link MessageCorrelator}.
   *
   * @param request - The `[headers, body]` tuple to send.
   * @returns The correlated `[headers, body]` response from the speaker.
   * @throws {ConnectionError} If the WebSocket is not connected.
   * @throws {CommandError} If the speaker returns a failure response.
   * @throws {TimeoutError} If no response is received within the configured timeout.
   */
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
