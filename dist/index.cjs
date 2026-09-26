"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AudioClipControl: () => AudioClipControl,
  ClipPriority: () => ClipPriority,
  ClipType: () => ClipType,
  CommandError: () => CommandError,
  ConnectionError: () => ConnectionError,
  ErrorCode: () => ErrorCode,
  FavoritesAccess: () => FavoritesAccess,
  HomeTheaterControl: () => HomeTheaterControl,
  NAMESPACE_EVENT_MAP: () => NAMESPACE_EVENT_MAP,
  PlaybackControl: () => PlaybackControl,
  PlaybackState: () => PlaybackState,
  PlayerHandle: () => PlayerHandle,
  PlaylistsAccess: () => PlaylistsAccess,
  QueueAction: () => QueueAction,
  SettingsControl: () => SettingsControl,
  SonosClient: () => SonosClient,
  SonosDiscovery: () => SonosDiscovery,
  SonosError: () => SonosError,
  SonosHousehold: () => SonosHousehold,
  TimeoutError: () => TimeoutError,
  VolumeControl: () => VolumeControl,
  consoleLogger: () => consoleLogger,
  noopLogger: () => noopLogger
});
module.exports = __toCommonJS(index_exports);

// src/client/SonosConnection.ts
var import_ws = __toESM(require("ws"), 1);

// src/util/TypedEventEmitter.ts
var import_node_events = require("events");
var TypedEventEmitter = class {
  emitter = new import_node_events.EventEmitter();
  /**
   * Register a listener for the given event. The listener is called every time the event fires.
   *
   * @param event - The event name to listen for.
   * @param listener - The callback to invoke when the event is emitted.
   * @returns This instance, for chaining.
   */
  on(event, listener) {
    this.emitter.on(event, listener);
    return this;
  }
  /**
   * Register a one-time listener for the given event. The listener is removed after it fires once.
   *
   * @param event - The event name to listen for.
   * @param listener - The callback to invoke once when the event is emitted.
   * @returns This instance, for chaining.
   */
  once(event, listener) {
    this.emitter.once(event, listener);
    return this;
  }
  /**
   * Remove a previously registered listener for the given event.
   *
   * @param event - The event name the listener was registered for.
   * @param listener - The callback to remove.
   * @returns This instance, for chaining.
   */
  off(event, listener) {
    this.emitter.off(event, listener);
    return this;
  }
  /**
   * Remove all listeners, optionally for a specific event only.
   *
   * @param event - If provided, only listeners for this event are removed. Otherwise, all listeners for all events are removed.
   * @returns This instance, for chaining.
   */
  removeAllListeners(event) {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }
  /**
   * Emit an event, invoking all registered listeners with the provided arguments.
   *
   * @param event - The event name to emit.
   * @param args - Arguments to pass to the listeners.
   * @returns `true` if the event had listeners, `false` otherwise.
   */
  emit(event, ...args) {
    return this.emitter.emit(event, ...args);
  }
  /**
   * Get the number of listeners currently registered for the given event.
   *
   * @param event - The event name to query.
   * @returns The number of registered listeners.
   */
  listenerCount(event) {
    return this.emitter.listenerCount(event);
  }
};

// src/util/logger.ts
var noopLogger = {
  error: () => {
  },
  warn: () => {
  },
  info: () => {
  },
  debug: () => {
  }
};
var consoleLogger = {
  error: (msg, ...args) => console.error(`[sonos-ws] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[sonos-ws] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[sonos-ws] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[sonos-ws] ${msg}`, ...args)
};

// src/types/errors.ts
var ErrorCode = /* @__PURE__ */ ((ErrorCode2) => {
  ErrorCode2["CONNECTION_FAILED"] = "CONNECTION_FAILED";
  ErrorCode2["CONNECTION_LOST"] = "CONNECTION_LOST";
  ErrorCode2["RECONNECT_EXHAUSTED"] = "RECONNECT_EXHAUSTED";
  ErrorCode2["REQUEST_TIMEOUT"] = "REQUEST_TIMEOUT";
  ErrorCode2["ERROR_MISSING_PARAMETERS"] = "ERROR_MISSING_PARAMETERS";
  ErrorCode2["ERROR_INVALID_SYNTAX"] = "ERROR_INVALID_SYNTAX";
  ErrorCode2["ERROR_UNSUPPORTED_NAMESPACE"] = "ERROR_UNSUPPORTED_NAMESPACE";
  ErrorCode2["ERROR_UNSUPPORTED_COMMAND"] = "ERROR_UNSUPPORTED_COMMAND";
  ErrorCode2["ERROR_INVALID_OBJECT_ID"] = "ERROR_INVALID_OBJECT_ID";
  ErrorCode2["ERROR_INVALID_PARAMETER"] = "ERROR_INVALID_PARAMETER";
  ErrorCode2["ERROR_COMMAND_FAILED"] = "ERROR_COMMAND_FAILED";
  ErrorCode2["ERROR_NOT_CAPABLE"] = "ERROR_NOT_CAPABLE";
  ErrorCode2["ERROR_NO_CONTENT"] = "ERROR_NO_CONTENT";
  ErrorCode2["PLAYER_NOT_FOUND"] = "PLAYER_NOT_FOUND";
  ErrorCode2["GROUP_OPERATION_FAILED"] = "GROUP_OPERATION_FAILED";
  return ErrorCode2;
})(ErrorCode || {});

// src/errors/SonosError.ts
var SonosError = class extends Error {
  /** The {@link ErrorCode} or Sonos API error string identifying what went wrong. */
  code;
  /** The Sonos API namespace where the error occurred (e.g. "groupVolume:1"). */
  namespace;
  /** The command that triggered the error (e.g. "setVolume"). */
  command;
  /** The unique command ID for correlating the error with its originating request. */
  cmdId;
  /**
   * @param code - Error code identifying the type of failure.
   * @param message - Human-readable error description.
   * @param options - Optional context about the command that caused the error.
   * @param options.namespace - Sonos API namespace (e.g. "playback:1").
   * @param options.command - Command name (e.g. "play").
   * @param options.cmdId - Unique command ID for request/response correlation.
   * @param options.cause - The underlying error that caused this one, if any.
   */
  constructor(code, message, options) {
    super(message, { cause: options?.cause });
    this.name = "SonosError";
    this.code = code;
    this.namespace = options?.namespace;
    this.command = options?.command;
    this.cmdId = options?.cmdId;
  }
};

// src/errors/TimeoutError.ts
var TimeoutError = class extends SonosError {
  /**
   * @param message - Human-readable description of the timeout.
   * @param options - Context about the command that timed out.
   * @param options.namespace - Sonos API namespace of the timed-out command.
   * @param options.command - Name of the timed-out command.
   * @param options.cmdId - Command ID for request/response correlation.
   */
  constructor(message, options) {
    super("REQUEST_TIMEOUT" /* REQUEST_TIMEOUT */, message, options);
    this.name = "TimeoutError";
  }
};

