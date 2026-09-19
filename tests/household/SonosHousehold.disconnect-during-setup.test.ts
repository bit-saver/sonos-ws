// Regression coverage for: a disconnect() that lands while subscribeToTopology()
// is still in flight must not let setup continue on to connectAllSpeakers().
// subscribeToTopology()'s own try/catch swallows the ConnectionError that
// disconnect() produces (via correlator.rejectAll), so without an explicit
// post-subscribe state check, handleReconnected() cannot tell the two apart:
// "subscribe failed but we're still connected" and "we were torn down while
// subscribe was in flight" both come out of subscribeToTopology() the same
// way — silently.
import { describe, it, expect, vi } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';

const instances: any[] = [];

vi.mock('../../src/client/SonosConnection.js', () => {
  const make = (opts: any) => {
    const listeners = new Map<string, Function[]>();
    const pending: Array<(e: Error) => void> = [];
    const inst: any = {
      host: opts.host,
      state: 'disconnected',
      connectCalls: 0,
      on(event: string, h: Function) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(h);
        return inst;
      },
      off() { return inst; },
      async connect() {
        inst.connectCalls++;
        inst.state = 'connected';
        for (const h of listeners.get('connected') || []) h();
      },
      async disconnect() {
        inst.state = 'disconnected';
        // Mirrors correlator.rejectAll on disconnect.
        for (const r of pending.splice(0)) r(new Error('Client disconnected'));
      },
      // Default dispatch: getGroups succeeds, subscribe hangs until disconnect()
      // rejects it (a slow speaker whose subscribe is still in flight), anything
      // else succeeds. Individual tests below override this per instance.
      send: vi.fn((request: any) => {
        const [headers] = request;
        if (headers.command === 'getGroups') {
          return Promise.resolve([{ householdId: 'HH_1', success: true }, {
            groups: [
              { id: 'G1', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] },
              { id: 'G2', name: 'Office', coordinatorId: 'RINCON_OFFICE', playerIds: ['RINCON_OFFICE'] },
            ],
            players: [
              { id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: 'wss://10.0.0.1:1443/websocket/api' },
              { id: 'RINCON_OFFICE', name: 'Office', capabilities: [], websocketUrl: 'wss://10.0.0.2:1443/websocket/api' },
            ],
          }]);
        }
        if (headers.command === 'subscribe') {
          return new Promise((_res, rej) => pending.push(rej));
        }
        return Promise.resolve([{ success: true }, {}]);
      }),
    };
    instances.push(inst);
    return inst;
  };
  return { SonosConnection: vi.fn(make) };
});

describe('repro: disconnect() while the groups:1 subscribe is in flight', () => {
  it('does not open per-speaker connections after the household was disconnected', async () => {
    const household = new SonosHousehold({ host: '10.0.0.1' });
    const connecting = household.connect();
    connecting.catch(() => {});

    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(instances[0].send.mock.calls.some(([r]: any) => r[0].command === 'subscribe')).toBe(true);

    const before = instances.length;
    await household.disconnect();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const leaked = instances.slice(before).filter((c) => c.connectCalls > 0 && c.state === 'connected');
    expect(leaked).toHaveLength(0);
    await expect(connecting).rejects.toThrow();
  });
});

describe('subscribeToTopology try/catch is load-bearing for the non-disconnect case', () => {
  it('a groups:1 subscribe failure on its own still lets connect() resolve with topology populated', async () => {
    const household = new SonosHousehold({ host: '10.0.9.1', autoConnect: false });
    // The instance just constructed above is the last one pushed.
    const inst = instances[instances.length - 1];
    inst.send = vi.fn((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') {
        return Promise.resolve([{ householdId: 'HH_9', success: true }, {
          groups: [
            { id: 'G1', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] },
          ],
          players: [
            { id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: 'wss://10.0.9.1:1443/websocket/api' },
          ],
        }]);
      }
      if (headers.command === 'subscribe') {
        // The connection is fine — the subscribe command itself is refused —
        // so inst.state stays 'connected' throughout.
        return Promise.reject(new Error('subscribe refused'));
      }
      return Promise.resolve([{ success: true }, {}]);
    });

    await expect(household.connect()).resolves.toBeUndefined();
    expect(household.players.size).toBe(1);
    expect(household.groups.length).toBe(1);
  });
});
