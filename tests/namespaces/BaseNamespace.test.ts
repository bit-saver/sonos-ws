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

describe('subscription intent', () => {
  const commands = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([req]: any) => req[0].command);

  it('keeps the intent when the subscribe send fails, so resubscribe retries it', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Not connected'))
      .mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await expect(ns.subscribe()).rejects.toThrow('Not connected');
    expect(ns.isSubscribed).toBe(true);

    await ns.resubscribe();
    expect(commands(send)).toEqual(['subscribe', 'subscribe']);
  });

  it('resubscribe sends nothing when events are not wanted', async () => {
    const send = vi.fn().mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await ns.resubscribe();
    expect(send).not.toHaveBeenCalled();
  });

  it('unsubscribe drops the intent even when its send fails', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce([{}, {}])
      .mockRejectedValueOnce(new Error('Not connected'))
      .mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await ns.subscribe();
    await expect(ns.unsubscribe()).rejects.toThrow();
    expect(ns.isSubscribed).toBe(false);

    await ns.resubscribe();
    expect(commands(send)).toEqual(['subscribe', 'unsubscribe']);
  });
});
