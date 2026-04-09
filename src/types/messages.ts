/** Headers sent and received as the first element of the Sonos WebSocket message array. */
export interface MessageHeaders {
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
export type SonosRequest = [MessageHeaders, Record<string, unknown>];

/** A response or event received from a Sonos device: `[headers, body]`. */
export type SonosResponse = [MessageHeaders, Record<string, unknown>];