// src/client/MessageCorrelator.ts
var MessageCorrelator = class {
  pending = /* @__PURE__ */ new Map();
  timeout;
  /**
   * @param timeout - Maximum time in milliseconds to wait for a response
   *   before rejecting with a {@link TimeoutError}. Defaults to 5000.
   */
  constructor(timeout = 5e3) {
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
  register(cmdId, namespace, command) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(cmdId)) return;
        reject(
          new TimeoutError(`Request timed out after ${this.timeout}ms: ${namespace}.${command}`, {
            namespace,
            command,
            cmdId
          })
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
  resolve(cmdId, response) {
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
  reject(cmdId, error) {
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
  rejectAll(error) {
    for (const [cmdId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  /** Number of requests currently awaiting a response. */
  get pendingCount() {
    return this.pending.size;
  }
  /**
   * Clears all pending requests and their associated timers without
   * rejecting the promises. Use {@link rejectAll} if callers need to be
   * notified of cancellation.
   */
  dispose() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
};

// src/errors/ConnectionError.ts
var ConnectionError = class extends SonosError {
  /**
   * @param code - One of the connection-related {@link ErrorCode} values.
   * @param message - Human-readable description of the connection failure.
   * @param options - Optional context.
   * @param options.cause - The underlying error that caused the connection failure.
   */
  constructor(code, message, options) {
    super(code, message, options);
    this.name = "ConnectionError";
  }
};

// src/errors/CommandError.ts
var CommandError = class extends SonosError {
  /**
   * @param code - Sonos API error code string from the device response.
   * @param message - Human-readable error description from the device.
   * @param options - Context about the command that failed.
   * @param options.namespace - Sonos API namespace of the failed command.
   * @param options.command - Name of the failed command.
   * @param options.cmdId - Command ID for request/response correlation.
   * @param options.cause - The underlying error, if any.
   */
  constructor(code, message, options) {
    super(code, message, options);
    this.name = "CommandError";
  }
};

// src/client/SonosConnection.ts
var DEFAULT_CONNECT_TIMEOUT = 1e4;
function summarize(body) {
  try {
    const json = JSON.stringify(body) ?? String(body);
    return json.length > EVENT_BODY_LOG_LIMIT ? `${json.slice(0, EVENT_BODY_LOG_LIMIT)}\u2026` : json;
  } catch {
    return "[unserializable]";
  }
}
var EVENT_BODY_LOG_LIMIT = 300;
var SUB_PROTOCOL = "v1.api.smartspeaker.audio";
var API_KEY = "123e4567-e89b-12d3-a456-426655440000";
var SonosConnection = class extends TypedEventEmitter {
  ws = null;
  _state = "disconnected";
  correlator;
  options;
  log;
  connectPromise = null;
  /**
   * Rejecter for the in-flight {@link connectPromise}.
   *
   * Held on the instance because a socket can emit `'close'` without ever
   * emitting `'open'` or `'error'`, and only those two closures can settle
   * the promise. Without this, `handleClose` cannot unblock a caller.
   */
  connectReject = null;
  reconnectAttempt = 0;
  reconnectTimer = null;
  intentionalClose = false;
  pingTimer = null;
  pongDeadlineTimer = null;
  constructor(options) {
    super();
    this.options = options;
    this.log = options.logger ?? noopLogger;
    this.correlator = new MessageCorrelator(options.requestTimeout);
    this.on("error", (err) => {
      this.log.error(`Unhandled connection error: ${err.message}`);
    });
  }
  /** Current connection state. */
  get state() {
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
  async connect() {
    if (this._state === "connected") return;
    if (this.connectPromise) return this.connectPromise;
    this.intentionalClose = false;
    this._state = "connecting";
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectReject = reject;
      const url = `wss://${this.options.host}:${this.options.port}/websocket/api`;
      this.log.info(`Connecting to ${url}`);
      this.ws = new import_ws.default(url, SUB_PROTOCOL, {
        rejectUnauthorized: false,
        headers: {
          "X-Sonos-Api-Key": API_KEY
        }
      });
      const socket = this.ws;
      const onOpen = () => {
        cleanup();
        this._state = "connected";
        this.reconnectAttempt = 0;
        this.connectPromise = null;
        this.connectReject = null;
        socket.on("error", (err) => {
          this.log.error("WebSocket error", err.message);
          this.emit("error", err);
        });
        this.emit("connected");
        socket.on("pong", () => {
          if (this.pongDeadlineTimer) {
            clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
          }
        });
        this.startPing();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        this._state = "disconnected";
        this.connectPromise = null;
        this.connectReject = null;
        this.abandonSocket(socket);
        if (this.ws === socket) this.ws = null;
        const connErr = new ConnectionError(
          "CONNECTION_FAILED" /* CONNECTION_FAILED */,
          `Failed to connect: ${err.message}`,
          { cause: err }
        );
        this.emit("error", connErr);
        reject(connErr);
        if (this.options.reconnect.enabled && !this.intentionalClose) {
          this.scheduleReconnect();
        }
      };
      let handshakeTimer = null;
      const clearHandshakeTimer = () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
      };
      const cleanup = () => {
        clearHandshakeTimer();
        socket.removeListener("open", onOpen);
        socket.removeListener("error", onError);
      };
      const connectTimeout = this.options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
      handshakeTimer = setTimeout(() => {
        handshakeTimer = null;
        if (this.ws !== socket) return;
        onError(new Error(`handshake timed out after ${connectTimeout}ms`));
        socket.terminate();
      }, connectTimeout);
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.on("message", (data) => this.handleMessage(data));
      socket.on("close", (code, reason) => {
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
  async disconnect() {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    const rejectPending = this.connectReject;
    this.connectPromise = null;
    this.connectReject = null;
    rejectPending?.(new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Client disconnected"));
    this.correlator.rejectAll(
      new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Client disconnected")
    );
    this.stopPing();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      if (socket.readyState === import_ws.default.OPEN) {
        socket.close(1e3, "client disconnect");
        this.abandonSocket(socket);
      } else {
        this.abandonSocket(socket);
        socket.terminate();
      }
    }
    this._state = "disconnected";
    this.emit("disconnected", "client disconnect");
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
  async send(request) {
    if (this._state === "connecting" && this.connectPromise) {
      await this.connectPromise.catch(() => {
      });
    }
    if (this._state === "reconnecting") {
      await this.waitForReconnect();
    }
    if (!this.ws || this.ws.readyState !== import_ws.default.OPEN) {
      throw new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Not connected");
    }
    const [headers, body] = request;
    const { cmdId, namespace, command } = headers;
    if (!cmdId || !namespace || !command) {
      throw new Error("Request must include cmdId, namespace, and command");
    }
    const promise = this.correlator.register(cmdId, namespace, command);
    this.log.debug(`Sending ${namespace}.${command} @${this.options.host} [${cmdId}]`);
    this.ws.send(JSON.stringify(request));
    const response = await promise;
    const [resHeaders, resBody] = response;
    if (resHeaders.success === false) {
      const errorCode = resBody?.errorCode ?? resHeaders.type ?? resHeaders.response ?? "UNKNOWN";
      const reason = resBody?.reason ?? `Command failed: ${namespace}.${command}`;
      throw new CommandError(errorCode, reason, { namespace, command, cmdId, cause: response });
    }
    return response;
  }
  handleMessage(data) {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.log.warn("Received non-JSON message", data.toString().substring(0, 200));
      return;
    }
    if (!Array.isArray(parsed) || parsed.length < 2) {
      this.log.warn("Unexpected message format", data.toString().substring(0, 200));
      return;
    }
    const [headers, body] = parsed;
    const cmdId = headers?.cmdId;
    if (cmdId && this.correlator.resolve(cmdId, parsed)) {
      this.log.debug(`Response for ${headers.namespace}.${headers.command ?? headers.response} [${cmdId}]`);
      return;
    }
    this.log.debug(
      `Event: ${headers?.namespace}.${headers?.type ?? headers?.command} @${this.options.host} ${summarize(body)}`
    );
    this.emit("message", parsed);
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
  abandonSocket(ws) {
    ws.removeAllListeners();
    ws.on("error", (err) => {
      const message = err?.message;
      this.log.debug(
        `Ignoring error from abandoned socket: ${typeof message === "string" ? message : String(err)}`
      );
    });
  }
  handleClose(code, reason) {
    this.stopPing();
    this.log.info(`Connection closed: ${code} ${reason}`);
    this.correlator.rejectAll(
      new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, `Connection closed: ${code} ${reason}`)
    );
    if (this.connectPromise) {
      const rejectPending = this.connectReject;
      this.connectPromise = null;
      this.connectReject = null;
      rejectPending?.(
        new ConnectionError(
          "CONNECTION_LOST" /* CONNECTION_LOST */,
          `Connection closed before open: ${code} ${reason}`
        )
      );
    }
    if (this.intentionalClose) {
      this._state = "disconnected";
      this.emit("disconnected", reason);
      return;
    }
    if (this.options.reconnect.enabled) {
      this.scheduleReconnect();
    } else {
      this._state = "disconnected";
      this.emit("disconnected", reason);
    }
  }
  scheduleReconnect() {
    this.clearReconnectTimer();
    if (this.reconnectAttempt >= this.options.reconnect.maxAttempts) {
      this._state = "disconnected";
      const err = new ConnectionError(
        "RECONNECT_EXHAUSTED" /* RECONNECT_EXHAUSTED */,
        `Reconnection failed after ${this.reconnectAttempt} attempts`
      );
      this.emit("error", err);
      this.emit("disconnected", "reconnect exhausted");
      return;
    }
    this._state = "reconnecting";
    const delay = Math.min(
      this.options.reconnect.initialDelay * Math.pow(this.options.reconnect.factor, this.reconnectAttempt),
      this.options.reconnect.maxDelay
    );
    this.reconnectAttempt++;
    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.emit("reconnecting", this.reconnectAttempt, delay);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
      }
    }, delay);
  }
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  startPing() {
    const { pingInterval, pongTimeout } = this.options.reconnect;
    if (!pingInterval || !this.ws) return;
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== import_ws.default.OPEN) return;
      this.ws.ping();
      this.pongDeadlineTimer = setTimeout(() => {
        this.log.warn(`No pong received within ${pongTimeout}ms \u2014 terminating connection`);
        const dead = this.ws;
        if (dead) {
          this.abandonSocket(dead);
          dead.terminate();
          this.ws = null;
        }
        this.handleClose(1006, "ping timeout");
      }, pongTimeout);
    }, pingInterval);
  }
  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongDeadlineTimer) {
      clearTimeout(this.pongDeadlineTimer);
      this.pongDeadlineTimer = null;
    }
  }
  waitForReconnect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new ConnectionError(
          "CONNECTION_LOST" /* CONNECTION_LOST */,
          `Reconnection did not complete within ${this.options.requestTimeout}ms`
        ));
      }, this.options.requestTimeout);
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const onDisconnected = () => {
        cleanup();
        reject(new ConnectionError(
          "CONNECTION_LOST" /* CONNECTION_LOST */,
          "Connection lost during reconnection"
        ));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.off("connected", onConnected);
        this.off("disconnected", onDisconnected);
      };
      this.on("connected", onConnected);
      this.on("disconnected", onDisconnected);
    });
  }
};

// src/client/discoverHouseholdId.ts
var import_node_crypto = require("crypto");
async function discoverHouseholdId(connection) {
  try {
    const [headers] = await connection.send([
      { namespace: "groups:1", command: "getGroups", cmdId: (0, import_node_crypto.randomUUID)() },
      {}
    ]);
    return headers.householdId;
  } catch (err) {
    if (err instanceof Error && Array.isArray(err.cause)) {
      const [headers] = err.cause;
      return headers?.householdId;
    }
    return void 0;
  }
}

// src/types/events.ts
var NAMESPACE_EVENT_MAP = {
  "groupVolume:1": "volumeChanged",
  "playerVolume:1": "playerVolumeChanged",
  "groups:1": "groupsChanged",
  "playback:1": "playbackChanged",
  "playbackMetadata:1": "metadataChanged",
  "favorites:1": "favoritesChanged",
  "playlists:1": "playlistsChanged",
  "homeTheater:1": "homeTheaterChanged"
};

// src/util/eventSource.ts
function sourceOf(headers) {
  const source = {};
  if (headers?.playerId) source.playerId = headers.playerId;
  if (headers?.groupId) source.groupId = headers.groupId;
  return source;
}

