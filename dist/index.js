// src/client/SonosConnection.ts
import WebSocket from "ws";

// src/util/TypedEventEmitter.ts
import { EventEmitter } from "events";
var TypedEventEmitter = class {
  emitter = new EventEmitter();
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
var SUB_PROTOCOL = "v1.api.smartspeaker.audio";
var API_KEY = "123e4567-e89b-12d3-a456-426655440000";
var SonosConnection = class extends TypedEventEmitter {
  ws = null;
  _state = "disconnected";
  correlator;
  options;
  log;
  connectPromise = null;
  reconnectAttempt = 0;
  reconnectTimer = null;
  intentionalClose = false;
  constructor(options) {
    super();
    this.options = options;
    this.log = options.logger ?? noopLogger;
    this.correlator = new MessageCorrelator(options.requestTimeout);
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
      const url = `wss://${this.options.host}:${this.options.port}/websocket/api`;
      this.log.info(`Connecting to ${url}`);
      this.ws = new WebSocket(url, SUB_PROTOCOL, {
        rejectUnauthorized: false,
        headers: {
          "X-Sonos-Api-Key": API_KEY
        }
      });
      const onOpen = () => {
        cleanup();
        this._state = "connected";
        this.reconnectAttempt = 0;
        this.connectPromise = null;
        this.log.info("Connected");
        this.ws.on("error", (err) => {
          this.log.error("WebSocket error", err.message);
          this.emit("error", err);
        });
        this.emit("connected");
        resolve();
      };
      const onError = (err) => {
        cleanup();
        this._state = "disconnected";
        this.connectPromise = null;
        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws = null;
        }
        const connErr = new ConnectionError(
          "CONNECTION_FAILED" /* CONNECTION_FAILED */,
          `Failed to connect: ${err.message}`,
          { cause: err }
        );
        this.emit("error", connErr);
        reject(connErr);
      };
      const cleanup = () => {
        this.ws?.removeListener("open", onOpen);
        this.ws?.removeListener("error", onError);
      };
      this.ws.once("open", onOpen);
      this.ws.once("error", onError);
      this.ws.on("message", (data) => this.handleMessage(data));
      this.ws.on("close", (code, reason) => {
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
  async disconnect() {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.connectPromise = null;
    this.correlator.rejectAll(
      new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Client disconnected")
    );
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1e3, "client disconnect");
      }
      this.ws.removeAllListeners();
      this.ws = null;
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, "Not connected");
    }
    const [headers, body] = request;
    const { cmdId, namespace, command } = headers;
    if (!cmdId || !namespace || !command) {
      throw new Error("Request must include cmdId, namespace, and command");
    }
    const promise = this.correlator.register(cmdId, namespace, command);
    this.log.debug(`Sending ${namespace}.${command} [${cmdId}]`);
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
    const [headers] = parsed;
    const cmdId = headers?.cmdId;
    if (cmdId && this.correlator.resolve(cmdId, parsed)) {
      this.log.debug(`Response for ${headers.namespace}.${headers.command ?? headers.response} [${cmdId}]`);
      return;
    }
    this.log.debug(`Event: ${headers?.namespace}.${headers?.type ?? headers?.command}`);
    this.emit("message", parsed);
  }
  handleClose(code, reason) {
    this.log.info(`Connection closed: ${code} ${reason}`);
    this.correlator.rejectAll(
      new ConnectionError("CONNECTION_LOST" /* CONNECTION_LOST */, `Connection closed: ${code} ${reason}`)
    );
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
        this.scheduleReconnect();
      }
    }, delay);
  }
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
};

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

