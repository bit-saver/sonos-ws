/**
 * Error codes used by {@link SonosError} and its subclasses.
 *
 * The first four codes are client-side errors raised by sonos-ws itself.
 * The remaining `ERROR_*` codes are Sonos API error codes returned by the device.
 */
export enum ErrorCode {
  /** The initial WebSocket connection to the Sonos device failed. */
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  /** An existing WebSocket connection was unexpectedly lost. */
  CONNECTION_LOST = 'CONNECTION_LOST',
  /** All automatic reconnect attempts have been exhausted. */
  RECONNECT_EXHAUSTED = 'RECONNECT_EXHAUSTED',
  /** A command did not receive a response within the configured timeout. */
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',

  /** The command is missing one or more required parameters. */
  ERROR_MISSING_PARAMETERS = 'ERROR_MISSING_PARAMETERS',
  /** The command has invalid syntax or malformed JSON. */
  ERROR_INVALID_SYNTAX = 'ERROR_INVALID_SYNTAX',
  /** The requested namespace is not supported by this device. */
  ERROR_UNSUPPORTED_NAMESPACE = 'ERROR_UNSUPPORTED_NAMESPACE',
  /** The requested command is not supported within the namespace. */
  ERROR_UNSUPPORTED_COMMAND = 'ERROR_UNSUPPORTED_COMMAND',
  /** The specified object ID (group, player, etc.) is invalid or not found. */
  ERROR_INVALID_OBJECT_ID = 'ERROR_INVALID_OBJECT_ID',
  /** A command parameter has an invalid value. */
  ERROR_INVALID_PARAMETER = 'ERROR_INVALID_PARAMETER',
  /** The command failed for a device-specific reason. */
  ERROR_COMMAND_FAILED = 'ERROR_COMMAND_FAILED',
  /** The target player does not have the required capability for this command. */
  ERROR_NOT_CAPABLE = 'ERROR_NOT_CAPABLE',
  /** The requested content is not available or has no playable items. */
  ERROR_NO_CONTENT = 'ERROR_NO_CONTENT',
  /** The specified player name or ID was not found in the household topology. */
  PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
  /** A multi-step group operation failed partway through. */
  GROUP_OPERATION_FAILED = 'GROUP_OPERATION_FAILED',
}
