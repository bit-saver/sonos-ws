/**
 * Type-safe wrapper around the Node.js {@link EventEmitter}.
 *
 * The generic parameter `T` should be an interface mapping event names
 * to their listener signatures. This ensures that `on`, `once`, `off`,
 * and `emit` calls are type-checked at compile time.
 *
 * @typeParam T - An interface whose keys are event names and values are listener function signatures.
 */
declare class TypedEventEmitter<T> {
    private readonly emitter;
    /**
     * Register a listener for the given event. The listener is called every time the event fires.
     *
     * @param event - The event name to listen for.
     * @param listener - The callback to invoke when the event is emitted.
     * @returns This instance, for chaining.
     */
    on<K extends string & keyof T>(event: K, listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never): this;
    /**
     * Register a one-time listener for the given event. The listener is removed after it fires once.
     *
     * @param event - The event name to listen for.
     * @param listener - The callback to invoke once when the event is emitted.
     * @returns This instance, for chaining.
     */
    once<K extends string & keyof T>(event: K, listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never): this;
    /**
     * Remove a previously registered listener for the given event.
     *
     * @param event - The event name the listener was registered for.
     * @param listener - The callback to remove.
     * @returns This instance, for chaining.
     */
    off<K extends string & keyof T>(event: K, listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never): this;
    /**
     * Remove all listeners, optionally for a specific event only.
     *
     * @param event - If provided, only listeners for this event are removed. Otherwise, all listeners for all events are removed.
     * @returns This instance, for chaining.
     */
    removeAllListeners<K extends string & keyof T>(event?: K): this;
    /**
     * Emit an event, invoking all registered listeners with the provided arguments.
     *
     * @param event - The event name to emit.
     * @param args - Arguments to pass to the listeners.
     * @returns `true` if the event had listeners, `false` otherwise.
     */
    protected emit<K extends string & keyof T>(event: K, ...args: T[K] extends (...args: infer A) => void ? A : never): boolean;
    /**
     * Get the number of listeners currently registered for the given event.
     *
     * @param event - The event name to query.
     * @returns The number of registered listeners.
     */
    listenerCount<K extends string & keyof T>(event: K): number;
}

/** Available log levels, from most to least severe. */
type LogLevel = 'error' | 'warn' | 'info' | 'debug';
/**
 * Pluggable logging interface for sonos-ws.
 *
 * Supply a custom implementation via the `logger` option in `SonosClientOptions`
 * to integrate with your application's logging framework. Two built-in
 * implementations are provided: {@link noopLogger} and {@link consoleLogger}.
 */
interface Logger {
    /** Log an error-level message. */
    error(message: string, ...args: unknown[]): void;
    /** Log a warning-level message. */
    warn(message: string, ...args: unknown[]): void;
    /** Log an informational message. */
    info(message: string, ...args: unknown[]): void;
    /** Log a debug-level message. */
    debug(message: string, ...args: unknown[]): void;
}
/** A logger that silently discards all messages. This is the default logger. */
declare const noopLogger: Logger;
/** A logger that writes all messages to the console with a `[sonos-ws]` prefix. */
declare const consoleLogger: Logger;

/** Headers sent and received as the first element of the Sonos WebSocket message array. */
interface MessageHeaders {
    /** Sonos API namespace that identifies the feature area (e.g. "groupVolume:1", "playback:1"). */
    namespace: string;
    /** Command name within the namespace (e.g. "setVolume", "play", "subscribe"). */
    command?: string;
    /** Unique command ID used for correlating requests with their responses. */
    cmdId?: string;
    /** Target household ID for the command. */
    householdId?: string;
    /** Target group ID for group-scoped commands. */
    groupId?: string;
    /** Target player ID for player-scoped commands. */
    playerId?: string;
    /** Response status or Sonos error code (e.g. "SUCCESS", "ERROR_COMMAND_FAILED"). */
    response?: string;
    /** Event type for subscription events (e.g. "groupVolume"). */
    type?: string;
    /** Whether the command completed successfully. */
    success?: boolean;
    /** Sonos location identifier associated with the device. */
    locationId?: string;
}
/** A request sent to a Sonos device: `[headers, body]`. */
type SonosRequest = [MessageHeaders, Record<string, unknown>];
/** A response or event received from a Sonos device: `[headers, body]`. */
type SonosResponse = [MessageHeaders, Record<string, unknown>];

