// Regression coverage for the binding invariant: connect() must always settle, exactly once.
// The mock mirrors the real async SonosConnection: connect() returns at once when already
// connected and shares an in-flight handshake; disconnect() rejects that handshake and any
// pending sends synchronously, the way the real correlator's rejectAll does.
import { describe, it, expect, vi } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';

const instances: any[] = [];
// Hosts whose handshake needs manual completion (set/cleared per test that uses it).
const manualHosts = new Set<string>();
// Whether the mock topology includes a second player, so a test can exercise connectAllSpeakers().
let twoPlayers = false;

vi.mock('../../src/client/SonosConnection.js', () => {
  const topo = () => [{ householdId: 'HH_1', success: true }, {
    groups: [
      { id: 'G1', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] },
      ...(twoPlayers ? [{ id: 'G2', name: 'Sub', coordinatorId: 'RINCON_SUB', playerIds: ['RINCON_SUB'] }] : []),
    ],
    players: [
      { id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: 'wss://10.0.0.1:1443/websocket/api' },
      ...(twoPlayers ? [{ id: 'RINCON_SUB', name: 'Sub', capabilities: [], websocketUrl: 'wss://10.0.0.9:1443/websocket/api' }] : []),
    ],
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
      manualHandshake: manualHosts.has(opts.host),
      handshakes: 0,
      failTopology: false,
      sent: [] as any[],
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
      // An unexpected close with reconnect enabled: pending sends fail, state goes to 'reconnecting'.
      drop() {
        for (const r of [...pending]) r(new Error('Connection closed: 1006'));
        pending.clear();
        inst.state = 'reconnecting';
        inst.emit('reconnecting', 1, 1000);
      },
      send: vi.fn((request: any) => new Promise((resolve, reject) => {
        const [headers] = request;
        inst.sent.push({ ns: headers.namespace, cmd: headers.command, hh: !!headers.householdId, hs: inst.handshakes, state: inst.state });
        if (inst.state !== 'connected') { reject(new Error('Not connected')); return; }
        if (inst.failTopology && headers.command === 'getGroups' && headers.householdId) { reject(new Error('getGroups failed')); return; }
        pending.add(reject);
        const g = inst.gate?.(headers) ?? null;
        const result = headers.command === 'getGroups' ? topo() : [{ success: true }, {}];
        Promise.resolve(g).then(() => { pending.delete(reject); resolve(result); });
      })),
    };
    instances.push(inst);
    return inst;
  };
  return { SonosConnection: vi.fn(make) };
});

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const outcomeOf = (p: Promise<void>) => {
  const box = { v: 'pending' };
  p.then(() => { box.v = 'ok'; }, (e) => { box.v = 'err: ' + e.message; });
  return box;
};
// Filters to the topology re-read (refreshTopology), not the one-time discoverHouseholdId
// call, which never carries a householdId in its own request headers.
const topologyReads = (inst: any) =>
  inst.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;
