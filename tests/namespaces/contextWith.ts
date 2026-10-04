import { vi } from 'vitest';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

/** A namespace context whose connection is just the given `send` mock. */
export function contextWith(send: ReturnType<typeof vi.fn>): NamespaceContext {
  return {
    connection: { send } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'G_1',
    getPlayerId: () => 'P_1',
  };
}