/**
 * The four possible states of a {@link SonosConnection}.
 *
 * - `disconnected` -- no active connection
 * - `connecting` -- a connection attempt is in progress
 * - `connected` -- the WebSocket is open and ready
 * - `reconnecting` -- the connection was lost and a reconnect is pending
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
/** Events emitted by {@link SonosConnection}. */
interface ConnectionEvents {
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
interface ReconnectOptions {
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
interface ConnectionOptions {
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
/**
 * Manages the WebSocket lifecycle for a single Sonos speaker.
 *
 * Handles TLS connection establishment (accepting the speaker's self-signed
 * certificate), exponential-backoff reconnection, and request/response
 * correlation via {@link MessageCorrelator}.
 */
declare class SonosConnection extends TypedEventEmitter<ConnectionEvents> {
    private ws;
    private _state;
    private readonly correlator;
    private readonly options;
    private readonly log;
    private connectPromise;
    private reconnectAttempt;
    private reconnectTimer;
    private intentionalClose;
    constructor(options: ConnectionOptions);
    /** Current connection state. */
    get state(): ConnectionState;
    /**
     * Establishes the WebSocket connection to the Sonos speaker over TLS.
     *
     * The speaker uses a self-signed certificate, so TLS verification is
     * intentionally disabled. If already connected, this method returns
     * immediately. If a connection attempt is already in progress, the
     * existing promise is returned.
     */
    connect(): Promise<void>;
    /**
     * Intentionally closes the WebSocket connection.
     *
     * All pending requests are rejected with a {@link ConnectionError}, the
     * reconnect timer is cancelled, and no automatic reconnection will occur.
     */
    disconnect(): Promise<void>;
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
    send(request: SonosRequest): Promise<SonosResponse>;
    private handleMessage;
    private handleClose;
    private scheduleReconnect;
    private clearReconnectTimer;
}

/** Current volume state for a Sonos group. */
interface GroupVolumeStatus {
    /** Current volume level (0--100). */
    volume: number;
    /** Whether the group is currently muted. */
    muted: boolean;
    /** Whether the group is in fixed volume mode (volume controlled externally, e.g. by a TV via HDMI ARC). */
    fixed: boolean;
}
/** Current volume state for an individual Sonos player. */
interface PlayerVolumeStatus {
    /** Current volume level (0--100). */
    volume: number;
    /** Whether the player is currently muted. */
    muted: boolean;
    /** Whether the player is in fixed volume mode (volume controlled externally). */
    fixed: boolean;
}
/** Response returned from a relative volume adjustment. */
interface VolumeResponse {
    /** The new volume level after the adjustment (0--100). */
    volume: number;
}

/**
 * Capabilities a Sonos player can have.
 *
 * - `PLAYBACK` -- standard audio playback
 * - `CLOUD` -- cloud service connectivity
 * - `HT_PLAYBACK` -- home theater playback (e.g. Sonos Arc, Beam)
 * - `HT_POWER_STATE` -- home theater power state control
 * - `AIRPLAY` -- Apple AirPlay support
 * - `LINE_IN` -- analog or HDMI line-in input
 * - `AUDIO_CLIP` -- audio clip overlay playback
 * - `VOICE` -- voice assistant support
 * - `SPEAKER_DETECTION` -- surround speaker detection
 * - `FIXED_VOLUME` -- fixed volume mode support
 */
type PlayerCapability = 'PLAYBACK' | 'CLOUD' | 'HT_PLAYBACK' | 'HT_POWER_STATE' | 'AIRPLAY' | 'LINE_IN' | 'AUDIO_CLIP' | 'VOICE' | 'SPEAKER_DETECTION' | 'FIXED_VOLUME';
/** A Sonos player (speaker) on the local network. */
interface Player {
    /** Unique player identifier. */
    id: string;
    /** Human-readable player name (e.g. "Living Room"). */
    name: string;
    /** WebSocket URL for direct communication with this player (wss://host:1443/...). */
    websocketUrl?: string;
    /** Current software version running on the player. */
    softwareVersion?: string;
    /** Sonos WebSocket API version supported by this player. */
    apiVersion?: string;
    /** Minimum API version supported by this player. */
    minApiVersion?: string;
    /** List of capabilities this player supports. */
    capabilities: PlayerCapability[];
    /** Hardware device IDs associated with this player. */
    deviceIds?: string[];
    /** URL to the player's icon image. */
    icon?: string;
}
/** A group of one or more Sonos players that play audio in sync. */
interface Group {
    /** Unique group identifier. */
    id: string;
    /** Human-readable group name, derived from member player names. */
    name: string;
    /** Player ID of the group coordinator that controls playback for the group. */
    coordinatorId: string;
    /** Current playback state of the group. */
    playbackState?: string;
    /** Player IDs of all members in this group, including the coordinator. */
    playerIds: string[];
}
/** Response from the groups namespace containing all groups and players in the household. */
interface GroupsResponse {
    /** All groups in the household. */
    groups: Group[];
    /** All players in the household. */
    players: Player[];
}
/** Response returned when a new group is created. */
interface CreateGroupResponse {
    /** The newly created group. */
    group: Group;
}
/** Response returned when an existing group is modified (players added or removed). */
interface ModifyGroupResponse {
    /** The modified group. */
    group: Group;
}
/**
 * Options for {@link SonosHousehold.group}.
 */
interface GroupOptions {
    /**
     * Audio transfer behavior:
     * - `undefined` (default): just group; if a target player is playing, its audio continues.
     * - `true`: automatically find the active audio source and transfer it.
     *   Checks target players first (by array order), then the rest of the household.
     *   Prefers `PLAYING` over `PAUSED`. If nothing is playing anywhere, groups silently.
     * - A player handle reference: transfer audio from that specific player.
     *   Throws if that player is not actively playing or paused.
     */
    transfer?: boolean | {
        readonly id: string;
    };
}

/** Possible playback states for a Sonos player or group. */
declare enum PlaybackState {
    /** No content loaded or playback has finished. */
    IDLE = "PLAYBACK_STATE_IDLE",
    /** Loading content for playback. */
    BUFFERING = "PLAYBACK_STATE_BUFFERING",
    /** Actively playing audio. */
    PLAYING = "PLAYBACK_STATE_PLAYING",
    /** Playback is paused. */
    PAUSED = "PLAYBACK_STATE_PAUSED"
}
/** Playback mode settings that control queue behavior. */
interface PlayModes {
    /** Whether to randomize track order in the queue. */
    shuffle: boolean;
    /** Whether to repeat the entire queue when it finishes. */
    repeat: boolean;
    /** Whether to repeat the current track continuously. */
    repeatOne: boolean;
    /** Whether to crossfade between tracks. */
    crossfade: boolean;
}
/** Indicates which playback actions are currently available for the session. */
interface PlaybackActions {
    /** Whether the player can skip to the next track. */
    canSkip: boolean;
    /** Whether the player can skip back to the previous track. */
    canSkipBack: boolean;
    /** Whether the player can seek within the current track. */
    canSeek: boolean;
    /** Whether repeat mode can be toggled. */
    canRepeat: boolean;
    /** Whether repeat-one mode can be toggled. */
    canRepeatOne: boolean;
    /** Whether crossfade mode can be toggled. */
    canCrossfade: boolean;
    /** Whether shuffle mode can be toggled. */
    canShuffle: boolean;
    /** Whether playback can be paused. */
    canPause: boolean;
    /** Whether playback can be stopped. */
    canStop: boolean;
}
/** Full playback state including position, modes, and available actions. */
interface PlaybackStatus {
    /** The current playback state. */
    playbackState: PlaybackState;
    /** Version string for the current queue, used for cache invalidation. */
    queueVersion?: string;
    /** Identifier of the currently playing item in the queue. */
    itemId?: string;
    /** Current playback position in milliseconds. */
    positionMillis: number;
    /** Previous playback position in milliseconds (before a seek or track change). */
    previousPositionMillis?: number;
    /** Current playback mode settings (shuffle, repeat, crossfade). */
    playModes: PlayModes;
    /** Which playback actions are currently available. */
    availablePlaybackActions?: PlaybackActions;
}
/** Options for loading a line-in audio source. */
interface LoadLineInOptions {
    /** The player ID whose line-in input to use. If omitted, defaults to the group coordinator. */
    playerId?: string;
}

/** Information about a music service (e.g. Spotify, Apple Music, Amazon Music). */
interface ServiceInfo {
    /** Display name of the music service. */
    name?: string;
    /** Unique identifier for the music service. */
    id?: string;
    /** URL to the music service's logo or icon. */
    imageUrl?: string;
}
/** Metadata for a single audio track. */
interface Track {
    /** Track title. */
    name: string;
    /** Artist or performer name. */
    artist?: string;
    /** Album name. */
    album?: string;
    /** URL to the album art or track image. */
    imageUrl?: string;
    /** Track duration in milliseconds. */
    durationMillis?: number;
    /** Content type (e.g. "track", "show", "ad"). */
    type?: string;
    /** The music service this track originates from. */
    service?: ServiceInfo;
    /** Descriptive tags associated with the track. */
    tags?: string[];
}
/** Wrapper around {@link Track} that includes a deletion flag. */
interface TrackInfo {
    /** The track metadata. */
    track: Track;
    /** Whether the track has been deleted from the music service. */
    deleted?: boolean;
}
/** Metadata for a container such as an album, playlist, or radio station. */
interface Container {
    /** Container name (e.g. album title, playlist name). */
    name?: string;
    /** Container type (e.g. "album", "playlist", "station"). */
    type?: string;
    /** Unique identifier for the container. */
    id?: string;
    /** URL to the container's cover art or image. */
    imageUrl?: string;
    /** The music service this container originates from. */
    service?: ServiceInfo;
    /** Descriptive tags associated with the container. */
    tags?: string[];
}
/** Full metadata status for the current playback session. */
interface MetadataStatus {
    /** The container (album, playlist, station) currently being played from. */
    container?: Container;
    /** Metadata for the currently playing track. */
    currentItem?: TrackInfo;
    /** Metadata for the next track in the queue. */
    nextItem?: TrackInfo;
    /** Stream information string for live or radio streams. */
    streamInfo?: string;
}

/** A Sonos favorite (saved item such as a playlist, station, or album). */
interface Favorite {
    /** Unique identifier for the favorite. */
    id: string;
    /** Display name of the favorite. */
    name: string;
    /** Optional description of the favorite. */
    description?: string;
    /** URL to the favorite's cover art or image. */
    imageUrl?: string;
    /** The music service this favorite originates from. */
    service?: ServiceInfo;
}
/** Response containing the user's Sonos favorites list. */
interface FavoritesResponse {
    /** Version string for cache invalidation; changes when favorites are added or removed. */
    version?: string;
    /** The list of saved favorites. */
    items: Favorite[];
}
/** Determines how content is added to the playback queue. */
declare enum QueueAction {
    /** Clear the existing queue and add the new content. */
    REPLACE = "REPLACE",
    /** Add to the end of the existing queue. */
    APPEND = "APPEND",
    /** Insert at the current position in the queue. */
    INSERT = "INSERT",
    /** Insert immediately after the currently playing track. */
    INSERT_NEXT = "INSERT_NEXT"
}
/** Options when loading a favorite into the playback queue. */
interface LoadFavoriteOptions {
    /** How to add the favorite to the queue. Defaults to {@link QueueAction.REPLACE}. */
    action?: QueueAction;
    /** Playback mode overrides to apply (shuffle, repeat, crossfade). */
    playModes?: Partial<PlayModes>;
    /** Whether to begin playback automatically after the favorite is loaded. */
    playOnCompletion?: boolean;
}

/** Summary information for a Sonos playlist. */
interface Playlist {
    /** Unique identifier for the playlist. */
    id: string;
    /** Display name of the playlist. */
    name: string;
    /** Number of tracks in the playlist. */
    trackCount?: number;
    /** Optional description of the playlist. */
    description?: string;
}
/** A track within a playlist, with its optional containing album or collection. */
interface PlaylistTrack {
    /** The track metadata. */
    track: Track;
    /** The container (album, collection) the track belongs to, if any. */
    container?: Container;
}
/** Full playlist details including all tracks. */
interface PlaylistResponse {
    /** Unique identifier for the playlist. */
    id: string;
    /** Display name of the playlist. */
    name: string;
    /** Ordered list of tracks in the playlist. */
    tracks: PlaylistTrack[];
}
/** Response containing all Sonos playlists in the household. */
interface PlaylistsResponse {
    /** Version string for cache invalidation; changes when playlists are modified. */
    version?: string;
    /** The list of playlists. */
    playlists: Playlist[];
}
/** Options when loading a playlist into the playback queue. */
interface LoadPlaylistOptions {
    /** Whether to begin playback automatically after the playlist is loaded. */
    playOnCompletion?: boolean;
}

/** Home theater audio settings for Sonos soundbar devices (Arc, Beam, Ray). */
interface HomeTheaterOptions {
    /** Whether night mode is enabled, which reduces loud sounds for nighttime listening. */
    nightMode: boolean;
    /** Whether dialog enhancement is enabled, which boosts voice and dialog clarity. */
    enhanceDialog: boolean;
}

/**
 * Error codes used by {@link SonosError} and its subclasses.
 *
 * The first four codes are client-side errors raised by sonos-ws itself.
 * The remaining `ERROR_*` codes are Sonos API error codes returned by the device.
 */
declare enum ErrorCode {
    /** The initial WebSocket connection to the Sonos device failed. */
    CONNECTION_FAILED = "CONNECTION_FAILED",
    /** An existing WebSocket connection was unexpectedly lost. */
    CONNECTION_LOST = "CONNECTION_LOST",
    /** All automatic reconnect attempts have been exhausted. */
    RECONNECT_EXHAUSTED = "RECONNECT_EXHAUSTED",
    /** A command did not receive a response within the configured timeout. */
    REQUEST_TIMEOUT = "REQUEST_TIMEOUT",
    /** The command is missing one or more required parameters. */
    ERROR_MISSING_PARAMETERS = "ERROR_MISSING_PARAMETERS",
    /** The command has invalid syntax or malformed JSON. */
    ERROR_INVALID_SYNTAX = "ERROR_INVALID_SYNTAX",
    /** The requested namespace is not supported by this device. */
    ERROR_UNSUPPORTED_NAMESPACE = "ERROR_UNSUPPORTED_NAMESPACE",
    /** The requested command is not supported within the namespace. */
    ERROR_UNSUPPORTED_COMMAND = "ERROR_UNSUPPORTED_COMMAND",
    /** The specified object ID (group, player, etc.) is invalid or not found. */
    ERROR_INVALID_OBJECT_ID = "ERROR_INVALID_OBJECT_ID",
    /** A command parameter has an invalid value. */
    ERROR_INVALID_PARAMETER = "ERROR_INVALID_PARAMETER",
    /** The command failed for a device-specific reason. */
    ERROR_COMMAND_FAILED = "ERROR_COMMAND_FAILED",
    /** The target player does not have the required capability for this command. */
    ERROR_NOT_CAPABLE = "ERROR_NOT_CAPABLE",
    /** The requested content is not available or has no playable items. */
    ERROR_NO_CONTENT = "ERROR_NO_CONTENT",
    /** The specified player name or ID was not found in the household topology. */
    PLAYER_NOT_FOUND = "PLAYER_NOT_FOUND",
    /** A multi-step group operation failed partway through. */
    GROUP_OPERATION_FAILED = "GROUP_OPERATION_FAILED"
}

/**
 * Base error class for all sonos-ws errors.
 *
 * Extends the standard `Error` with Sonos-specific context such as the
 * error code, API namespace, command name, and command ID. All other
 * error classes in sonos-ws ({@link ConnectionError}, {@link CommandError},
 * {@link TimeoutError}) extend this class.
 */
declare class SonosError extends Error {
    /** The {@link ErrorCode} or Sonos API error string identifying what went wrong. */
    readonly code: ErrorCode | string;
    /** The Sonos API namespace where the error occurred (e.g. "groupVolume:1"). */
    readonly namespace?: string;
    /** The command that triggered the error (e.g. "setVolume"). */
    readonly command?: string;
    /** The unique command ID for correlating the error with its originating request. */
    readonly cmdId?: string;
    /**
     * @param code - Error code identifying the type of failure.
     * @param message - Human-readable error description.
     * @param options - Optional context about the command that caused the error.
     * @param options.namespace - Sonos API namespace (e.g. "playback:1").
     * @param options.command - Command name (e.g. "play").
     * @param options.cmdId - Unique command ID for request/response correlation.
     * @param options.cause - The underlying error that caused this one, if any.
     */
    constructor(code: ErrorCode | string, message: string, options?: {
        namespace?: string;
        command?: string;
        cmdId?: string;
        cause?: unknown;
    });
}

/** Event data emitted when a group's coordinator changes (speakers grouped or ungrouped). */
interface GroupCoordinatorChangedEvent {
    _objectType: 'groupCoordinatorChanged';
    /** Status of the group change (e.g. `"GROUP_STATUS_MOVED"`). */
    groupStatus: string;
    /** Name of the new group (e.g. `"Bedroom + 1"`). */
    groupName: string;
    /** WebSocket URL of the new group coordinator. */
    websocketUrl: string;
    /** Player ID of the new group coordinator. */
    playerId: string;
}
/**
 * All events emitted by {@link SonosClient}.
 *
 * Includes connection lifecycle events, real-time subscription updates
 * from the Sonos device, and a raw message event for debugging.
 */
interface SonosEvents {
    /** Emitted when the WebSocket connection is established. */
    connected: () => void;
    /** Emitted when the WebSocket connection is lost, with a human-readable reason string. */
    disconnected: (reason: string) => void;
    /** Emitted before each reconnect attempt, with the attempt number and delay in milliseconds before the attempt. */
    reconnecting: (attempt: number, delay: number) => void;
    /** Emitted on connection or command errors. */
    error: (error: SonosError | Error) => void;
    /** Emitted when the group volume or mute state changes. */
    volumeChanged: (data: GroupVolumeStatus) => void;
    /** Emitted when an individual player's volume or mute state changes. */
    playerVolumeChanged: (data: PlayerVolumeStatus) => void;
    /** Emitted when group membership or topology changes (players grouped/ungrouped). */
    groupsChanged: (data: GroupsResponse) => void;
    /** Emitted when the playback state, position, or play modes change. */
    playbackChanged: (data: PlaybackStatus) => void;
    /** Emitted when the currently playing track or next track metadata changes. */
    metadataChanged: (data: MetadataStatus) => void;
    /** Emitted when the user's favorites list is modified. */
    favoritesChanged: (data: FavoritesResponse) => void;
    /** Emitted when the user's playlists are modified. */
    playlistsChanged: (data: PlaylistsResponse) => void;
    /** Emitted when home theater settings (night mode, dialog enhancement) change. */
    homeTheaterChanged: (data: HomeTheaterOptions) => void;
    /**
     * Emitted when the group coordinator changes (e.g. speakers grouped/ungrouped).
     * The client automatically calls {@link SonosClient.refreshGroups} to update
     * its internal groupId. Listen to this event to react to topology changes.
     */
    coordinatorChanged: (data: GroupCoordinatorChangedEvent) => void;
    /** Emitted for every raw WebSocket message received from the Sonos device. Useful for debugging. */
    rawMessage: (message: SonosResponse) => void;
}
/**
 * Events emitted by {@link SonosHousehold}.
 * Extends all {@link SonosEvents} and adds household-level topology events.
 */
interface SonosHouseholdEvents extends SonosEvents {
    /** Emitted when group topology changes (groups/players added/removed/reorganized). */
    topologyChanged: (groups: Group[], players: Player[]) => void;
}
/**
 * Maps Sonos API namespace strings to their corresponding {@link SonosEvents} event names.
 *
 * Used internally to route subscription events from the WebSocket connection
 * to the appropriate typed event emitter.
 */
declare const NAMESPACE_EVENT_MAP: Record<string, keyof SonosEvents>;

/**
 * Shared context passed to all namespace instances, providing the WebSocket
 * connection and accessor functions for the current household, group, and player IDs.
 */
interface NamespaceContext {
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
declare abstract class BaseNamespace {
    /** The shared connection and ID context for this namespace. */
    protected readonly context: NamespaceContext;
    /** The Sonos API namespace string (e.g. `"groupVolume:1"`). */
    abstract readonly namespace: string;
    private subscribed;
    constructor(context: NamespaceContext);
    /** Whether this namespace is currently subscribed to real-time events. */
    get isSubscribed(): boolean;
    /**
     * Subscribes to real-time events for this namespace.
     *
     * Once subscribed, the Sonos device will push event notifications
     * whenever the state managed by this namespace changes.
     */
    subscribe(): Promise<void>;
    /**
     * Unsubscribes from real-time events for this namespace.
     *
     * After calling this method, no further event notifications will be
     * received for this namespace until {@link subscribe} is called again.
     */
    unsubscribe(): Promise<void>;
    /**
     * Re-subscribes to events after a WebSocket reconnection.
     *
     * This is a no-op if the namespace was not previously subscribed.
     * Called internally by the client during reconnection to restore
     * event subscriptions transparently.
     */
    resubscribe(): Promise<void>;
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
    protected send(command: string, bodyElements?: Record<string, unknown>): Promise<SonosResponse>;
    /** Extract the body (second element) from a response. */
    protected body(response: SonosResponse): Record<string, unknown>;
}

/**
 * Manages Sonos player groups (grouping and ungrouping speakers).
 *
 * Maps to the Sonos WebSocket Control API `groups:1` namespace.
 */
declare class GroupsNamespace extends BaseNamespace {
    readonly namespace = "groups:1";
    /**
     * Gets all groups and players in the household.
     *
     * @returns The complete list of groups, their member players, and all known players.
     */
    getGroups(): Promise<GroupsResponse>;
    /**
     * Creates a new group from the specified player IDs.
     *
     * @param playerIds - The IDs of the players to include in the new group.
     * @returns The newly created group's details.
     */
    createGroup(playerIds: string[]): Promise<CreateGroupResponse>;
    /**
     * Adds or removes players from the current group.
     *
     * @param playerIdsToAdd - Player IDs to add to the group.
     * @param playerIdsToRemove - Player IDs to remove from the group.
     * @returns The modified group's details.
     */
    modifyGroupMembers(playerIdsToAdd?: string[], playerIdsToRemove?: string[]): Promise<ModifyGroupResponse>;
    /**
     * Replaces all members of the current group with the specified players.
     *
     * @param playerIds - The player IDs that should form the new membership of the group.
     */
    setGroupMembers(playerIds: string[]): Promise<void>;
}

/**
 * Unified volume control for a Sonos player.
 *
 * Primary methods control the group volume (all speakers in this player's group).
 * The {@link player} sub-object controls this individual speaker within its group.
 */
declare class VolumeControl {
    private readonly group;
    private readonly _player;
    constructor(context: NamespaceContext);
    /** Gets the current group volume level and mute status. */
    get(): Promise<GroupVolumeStatus>;
    /**
     * Sets the absolute group volume.
     * @param volume - Volume level (0–100).
     */
    set(volume: number): Promise<void>;
    /**
     * Adjusts the group volume by a relative amount.
     * @param delta - Amount to adjust (positive to increase, negative to decrease).
     * @returns The resulting volume status after the adjustment.
     */
    relative(delta: number): Promise<GroupVolumeStatus>;
    /**
     * Mutes or unmutes the entire group.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute(muted: boolean): Promise<void>;
    /**
     * Subscribes to real-time group volume change events.
     * After subscribing, the household emits `volumeChanged` events.
     */
    subscribe(): Promise<void>;
    /** Unsubscribes from group volume events. */
    unsubscribe(): Promise<void>;
    /**
     * Per-speaker volume control.
     * Controls this individual speaker independently within its group.
     * Use this to adjust one speaker's volume without affecting others in the group.
     */
    readonly player: {
        /** Gets the current volume and mute status for this individual speaker. */
        get: () => Promise<PlayerVolumeStatus>;
        /**
         * Sets the absolute volume for this speaker.
         * @param volume - Volume level (0–100).
         * @param muted - Optionally set mute state simultaneously.
         */
        set: (volume: number, muted?: boolean) => Promise<void>;
        /**
         * Adjusts this speaker's volume by a relative amount.
         * @param delta - Amount to adjust.
         * @returns The resulting volume level.
         */
        relative: (delta: number) => Promise<VolumeResponse>;
        /**
         * Mutes or unmutes this individual speaker.
         * @param muted - `true` to mute, `false` to unmute.
         */
        mute: (muted: boolean) => Promise<void>;
        /** Subscribes to per-speaker volume events. */
        subscribe: () => Promise<void>;
        /** Unsubscribes from per-speaker volume events. */
        unsubscribe: () => Promise<void>;
    };
}

/**
 * Playback and metadata control for a Sonos player's group.
 *
 * Combines the `playback:1` and `playbackMetadata:1` namespaces into
 * a single interface — playback state and track metadata are always
 * about the same thing (what's currently playing).
 */
declare class PlaybackControl {
    private readonly pb;
    private readonly meta;
    constructor(context: NamespaceContext);
    /** Starts or resumes playback. */
    play(): Promise<void>;
    /** Pauses playback. */
    pause(): Promise<void>;
    /** Toggles between play and pause. */
    togglePlayPause(): Promise<void>;
    /** Stops playback entirely. */
    stop(): Promise<void>;
    /** Skips to the next track in the queue. */
    skipToNextTrack(): Promise<void>;
    /** Skips to the previous track. */
    skipToPreviousTrack(): Promise<void>;
    /**
     * Seeks to an absolute position in the current track.
     * @param positionMillis - Position in milliseconds.
     */
    seek(positionMillis: number): Promise<void>;
    /**
     * Seeks forward or backward by a relative amount.
     * @param deltaMillis - Amount in milliseconds (positive = forward, negative = backward).
     */
    seekRelative(deltaMillis: number): Promise<void>;
    /** Gets the current playback state, position, and play modes. */
    getStatus(): Promise<PlaybackStatus>;
    /**
     * Sets shuffle, repeat, crossfade modes.
     * @param modes - Partial play modes to update.
     */
    setPlayModes(modes: Partial<PlayModes>): Promise<void>;
    /**
     * Switches playback to a line-in source.
     * @param options - Optional line-in configuration.
     */
    loadLineIn(options?: LoadLineInOptions): Promise<void>;
    /** Gets metadata for the current track, container, and next item. */
    getMetadata(): Promise<MetadataStatus>;
    /** Subscribes to playback state change events. */
    subscribe(): Promise<void>;
    /** Unsubscribes from playback state events. */
    unsubscribe(): Promise<void>;
}

/** Access and load Sonos favorites. */
declare class FavoritesAccess {
    private readonly ns;
    constructor(context: NamespaceContext);
    /** Retrieves the list of Sonos favorites. */
    get(): Promise<FavoritesResponse>;
    /**
     * Loads a favorite into the queue.
     * @param id - Favorite ID.
     * @param options - Queue action and playback options.
     */
    load(id: string, options?: LoadFavoriteOptions): Promise<void>;
}

/** Access and load Sonos playlists. */
declare class PlaylistsAccess {
    private readonly ns;
    constructor(context: NamespaceContext);
    /** Retrieves all Sonos playlists. */
    get(): Promise<PlaylistsResponse>;
    /**
     * Retrieves a specific playlist with its tracks.
     * @param id - Playlist ID.
     */
    getPlaylist(id: string): Promise<PlaylistResponse>;
    /**
     * Loads a playlist into the queue.
     * @param id - Playlist ID.
     * @param options - Playback options.
     */
    load(id: string, options?: LoadPlaylistOptions): Promise<void>;
}

/** The type of audio clip to play. */
declare enum ClipType {
    /** A built-in chime sound provided by the Sonos player. */
    CHIME = "CHIME",
    /** A custom audio clip loaded from an external URL. */
    CUSTOM = "CUSTOM"
}
/** Priority level for audio clip playback. */
declare enum ClipPriority {
    /** Low priority; the clip may be skipped if another clip is already playing. */
    LOW = "LOW",
    /** High priority; the clip will interrupt other clips and duck current audio. */
    HIGH = "HIGH"
}
/** Options for playing an audio clip overlay on a Sonos player. */
interface LoadAudioClipOptions {
    /** Display name for the audio clip. */
    name: string;
    /** Identifier of the application requesting the clip (e.g. "com.myapp.alerts"). */
    appId: string;
    /** Priority level for the clip. Defaults to {@link ClipPriority.LOW}. */
    priority?: ClipPriority;
    /** Whether to play a built-in chime or a custom audio URL. Defaults to {@link ClipType.CUSTOM}. */
    clipType?: ClipType;
    /** URL of the audio file to stream for custom clips. Required when clipType is CUSTOM. */
    streamUrl?: string;
    /** HTTP Authorization header value for accessing a protected streamUrl. */
    httpAuthorization?: string;
    /** Volume level for the clip (0--100). If omitted, plays at the player's current volume. */
    volume?: number;
}
/** Response returned after loading an audio clip. */
interface AudioClipResponse {
    /** Unique identifier for this audio clip instance. */
    id: string;
    /** Display name of the audio clip. */
    name: string;
    /** Application ID that requested the clip. */
    appId: string;
    /** Current status of the audio clip (e.g. "ACTIVE", "DONE"). */
    status?: string;
}

/** Plays audio clips (notifications, chimes) that overlay current audio. */
declare class AudioClipControl {
    private readonly ns;
    constructor(context: NamespaceContext);
    /**
     * Plays an audio clip.
     * @param options - Clip configuration (name, appId, streamUrl, priority, volume).
     */
    load(options: LoadAudioClipOptions): Promise<AudioClipResponse>;
    /**
     * Cancels a currently playing audio clip.
     * @param clipId - ID of the clip to cancel.
     */
    cancel(clipId: string): Promise<void>;
}

/** Manages home theater settings (night mode, dialog enhancement). */
declare class HomeTheaterControl {
    private readonly ns;
    constructor(context: NamespaceContext);
    /** Gets the current home theater settings. */
    get(): Promise<HomeTheaterOptions>;
    /**
     * Updates home theater settings.
     * @param options - Settings to update (nightMode, enhanceDialog).
     */
    set(options: Partial<HomeTheaterOptions>): Promise<void>;
}

/** Player-level configuration settings. */
interface PlayerSettings {
    /** Volume control mode (e.g. "VARIABLE", "FIXED", "PASS_THROUGH"). */
    volumeMode?: string;
    /** Volume scaling multiplier applied to the player's output level. */
    volumeScalingFactor?: number;
    /** Whether mono audio output is enabled (combines stereo channels). */
    monoMode?: boolean;
    /** Whether WiFi is disabled, forcing the player into wired-only mode. */
    wifiDisable?: boolean;
    /** Additional settings not explicitly typed. */
    [key: string]: unknown;
}

/** Manages player-level settings. */
declare class SettingsControl {
    private readonly ns;
    constructor(context: NamespaceContext);
    /** Gets the current player settings. */
    get(): Promise<PlayerSettings>;
    /**
     * Updates player settings.
     * @param settings - Settings to update.
     */
    set(settings: Partial<PlayerSettings>): Promise<void>;
}

/**
 * A lightweight handle for controlling a single Sonos player.
 *
 * Routes all commands through a shared WebSocket connection using this
 * player's `groupId` and `playerId` in the request headers.
 *
 * Obtain instances via {@link SonosHousehold.player} or internally
 * from {@link SonosClient}.
 */
declare class PlayerHandle {
    /** RINCON player ID. */
    readonly id: string;
    /** Display name (e.g. "Arc", "Office"). */
    readonly name: string;
    /** Player capabilities from the Sonos API. */
    readonly capabilities: PlayerCapability[];
    private _group;
    private readonly householdId;
    /** Unified volume control (group volume + per-speaker volume). */
    readonly volume: VolumeControl;
    /** Playback and metadata control. */
    readonly playback: PlaybackControl;
    /** Sonos favorites. */
    readonly favorites: FavoritesAccess;
    /** Sonos playlists. */
    readonly playlists: PlaylistsAccess;
    /** Audio clip playback. */
    readonly audioClip: AudioClipControl;
    /** Home theater settings. */
    readonly homeTheater: HomeTheaterControl;
    /** Player settings. */
    readonly settings: SettingsControl;
    /** Raw group operations (used internally by SonosHousehold for grouping). */
    readonly groups: GroupsNamespace;
    constructor(player: Player, group: Group, householdId: string, connection: SonosConnection);
    /** Current group ID this player belongs to. Updated automatically on topology changes. */
    get groupId(): string;
    /** Whether this player is the coordinator of its current group. */
    get isCoordinator(): boolean;
    /**
     * Updates the group this player belongs to.
     * Called internally by SonosHousehold when topology changes.
     * @internal
     */
    updateGroup(group: Group): void;
}

/**
 * Configuration options for creating a {@link SonosHousehold} instance.
 */
interface SonosHouseholdOptions {
    /** IP or hostname of any Sonos speaker in the household. */
    host: string;
    /** WebSocket port. @defaultValue 1443 */
    port?: number;
    /** Reconnection config. @defaultValue true */
    reconnect?: Partial<ReconnectOptions> | boolean;
    /** Custom logger. */
    logger?: Logger;
    /** Command timeout in ms. @defaultValue 5000 */
    requestTimeout?: number;
}
/**
 * Top-level API for controlling an entire Sonos household.
 *
 * Owns a single {@link SonosConnection} and exposes {@link PlayerHandle}
 * objects for targeting individual speakers. Automatically tracks group
 * topology changes and provides high-level grouping operations.
 *
 * @example
 * ```typescript
 * const household = new SonosHousehold({ host: '192.168.68.96' });
 * await household.connect();
 *
 * const arc = household.player('Arc');
 * await arc.volume.relative(5);
 *
 * const office = household.player('Office');
 * await household.group([arc, office], { transfer: true });
 * ```
 */
declare class SonosHousehold extends TypedEventEmitter<SonosHouseholdEvents> {
    private readonly connection;
    private readonly log;
    private readonly _players;
    private _groups;
    private _rawPlayers;
    private _householdId;
    private _initialConnectDone;
    /** Household-scoped GroupsNamespace for createGroup calls (no groupId/playerId). */
    private readonly householdGroups;
    constructor(options: SonosHouseholdOptions);
    /** All discovered players in the household, keyed by RINCON player ID. */
    get players(): ReadonlyMap<string, PlayerHandle>;
    /** All current groups in the household. */
    get groups(): readonly Group[];
    /** The Sonos household ID. */
    get householdId(): string | undefined;
    /** Whether the WebSocket connection is currently open. */
    get connected(): boolean;
    /**
     * Connects to the Sonos speaker and discovers the household topology.
     * Populates {@link players} and {@link groups}.
     */
    connect(): Promise<void>;
    /** Gracefully closes the WebSocket connection. */
    disconnect(): Promise<void>;
    /**
     * Gets a player handle by display name (case-insensitive) or RINCON ID.
     *
     * @param nameOrId - Player display name (e.g. "Arc") or RINCON ID.
     * @returns The player handle.
     * @throws {SonosError} With code `PLAYER_NOT_FOUND` if not found.
     */
    player(nameOrId: string): PlayerHandle;
    /**
     * Refreshes the household topology from the Sonos device.
     * Updates all player handles with their current group assignments.
     * @internal
     */
    refreshTopology(): Promise<GroupsResponse>;
    /**
     * Groups the specified players. The first player in the array becomes the coordinator.
     *
     * @param players - Players to group. First player becomes coordinator.
     * @param options - Grouping options including audio transfer behavior.
     * @throws {SonosError} With code `INVALID_PARAMETER` if players array is empty.
     */
    group(players: PlayerHandle[], options?: GroupOptions): Promise<void>;
    /**
     * Removes a player from its current group. No-op if already solo.
     *
     * @param player - The player to ungroup.
     */
    ungroup(player: PlayerHandle): Promise<void>;
    /**
     * Ungroups all players in the household. Each becomes its own group.
     */
    ungroupAll(): Promise<void>;
    /**
     * Discovers the householdId by sending a raw getGroups request.
     */
    private discoverHouseholdId;
    /**
     * Routes incoming unsolicited messages to typed events.
     * Filters by `_objectType` to avoid double-firing and Volume: undefined.
     */
    private handleMessage;
    /**
     * Handles reconnection events. Only refreshes topology on reconnect,
     * not on initial connect (which is handled by connect() directly).
     */
    private handleReconnected;
    /**
     * Resolves the audio source player based on the `transfer` option.
     * @returns The player with audio, or undefined if nothing is playing.
     */
    private resolveAudioSource;
    /**
     * Performs a simple group operation: ensures the coordinator owns a group
     * with exactly the desired members.
     */
    private simpleGroup;
    /**
     * Transfers audio from a source player to a target coordinator using
     * the coordinator shuffle technique.
     *
     * 1. Add target to source's group
     * 2. Remove source from group (expected ~8s timeout)
     * 3. Target inherits audio
     * 4. Add remaining members
     */
    private transferAudio;
}

interface SonosClientOptions {
    host: string;
    port?: number;
    reconnect?: Partial<ReconnectOptions> | boolean;
    logger?: Logger;
    requestTimeout?: number;
}
/**
 * Simple single-speaker API for controlling one Sonos player.
 *
 * For multi-speaker control and grouping, use {@link SonosHousehold} instead.
 *
 * @example
 * ```typescript
 * const client = new SonosClient({ host: '192.168.68.96' });
 * await client.connect();
 * await client.volume.set(50);
 * await client.disconnect();
 * ```
 */
declare class SonosClient extends TypedEventEmitter<SonosEvents> {
    private readonly connection;
    private readonly log;
    private _handle;
    private _householdId;
    constructor(options: SonosClientOptions);
    get connected(): boolean;
    get connectionState(): ConnectionState;
    get householdId(): string | undefined;
    get volume(): VolumeControl;
    get playback(): PlaybackControl;
    get favorites(): FavoritesAccess;
    get playlists(): PlaylistsAccess;
    get audioClip(): AudioClipControl;
    get homeTheater(): HomeTheaterControl;
    get settings(): SettingsControl;
    private get handle();
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private discoverAndCreateHandle;
    private handleConnected;
    private handleMessage;
}

/** Configuration options for Sonos device discovery. */
interface DiscoveryOptions {
    /** How long to listen for SSDP responses, in milliseconds. Defaults to 5000. */
    timeout?: number;
    /** Network interface IP address to bind the SSDP socket to. Useful on multi-homed systems. */
    interfaceAddress?: string;
}
/** A Sonos device discovered via SSDP/UPnP on the local network. */
interface DiscoveredDevice {
    /** IP address of the discovered device. */
    host: string;
    /** WebSocket port for the Sonos Control API (always 1443). */
    port: number;
    /** Model name of the device (e.g. "Sonos Arc", "Sonos Era 300"). */
    model?: string;
    /** Hardware model number. */
    modelNumber?: string;
    /** Device serial number. */
    serialNumber?: string;
    /** Room name assigned to the device in the Sonos app. */
    roomName?: string;
    /** UPnP device description URL returned in the SSDP response. */
    location: string;
}
/**
 * Discovers Sonos devices on the local network using SSDP (Simple Service Discovery Protocol).
 *
 * Sends an M-SEARCH multicast message and collects responses from Sonos ZonePlayers,
 * then fetches each device's UPnP description to obtain model and room information.
 */
declare class SonosDiscovery {
    /**
     * Send an SSDP M-SEARCH and collect all responding Sonos devices.
     *
     * @param options - Discovery configuration (timeout, network interface).
     * @returns An array of discovered Sonos devices on the local network.
     */
    static discover(options?: DiscoveryOptions): Promise<DiscoveredDevice[]>;
    /**
     * Convenience method that discovers Sonos devices and returns the first one found.
     *
     * @param options - Discovery configuration (timeout, network interface).
     * @returns The first discovered device, or `undefined` if none were found.
     */
    static discoverOne(options?: DiscoveryOptions): Promise<DiscoveredDevice | undefined>;
}

/**
 * Thrown for WebSocket connection failures, unexpected disconnections,
 * and reconnect exhaustion.
 *
 * The {@link SonosError.code} will be one of:
 * - {@link ErrorCode.CONNECTION_FAILED} -- initial connection could not be established
 * - {@link ErrorCode.CONNECTION_LOST} -- an existing connection was unexpectedly lost
 * - {@link ErrorCode.RECONNECT_EXHAUSTED} -- all automatic reconnect attempts failed
 */
declare class ConnectionError extends SonosError {
    /**
     * @param code - One of the connection-related {@link ErrorCode} values.
     * @param message - Human-readable description of the connection failure.
     * @param options - Optional context.
     * @param options.cause - The underlying error that caused the connection failure.
     */
    constructor(code: ErrorCode.CONNECTION_FAILED | ErrorCode.CONNECTION_LOST | ErrorCode.RECONNECT_EXHAUSTED, message: string, options?: {
        cause?: unknown;
    });
}

/**
 * Thrown when a Sonos device returns an error response to a command.
 *
 * The {@link SonosError.code} contains the Sonos API error code string
 * (e.g. "ERROR_COMMAND_FAILED", "ERROR_INVALID_PARAMETER").
 * The {@link SonosError.namespace}, {@link SonosError.command}, and
 * {@link SonosError.cmdId} identify which request failed.
 */
declare class CommandError extends SonosError {
    /**
     * @param code - Sonos API error code string from the device response.
     * @param message - Human-readable error description from the device.
     * @param options - Context about the command that failed.
     * @param options.namespace - Sonos API namespace of the failed command.
     * @param options.command - Name of the failed command.
     * @param options.cmdId - Command ID for request/response correlation.
     * @param options.cause - The underlying error, if any.
     */
    constructor(code: string, message: string, options?: {
        namespace?: string;
        command?: string;
        cmdId?: string;
        cause?: unknown;
    });
}

/**
 * Thrown when a command does not receive a response from the Sonos device
 * within the configured timeout period.
 *
 * The {@link SonosError.code} is always {@link ErrorCode.REQUEST_TIMEOUT}.
 */
declare class TimeoutError extends SonosError {
    /**
     * @param message - Human-readable description of the timeout.
     * @param options - Context about the command that timed out.
     * @param options.namespace - Sonos API namespace of the timed-out command.
     * @param options.command - Name of the timed-out command.
     * @param options.cmdId - Command ID for request/response correlation.
     */
    constructor(message: string, options?: {
        namespace?: string;
        command?: string;
        cmdId?: string;
    });
}

export { AudioClipControl, type AudioClipResponse, ClipPriority, ClipType, CommandError, ConnectionError, type ConnectionState, type Container, type CreateGroupResponse, type DiscoveredDevice, type DiscoveryOptions, ErrorCode, type Favorite, FavoritesAccess, type FavoritesResponse, type Group, type GroupCoordinatorChangedEvent, type GroupOptions, type GroupVolumeStatus, type GroupsResponse, HomeTheaterControl, type HomeTheaterOptions, type LoadAudioClipOptions, type LoadFavoriteOptions, type LoadLineInOptions, type LoadPlaylistOptions, type LogLevel, type Logger, type MessageHeaders, type MetadataStatus, type ModifyGroupResponse, NAMESPACE_EVENT_MAP, type PlayModes, type PlaybackActions, PlaybackControl, PlaybackState, type PlaybackStatus, type Player, type PlayerCapability, PlayerHandle, type PlayerSettings, type PlayerVolumeStatus, type Playlist, type PlaylistResponse, type PlaylistTrack, PlaylistsAccess, type PlaylistsResponse, QueueAction, type ReconnectOptions, type ServiceInfo, SettingsControl, SonosClient, type SonosClientOptions, SonosDiscovery, SonosError, type SonosEvents, SonosHousehold, type SonosHouseholdEvents, type SonosHouseholdOptions, type SonosRequest, type SonosResponse, TimeoutError, type Track, type TrackInfo, VolumeControl, type VolumeResponse, consoleLogger, noopLogger };