// src/namespaces/BaseNamespace.ts
var BaseNamespace = class {
  /** The shared connection and ID context for this namespace. */
  context;
  subscribed = false;
  constructor(context) {
    this.context = context;
  }
  /** Whether this namespace is currently subscribed to real-time events. */
  get isSubscribed() {
    return this.subscribed;
  }
  /**
   * Subscribes to real-time events for this namespace.
   *
   * Once subscribed, the Sonos device will push event notifications
   * whenever the state managed by this namespace changes.
   */
  async subscribe() {
    await this.send("subscribe");
    this.subscribed = true;
  }
  /**
   * Unsubscribes from real-time events for this namespace.
   *
   * After calling this method, no further event notifications will be
   * received for this namespace until {@link subscribe} is called again.
   */
  async unsubscribe() {
    await this.send("unsubscribe");
    this.subscribed = false;
  }
  /**
   * Re-subscribes to events after a WebSocket reconnection.
   *
   * This is a no-op if the namespace was not previously subscribed.
   * Called internally by the client during reconnection to restore
   * event subscriptions transparently.
   */
  async resubscribe() {
    if (this.subscribed) {
      await this.send("subscribe");
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
  async send(command, bodyElements = {}) {
    const request = [
      {
        namespace: this.namespace,
        command,
        cmdId: crypto.randomUUID(),
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

// src/player/VolumeControl.ts
var VolumeControl = class {
  group;
  _player;
  context;
  constructor(context) {
    this.context = context;
    this.group = new GroupVolumeNamespace(context);
    this._player = new PlayerVolumeNamespace(context);
  }
  /** Gets the current group volume level and mute status. */
  async get() {
    return this.group.getVolume();
  }
  /**
   * Sets the absolute group volume.
   * @param volume - Volume level (0–100).
   */
  async set(volume) {
    return this.group.setVolume(volume);
  }
  /**
   * Adjusts the group volume by a relative amount.
   * @param delta - Amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume status after the adjustment.
   */
  async relative(delta) {
    const volumeEvent = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.context.connection.off("message", handler);
        this.group.getVolume().then(resolve, () => resolve({ volume: 0, muted: false, fixed: false }));
      }, 2e3);
      const handler = (msg) => {
        const [headers, body] = msg;
        if (headers?.namespace === "groupVolume:1" && body?._objectType === "groupVolume") {
          clearTimeout(timeout);
          this.context.connection.off("message", handler);
          resolve(body);
        }
      };
      this.context.connection.on("message", handler);
    });
    await this.group.setRelativeVolume(delta);
    return volumeEvent;
  }
  /**
   * Mutes or unmutes the entire group.
   * @param muted - `true` to mute, `false` to unmute.
   */
  async mute(muted) {
    return this.group.setMute(muted);
  }
  /**
   * Subscribes to real-time group volume change events.
   * After subscribing, the household emits `volumeChanged` events.
   */
  async subscribe() {
    return this.group.subscribe();
  }
  /** Unsubscribes from group volume events. */
  async unsubscribe() {
    return this.group.unsubscribe();
  }
  /**
   * Per-speaker volume control.
   * Controls this individual speaker independently within its group.
   * Use this to adjust one speaker's volume without affecting others in the group.
   */
  player = {
    /** Gets the current volume and mute status for this individual speaker. */
    get: () => {
      return this._player.getVolume();
    },
    /**
     * Sets the absolute volume for this speaker.
     * @param volume - Volume level (0–100).
     * @param muted - Optionally set mute state simultaneously.
     */
    set: (volume, muted) => {
      return this._player.setVolume(volume, muted);
    },
    /**
     * Adjusts this speaker's volume by a relative amount.
     * @param delta - Amount to adjust.
     * @returns The resulting volume level.
     */
    relative: (delta) => {
      return this._player.setRelativeVolume(delta);
    },
    /**
     * Mutes or unmutes this individual speaker.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute: (muted) => {
      return this._player.setMute(muted);
    },
    /** Subscribes to per-speaker volume events. */
    subscribe: () => {
      return this._player.subscribe();
    },
    /** Unsubscribes from per-speaker volume events. */
    unsubscribe: () => {
      return this._player.unsubscribe();
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
  constructor(context) {
    this.ns = new FavoritesNamespace(context);
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
    return this.ns.loadFavorite(id, options);
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
  constructor(context) {
    this.ns = new PlaylistsNamespace(context);
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
    return this.ns.loadPlaylist(id, options);
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
  constructor(player, group, householdId, connection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;
    const context = {
      connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id
    };
    this.volume = new VolumeControl(context);
    this.playback = new PlaybackControl(context);
    this.favorites = new FavoritesAccess(context);
    this.playlists = new PlaylistsAccess(context);
    this.audioClip = new AudioClipControl(context);
    this.homeTheater = new HomeTheaterControl(context);
    this.settings = new SettingsControl(context);
    this.groups = new GroupsNamespace(context);
  }
  /** Current group ID this player belongs to. Updated automatically on topology changes. */
  get groupId() {
    return this._group.id;
  }
  /** Whether this player is the coordinator of its current group. */
  get isCoordinator() {
    return this._group.coordinatorId === this.id;
  }
  /**
   * Updates the group this player belongs to.
   * Called internally by SonosHousehold when topology changes.
   * @internal
   */
  updateGroup(group) {
    this._group = group;
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
var POLL_DEADLINE_MS = 3e3;
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
        const audioSource2 = this.resolveAudioSource(playerHandles, options.transfer, snap);
        if (audioSource2 && audioSource2.id !== player.id) {
          await this.transferAudio(audioSource2, player, [player.id]);
          await this.refreshAndSnapshot();
          return;
        }
      }
      if (snap.isAloneInGroup(player.id)) return;
      await this.householdGroups.createGroup([player.id]);
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
      const freshSnap = await this.refreshAndSnapshot();
      const coordGroup = freshSnap.findGroupOf(coordinator.id);
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
      const response = await this.householdGroups.getGroups();
      if (condition(response)) return response;
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
  maxAttempts: Infinity
};
var SonosHousehold = class extends TypedEventEmitter {
  connection;
  log;
  _players = /* @__PURE__ */ new Map();
  _groups = [];
  _rawPlayers = [];
  _householdId;
  _initialConnectDone = false;
  /** Household-scoped GroupsNamespace for createGroup calls (no groupId/playerId). */
  householdGroups;
  engine;
  constructor(options) {
    super();
    this.log = options.logger ?? noopLogger;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 5e3,
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
    this._initialConnectDone = false;
    this.connection.on("connected", () => this.handleReconnected());
    this.connection.on("disconnected", (r) => this.emit("disconnected", r));
    this.connection.on("reconnecting", (a, d) => this.emit("reconnecting", a, d));
    this.connection.on("error", (e) => this.emit("error", e));
    this.connection.on("message", (msg) => this.handleMessage(msg));
    await this.connection.connect();
    await this.discoverHouseholdId();
    await this.refreshTopology();
    this._initialConnectDone = true;
  }
  /** Gracefully closes the WebSocket connection. */
  async disconnect() {
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
        this._players.set(player.id, new PlayerHandle(player, group, householdId, this.connection));
      }
    }
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }
    this.emit("topologyChanged", this._groups, this._rawPlayers);
    this.log.debug(`Topology refreshed: ${this._players.size} players, ${this._groups.length} groups`);
    return result;
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
   * Discovers the householdId by sending a raw getGroups request.
   */
  async discoverHouseholdId() {
    this.log.debug("Discovering householdId...");
    try {
      const [headers] = await this.connection.send([
        { namespace: "groups:1", command: "getGroups", cmdId: crypto.randomUUID() },
        {}
      ]);
      if (headers.householdId) this._householdId = headers.householdId;
    } catch (err) {
      if (err instanceof Error && err.cause && Array.isArray(err.cause)) {
        const [headers] = err.cause;
        if (headers?.householdId) this._householdId = headers.householdId;
      }
    }
    if (this._householdId) {
      this.log.debug(`Discovered householdId: ${this._householdId}`);
    } else {
      this.log.warn("Could not auto-discover householdId");
    }
  }
  /**
   * Routes incoming unsolicited messages to typed events.
   * Filters by `_objectType` to avoid double-firing and Volume: undefined.
   */
  handleMessage(message) {
    this.emit("rawMessage", message);
    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }
    const objectType = body?._objectType;
    if (objectType === "groupCoordinatorChanged") {
      this.emit("coordinatorChanged", body);
      this.refreshTopology().catch((err) => this.log.warn("Failed to refresh topology", err));
      return;
    }
    if (!objectType) return;
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      this.emit(eventName, body);
    }
  }
  /**
   * Handles reconnection events. Only refreshes topology on reconnect,
   * not on initial connect (which is handled by connect() directly).
   */
  async handleReconnected() {
    if (this._initialConnectDone) {
      await this.refreshTopology().catch((err) => this.log.warn("Failed to refresh topology on reconnect", err));
      for (const handle of this._players.values()) {
        try {
          await handle.volume.subscribe();
        } catch {
        }
      }
    }
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
var DEFAULT_RECONNECT2 = {
  enabled: true,
  initialDelay: 1e3,
  maxDelay: 3e4,
  factor: 2,
  maxAttempts: Infinity
};
var SonosClient = class extends TypedEventEmitter {
  connection;
  log;
  _handle;
  _householdId;
  constructor(options) {
    super();
    this.log = options.logger ?? noopLogger;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions2(options.reconnect),
      requestTimeout: options.requestTimeout ?? 5e3,
      logger: this.log
    });
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
  async connect() {
    this.connection.on("connected", () => this.handleConnected());
    this.connection.on("disconnected", (r) => this.emit("disconnected", r));
    this.connection.on("reconnecting", (a, d) => this.emit("reconnecting", a, d));
    this.connection.on("error", (e) => this.emit("error", e));
    this.connection.on("message", (msg) => this.handleMessage(msg));
    await this.connection.connect();
    await this.discoverAndCreateHandle();
    this.emit("connected");
  }
  async disconnect() {
    await this.connection.disconnect();
  }
  async discoverAndCreateHandle() {
    const request = [
      { namespace: "groups:1", command: "getGroups", cmdId: crypto.randomUUID() },
      {}
    ];
    try {
      const [headers, body] = await this.connection.send(request);
      if (headers.householdId) this._householdId = headers.householdId;
      const result = body;
      const group = result.groups?.[0];
      const player = result.players?.find((p) => p.id === group?.coordinatorId) ?? result.players?.[0];
      if (group && player) {
        this._handle = new PlayerHandle(player, group, this._householdId ?? "", this.connection);
      }
    } catch {
      this.log.warn("Could not discover player \u2014 provide host of a specific speaker");
    }
  }
  async handleConnected() {
    if (this._handle) {
      try {
        await this.discoverAndCreateHandle();
      } catch (err) {
        this.log.warn("Failed to re-discover on reconnect", err);
      }
    }
    this.emit("connected");
  }
  handleMessage(message) {
    this.emit("rawMessage", message);
    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }
    const objectType = body?._objectType;
    if (objectType === "groupCoordinatorChanged") {
      this.emit("coordinatorChanged", body);
      this.discoverAndCreateHandle().catch((err) => this.log.warn("Failed to refresh after coordinator change", err));
      return;
    }
    if (!objectType) return;
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      this.emit(eventName, body);
    }
  }
};
function resolveReconnectOptions2(input) {
  if (input === false) return { ...DEFAULT_RECONNECT2, enabled: false };
  if (input === true || input === void 0) return { ...DEFAULT_RECONNECT2 };
  return { ...DEFAULT_RECONNECT2, ...input };
}

// src/discovery/SsdpDiscovery.ts
import { createSocket } from "dgram";
import { get as httpGet } from "http";
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
      const socket = createSocket({ type: "udp4", reuseAddr: true });
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
    httpGet(location, (res) => {
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
export {
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
};
//# sourceMappingURL=index.js.map