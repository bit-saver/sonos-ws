import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlayerVolumeNamespace } from '../../src/namespaces/PlayerVolumeNamespace.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function contextWith(send: ReturnType<typeof vi.fn>): NamespaceContext {
  return {
    connection: { send } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'G_1',
    getPlayerId: () => 'P_1',
  };
}

describe('command IDs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not depend on a global crypto, which Node 18 exposes only behind a flag', async () => {
    vi.stubGlobal('crypto', undefined);
    const send = vi.fn().mockResolvedValue([{}, {}]);

    await new PlayerVolumeNamespace(contextWith(send)).getVolume();

    expect(send.mock.calls[0][0][0].cmdId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
