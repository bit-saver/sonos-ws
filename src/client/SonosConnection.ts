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
  /** Milliseconds between WebSocket pings. Set to 0 to disable keepalive. */
  pingInterval: number;
  /** Milliseconds to wait for a pong reply before declaring the connection dead. */
  pongTimeout: number;
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
  /**
   * Milliseconds to wait for a WebSocket handshake to open or fail before
   * abandoning it. Defaults to 10 000 ms.
   */
  connectTimeout?: number;
  /** Logger instance for debug, info, warn, and error output. */
  logger: Logger;
}

/**
 * A healthy handshake to a speaker on the LAN completes in well under a
 * second. Anything still pending after this long is not coming: under Bun a
 * handshake can produce no `'open'`, no `'error'` and no `'close'` at all, and
 * without a deadline the attempt — and the reconnect ladder awaiting it —
 * never ends.
 */
const DEFAULT_CONNECT_TIMEOUT = 10_000;

/**
 * One-line form of an event body for the log.
 *
 * An external controller — the Sonos app, a Spotify Connect client — can move
 * a player with no command from us, and the event is the only record. Logging
 * the namespace alone says that something happened and discards what: the
 * value, and the `muted`/`fixed` flags that say how. Truncated because a
 * topology or metadata event runs to kilobytes.
 */
function summarize(body: unknown): string {
  try {
    const json = JSON.stringify(body) ?? String(body);
    return json.length > EVENT_BODY_LOG_LIMIT ? `${json.slice(0, EVENT_BODY_LOG_LIMIT)}…` : json;
  } catch {
    return '[unserializable]';
  }
}