// Counts groups:1 subscribes sent while connected on a specific handshake, so a test can tell
// whether a particular socket (not just any socket, ever) got its topology subscription.
const groupsSubsOn = (inst: any, handshake: number) =>
  inst.sent.filter((s: any) => s.ns === 'groups:1' && s.cmd === 'subscribe' && s.hs === handshake && s.state === 'connected').length;

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

  it("a connect() started before an earlier attempt's cleanup runs does not also let the listener set up its handshake", async () => {
    const household = new SonosHousehold({ host: '10.0.0.8', autoConnect: false, reconnect: false });
    const inst = instances[instances.length - 1];
    inst.manualHandshake = true;
    inst.failTopology = true;

    const first = household.connect();
    first.catch(() => {});
    await flush();

    inst.manualHandshake = false;
    // Not awaited: connect() below can start before this call's own cleanup (and first's
    // ownedHandshakes-- decrement) has actually run.
    void household.disconnect();
    const second = household.connect();
    second.catch(() => {});

    await sleep(50);
    expect(topologyReads(inst)).toBe(1);
  });

  it('a connect() whose handshake an older setup run finishes on still sets that socket up (ladder shares the handshake)', async () => {
    twoPlayers = true;
    manualHosts.add('10.0.0.9');
    try {
      const household = new SonosHousehold({ host: '10.0.0.10' });
      const primary = instances[instances.length - 1];
      const first = outcomeOf(household.connect());
      await sleep(20);
      const sub = [...instances].reverse().find((i) => i.host === '10.0.0.9' && i !== primary);

      // The primary drops while first's setup run is still parked in connectAllSpeakers,
      // waiting on the sub speaker's handshake.
      primary.drop();
      primary.manualHandshake = true;
      void primary.connect().catch(() => {}); // the ladder's own reconnect timer: handshake 2, unowned
      const second = outcomeOf(household.connect()); // the consumer calls connect() while it is in flight
      await flush();
      primary.finishHandshake();
      await sleep(20);
      sub.finishHandshake();
      await sleep(50);

      expect(first.v).toBe('ok');
      expect(second.v).toBe('ok');
      expect(groupsSubsOn(primary, 2)).toBeGreaterThan(0);
    } finally {
      twoPlayers = false;
      manualHosts.delete('10.0.0.9');
    }
  });

  it('a connect() whose handshake an older setup run finishes on still sets that socket up (connect() starts the handshake itself)', async () => {
    twoPlayers = true;
    manualHosts.add('10.0.0.9');
    try {
      const household = new SonosHousehold({ host: '10.0.0.11' });
      const primary = instances[instances.length - 1];
      const first = outcomeOf(household.connect());
      await sleep(20);
      const sub = [...instances].reverse().find((i) => i.host === '10.0.0.9' && i.state === 'connecting');

      primary.drop();
      const second = outcomeOf(household.connect()); // starts handshake 2 itself; no separate ladder call
      await sleep(20);
      sub.finishHandshake();
      await sleep(50);

      expect(first.v).toBe('ok');
      expect(second.v).toBe('ok');
      expect(groupsSubsOn(primary, 2)).toBeGreaterThan(0);
    } finally {
      twoPlayers = false;
      manualHosts.delete('10.0.0.9');
    }
  });
});

describe('setup runs once per socket', () => {
  it('connect() during a ladder reconnect run waits for it instead of redoing first-connect setup', async () => {
    const household = new SonosHousehold({ host: '10.0.0.12', autoConnect: false });
    const primary = instances[instances.length - 1];
    await household.connect();
    let connectedEmits = 0;
    household.on('connected', () => { connectedEmits++; });
    const mark = primary.sent.length;

    // The ladder reconnects on its own (handshake 2, unowned); its setup run parks in the topology read.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    primary.gate = (h: any) => (h.command === 'getGroups' && h.householdId ? gate : null);
    primary.drop();
    void primary.connect().catch(() => {});
    await sleep(10);

    const second = outcomeOf(household.connect());
    await flush();
    expect(second.v).toBe('pending');
    primary.gate = null;
    release();
    await sleep(50);

    const after = primary.sent.slice(mark);
    expect(second.v).toBe('ok');
    expect(after.filter((s: any) => s.cmd === 'getGroups' && !s.hh)).toHaveLength(0); // no household rediscovery
    expect(after.filter((s: any) => s.cmd === 'getGroups' && s.hh)).toHaveLength(1);
    expect(groupsSubsOn(primary, 2)).toBe(1);
    expect(connectedEmits).toBe(1);
  });

  it('a ladder reconnect queued behind overlapping connect() calls finds its socket already set up', async () => {
    twoPlayers = true;
    manualHosts.add('10.0.0.9');
    try {
      const household = new SonosHousehold({ host: '10.0.0.13' });
      const primary = instances[instances.length - 1];
      let connectedEmits = 0;
      household.on('connected', () => { connectedEmits++; });
      const a = outcomeOf(household.connect());
      const b = outcomeOf(household.connect());
      await sleep(20);
      const sub = [...instances].reverse().find((i) => i.host === '10.0.0.9' && i.state === 'connecting');

      // While a's setup waits on the sub speaker, the primary drops and the ladder reconnects (handshake 2, unowned).
      primary.drop();
      void primary.connect().catch(() => {});
      await sleep(20);
      sub.finishHandshake();
      await sleep(50);

      expect([a.v, b.v]).toEqual(['ok', 'ok']);
      // b's queued run sets socket 2 up; the ladder's run, queued behind it, has nothing left to do.
      expect(primary.sent.filter((s: any) => s.cmd === 'getGroups' && s.hh && s.hs === 2)).toHaveLength(1);
      expect(groupsSubsOn(primary, 2)).toBe(1);
      expect(connectedEmits).toBe(2); // one per socket
    } finally {
      twoPlayers = false;
      manualHosts.delete('10.0.0.9');
    }
  });
});