// src/namespaces/BaseNamespace.ts
var import_node_crypto2 = require("crypto");
var BaseNamespace = class {
  /** The shared connection and ID context for this namespace. */
  context;
  subscribed = false;
  constructor(context) {
    this.context = context;
  }
  /**
   * Whether events for this namespace are wanted. An intent, not proof a subscription is live: a reconnect or a regroup
   * can drop it, and {@link resubscribe} puts it back.
   */
  get isSubscribed() {
    return this.subscribed;
  }
  /**
   * Subscribes to real-time events for this namespace.
   *
   * The intent is recorded before sending, so a failed attempt is retried by the next {@link resubscribe}; the promise still rejects.
   */
  async subscribe() {
    this.subscribed = true;
    await this.send("subscribe");
  }
  /**
   * Unsubscribes from real-time events for this namespace. The intent is dropped before sending.
   *
   * Sonos keeps one subscription per socket and target, so for a group-level namespace this also stops the events other
   * handles in the group asked for, until their next {@link resubscribe}.
   */
  async unsubscribe() {
    this.subscribed = false;
    await this.send("unsubscribe");
  }
  /**
   * Sends the subscribe again if events are wanted. Safe on a live subscription (Sonos keeps one per socket and target),
   * so owners call it after any change that may have dropped one.
   */
  async resubscribe() {
    if (this.subscribed) await this.send("subscribe");
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
  async send(command, bodyElements = {}) {
    const request = [
      {
        namespace: this.namespace,
        command,
        cmdId: (0, import_node_crypto2.randomUUID)(),
        householdId: this.context.getHouseholdId(),
        groupId: this.context.getGroupId(),
        playerId: this.context.getPlayerId()
      },
      bodyElements
    ];
    return this.context.connection.send(request);
  }
  /** Extract the body (second element) from a response. */
  body(response) {
    return response[1];
  }
};

// src/namespaces/GroupsNamespace.ts
var GroupsNamespace = class extends BaseNamespace {
  namespace = "groups:1";
  /**
   * Gets all groups and players in the household.
   *
   * @returns The complete list of groups, their member players, and all known players.
   */
  async getGroups() {
    const response = await this.send("getGroups");
    return this.body(response);
  }
  /**
   * Creates a new group from the specified player IDs.
   *
   * @param playerIds - The IDs of the players to include in the new group.
   * @returns The newly created group's details.
   */
  async createGroup(playerIds) {
    const response = await this.send("createGroup", { playerIds });
    return this.body(response);
  }
  /**
   * Adds or removes players from the current group.
   *
   * @param playerIdsToAdd - Player IDs to add to the group.
   * @param playerIdsToRemove - Player IDs to remove from the group.
   * @returns The modified group's details.
   */
  async modifyGroupMembers(playerIdsToAdd, playerIdsToRemove) {
    const body = {};
    if (playerIdsToAdd) body.playerIdsToAdd = playerIdsToAdd;
    if (playerIdsToRemove) body.playerIdsToRemove = playerIdsToRemove;
    const response = await this.send("modifyGroupMembers", body);
    return this.body(response);
  }
  /**
   * Replaces all members of the current group with the specified players.
   *
   * @param playerIds - The player IDs that should form the new membership of the group.
   */
  async setGroupMembers(playerIds) {
    await this.send("setGroupMembers", { playerIds });
  }
};

// src/namespaces/GroupVolumeNamespace.ts
var GroupVolumeNamespace = class extends BaseNamespace {
  namespace = "groupVolume:1";
  /**
   * Gets the current group volume level and mute status.
   *
   * @returns The current volume and mute state for the group.
   */
  async getVolume() {
    const response = await this.send("getVolume");
    return this.body(response);
  }
  /**
   * Sets the absolute group volume.
   *
   * @param volume - The desired volume level (0--100).
   */
  async setVolume(volume) {
    await this.send("setVolume", { volume });
  }
  /**
   * Adjusts the group volume by a relative amount.
   *
   * @param volumeDelta - The amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level after the adjustment.
   */
  async setRelativeVolume(volumeDelta) {
    const response = await this.send("setRelativeVolume", { volumeDelta });
    return this.body(response);
  }
  /**
   * Mutes or unmutes the entire group.
   *
   * @param muted - `true` to mute, `false` to unmute.
   */
  async setMute(muted) {
    await this.send("setMute", { muted });
  }
};

// src/namespaces/PlayerVolumeNamespace.ts
var PlayerVolumeNamespace = class extends BaseNamespace {
  namespace = "playerVolume:1";
  /**
   * Gets the current player volume level and mute status.
   *
   * @returns The current volume and mute state for this player.
   */
  async getVolume() {
    const response = await this.send("getVolume");
    return this.body(response);
  }
  /**
   * Sets the absolute player volume, optionally setting the mute state at the same time.
   *
   * @param volume - The desired volume level (0--100).
   * @param muted - If provided, simultaneously sets the mute state (`true` to mute, `false` to unmute).
   */
  async setVolume(volume, muted) {
    const body = { volume };
    if (muted !== void 0) body.muted = muted;
    await this.send("setVolume", body);
  }
  /**
   * Adjusts the player volume by a relative amount.
   *
   * @param volumeDelta - The amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level after the adjustment.
   */
  async setRelativeVolume(volumeDelta) {
    const response = await this.send("setRelativeVolume", { volumeDelta });
    return this.body(response);
  }
  /**
   * Mutes or unmutes the player.
   *
   * @param muted - `true` to mute, `false` to unmute.
   */
  async setMute(muted) {
    await this.send("setMute", { muted });
  }
};

// src/util/settleAll.ts
async function settleAll(tasks, message) {
  const results = await Promise.allSettled(tasks);
  const errors = results.flatMap((result) => {
    if (result.status === "fulfilled") return [];
    return result.reason instanceof AggregateError ? result.reason.errors : [result.reason];
  });
  if (errors.length > 0) throw new AggregateError(errors, message);
}

// src/player/VolumeControl.ts
var RELATIVE_EVENT_WAIT_MS = 2e3;
var VolumeControl = class {
  _group;
  _player;
  coordinatorContext;
  /**
   * @param speakerContext — for per-speaker volume (playerVolume:1)
   * @param coordinatorContext — for group volume (groupVolume:1), routed through the coordinator's connection
   */
  constructor(speakerContext, coordinatorContext) {
    this.coordinatorContext = coordinatorContext ?? speakerContext;
    this._group = new GroupVolumeNamespace(this.coordinatorContext);
    this._player = new PlayerVolumeNamespace(speakerContext);
  }
  // ── Individual speaker volume (default) ─────────────────────────────
  /** Gets the current volume and mute status for this speaker. */
  async get() {
    return this._player.getVolume();
  }
  /**
   * Sets the absolute volume for this speaker.
   * @param volume - Volume level (0–100).
   * @param muted - Optionally set mute state simultaneously.
   */
  async set(volume, muted) {
    return this._player.setVolume(volume, muted);
  }
  /**
   * Adjusts this speaker's volume by a relative amount.
   * @param delta - Amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level.
   */
  async relative(delta) {
    return this._player.setRelativeVolume(delta);
  }
  /**
   * Mutes or unmutes this individual speaker.
   * @param muted - `true` to mute, `false` to unmute.
   */
  async mute(muted) {
    return this._player.setMute(muted);
  }
  /** Subscribes to per-speaker volume events. */
  async subscribe() {
    return this._player.subscribe();
  }
  /** Unsubscribes from per-speaker volume events. */
  async unsubscribe() {
    return this._player.unsubscribe();
  }
  /**
   * Re-sends the player and group volume subscriptions that are wanted.
   * @internal
   */
  async resubscribe() {
    await settleAll([this._player.resubscribe(), this._group.resubscribe()], "Failed to restore volume subscriptions");
  }
  // ── Group volume ────────────────────────────────────────────────────
  /**
   * Group volume control.
   * Controls all speakers in this player's group proportionally.
   * Automatically routes through the group coordinator's connection.
   */
  group = {
    /** Gets the current group volume level and mute status. */
    get: () => {
      return this._group.getVolume();
    },
    /**
     * Sets the absolute group volume.
     * @param volume - Volume level (0–100).
     */
    set: (volume) => {
      return this._group.setVolume(volume);
    },
    /**
     * Adjusts the group volume by a relative amount.
     * @param delta - Amount to adjust (positive to increase, negative to decrease).
     * @returns The resulting group volume status after the adjustment.
     */
    relative: async (delta) => {
      const conn = this.coordinatorContext.connection;
      const groupId = this.coordinatorContext.getGroupId();
      let resolve;
      let reject;
      const result = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      let settled = false;
      let timer;
      const handler = (msg) => {
        const [headers, body] = msg;
        if (headers?.namespace === "groupVolume:1" && headers.groupId === groupId && body?._objectType === "groupVolume") {
          settled = true;
          stopWaiting();
          resolve(body);
        }
      };
      const stopWaiting = () => {
        clearTimeout(timer);
        conn.off("message", handler);
      };
      conn.on("message", handler);
      try {
        await this._group.setRelativeVolume(delta);
      } catch (err) {
        stopWaiting();
        throw err;
      }
      if (!settled) {
        timer = setTimeout(() => {
          stopWaiting();
          this._group.getVolume().then(resolve, reject);
        }, RELATIVE_EVENT_WAIT_MS);
      }
      return result;
    },
    /**
     * Mutes or unmutes the entire group.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute: (muted) => {
      return this._group.setMute(muted);
    },
    /** Subscribes to group volume change events. */
    subscribe: () => {
      return this._group.subscribe();
    },
    /** Unsubscribes from group volume events. */
    unsubscribe: () => {
      return this._group.unsubscribe();
    }
  };
};

// src/namespaces/PlaybackNamespace.ts
var PlaybackNamespace = class extends BaseNamespace {
  namespace = "playback:1";
  /** Starts or resumes playback for the group. */
  async play() {
    await this.send("play");
  }
  /** Pauses playback for the group. */
  async pause() {
    await this.send("pause");
  }
  /** Toggles between play and pause for the group. */
  async togglePlayPause() {
    await this.send("togglePlayPause");
  }
  /** Stops playback entirely for the group. */
  async stop() {
    await this.send("stop");
  }
  /** Skips to the next track in the queue. */
  async skipToNextTrack() {
    await this.send("skipToNextTrack");
  }
  /** Skips to the previous track in the queue. */
  async skipToPreviousTrack() {
    await this.send("skipToPreviousTrack");
  }
  /**
   * Seeks to an absolute position in the current track.
   *
   * @param positionMillis - The target position in milliseconds from the start of the track.
   */
  async seek(positionMillis) {
    await this.send("seek", { positionMillis });
  }
  /**
   * Seeks forward or backward by a relative amount in the current track.
   *
   * @param deltaMillis - The offset in milliseconds (positive to seek forward, negative to seek backward).
   */
  async seekRelative(deltaMillis) {
    await this.send("seekRelative", { deltaMillis });
  }
  /**
   * Gets the current playback state, track position, and play modes.
   *
   * @returns The current playback status for the group.
   */
  async getPlaybackStatus() {
    const response = await this.send("getPlaybackStatus");
    return this.body(response);
  }
  /**
   * Sets the play modes for the group (shuffle, repeat, crossfade).
   *
   * @param playModes - An object containing the play mode properties to update.
   */
  async setPlayModes(playModes) {
    await this.send("setPlayModes", { playModes });
  }
  /**
   * Switches playback to a line-in source.
   *
   * @param options - Optional configuration for the line-in source.
   */
  async loadLineIn(options) {
    await this.send("loadLineIn", { ...options });
  }
};

// src/namespaces/PlaybackMetadataNamespace.ts
var PlaybackMetadataNamespace = class extends BaseNamespace {
  namespace = "playbackMetadata:1";
  /**
   * Gets metadata for the current track, its container, and the next queued item.
   *
   * @returns The metadata status including current track info, container details, and next item.
   */
  async getMetadataStatus() {
    const response = await this.send("getMetadataStatus");
    return this.body(response);
  }
};

// src/player/PlaybackControl.ts
var PlaybackControl = class {
  pb;
  meta;
  constructor(context) {
    this.pb = new PlaybackNamespace(context);
    this.meta = new PlaybackMetadataNamespace(context);
  }
  /** Starts or resumes playback. */
  async play() {
    return this.pb.play();
  }
  /** Pauses playback. */
  async pause() {
    return this.pb.pause();
  }
  /** Toggles between play and pause. */
  async togglePlayPause() {
    return this.pb.togglePlayPause();
  }
  /** Stops playback entirely. */
  async stop() {
    return this.pb.stop();
  }
  /** Skips to the next track in the queue. */
  async skipToNextTrack() {
    return this.pb.skipToNextTrack();
  }
  /** Skips to the previous track. */
  async skipToPreviousTrack() {
    return this.pb.skipToPreviousTrack();
  }
  /**
   * Seeks to an absolute position in the current track.
   * @param positionMillis - Position in milliseconds.
   */
  async seek(positionMillis) {
    return this.pb.seek(positionMillis);
  }
  /**
   * Seeks forward or backward by a relative amount.
   * @param deltaMillis - Amount in milliseconds (positive = forward, negative = backward).
   */
  async seekRelative(deltaMillis) {
    return this.pb.seekRelative(deltaMillis);
  }
  /** Gets the current playback state, position, and play modes. */
  async getStatus() {
    return this.pb.getPlaybackStatus();
  }
  /**
   * Sets shuffle, repeat, crossfade modes.
   * @param modes - Partial play modes to update.
   */
  async setPlayModes(modes) {
    return this.pb.setPlayModes(modes);
  }
  /**
   * Switches playback to a line-in source.
   * @param options - Optional line-in configuration.
   */
  async loadLineIn(options) {
    return this.pb.loadLineIn(options);
  }
  /** Gets metadata for the current track, container, and next item. */
  async getMetadata() {
    return this.meta.getMetadataStatus();
  }
  /** Subscribes to playback state change events. */
  async subscribe() {
    await this.pb.subscribe();
  }
  /** Unsubscribes from playback state events. */
  async unsubscribe() {
    await this.pb.unsubscribe();
  }
  /** Subscribes to track metadata events — separate from {@link subscribe} because they are large and frequent. */
  async subscribeMetadata() {
    await this.meta.subscribe();
  }
  /** Unsubscribes from track metadata events. */
  async unsubscribeMetadata() {
    await this.meta.unsubscribe();
  }
  /**
   * Re-sends the playback and metadata subscriptions that are wanted.
   * @internal
   */
  async resubscribe() {
    await settleAll([this.pb.resubscribe(), this.meta.resubscribe()], "Failed to restore playback subscriptions");
  }
};

// src/namespaces/FavoritesNamespace.ts
var FavoritesNamespace = class extends BaseNamespace {
  namespace = "favorites:1";
  /**
   * Retrieves the list of Sonos favorites.
   *
   * @returns The favorites collection including item details and version info.
   */
  async getFavorites() {
    const response = await this.send("getFavorites");
    return this.body(response);
  }
  /**
   * Loads a favorite into the queue and optionally begins playback.
   *
   * @param favoriteId - The ID of the favorite to load.
   * @param options - Optional playback and queue behavior settings.
   */
  async loadFavorite(favoriteId, options) {
    await this.send("loadFavorite", { favoriteId, ...options });
  }
};

// src/player/FavoritesAccess.ts
var FavoritesAccess = class {
  ns;
  groupNs;
  /**
   * @param context — for reading favorites, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context, coordinatorContext = context) {
    this.ns = new FavoritesNamespace(context);
    this.groupNs = new FavoritesNamespace(coordinatorContext);
  }
  /** Retrieves the list of Sonos favorites. */
  async get() {
    return this.ns.getFavorites();
  }
  /**
   * Loads a favorite into the queue.
   * @param id - Favorite ID.
   * @param options - Queue action and playback options.
   */
  async load(id, options) {
    return this.groupNs.loadFavorite(id, options);
  }
};

// src/namespaces/PlaylistsNamespace.ts
var PlaylistsNamespace = class extends BaseNamespace {
  namespace = "playlists:1";
  /**
   * Retrieves all Sonos playlists.
   *
   * @returns The list of available playlists.
   */
  async getPlaylists() {
    const response = await this.send("getPlaylists");
    return this.body(response);
  }
  /**
   * Retrieves a specific playlist with its tracks.
   *
   * @param playlistId - The ID of the playlist to retrieve.
   * @returns The playlist details including its track listing.
   */
  async getPlaylist(playlistId) {
    const response = await this.send("getPlaylist", { playlistId });
    return this.body(response);
  }
  /**
   * Loads a playlist into the queue and optionally begins playback.
   *
   * @param playlistId - The ID of the playlist to load.
   * @param options - Optional playback and queue behavior settings.
   */
  async loadPlaylist(playlistId, options) {
    await this.send("loadPlaylist", { playlistId, ...options });
  }
};

// src/player/PlaylistsAccess.ts
var PlaylistsAccess = class {
  ns;
  groupNs;
  /**
   * @param context — for reading playlists, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context, coordinatorContext = context) {
    this.ns = new PlaylistsNamespace(context);
    this.groupNs = new PlaylistsNamespace(coordinatorContext);
  }
  /** Retrieves all Sonos playlists. */
  async get() {
    return this.ns.getPlaylists();
  }
  /**
   * Retrieves a specific playlist with its tracks.
   * @param id - Playlist ID.
   */
  async getPlaylist(id) {
    return this.ns.getPlaylist(id);
  }
  /**
   * Loads a playlist into the queue.
   * @param id - Playlist ID.
   * @param options - Playback options.
   */
  async load(id, options) {
    return this.groupNs.loadPlaylist(id, options);
  }
};

// src/namespaces/AudioClipNamespace.ts
var AudioClipNamespace = class extends BaseNamespace {
  namespace = "audioClip:1";
  /**
   * Plays an audio clip with the specified options.
   *
   * The clip is mixed on top of any currently playing audio and does not
   * affect the playback queue.
   *
   * @param options - Configuration for the audio clip (URL, volume, priority, etc.).
   * @returns Details about the queued audio clip, including its clip ID.
   */
  async loadAudioClip(options) {
    const response = await this.send("loadAudioClip", options);
    return this.body(response);
  }
  /**
   * Cancels a currently playing audio clip.
   *
   * @param clipId - The ID of the audio clip to cancel.
   */
  async cancelAudioClip(clipId) {
    await this.send("cancelAudioClip", { id: clipId });
  }
};

// src/player/AudioClipControl.ts
var AudioClipControl = class {
  ns;
  constructor(context) {
    this.ns = new AudioClipNamespace(context);
  }
  /**
   * Plays an audio clip.
   * @param options - Clip configuration (name, appId, streamUrl, priority, volume).
   */
  async load(options) {
    return this.ns.loadAudioClip(options);
  }
  /**
   * Cancels a currently playing audio clip.
   * @param clipId - ID of the clip to cancel.
   */
  async cancel(clipId) {
    return this.ns.cancelAudioClip(clipId);
  }
};

// src/namespaces/HomeTheaterNamespace.ts
var HomeTheaterNamespace = class extends BaseNamespace {
  namespace = "homeTheater:1";
  /**
   * Gets the current home theater settings.
   *
   * @returns The current home theater options (night mode, dialog enhancement, etc.).
   */
  async getOptions() {
    const response = await this.send("getOptions");
    return this.body(response);
  }
  /**
   * Updates home theater settings.
   *
   * Only the properties included in the options object are changed;
   * omitted properties remain at their current values.
   *
   * @param options - The home theater settings to update.
   */
  async setOptions(options) {
    await this.send("setOptions", options);
  }
};

// src/player/HomeTheaterControl.ts
var HomeTheaterControl = class {
  ns;
  constructor(context) {
    this.ns = new HomeTheaterNamespace(context);
  }
  /** Subscribes to home theater events (input/source and HT state changes). */
  async subscribe() {
    await this.ns.subscribe();
  }
  /** Unsubscribes from home theater events. */
  async unsubscribe() {
    await this.ns.unsubscribe();
  }
  /**
   * Re-sends the home theater subscription if it is wanted.
   * @internal
   */
  async resubscribe() {
    await this.ns.resubscribe();
  }
  /** Gets the current home theater settings. */
  async get() {
    return this.ns.getOptions();
  }
  /**
   * Updates home theater settings.
   * @param options - Settings to update (nightMode, enhanceDialog).
   */
  async set(options) {
    return this.ns.setOptions(options);
  }
};

// src/namespaces/SettingsNamespace.ts
var SettingsNamespace = class extends BaseNamespace {
  namespace = "settings:1";
  /**
   * Gets the current player settings.
   *
   * @returns The player's current settings.
   */
  async getPlayerSettings() {
    const response = await this.send("getPlayerSettings");
    return this.body(response);
  }
  /**
   * Updates player settings.
   *
   * Only the properties included in the settings object are changed;
   * omitted properties remain at their current values.
   *
   * @param settings - The player settings to update.
   */
  async setPlayerSettings(settings) {
    await this.send("setPlayerSettings", settings);
  }
};

// src/player/SettingsControl.ts
var SettingsControl = class {
  ns;
  constructor(context) {
    this.ns = new SettingsNamespace(context);
  }
  /** Gets the current player settings. */
  async get() {
    return this.ns.getPlayerSettings();
  }
  /**
   * Updates player settings.
   * @param settings - Settings to update.
   */
  async set(settings) {
    return this.ns.setPlayerSettings(settings);
  }
};

// src/player/PlayerHandle.ts
var PlayerHandle = class {
  /** RINCON player ID. */
  id;
  /** Display name (e.g. "Arc", "Office"). */
  name;
  /** Player capabilities from the Sonos API. */
  capabilities;
  _group;
  householdId;
  _speakerConnection;
  _coordinatorConnectionResolver;
  /** Unified volume control (group volume + per-speaker volume). */
  volume;
  /** Playback and metadata control. */
  playback;
  /** Sonos favorites. */
  favorites;
  /** Sonos playlists. */
  playlists;
  /** Audio clip playback. */
  audioClip;
  /** Home theater settings. */
  homeTheater;
  /** Player settings. */
  settings;
  /** Raw group operations (used internally by SonosHousehold for grouping). */
  groups;
  constructor(player, group, householdId, speakerConnection, groupsConnection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;
    this._speakerConnection = speakerConnection;
    const self = this;
    const speakerContext = {
      get connection() {
        return self._speakerConnection;
      },
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id
    };
    const groupsContext = {
      connection: groupsConnection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id
    };
    const coordinatorContext = {
      get connection() {
        if (self._coordinatorConnectionResolver) {
          return self._coordinatorConnectionResolver();
        }
        return self._speakerConnection;
      },
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id
    };
    this.volume = new VolumeControl(speakerContext, coordinatorContext);
    this.playback = new PlaybackControl(coordinatorContext);
    this.favorites = new FavoritesAccess(speakerContext, coordinatorContext);
    this.playlists = new PlaylistsAccess(speakerContext, coordinatorContext);
    this.audioClip = new AudioClipControl(speakerContext);
    this.homeTheater = new HomeTheaterControl(speakerContext);
    this.settings = new SettingsControl(speakerContext);
    this.groups = new GroupsNamespace(groupsContext);
  }
  /**
   * Updates the speaker connection for this handle.
   * Called by SonosHousehold after establishing per-speaker connections.
   * @internal
   */
  setSpeakerConnection(connection) {
    this._speakerConnection = connection;
  }
  /**
   * Sets a resolver that returns the coordinator's connection for this player's group.
   * Used for group-level commands, which must go through the coordinator's WebSocket.
   * @internal
   */
  setCoordinatorConnectionResolver(resolver) {
    this._coordinatorConnectionResolver = resolver;
  }
  /** Current group ID this player belongs to. Updated automatically on topology changes. */
  get groupId() {
    return this._group.id;
  }
  /** Whether this player is the coordinator of its current group. */
  get isCoordinator() {
    return this._group.coordinatorId === this.id;
  }
  /** RINCON ID of the coordinator of this player's current group. */
  get coordinatorId() {
    return this._group.coordinatorId;
  }
  /**
   * Updates the group this player belongs to.
   * Called internally by SonosHousehold when topology changes.
   * @internal
   */
  updateGroup(group) {
    this._group = group;
  }
  /**
   * Re-sends every subscription this handle wants, each through the socket it now belongs on.
   * Tries them all, then rejects with an AggregateError of the failures.
   * @internal
   */
  async resubscribe() {
    await settleAll(
      [this.volume.resubscribe(), this.playback.resubscribe(), this.homeTheater.resubscribe(), this.groups.resubscribe()],
      `Failed to restore event subscriptions for ${this.name}`
    );
  }
};

// src/household/TopologySnapshot.ts
var TopologySnapshot = class {
  groups;
  players;
  constructor(response) {
    this.groups = response.groups;
    this.players = response.players;
  }
  /** Finds the group containing a player. */
  findGroupOf(playerId) {
    return this.groups.find((g) => g.playerIds.includes(playerId));
  }
  /** Returns the coordinator ID for a player's group. */
  coordinatorOf(playerId) {
    return this.findGroupOf(playerId)?.coordinatorId;
  }
  /** Whether a player is the only member of its group. */
  isAloneInGroup(playerId) {
    const group = this.findGroupOf(playerId);
    return group !== void 0 && group.playerIds.length === 1;
  }
};

// src/household/GroupingEngine.ts
var POLL_INTERVAL_MS = 200;
var POLL_DEADLINE_MS = 8e3;
var GroupingEngine = class {
  constructor(householdGroups, refreshTopology, players, log) {
    this.householdGroups = householdGroups;
    this.refreshTopology = refreshTopology;
    this.players = players;
    this.log = log;
  }
  householdGroups;
  refreshTopology;
  players;
  log;
  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   */
  async group(playerHandles, options) {
    if (playerHandles.length === 0) {
      throw new SonosError("ERROR_INVALID_PARAMETER" /* ERROR_INVALID_PARAMETER */, "group() requires at least one player");
    }
    let snap = await this.refreshAndSnapshot();
    if (playerHandles.length === 1) {
      const player = playerHandles[0];
      if (options?.transfer) {
        const audioSource2 = this.resolveAudioSourceExcluding(player.id, options.transfer, snap);
        if (audioSource2) {
          await this.transferAudio(audioSource2, player, [player.id]);
          await this.refreshAndSnapshot();
          return;
        }
      }
      if (snap.isAloneInGroup(player.id)) return;
      const playerGroup = snap.findGroupOf(player.id);
      if (playerGroup && playerGroup.coordinatorId === player.id && playerGroup.playerIds.length > 1) {
        const othersToRemove = playerGroup.playerIds.filter((id) => id !== player.id);
        for (const otherId of othersToRemove) {
          await this.householdGroups.createGroup([otherId]);
        }
      } else {
        await this.householdGroups.createGroup([player.id]);
      }
      await this.refreshAndSnapshot();
      return;
    }
    const coordinator = playerHandles[0];
    const memberIds = playerHandles.map((p) => p.id);
    if (this.isAlreadyGrouped(coordinator.id, memberIds, snap) && !options?.transfer) {
      return;
    }
    let audioSource;
    if (options?.transfer) {
      audioSource = this.resolveAudioSource(playerHandles, options.transfer, snap);
    }
    if (audioSource && audioSource.id !== coordinator.id) {
      if (memberIds.includes(audioSource.id)) {
        this.log.info(`Audio source "${audioSource.name}" is in target group \u2014 using as coordinator to preserve audio`);
        await this.simpleGroup(audioSource, memberIds);
      } else if (typeof options?.transfer === "object") {
        this.log.info(`Transferring audio from "${audioSource.name}" to "${coordinator.name}"`);
        await this.transferAudio(audioSource, coordinator, memberIds);
      } else {
        this.log.info(`Audio on "${audioSource.name}" (not in target group) \u2014 grouping without transfer`);
        await this.simpleGroup(coordinator, memberIds);
      }
    } else {
      await this.simpleGroup(coordinator, memberIds);
    }
    await this.refreshAndSnapshot();
  }
  /** Removes a player from its current group. No-op if already solo. */
  async ungroup(player) {
    const snap = await this.refreshAndSnapshot();
    if (snap.isAloneInGroup(player.id)) return;
    await this.householdGroups.createGroup([player.id]);
    await this.refreshAndSnapshot();
  }
  /** Ungroups all players in the household. */
  async ungroupAll() {
    const snap = await this.refreshAndSnapshot();
    const multiPlayerGroups = snap.groups.filter((g) => g.playerIds.length > 1);
    for (const group of multiPlayerGroups) {
      for (const playerId of group.playerIds) {
        if (playerId !== group.coordinatorId) {
          await this.householdGroups.createGroup([playerId]);
        }
      }
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshAndSnapshot();
    }
  }
  // ── Private helpers ─────────────────────────────────────────────────────
  isAlreadyGrouped(coordinatorId, memberIds, snap) {
    const group = snap.findGroupOf(coordinatorId);
    return group !== void 0 && group.coordinatorId === coordinatorId && group.playerIds.length === memberIds.length && memberIds.every((id) => group.playerIds.includes(id));
  }
  resolveAudioSource(targetPlayers, transfer, snap) {
    if (typeof transfer === "object") {
      const source = this.players.get(transfer.id);
      if (!source) {
        throw new SonosError("PLAYER_NOT_FOUND" /* PLAYER_NOT_FOUND */, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup || sourceGroup.playbackState !== "PLAYBACK_STATE_PLAYING" && sourceGroup.playbackState !== "PLAYBACK_STATE_PAUSED") {
        throw new SonosError("ERROR_NO_CONTENT" /* ERROR_NO_CONTENT */, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }
    const targetIds = new Set(targetPlayers.map((p) => p.id));
    for (const phase of ["PLAYBACK_STATE_PLAYING", "PLAYBACK_STATE_PAUSED"]) {
      for (const player of targetPlayers) {
        const group = snap.findGroupOf(player.id);
        if (group?.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          return coord ?? player;
        }
      }
      for (const group of snap.groups) {
        if (group.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          if (coord && !targetIds.has(coord.id)) return coord;
        }
      }
    }
    return void 0;
  }
  /**
   * Like resolveAudioSource but skips a specific player.
   * Used for single-player transfer where the target player's own audio
   * is not what we want — we're looking for audio on OTHER speakers.
   */
  resolveAudioSourceExcluding(excludePlayerId, transfer, snap) {
    if (typeof transfer === "object") {
      const source = this.players.get(transfer.id);
      if (!source) {
        throw new SonosError("PLAYER_NOT_FOUND" /* PLAYER_NOT_FOUND */, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = snap.findGroupOf(source.id);
      if (!sourceGroup || sourceGroup.playbackState !== "PLAYBACK_STATE_PLAYING" && sourceGroup.playbackState !== "PLAYBACK_STATE_PAUSED") {
        throw new SonosError("ERROR_NO_CONTENT" /* ERROR_NO_CONTENT */, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }
    for (const phase of ["PLAYBACK_STATE_PLAYING", "PLAYBACK_STATE_PAUSED"]) {
      for (const group of snap.groups) {
        if (group.playbackState === phase) {
          const coord = this.players.get(group.coordinatorId);
          if (coord && coord.id !== excludePlayerId) return coord;
        }
      }
    }
    return void 0;
  }
  async simpleGroup(coordinator, memberIds) {
    let snap = await this.refreshAndSnapshot();
    const currentGroup = snap.findGroupOf(coordinator.id);
    if (!currentGroup) return;
    if (currentGroup.coordinatorId !== coordinator.id) {
      await this.householdGroups.createGroup([coordinator.id]);
      await this.pollUntil(
        (res) => res.groups.some((g) => g.coordinatorId === coordinator.id && g.playerIds.length === 1)
      );
      snap = await this.refreshAndSnapshot();
    }
    await this.withRetry(async () => {
      const retrySnap = await this.refreshAndSnapshot();
      const coordGroup = retrySnap.findGroupOf(coordinator.id);
      if (!coordGroup) return;
      const toAdd = memberIds.filter((id) => id !== coordinator.id && !coordGroup.playerIds.includes(id));
      const toRemove = coordGroup.playerIds.filter((id) => id !== coordinator.id && !memberIds.includes(id));
      if (toAdd.length > 0 || toRemove.length > 0) {
        await coordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : void 0,
          toRemove.length > 0 ? toRemove : void 0
        );
      }
    });
  }
  async transferAudio(source, targetCoordinator, allMemberIds) {
    let snap = await this.refreshAndSnapshot();
    const sourceGroup = snap.findGroupOf(source.id);
    if (!sourceGroup) {
      throw new SonosError("GROUP_OPERATION_FAILED" /* GROUP_OPERATION_FAILED */, `Cannot find group for source "${source.name}"`);
    }
    const sourceCoord = this.players.get(sourceGroup.coordinatorId);
    if (!sourceCoord) {
      throw new SonosError("GROUP_OPERATION_FAILED" /* GROUP_OPERATION_FAILED */, `Cannot find coordinator for source group`);
    }
    if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
      await this.withRetry(async () => {
        await sourceCoord.groups.modifyGroupMembers([targetCoordinator.id]);
      });
    }
    try {
      await sourceCoord.groups.modifyGroupMembers([], [sourceCoord.id]);
    } catch (err) {
      if (this.isExpectedShuffleError(err)) {
        this.log.debug("Coordinator shuffle initiated (expected error)");
      } else {
        throw err;
      }
    }
    const settled = await this.pollUntil(
      (res) => res.groups.some((g) => g.coordinatorId === targetCoordinator.id)
    );
    if (!settled) {
      this.log.warn(`Coordinator shuffle did not settle within ${POLL_DEADLINE_MS}ms`);
    }
    await this.withRetry(async () => {
      const freshSnap = await this.refreshAndSnapshot();
      const targetGroup = freshSnap.findGroupOf(targetCoordinator.id);
      if (!targetGroup) return;
      const toAdd = allMemberIds.filter((id) => id !== targetCoordinator.id && !targetGroup.playerIds.includes(id));
      const toRemove = targetGroup.playerIds.filter((id) => id !== targetCoordinator.id && !allMemberIds.includes(id));
      if (toAdd.length > 0 || toRemove.length > 0) {
        await targetCoordinator.groups.modifyGroupMembers(
          toAdd.length > 0 ? toAdd : void 0,
          toRemove.length > 0 ? toRemove : void 0
        );
      }
    });
  }
  /**
   * Polls getGroups until a condition is met or the deadline passes.
   * The return value is a readiness signal only — authoritative state
   * comes from the subsequent refreshAndSnapshot().
   */
  async pollUntil(condition, deadlineMs = POLL_DEADLINE_MS, intervalMs = POLL_INTERVAL_MS) {
    const start = Date.now();
    while (true) {
      try {
        const response = await this.householdGroups.getGroups();
        if (condition(response)) return response;
      } catch {
      }
      const elapsed = Date.now() - start;
      if (elapsed >= deadlineMs) return null;
      await new Promise((r) => setTimeout(r, Math.min(intervalMs, deadlineMs - elapsed)));
    }
  }
  /**
   * Wraps a function that can fail with a stale groupId.
   * On `groupCoordinatorChanged`, refreshes topology (updating handle
   * closures) and retries exactly once.
   */
  async withRetry(fn) {
    try {
      await fn();
    } catch (err) {
      if (err instanceof CommandError && err.code === "groupCoordinatorChanged") {
        this.log.debug("groupCoordinatorChanged \u2014 refreshing topology and retrying");
        await this.refreshAndSnapshot();
        await fn();
      } else {
        throw err;
      }
    }
  }
  isExpectedShuffleError(err) {
    return err instanceof CommandError && err.code === "groupCoordinatorChanged" || err instanceof TimeoutError;
  }
  async refreshAndSnapshot() {
    const response = await this.refreshTopology();
    return new TopologySnapshot(response);
  }
};

// src/household/SonosHousehold.ts
var DEFAULT_RECONNECT = {
  enabled: true,
  initialDelay: 1e3,
  maxDelay: 3e4,
  factor: 2,
  maxAttempts: Infinity,
  pingInterval: 3e4,
  pongTimeout: 1e4
};
var TOPOLOGY_EVENT_DEBOUNCE_MS = 250;
var SonosHousehold = class extends TypedEventEmitter {
  connection;
  log;
  _players = /* @__PURE__ */ new Map();
  _groups = [];
  _rawPlayers = [];
  _householdId;
  _initialConnectDone = false;
  _lastTopologyKey = "";
  /** Group IDs, coordinators and members, without playback state. */
  _lastMembershipKey = "";
  /** Pending debounced topology re-read, armed by groups:1 events. */
  topologyRefreshTimer = null;
  /** Setup runs, chained so each starts after the previous one settles: a flap mid-setup must not run two at once. */
  setupChain = Promise.resolve();
  /** Handshakes a connect() call is awaiting: their setup is that call's to run, not the 'connected' listener's. */
  ownedHandshakes = 0;
  /** Counts primary 'connected' events, so a completed setup can be matched to the socket it ran on. */
  primaryEpoch = 0;
  /** The primaryEpoch the last completed setup started under. */
  setupEpoch = -1;
  /** Set up on the socket that is up now, not merely set up once. */
  get setUpOnCurrentSocket() {
    return this._initialConnectDone && this.setupEpoch === this.primaryEpoch;
  }
  /** Per-speaker WebSocket connections. Key is player ID. */
  speakerConnections = /* @__PURE__ */ new Map();
  primaryHost;
  reconnectOptions;
  requestTimeoutMs;
  autoConnectSpeakers;
  /** Household-scoped GroupsNamespace for createGroup calls (no groupId/playerId). */
  householdGroups;
  engine;
  constructor(options) {
    super();
    this.log = options.logger ?? noopLogger;
    this.primaryHost = options.host;
    this.reconnectOptions = resolveReconnectOptions(options.reconnect);
    this.requestTimeoutMs = options.requestTimeout ?? 12e4;
    this.autoConnectSpeakers = options.autoConnect ?? true;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log
    });
    const householdContext = {
      connection: this.connection,
      getHouseholdId: () => this._householdId,
      getGroupId: () => void 0,
      getPlayerId: () => void 0
    };
    this.householdGroups = new GroupsNamespace(householdContext);
    this.engine = new GroupingEngine(
      this.householdGroups,
      () => this.refreshTopology(),
      this._players,
      this.log
    );
    this.on("error", (err) => {
      this.log.error(`Unhandled household error: ${err.message}`);
    });
    this.connection.on("connected", () => this.onPrimaryConnected());
    this.connection.on("disconnected", (r) => this.emit("disconnected", r));
    this.connection.on("reconnecting", (a, d) => this.emit("reconnecting", a, d));
    this.connection.on("error", (e) => this.emit("error", e));
    this.connection.on("message", (msg) => this.handleMessage(msg));
  }
  /** All discovered players in the household, keyed by RINCON player ID. */
  get players() {
    return this._players;
  }
  /** All current groups in the household. */
  get groups() {
    return this._groups;
  }
  /** The Sonos household ID. */
  get householdId() {
    return this._householdId;
  }
  /** Whether the WebSocket connection is currently open. */
  get connected() {
    return this.connection.state === "connected";
  }
  /**
   * Connects to the Sonos speaker and discovers the household topology.
   * Populates {@link players} and {@link groups}.
   */
  async connect() {
    if (this.setUpOnCurrentSocket && this.connection.state === "connected") return;
    if (this.connection.state !== "connected") this._initialConnectDone = false;
    this.ownedHandshakes++;
    try {
      await this.connection.connect();
    } finally {
      this.ownedHandshakes--;
    }
    await this.enqueueSetup(() => this.setUpOnCurrentSocket ? Promise.resolve() : this.handleReconnected());
  }
  /** Sets up after a handshake no connect() call awaits: the reconnect ladder's. Returns the run so tests can await it. */
  onPrimaryConnected() {
    this.primaryEpoch++;
    if (this.ownedHandshakes > 0) return Promise.resolve();
    return this.enqueueSetup(() => this.setUpOnCurrentSocket ? Promise.resolve() : this.handleReconnected()).catch(() => {
    });
  }
  /** Runs setup work after any run in flight. A failure rejects this call, never the chain. */
  enqueueSetup(task) {
    const run = this.setupChain.then(task);
    this.setupChain = run.catch(() => {
    });
    return run;
  }
  /** Gracefully closes all WebSocket connections. */
  async disconnect() {
    if (this.topologyRefreshTimer) {
      clearTimeout(this.topologyRefreshTimer);
      this.topologyRefreshTimer = null;
    }
    for (const [, conn] of this.speakerConnections) {
      try {
        await conn.disconnect();
      } catch {
      }
    }
    this.speakerConnections.clear();
    await this.connection.disconnect();
  }
  /**
   * Gets a player handle by display name (case-insensitive) or RINCON ID.
   *
   * @param nameOrId - Player display name (e.g. "Arc") or RINCON ID.
   * @returns The player handle.
   * @throws {SonosError} With code `PLAYER_NOT_FOUND` if not found.
   */
  player(nameOrId) {
    const byId = this._players.get(nameOrId);
    if (byId) return byId;
    const lower = nameOrId.toLowerCase();
    for (const handle of this._players.values()) {
      if (handle.name.toLowerCase() === lower) return handle;
    }
    throw new SonosError(
      "PLAYER_NOT_FOUND" /* PLAYER_NOT_FOUND */,
      `Player not found: "${nameOrId}". Available: ${[...this._players.values()].map((p) => p.name).join(", ")}`
    );
  }
  /**
   * Refreshes the household topology from the Sonos device.
   * Updates all player handles with their current group assignments.
   * @internal
   */
  async refreshTopology() {
    const result = await this.householdGroups.getGroups();
    this._groups = result.groups;
    this._rawPlayers = result.players;
    const householdId = this._householdId ?? "";
    for (const player of result.players) {
      const group = result.groups.find((g) => g.playerIds.includes(player.id));
      if (!group) continue;
      const existing = this._players.get(player.id);
      if (existing) {
        existing.updateGroup(group);
      } else {
        const handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
        handle.setCoordinatorConnectionResolver(() => this.connectionForPlayer(handle.coordinatorId));
        this._players.set(player.id, handle);
      }
    }
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }
    const membershipKey = result.groups.map((g) => `${g.id}:${g.coordinatorId}:${[...g.playerIds].sort().join(",")}`).sort().join("|");
    if (this._lastMembershipKey && membershipKey !== this._lastMembershipKey) {
      void this.resubscribeAll();
    }
    this._lastMembershipKey = membershipKey;
    const topologyKey = result.groups.map((g) => `${g.id}:${g.coordinatorId}:${g.playerIds.join(",")}:${g.playbackState ?? ""}`).sort().join("|");
    if (topologyKey !== this._lastTopologyKey) {
      this._lastTopologyKey = topologyKey;
      this.emit("topologyChanged", this._groups, this._rawPlayers);
    }
    this.log.debug(`Topology refreshed: ${this._players.size} players, ${this._groups.length} groups`);
    return result;
  }
  /**
   * Re-reads topology once a burst of groups:1 events has gone quiet.
   * Each new event restarts the wait, so a regroup costs one read, taken
   * after it settles.
   */
  scheduleTopologyRefresh() {
    if (this.topologyRefreshTimer) clearTimeout(this.topologyRefreshTimer);
    this.topologyRefreshTimer = setTimeout(() => {
      this.topologyRefreshTimer = null;
      this.refreshTopology().catch((err) => this.log.warn("Failed to refresh topology", err));
    }, TOPOLOGY_EVENT_DEBOUNCE_MS);
  }
  /**
   * Subscribes every player to the events that say what an external controller did: group volume (a group set is
   * otherwise indistinguishable from a player set), playback, and home theater (a TV input switch).
   * Best effort and not awaited: a send to an offline speaker can wait out the whole request timeout, and diagnostics
   * must never stop or stall a household connecting. Each intent is recorded before its send, so an offline speaker's
   * are re-sent when its socket connects.
   * Runs once, at first connect; resubscribeAll() keeps them alive after. Re-running first-connect setup — connect()
   * while the socket is down, whether after disconnect() or mid-ladder — re-declares these intents, undoing an
   * earlier unsubscribe() of them.
   */
  subscribeDiagnostics() {
    for (const handle of this._players.values()) {
      const subscriptions = [
        ["groupVolume", () => handle.volume.group.subscribe()],
        ["playback", () => handle.playback.subscribe()],
        ["homeTheater", () => handle.homeTheater.subscribe()]
      ];
      for (const [name, subscribe] of subscriptions) {
        void subscribe().catch((err) => this.log.warn(`Failed to subscribe ${handle.name} to ${name} events`, err));
      }
    }
  }
  /**
   * Re-sends every subscription the handles want. Runs wherever one may have died:
   * - the end of setup and of each primary reconnect
   * - a speaker's own socket reconnecting
   * - a membership change (a player that leaves a group gets a new group ID)
   * Re-sending a live subscription is harmless, so nothing tracks which ones died.
   */
  async resubscribeAll() {
    await Promise.all(
      [...this._players.values()].map((handle) => handle.resubscribe().catch((err) => this.log.warn(`Failed to restore event subscriptions for ${handle.name}`, err)))
    );
  }
  /**
   * Subscribes to household group changes, so topology follows every
   * regroup — including ones made from the Sonos app — instead of only
   * those this library performs. Best effort: a failure leaves the older
   * refresh triggers (reconnect, coordinator change, grouping calls) intact.
   */
  async subscribeToTopology() {
    try {
      await this.householdGroups.subscribe();
    } catch (err) {
      this.log.warn("Failed to subscribe to group changes", err);
    }
  }
  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   *
   * @param players - Players to group. First player becomes coordinator.
   * @param options - Grouping options including audio transfer behavior.
   * @throws {SonosError} With code `INVALID_PARAMETER` if players array is empty.
   */
  async group(players, options) {
    await this.engine.group(players, options);
  }
  /**
   * Removes a player from its current group. No-op if already solo.
   *
   * @param player - The player to ungroup.
   */
  async ungroup(player) {
    await this.engine.ungroup(player);
  }
  /**
   * Ungroups all players in the household. Each becomes its own group.
   */
  async ungroupAll() {
    await this.engine.ungroupAll();
  }
  /**
   * Opens connections to all discovered speakers in parallel.
   * The primary speaker reuses the existing connection.
   */
  async connectAllSpeakers() {
    const promises = this._rawPlayers.map(async (player) => {
      try {
        const conn = await this.connectToSpeaker(player);
        const handle = this._players.get(player.id);
        if (handle) {
          handle.setSpeakerConnection(conn);
        }
      } catch (err) {
        this.log.warn(`Failed to connect to ${player.name}:`, err);
      }
    });
    await Promise.all(promises);
  }
  /**
   * Gets or creates a connection to a specific speaker.
   * Returns the primary connection if the speaker is the primary host.
   */
  async connectToSpeaker(player) {
    if (player.websocketUrl) {
      try {
        const url2 = new URL(player.websocketUrl);
        if (url2.hostname === this.primaryHost) {
          return this.connection;
        }
      } catch {
      }
    }
    const existing = this.speakerConnections.get(player.id);
    if (existing && existing.state === "connected") {
      return existing;
    }
    if (!player.websocketUrl) {
      this.log.warn(`No websocketUrl for player ${player.name} \u2014 using primary connection`);
      return this.connection;
    }
    const url = new URL(player.websocketUrl);
    const conn = existing ?? this.createSpeakerConnection(url);
    this.speakerConnections.set(player.id, conn);
    this._players.get(player.id)?.setSpeakerConnection(conn);
    try {
      await conn.connect();
      this.log.info(`Connected to ${player.name} at ${url.hostname}`);
    } catch (err) {
      this.log.warn(`Initial connect to ${player.name} failed; reconnect loop will retry`, err);
    }
    return conn;
  }
  /** Builds and wires a speaker's connection; its events reach listeners like the primary's. */
  createSpeakerConnection(url) {
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log
    });
    conn.on("message", (msg) => this.handleMessage(msg));
    conn.on("connected", () => {
      void this.resubscribeAll();
    });
    return conn;
  }
  /**
   * A player's own socket, else the primary. Right for the primary speaker, which has no entry of its own; under
   * `autoConnect: false` group commands for a group led elsewhere then fail, as documented on that option.
   */
  connectionForPlayer(playerId) {
    return this.speakerConnections.get(playerId) ?? this.connection;
  }
  /**
   * Discovers the householdId by sending a raw getGroups request.
   */
  async discoverHouseholdId() {
    this.log.debug("Discovering householdId...");
    this._householdId = await discoverHouseholdId(this.connection) ?? this._householdId;
    if (this._householdId) {
      this.log.debug(`Discovered householdId: ${this._householdId}`);
    } else {
      this.log.warn("Could not auto-discover householdId");
    }
  }
  /**
   * Routes unsolicited messages from every socket to typed events, tagged with their source.
   * Filters by `_objectType` to avoid double-firing and Volume: undefined.
   */
  handleMessage(message) {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit("rawMessage", message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }
    const objectType = body?._objectType;
    if (objectType === "groupCoordinatorChanged") {
      this.emit("coordinatorChanged", body, source);
      this.scheduleTopologyRefresh();
      return;
    }
    if (!objectType) return;
    if (namespace === "groups:1") this.scheduleTopologyRefresh();
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      this.emit(eventName, body, source);
    }
  }
  /**
   * Reconnects any per-speaker connections that have dropped, and connects
   * to newly discovered players not yet in the speakerConnections map.
   * Called as a safety net after the primary connection reconnects.
   */
  async reconnectSpeakers() {
    const reconnectPromises = [];
    for (const [playerId, conn] of this.speakerConnections) {
      if (conn.state === "disconnected") {
        this.log.info(`Reconnecting speaker ${playerId}`);
        reconnectPromises.push(
          conn.connect().catch((err) => this.log.warn(`Failed to reconnect speaker ${playerId}:`, err))
        );
      }
    }
    for (const player of this._rawPlayers) {
      if (!this.speakerConnections.has(player.id)) {
        reconnectPromises.push(
          this.connectToSpeaker(player).then((conn) => {
            const handle = this._players.get(player.id);
            if (handle) handle.setSpeakerConnection(conn);
          }).catch((err) => this.log.warn(`Failed to connect new speaker ${player.name}:`, err))
        );
      }
    }
    await Promise.allSettled(reconnectPromises);
  }
  /**
   * Handles reconnection events. Runs full initial setup on the first
   * successful connect (whether that's the caller's first attempt or after
   * a background reconnect loop), and reconnect-specific work on every
   * subsequent reconnect.
   */
  async handleReconnected() {
    const epoch = this.primaryEpoch;
    if (!this._initialConnectDone) {
      try {
        await this.discoverHouseholdId();
        await this.refreshTopology();
        await this.subscribeToTopology();
        if (this.connection.state !== "connected") {
          throw new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Disconnected during setup");
        }
        if (this.autoConnectSpeakers) {
          await this.connectAllSpeakers();
        }
        void this.resubscribeAll();
        this.subscribeDiagnostics();
        this._initialConnectDone = true;
      } catch (err) {
        this.log.warn("Failed initial setup on connect", err);
        throw err;
      }
    } else {
      try {
        await this.refreshTopology().catch((err) => this.log.warn("Failed to refresh topology on reconnect", err));
        await this.subscribeToTopology();
        if (this.connection.state !== "connected") {
          throw new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Disconnected during setup");
        }
        await this.reconnectSpeakers();
        void this.resubscribeAll();
      } catch (err) {
        this.log.warn("Failed reconnect setup", err);
        throw err;
      }
    }
    this.setupEpoch = epoch;
    this.emit("connected");
  }
};
function resolveReconnectOptions(input) {
  if (input === false) {
    return { ...DEFAULT_RECONNECT, enabled: false };
  }
  if (input === true || input === void 0) {
    return { ...DEFAULT_RECONNECT };
  }
  return { ...DEFAULT_RECONNECT, ...input };
}

