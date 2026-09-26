// Household behavior that depends on WHICH speaker's socket a command or event
// uses. Unlike SonosHousehold.test.ts, every SonosConnection here is its own
// mock, keyed by host, so a test can see which socket carried what.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';
import type { GroupsResponse } from '../../src/types/groups.js';

const instances: any[] = [];
let topology: GroupsResponse;

vi.mock('../../src/client/SonosConnection.js', () => ({
  SonosConnection: vi.fn((opts: any) => {
    const listeners = new Map<string, Function[]>();
    const inst: any = {
      host: opts.host,
      state: 'disconnected',
      on(event: string, handler: Function) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return inst;
      },
      off() { return inst; },
      async connect() {
        inst.state = 'connected';
        for (const h of listeners.get('connected') ?? []) h();
      },
      async disconnect() { inst.state = 'disconnected'; },
      send: vi.fn(async (request: any) => {
        const [headers] = request;
        if (headers.command === 'getGroups') return [{ householdId: 'HH_1', success: true }, topology];
        return [{ success: true }, {}];
      }),
      _listeners: listeners,
      _emit(event: string, ...args: unknown[]) {
        for (const h of [...(listeners.get(event) ?? [])]) h(...args);
      },
    };
    instances.push(inst);
    return inst;
  }),
}));

const PRIMARY = '10.0.0.1';
const OFFICE_IP = '10.0.0.2';
const BED_IP = '10.0.0.3';
const KITCHEN_IP = '10.0.0.4';

const ARC = { id: 'RINCON_ARC', name: 'Arc', capabilities: [], websocketUrl: `wss://${PRIMARY}:1443/websocket/api` };
const OFFICE = { id: 'RINCON_OFFICE', name: 'Office', capabilities: [], websocketUrl: `wss://${OFFICE_IP}:1443/websocket/api` };
const BED = { id: 'RINCON_BED', name: 'Bedroom', capabilities: [], websocketUrl: `wss://${BED_IP}:1443/websocket/api` };
const KITCHEN = { id: 'RINCON_KITCHEN', name: 'Kitchen', capabilities: [], websocketUrl: `wss://${KITCHEN_IP}:1443/websocket/api` };

const solo = {
  groups: [
    { id: 'G_ARC', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] },
    { id: 'G_OFF', name: 'Office', coordinatorId: 'RINCON_OFFICE', playerIds: ['RINCON_OFFICE'] },
    { id: 'G_BED', name: 'Bedroom', coordinatorId: 'RINCON_BED', playerIds: ['RINCON_BED'] },
  ],
  players: [ARC, OFFICE, BED],
} as GroupsResponse;

const officeUnderBedroom = {
  groups: [
    { id: 'G_ARC', name: 'Arc', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC'] },
    { id: 'G_BED', name: 'Bedroom + 1', coordinatorId: 'RINCON_BED', playerIds: ['RINCON_BED', 'RINCON_OFFICE'] },
  ],
  players: [ARC, OFFICE, BED],
} as GroupsResponse;

const socket = (host: string) => {
  const found = instances.find((i) => i.host === host);
  if (!found) throw new Error(`no socket for ${host}`);
  return found;
};

/** Headers of every command sent through a host's socket, optionally filtered. */
const sentVia = (host: string, namespace?: string, command?: string) =>
  socket(host).send.mock.calls
    .map(([req]: any) => req[0])
    .filter((h: any) => (!namespace || h.namespace === namespace) && (!command || h.command === command));

async function connectedHousehold(start: GroupsResponse): Promise<SonosHousehold> {
  instances.length = 0;
  topology = start;
  const household = new SonosHousehold({ host: PRIMARY });
  await household.connect();
  return household;
}

describe('routing group-level commands', () => {
  it("sends a grouped non-coordinator's playback through the coordinator's socket", async () => {
    const household = await connectedHousehold(officeUnderBedroom);

    await household.player('Office').playback.pause();

    expect(sentVia(OFFICE_IP, 'playback:1', 'pause')).toHaveLength(0);
    expect(sentVia(BED_IP, 'playback:1', 'pause')).toEqual([
      expect.objectContaining({ groupId: 'G_BED', playerId: 'RINCON_OFFICE' }),
    ]);
  });

  it('routes a player discovered after setup through its coordinator too', async () => {
    const household = await connectedHousehold(solo);
    topology = {
      groups: [
        ...solo.groups.filter((g) => g.id !== 'G_BED'),
        { id: 'G_BED', name: 'Bedroom + 1', coordinatorId: 'RINCON_BED', playerIds: ['RINCON_BED', 'RINCON_KITCHEN'] },
      ],
      players: [ARC, OFFICE, BED, KITCHEN],
    } as GroupsResponse;

    await household.refreshTopology();
    await household.player('Kitchen').playback.pause();

    expect(sentVia(PRIMARY, 'playback:1', 'pause')).toHaveLength(0);
    expect(sentVia(BED_IP, 'playback:1', 'pause')).toEqual([
      expect.objectContaining({ groupId: 'G_BED', playerId: 'RINCON_KITCHEN' }),
    ]);
  });
});

describe('events from every socket', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers an event from a speaker's own socket, tagged with its group", async () => {
    const household = await connectedHousehold(officeUnderBedroom);
    const heard: unknown[][] = [];
    household.on('volumeChanged', (...args) => heard.push(args));

    socket(BED_IP)._emit('message', [
      { namespace: 'groupVolume:1', type: 'groupVolume', groupId: 'G_BED' },
      { _objectType: 'groupVolume', volume: 30, muted: false, fixed: false },
    ]);

    expect(heard).toEqual([[
      { _objectType: 'groupVolume', volume: 30, muted: false, fixed: false },
      { groupId: 'G_BED' },
    ]]);
  });

  it('tags a player-level event from the primary with its player', async () => {
    const household = await connectedHousehold(solo);
    const heard: unknown[][] = [];
    household.on('playerVolumeChanged', (...args) => heard.push(args));

    socket(PRIMARY)._emit('message', [
      { namespace: 'playerVolume:1', type: 'playerVolume', playerId: 'RINCON_ARC' },
      { _objectType: 'playerVolume', volume: 12, muted: false, fixed: false },
    ]);

    expect(heard[0]?.[1]).toEqual({ playerId: 'RINCON_ARC' });
  });

  it('turns coordinator changes reported by several sockets into one topology read', async () => {
    const household = await connectedHousehold(solo);
    vi.useFakeTimers();
    const reads = () => sentVia(PRIMARY, 'groups:1', 'getGroups').filter((h: any) => h.householdId).length;
    const before = reads();
    const changed = [
      { namespace: 'global', type: 'groupCoordinatorChanged', groupId: 'G_OFF' },
      { _objectType: 'groupCoordinatorChanged', groupStatus: 'GROUP_STATUS_GONE' },
    ];

    socket(OFFICE_IP)._emit('message', changed);
    socket(BED_IP)._emit('message', changed);
    await vi.advanceTimersByTimeAsync(300);

    expect(reads()).toBe(before + 1);
    void household;
  });
});

