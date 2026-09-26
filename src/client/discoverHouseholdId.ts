import { randomUUID } from 'node:crypto';
import type { SonosConnection } from './SonosConnection.js';
import type { SonosResponse } from '../types/messages.js';

/**
 * Reads the household ID from a speaker. Sonos refuses `getGroups` without one but names the household in the refusal's
 * headers. Undefined when neither a reply nor a refusal carries it (a timeout, a lost connection).
 */
export async function discoverHouseholdId(connection: SonosConnection): Promise<string | undefined> {
  try {
    const [headers] = await connection.send([
      { namespace: 'groups:1', command: 'getGroups', cmdId: randomUUID() },
      {},
    ]);
    return headers.householdId;
  } catch (err: unknown) {
    // SonosConnection attaches the refused response as the error's cause.
    if (err instanceof Error && Array.isArray(err.cause)) {
      const [headers] = err.cause as SonosResponse;
      return headers?.householdId;
    }
    return undefined;
  }
}