// src/client/SonosClient.ts
var import_node_crypto3 = require("crypto");
var DEFAULT_RECONNECT2 = {
  enabled: true,
  initialDelay: 1e3,
  maxDelay: 3e4,
  factor: 2,
  maxAttempts: Infinity,
  pingInterval: 3e4,
  pongTimeout: 1e4
};
var SonosClient = class extends TypedEventEmitter {
  connection;
  log;
  host;
  _handle;
  _householdId;
  /** Setup runs, chained so each starts after the previous one settles. */
  setupChain = Promise.resolve();
  /** Handshakes a connect() call is awaiting: their setup is that call's to run, not the 'connected' listener's. */
  ownedHandshakes = 0;
  /** Counts 'connected' events, so a completed setup can be matched to the socket it ran on. */
  connectedEpoch = 0;
  /** The connectedEpoch the last completed setup started under. */
  setupEpoch = -1;
  /** Set up on the socket that is up now, not merely set up once. */
  get setUpOnCurrentSocket() {
    return this._handle !== void 0 && this.setupEpoch === this.connectedEpoch;
  }
  constructor(options) {
    super();
    this.log = options.logger ?? noopLogger;
    this.host = options.host;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions2(options.reconnect),
      requestTimeout: options.requestTimeout ?? 12e4,
      logger: this.log
    });
    this.on("error", (err) => {
      this.log.error(`Unhandled client error: ${err.message}`);
    });
    this.connection.on("connected", () => this.onConnected());
    this.connection.on("disconnected", (r) => this.emit("disconnected", r));
    this.connection.on("reconnecting", (a, d) => this.emit("reconnecting", a, d));
    this.connection.on("error", (e) => this.emit("error", e));
    this.connection.on("message", (msg) => this.handleMessage(msg));
  }
  get connected() {
    return this.connection.state === "connected";
  }
  get connectionState() {
    return this.connection.state;
  }
  get householdId() {
    return this._householdId;
  }
  get volume() {
    return this.handle.volume;
  }
  get playback() {
    return this.handle.playback;
  }
  get favorites() {
    return this.handle.favorites;
  }
  get playlists() {
    return this.handle.playlists;
  }
  get audioClip() {
    return this.handle.audioClip;
  }
  get homeTheater() {
    return this.handle.homeTheater;
  }
  get settings() {
    return this.handle.settings;
  }
  get handle() {
    if (!this._handle) throw new Error("Not connected \u2014 call connect() first");
    return this._handle;
  }
  /**
   * Connects and finds this speaker in its household. Resolves once the
   * player controls are usable; rejects if the connection or the lookup fails.
   */
  async connect() {
    if (this.setUpOnCurrentSocket && this.connection.state === "connected") return;
    this.ownedHandshakes++;
    try {
      await this.connection.connect();
    } finally {
      this.ownedHandshakes--;
    }
    await this.enqueue(() => this.setUpOnCurrentSocket ? Promise.resolve() : this.setUp());
  }
  async disconnect() {
    await this.connection.disconnect();
  }
  /** Runs work after any setup in flight. A failure rejects this call, never the chain. */
  enqueue(task) {
    const run = this.setupChain.then(task);
    this.setupChain = run.catch(() => {
    });
    return run;
  }
  /** Sets up after a handshake no connect() call awaits: the reconnect ladder's. Returns the run so tests can await it. */
  onConnected() {
    this.connectedEpoch++;
    if (this.ownedHandshakes > 0) return Promise.resolve();
    return this.enqueue(() => this.setUpOnCurrentSocket ? Promise.resolve() : this.setUp()).catch(() => {
    });
  }
  /** Finds this speaker, then emits `connected`. Logs and rethrows a failure. */
  async setUp() {
    const epoch = this.connectedEpoch;
    try {
      await this.locatePlayer();
    } catch (err) {
      this.log.warn("Setup after connect failed", err);
      throw err;
    }
    this.setupEpoch = epoch;
    this.emit("connected");
  }
  /**
   * Finds this speaker by host and builds its handle. On a reconnect, moves the existing handle to its current group and
   * restores its subscriptions, which died with the old socket.
   */
  async locatePlayer() {
    const householdId = this._householdId ?? await discoverHouseholdId(this.connection);
    if (!householdId) {
      throw new SonosError("CONNECTION_FAILED" /* CONNECTION_FAILED */, `Could not read the household ID from ${this.host}`);
    }
    this._householdId = householdId;
    const [, body] = await this.connection.send([
      { namespace: "groups:1", command: "getGroups", cmdId: (0, import_node_crypto3.randomUUID)(), householdId },
      {}
    ]);
    const { groups = [], players = [] } = body;
    const player = players.find((p) => hostOf(p.websocketUrl) === this.host);
    const group = player && groups.find((g) => g.playerIds.includes(player.id));
    if (!player || !group) {
      const known = players.map((p) => `${p.name} at ${hostOf(p.websocketUrl) ?? "no address"}`).join(", ");
      throw new SonosError(
        "PLAYER_NOT_FOUND" /* PLAYER_NOT_FOUND */,
        `No player at ${this.host}. Sonos reports: ${known}. Use the speaker's IP address; host names are not matched.`
      );
    }
    if (this._handle?.id === player.id) {
      this._handle.updateGroup(group);
      await this._handle.resubscribe().catch((err) => this.log.warn("Failed to restore event subscriptions", err));
    } else {
      this._handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
    }
  }
  handleMessage(message) {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit("rawMessage", message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }
    const objectType = body?._objectType;
    if (objectType === "groupCoordinatorChanged") {
      this.emit("coordinatorChanged", body, source);
      this.enqueue(() => this.locatePlayer()).catch((err) => this.log.warn("Failed to refresh after coordinator change", err));
      return;
    }
    if (!objectType) return;
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      this.emit(eventName, body, source);
    }
  }
};
function hostOf(url) {
  if (!url) return void 0;
  try {
    return new URL(url).hostname;
  } catch {
    return void 0;
  }
}
function resolveReconnectOptions2(input) {
  if (input === false) return { ...DEFAULT_RECONNECT2, enabled: false };
  if (input === true || input === void 0) return { ...DEFAULT_RECONNECT2 };
  return { ...DEFAULT_RECONNECT2, ...input };
}

