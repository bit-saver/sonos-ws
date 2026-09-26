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