describe('subscription upkeep', () => {
  const wantedOn = (host: string, namespace: string, extra: Record<string, string>) =>
    sentVia(host, namespace, 'subscribe').filter((h: any) => Object.entries(extra).every(([k, v]) => h[k] === v)).length;

  it("re-subscribes a moved player's group events on its new coordinator's socket", async () => {
    const household = await connectedHousehold(solo);

    topology = officeUnderBedroom;
    await household.refreshTopology();
    await vi.waitFor(() =>
      expect(wantedOn(BED_IP, 'playback:1', { groupId: 'G_BED', playerId: 'RINCON_OFFICE' })).toBe(1));

    // Office leaves and comes back under a new group ID, as it does live.
    topology = {
      ...solo,
      groups: solo.groups.map((g) => (g.id === 'G_OFF' ? { ...g, id: 'G_OFF_2' } : g)),
    } as GroupsResponse;
    await household.refreshTopology();
    await vi.waitFor(() =>
      expect(wantedOn(OFFICE_IP, 'playback:1', { groupId: 'G_OFF_2', playerId: 'RINCON_OFFICE' })).toBe(1));
  });

  it('does not re-send when only playback state changed', async () => {
    const household = await connectedHousehold(solo);
    const subscribes = () => instances.reduce((n, i) => n + i.send.mock.calls.filter(([r]: any) => r[0].command === 'subscribe').length, 0);
    const before = subscribes();

    topology = {
      ...solo,
      groups: solo.groups.map((g) => ({ ...g, playbackState: 'PLAYBACK_STATE_PLAYING' })),
    } as GroupsResponse;
    await household.refreshTopology();
    for (let i = 0; i < 30; i++) await Promise.resolve();

    expect(subscribes()).toBe(before);
  });

  it("restores a speaker's subscriptions when its own socket reconnects", async () => {
    await connectedHousehold(solo);
    const before = wantedOn(OFFICE_IP, 'homeTheater:1', { playerId: 'RINCON_OFFICE' });

    socket(OFFICE_IP)._emit('connected');

    await vi.waitFor(() =>
      expect(wantedOn(OFFICE_IP, 'homeTheater:1', { playerId: 'RINCON_OFFICE' })).toBe(before + 1));
  });

  it('a primary reconnect re-sends what is wanted, and only that', async () => {
    const household = await connectedHousehold(solo);
    await household.player('Arc').volume.subscribe();

    await socket(PRIMARY)._listeners.get('connected')[0]();

    expect(wantedOn(PRIMARY, 'playerVolume:1', { playerId: 'RINCON_ARC' })).toBe(2);
    expect(sentVia(OFFICE_IP, 'playerVolume:1', 'subscribe')).toHaveLength(0);
    expect(sentVia(BED_IP, 'playerVolume:1', 'subscribe')).toHaveLength(0);
  });

  it("re-sends a new speaker's player-level subscriptions only on its own socket once that connects", async () => {
    const household = await connectedHousehold(solo);
    topology = {
      groups: [...solo.groups, { id: 'G_KIT', name: 'Kitchen', coordinatorId: 'RINCON_KITCHEN', playerIds: ['RINCON_KITCHEN'] }],
      players: [ARC, OFFICE, BED, KITCHEN],
    } as GroupsResponse;
    await household.refreshTopology();
    // Kitchen has no socket of its own yet, so this goes out on the primary.
    await household.player('Kitchen').volume.subscribe();
    expect(wantedOn(PRIMARY, 'playerVolume:1', { playerId: 'RINCON_KITCHEN' })).toBe(1);

    // A primary reconnect opens Kitchen's own socket.
    await socket(PRIMARY)._listeners.get('connected')[0]();

    expect(wantedOn(PRIMARY, 'playerVolume:1', { playerId: 'RINCON_KITCHEN' })).toBe(1);
    expect(wantedOn(KITCHEN_IP, 'playerVolume:1', { playerId: 'RINCON_KITCHEN' })).toBeGreaterThan(0);
  });
});