// src/discovery/SsdpDiscovery.ts
var import_node_dgram = require("dgram");
var import_node_http = require("http");
var SSDP_ADDRESS = "239.255.255.250";
var SSDP_PORT = 1900;
var SEARCH_TARGET = "urn:schemas-upnp-org:device:ZonePlayer:1";
var SonosDiscovery = class _SonosDiscovery {
  /**
   * Send an SSDP M-SEARCH and collect all responding Sonos devices.
   *
   * @param options - Discovery configuration (timeout, network interface).
   * @returns An array of discovered Sonos devices on the local network.
   */
  static async discover(options) {
    const timeout = options?.timeout ?? 5e3;
    const devices = /* @__PURE__ */ new Map();
    return new Promise((resolve) => {
      const socket = (0, import_node_dgram.createSocket)({ type: "udp4", reuseAddr: true });
      const message = Buffer.from(
        [
          "M-SEARCH * HTTP/1.1",
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          "MX: 2",
          `ST: ${SEARCH_TARGET}`,
          "",
          ""
        ].join("\r\n")
      );
      const pendingFetches = [];
      const timer = setTimeout(async () => {
        socket.close();
        await Promise.allSettled(pendingFetches);
        resolve([...devices.values()]);
      }, timeout);
      socket.on("message", (msg, rinfo) => {
        const response = msg.toString();
        const locationMatch = response.match(/LOCATION:\s*(.+)/i);
        if (!locationMatch?.[1]) return;
        const location = locationMatch[1].trim();
        const host = rinfo.address;
        if (!devices.has(host)) {
          const device = { host, port: 1443, location };
          devices.set(host, device);
          const fetchPromise = fetchDeviceDescription(location).then((info) => {
            if (info) Object.assign(device, info);
          }).catch(() => {
          });
          pendingFetches.push(fetchPromise);
        }
      });
      socket.on("error", async () => {
        clearTimeout(timer);
        socket.close();
        await Promise.allSettled(pendingFetches);
        resolve([...devices.values()]);
      });
      if (options?.interfaceAddress) {
        socket.bind({ address: options.interfaceAddress }, () => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
        });
      } else {
        socket.bind(() => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
        });
      }
    });
  }
  /**
   * Convenience method that discovers Sonos devices and returns the first one found.
   *
   * @param options - Discovery configuration (timeout, network interface).
   * @returns The first discovered device, or `undefined` if none were found.
   */
  static async discoverOne(options) {
    const devices = await _SonosDiscovery.discover(options);
    return devices[0];
  }
};
function fetchDeviceDescription(location) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3e3);
    (0, import_node_http.get)(location, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk.toString());
      res.on("end", () => {
        clearTimeout(timer);
        const model = body.match(/<modelName>(.+?)<\/modelName>/)?.[1];
        const modelNumber = body.match(/<modelNumber>(.+?)<\/modelNumber>/)?.[1];
        const serialNumber = body.match(/<serialNum>(.+?)<\/serialNum>/)?.[1];
        const roomName = body.match(/<roomName>(.+?)<\/roomName>/)?.[1];
        resolve({ model, modelNumber, serialNumber, roomName });
      });
      res.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    }).on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

