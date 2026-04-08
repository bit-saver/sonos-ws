/** Headers sent/received as the first element of the WebSocket message array. */
export interface MessageHeaders {
  namespace: string;
  command?: string;
  cmdId?: string;
  householdId?: string;
  groupId?: string;
  playerId?: string;
  response?: string;
  type?: string;
  success?: boolean;
  locationId?: string;
}

/** A request sent to Sonos: [headers, body] */
export type SonosRequest = [MessageHeaders, Record<string, unknown>];

/** A response or event received from Sonos: [headers, body] */
export type SonosResponse = [MessageHeaders, Record<string, unknown>];
