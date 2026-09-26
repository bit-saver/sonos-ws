// Regression coverage for the binding invariant: connect() must always settle, exactly once.
// The mock below mirrors the real SonosConnection.connect(): it returns at once when the
// socket is already connected, and it shares an in-flight handshake between overlapping callers.
import { describe, it, expect, vi } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';

const instances: any[] = [];

vi.mock('../../src/client/SonosConnection.js', () => {
  const ok = (request: any) => {
    const [headers] = request;
    if (headers.command === 'getGroups') {
      return Promise.resolve([{ householdId: 'HH_1', success: true }, {
        groups: [{ id: 'G1', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] }],
        players: [{ id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: 'wss://10.0.0.1:1443/websocket/api' }],
      }]);
    }
    return Promise.resolve([{ success: true }, {}]);
  };
  const make = (opts: any) => {
    const listeners = new Map<string, Function[]>();
    const inst: any = {
      host: opts.host,
      state: 'disconnected',
      connectPromise: null,
      finishHandshake: null,
      manualHandshake: false,
      listeners,
      ok,
      on(event: string, h: Function) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(h);
        return inst;
      },
      off() { return inst; },
      // Mirrors SonosConnection.connect(): returns at once when connected, shares an in-flight handshake.
      connect() {
        if (inst.state === 'connected') return Promise.resolve();
        if (inst.connectPromise) return inst.connectPromise;
        inst.state = 'connecting';
        inst.connectPromise = new Promise<void>((resolve) => {
          inst.finishHandshake = () => {
            inst.state = 'connected';
            inst.connectPromise = null;
            for (const h of listeners.get('connected') || []) h();
            resolve();
          };
        });
        if (!inst.manualHandshake) setTimeout(() => inst.finishHandshake(), 0);
        return inst.connectPromise;
      },
      async disconnect() { inst.state = 'disconnected'; },
      send: vi.fn(ok),
    };
    instances.push(inst);
    return inst;
  };
  return { SonosConnection: vi.fn(make) };
});

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const outcomeOf = (p: Promise<void>) => {
  const box = { v: 'pending' };
  p.then(() => { box.v = 'ok'; }, (e) => { box.v = 'err: ' + e.message; });
  return box;
};
const topologyReads = (inst: any) =>
  inst.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;

describe('connect() settles every caller exactly once', () => {
  it('two overlapping connect() calls both settle', async () => {
    const household = new SonosHousehold({ host: '10.0.0.1', autoConnect: false });
    const a = outcomeOf(household.connect());
    const b = outcomeOf(household.connect());
    await new Promise((r) => setTimeout(r, 100));
    expect([a.v, b.v]).toEqual(['ok', 'ok']);
  });

  it('a stale background reconnect run failing does not reject a later connect()', async () => {
    const household = new SonosHousehold({ host: '10.0.0.2', autoConnect: false });
    const inst = instances[instances.length - 1];
    await household.connect();

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    inst.send = vi.fn(async (request: any) => {
      const [headers] = request;
      if (headers.namespace === 'groups:1' && headers.command === 'subscribe') { await gate; return [{ success: true }, {}]; }
      return inst.ok(request);
    });

    // Background reconnect run R, parked on its groups:1 subscribe.
    const R = inst.listeners.get('connected')[0]();
    await flush();

    // Socket goes away; the consumer calls connect() again; handshake in flight.
    inst.state = 'disconnected';
    inst.manualHandshake = true;
    const second = outcomeOf(household.connect());
    await flush();
    expect(inst.state).toBe('connecting');

    release();
    await R; // R sees state 'connecting', throws 'Disconnected during setup'
    inst.finishHandshake();
    await new Promise((r) => setTimeout(r, 100));
    expect(second.v).toBe('ok');
  });

  it('connect() retries setup when the socket is up but setup failed', async () => {
    const household = new SonosHousehold({ host: '10.0.0.3', autoConnect: false });
    const inst = instances[instances.length - 1];
    inst.send = vi.fn((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups' && headers.householdId) return Promise.reject(new Error('getGroups failed'));
      return inst.ok(request);
    });

    await expect(household.connect()).rejects.toThrow();
    expect(inst.state).toBe('connected');

    inst.send = vi.fn(inst.ok);

    const timeout = new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('connect() retry hung')), 1000));
    await expect(Promise.race([household.connect(), timeout])).resolves.toBeUndefined();
    expect(household.players.size).toBe(1);
  });

  it('connect() on a set-up, connected household resolves without re-running setup', async () => {
    const household = new SonosHousehold({ host: '10.0.0.4', autoConnect: false });
    const inst = instances[instances.length - 1];
    await household.connect();

    const readsBefore = topologyReads(inst);
    await expect(household.connect()).resolves.toBeUndefined();
    expect(topologyReads(inst)).toBe(readsBefore);
  });
});