// src/types/playback.ts
var PlaybackState = /* @__PURE__ */ ((PlaybackState2) => {
  PlaybackState2["IDLE"] = "PLAYBACK_STATE_IDLE";
  PlaybackState2["BUFFERING"] = "PLAYBACK_STATE_BUFFERING";
  PlaybackState2["PLAYING"] = "PLAYBACK_STATE_PLAYING";
  PlaybackState2["PAUSED"] = "PLAYBACK_STATE_PAUSED";
  return PlaybackState2;
})(PlaybackState || {});

// src/types/favorites.ts
var QueueAction = /* @__PURE__ */ ((QueueAction2) => {
  QueueAction2["REPLACE"] = "REPLACE";
  QueueAction2["APPEND"] = "APPEND";
  QueueAction2["INSERT"] = "INSERT";
  QueueAction2["INSERT_NEXT"] = "INSERT_NEXT";
  return QueueAction2;
})(QueueAction || {});

// src/types/audioClip.ts
var ClipType = /* @__PURE__ */ ((ClipType2) => {
  ClipType2["CHIME"] = "CHIME";
  ClipType2["CUSTOM"] = "CUSTOM";
  return ClipType2;
})(ClipType || {});
var ClipPriority = /* @__PURE__ */ ((ClipPriority2) => {
  ClipPriority2["LOW"] = "LOW";
  ClipPriority2["HIGH"] = "HIGH";
  return ClipPriority2;
})(ClipPriority || {});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AudioClipControl,
  ClipPriority,
  ClipType,
  CommandError,
  ConnectionError,
  ErrorCode,
  FavoritesAccess,
  HomeTheaterControl,
  NAMESPACE_EVENT_MAP,
  PlaybackControl,
  PlaybackState,
  PlayerHandle,
  PlaylistsAccess,
  QueueAction,
  SettingsControl,
  SonosClient,
  SonosDiscovery,
  SonosError,
  SonosHousehold,
  TimeoutError,
  VolumeControl,
  consoleLogger,
  noopLogger
});
//# sourceMappingURL=index.cjs.map