/** Characters of an event body kept in the log. */
const EVENT_BODY_LOG_LIMIT = 300;

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

  /**
   * Rejecter for the in-flight {@link connectPromise}.
   *
   * Held on the instance because a socket can emit `'close'` without ever
   * emitting `'open'` or `'error'`, and only those two closures can settle
   * the promise. Without this, `handleClose` cannot unblock a caller.
   */
  private connectReject: ((err: Error) => void) | null = null;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ConnectionOptions) {
    super();
    this.options = options;
    this.log = options.logger ?? noopLogger;
    this.correlator = new MessageCorrelator(options.requestTimeout);

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside.
    this.on('error', (err) => {
      this.log.error(`Unhandled connection error: ${err.message}`);
    });
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
      this.connectReject = reject;
      const url = `wss://${this.options.host}:${this.options.port}/websocket/api`;
      this.log.info(`Connecting to ${url}`);

      this.ws = new WebSocket(url, SUB_PROTOCOL, {
        rejectUnauthorized: false,
        headers: {
          'X-Sonos-Api-Key': API_KEY,
        },
      });

      // Every handler below acts on THIS attempt's socket, never on
      // this.ws — which, by the time a late event arrives, may already be
      // the next attempt's socket.
      const socket = this.ws;

      const onOpen = () => {
        cleanup();
        this._state = 'connected';
        this.reconnectAttempt = 0;
        this.connectPromise = null;
        this.connectReject = null;
        // this.log.info('Connected');

        socket.on('error', (err: Error) => {
          this.log.error('WebSocket error', err.message);
          this.emit('error', err);
        });

        this.emit('connected');

        socket.on('pong', () => {
          if (this.pongDeadlineTimer) {
            clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
          }
        });

        this.startPing();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        this._state = 'disconnected';
        this.connectPromise = null;
        this.connectReject = null;

        this.abandonSocket(socket);
        if (this.ws === socket) this.ws = null;

        const connErr = new ConnectionError(
          ErrorCode.CONNECTION_FAILED,
          `Failed to connect: ${err.message}`,
          { cause: err },
        );
        this.emit('error', connErr);
        reject(connErr);

        // Initial connect failed. If reconnect is enabled, start the loop
        // in the background so a later network recovery re-establishes the
        // connection. The rejected promise above informs the caller of the
        // initial failure immediately.
        if (this.options.reconnect.enabled && !this.intentionalClose) {
          this.scheduleReconnect();
        }
      };

      let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
      const clearHandshakeTimer = () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
      };

      const cleanup = () => {
        clearHandshakeTimer();
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
      };

      const connectTimeout = this.options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
      handshakeTimer = setTimeout(() => {
        handshakeTimer = null;
        if (this.ws !== socket) return;
        // Fail the attempt through the normal error path first — it abandons
        // the socket (listeners off, error sink on) and schedules the next
        // attempt — and only then terminate, so the teardown cannot re-enter
        // onError or handleClose.
        onError(new Error(`handshake timed out after ${connectTimeout}ms`));
        socket.terminate();
      }, connectTimeout);

      socket.once('open', onOpen);
      socket.once('error', onError);

      socket.on('message', (data: WebSocket.Data) => this.handleMessage(data));

      socket.on('close', (code: number, reason: Buffer) => {
        // The socket is finished. Strip every listener of this attempt —
        // including onOpen/onError, which a close-before-open would otherwise
        // leave armed — so nothing late from it can reach the next attempt.
        // A surviving handshake timer would also double-schedule the
        // reconnect handleClose is about to schedule.
        cleanup();
        this.abandonSocket(socket);
        if (this.ws === socket) this.ws = null;
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
   * A `connect()` still in flight is rejected the same way, with
   * `ConnectionError(CONNECTION_LOST, 'Client disconnected')`, and if its
   * socket is still handshaking (not yet open) it is terminated rather than
   * left to finish in the background as an orphan.
   */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();

    // A caller may still be awaiting a handshake. Settle it: nulling the
    // rejecter without calling it leaves that caller waiting forever.
    const rejectPending = this.connectReject;
    this.connectPromise = null;
    this.connectReject = null;
    rejectPending?.(new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'));

    this.correlator.rejectAll(
      new ConnectionError(ErrorCode.CONNECTION_LOST, 'Client disconnected'),
    );

    this.stopPing();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'client disconnect');
        this.abandonSocket(socket);
      } else {
        // Still handshaking: left alone it would finish in the background
        // and open as an orphan with no listeners. Abandon first so the
        // teardown's own 'error'/'close' land on the sink, then terminate.
        this.abandonSocket(socket);
        socket.terminate();
      }
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
    if (this._state === 'reconnecting') {
      await this.waitForReconnect();
    }

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

    if (resHeaders.success === false) {
      const errorCode = (resBody?.errorCode as string)
        ?? resHeaders.type
        ?? resHeaders.response
        ?? 'UNKNOWN';
      const reason = (resBody?.reason as string) ?? `Command failed: ${namespace}.${command}`;
      throw new CommandError(errorCode, reason, { namespace, command, cmdId, cause: response });
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

    const [headers, body] = parsed;
    const cmdId = headers?.cmdId;

    if (cmdId && this.correlator.resolve(cmdId, parsed)) {
      this.log.debug(`Response for ${headers.namespace}.${headers.command ?? headers.response} [${cmdId}]`);
      return;
    }

    this.log.debug(
      `Event: ${headers?.namespace}.${headers?.type ?? headers?.command} ${summarize(body)}`,
    );
    this.emit('message', parsed);
  }

  /**
   * Detaches our handlers from a socket we are done with, leaving a single
   * permanent `'error'` sink behind.
   *
   * Dropping our reference does not kill the socket: it stays alive inside
   * `ws` and can still emit `'error'` afterwards — Bun reliably does, with a
   * browser-style `ErrorEvent` rather than a Node `Error`. An EventEmitter
   * with no `'error'` listener *throws*, which escapes as an
   * `uncaughtException` and takes the host application down. The sink makes
   * every abandonment path safe without reviving the connection.
   *
   * No `'close'` listener is re-attached, so callers that detach before
   * `terminate()` to prevent a double `handleClose` keep that guarantee.
   */
  private abandonSocket(ws: WebSocket): void {
    ws.removeAllListeners();
    ws.on('error', (err: unknown) => {
      // Bun passes a browser-style ErrorEvent, which is not an Error but
      // does carry a message; String() on it yields "[object ErrorEvent]".
      const message = (err as { message?: unknown } | null)?.message;
      this.log.debug(
        `Ignoring error from abandoned socket: ${typeof message === 'string' ? message : String(err)}`,
      );
    });
  }

  private handleClose(code: number, reason: string): void {
    this.stopPing();
    this.log.info(`Connection closed: ${code} ${reason}`);
    this.correlator.rejectAll(
      new ConnectionError(ErrorCode.CONNECTION_LOST, `Connection closed: ${code} ${reason}`),
    );

    // A socket can emit 'close' having never emitted 'open' or 'error' — a
    // handshake aborted mid-flight. Only those two closures settle and clear
    // connectPromise, so without this the promise stays set AND unsettled
    // forever: connect() short-circuits on it at the top, the reconnect
    // ladder awaits a promise that can never resolve, and recovery goes
    // permanently silent with no further attempts and no exhaustion event.
    if (this.connectPromise) {
      const rejectPending = this.connectReject;
      this.connectPromise = null;
      this.connectReject = null;
      rejectPending?.(
        new ConnectionError(
          ErrorCode.CONNECTION_LOST,
          `Connection closed before open: ${code} ${reason}`,
        ),
      );
    }

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
    // At most one ladder. A failure outside the ladder (an external
    // connect() while it waits) reaches here with the ladder's timer still
    // pending; overwriting it would leave both running and exhaust twice.
    this.clearReconnectTimer();

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
        // onError already scheduled the next reconnect attempt for this
        // failure — do not schedule again here or we double-emit
        // RECONNECT_EXHAUSTED and halve the effective maxAttempts.
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    const { pingInterval, pongTimeout } = this.options.reconnect;
    if (!pingInterval || !this.ws) return;

    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
      this.pongDeadlineTimer = setTimeout(() => {
        this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
        const dead = this.ws;
        if (dead) {
          // Detach BEFORE terminate so a late 'close' event has no listener
          // and cannot double-fire handleClose / scheduleReconnect. The
          // error sink left behind absorbs the 'error' that terminate()
          // itself can provoke.
          this.abandonSocket(dead);
          dead.terminate();
          this.ws = null;
        }
        // Drive recovery directly. In some runtimes (Bun) terminate() does
        // not reliably fire 'close', which leaves _state stuck at 'connected'
        // while the socket is dead.
        this.handleClose(1006, 'ping timeout');
      }, pongTimeout);
    }, pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongDeadlineTimer) {
      clearTimeout(this.pongDeadlineTimer);
      this.pongDeadlineTimer = null;
    }
  }

  private waitForReconnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new ConnectionError(
          ErrorCode.CONNECTION_LOST,
          `Reconnection did not complete within ${this.options.requestTimeout}ms`,
        ));
      }, this.options.requestTimeout);

      const onConnected = () => {
        cleanup();
        resolve();
      };

      const onDisconnected = () => {
        cleanup();
        reject(new ConnectionError(
          ErrorCode.CONNECTION_LOST,
          'Connection lost during reconnection',
        ));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('connected', onConnected);
        this.off('disconnected', onDisconnected);
      };

      this.on('connected', onConnected);
      this.on('disconnected', onDisconnected);
    });
  }
}
