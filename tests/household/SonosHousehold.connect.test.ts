// Regression coverage for the binding invariant: connect() must always settle, exactly once.
// The mock mirrors the real async SonosConnection: connect() returns at once when already
// connected and shares an in-flight handshake; disconnect() rejects that handshake and any
// pending sends synchronously, the way the real correlator's rejectAll does.
import { describe, it, expect, vi } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';

const instances: any[] = [];

vi.mock('../../src/client/SonosConnection.js', () => {
  const topo = [{ householdId: 'HH_1', success: true }, {
    groups: [{ id: 'G1', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] }],
    players: [{ id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: 'wss://10.0.0.1:1443/websocket/api' }],
  }];
  const make = (opts: any) => {
    const listeners = new Map<string, Function[]>();
    const pending = new Set<(e: Error) => void>();
    const inst: any = {
      host: opts.host,
      state: 'disconnected',
      connectPromise: null,
      connectReject: null,
      finishHandshake: null,
      failHandshake: null,
      manualHandshake: false,
      handshakes: 0,
      gate: null as null | ((h: any) => Promise<void> | null),
      listeners,
      on(event: string, h: Function) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(h);
        return inst;
      },
      off() { return inst; },
      emit(event: string, ...a: any[]) { for (const h of listeners.get(event) || []) h(...a); },
      // Mirrors the real async connect(): returns at once when connected, shares an in-flight handshake.
      async connect() {
        if (inst.state === 'connected') return;
        if (inst.connectPromise) return inst.connectPromise;
        inst.state = 'connecting';
        inst.handshakes++;
        inst.connectPromise = new Promise<void>((resolve, reject) => {
          inst.connectReject = reject;
          inst.finishHandshake = () => {
            inst.state = 'connected'; inst.connectPromise = null; inst.connectReject = null;
            inst.emit('connected'); resolve();
          };
          inst.failHandshake = () => {
            inst.state = 'disconnected'; inst.connectPromise = null; inst.connectReject = null;
            reject(new Error('handshake failed'));
          };
        });
        if (!inst.manualHandshake) setTimeout(() => inst.finishHandshake(), 0);
        return inst.connectPromise;
      },
      // Mirrors the real disconnect(): rejects an in-flight connect and all pending sends, synchronously.
      async disconnect() {
        const rej = inst.connectReject;
        inst.connectPromise = null;
        inst.connectReject = null;
        rej?.(new Error('Client disconnected'));
        for (const r of [...pending]) r(new Error('Client disconnected'));
        pending.clear();
        inst.state = 'disconnected';
        inst.emit('disconnected', 'client disconnect');
      },
      send: vi.fn((request: any) => new Promise((resolve, reject) => {
        const [headers] = request;
        if (inst.state !== 'connected') { reject(new Error('Not connected')); return; }
        pending.add(reject);
        const g = inst.gate?.(headers) ?? null;
        const result = headers.command === 'getGroups' ? topo : [{ success: true }, {}];
        Promise.resolve(g).then(() => { pending.delete(reject); resolve(result); });
      })),
    };
    instances.push(inst);
    return inst;
  };
  return { SonosConnection: vi.fn(make) };
});

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const outcomeOf = (p: Promise<void>) => {
  const box = { v: 'pending' };
  p.then(() => { box.v = 'ok'; }, (e) => { box.v = 'err: ' + e.message; });
  return box;
};
// Filters to the topology re-read (refreshTopology), not the one-time discoverHouseholdId
// call, which never carries a householdId in its own request headers.
const topologyReads = (inst: any) =>
  inst.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;

describe('connect() settles every caller exactly once', () => {
  it('two overlapping connect() calls both settle, and setup runs once', async () => {
    const household = new SonosHousehold({ host: '10.0.0.1', autoConnect: false });
    const inst = instances[instances.length - 1];
    const a = outcomeOf(household.connect());
    const b = outcomeOf(household.connect());
    await new Promise((r) => setTimeout(r, 100));
    expect([a.v, b.v]).toEqual(['ok', 'ok']);
    expect(topologyReads(inst)).toBe(1);
  });

  it('a failing first-connect setup runs once, not twice', async () => {
    const household = new SonosHousehold({ host: '10.0.0.5', autoConnect: false });
    const inst = instances[instances.length - 1];
    const originalSend = inst.send;
    inst.send = vi.fn((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups' && headers.householdId) return Promise.reject(new Error('getGroups failed'));
      return originalSend(request);
    });

    await expect(household.connect()).rejects.toThrow();
    expect(topologyReads(inst)).toBe(1);
  });

  it('a stale background reconnect run failing does not reject a later connect()', async () => {
    const household = new SonosHousehold({ host: '10.0.0.2', autoConnect: false });
    const inst = instances[instances.length - 1];
    inst.manualHandshake = true;

    // The first connect() attempt fails outright at the handshake.
    const first = outcomeOf(household.connect());
    await flush();
    inst.failHandshake();
    await flush();
    expect(first.v).toMatch(/^err:/);

    // The library's reconnect ladder succeeds in the background; its first-connect run R parks
    // on the groups:1 subscribe.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    inst.gate = (h: any) => (h.namespace === 'groups:1' && h.command === 'subscribe' ? gate : null);
    inst.state = 'connected';
    const R = inst.listeners.get('connected')[0]();
    await flush();

    // Socket goes away; the consumer calls connect() again; its handshake is in flight.
    inst.gate = null;
    inst.state = 'disconnected';
    const second = outcomeOf(household.connect());
    await flush();

    release();
    await R; // R sees state 'connecting', throws 'Disconnected during setup', swallowed by the listener.
    await flush();

    inst.finishHandshake();
    await new Promise((r) => setTimeout(r, 50));
    expect(second.v).toBe('ok');
  });

  it('connect() retries setup when the socket is up but setup failed', async () => {
    const household = new SonosHousehold({ host: '10.0.0.3', autoConnect: false });
    const inst = instances[instances.length - 1];
    const originalSend = inst.send;
    inst.send = vi.fn((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups' && headers.householdId) return Promise.reject(new Error('getGroups failed'));
      return originalSend(request);
    });

    await expect(household.connect()).rejects.toThrow();
    expect(inst.state).toBe('connected');

    inst.send = originalSend;

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

  it('connect() right after disconnect() of a still-handshaking attempt starts a fresh handshake and resolves', async () => {
    const household = new SonosHousehold({ host: '10.0.0.6', autoConnect: false, reconnect: false });
    const inst = instances[instances.length - 1];
    inst.manualHandshake = true;

    const first = household.connect();
    first.catch(() => {});
    await flush();
    const handshakesBefore = inst.handshakes;

    await household.disconnect();
    const second = household.connect();
    await flush();

    expect(inst.handshakes).toBe(handshakesBefore + 1);
    if (inst.state === 'connecting') inst.finishHandshake();
    await expect(second).resolves.toBeUndefined();
    expect(household.players.size).toBe(1);
  });

  it('connect() after disconnect() during a setup run resolves once its own setup runs', async () => {
    const household = new SonosHousehold({ host: '10.0.0.7', autoConnect: false, reconnect: false });
    const inst = instances[instances.length - 1];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    inst.gate = (h: any) => (h.command === 'getGroups' && h.householdId ? gate : null);

    const first = household.connect();
    first.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    await household.disconnect();
    inst.gate = null;

    const second = household.connect();
    await new Promise((r) => setTimeout(r, 50));
    release();

    await expect(second).resolves.toBeUndefined();
    expect(household.players.size).toBe(1);
  });
});
