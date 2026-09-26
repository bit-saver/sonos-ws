import type { MessageHeaders } from '../types/messages.js';
import type { SonosEventSource } from '../types/events.js';

/** The source tag for an event's headers; keys the headers lack are omitted, not set to undefined. */
export function sourceOf(headers: MessageHeaders | undefined): SonosEventSource {
  const source: SonosEventSource = {};
  if (headers?.playerId) source.playerId = headers.playerId;
  if (headers?.groupId) source.groupId = headers.groupId;
  return source;
}
