import { describe, it, expect, vi, afterEach } from 'vitest';
import { VolumeControl } from '../../src/player/VolumeControl.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function mockContext(): NamespaceContext {
  const listeners: Record<string, Function[]> = {};
  return {
    connection: {
      send: vi.fn().mockImplementation(async (req: any) => {
        const [headers] = req;
        // After setRelativeVolume on groupVolume, simulate a subscription event
        if (headers.command === 'setRelativeVolume' && headers.namespace === 'groupVolume:1') {
          setTimeout(() => {
            const handlers = listeners['message'] || [];
            for (const h of handlers) {
              h([{ namespace: 'groupVolume:1', groupId: 'GROUP_1' }, { _objectType: 'groupVolume', volume: 47, muted: false, fixed: false }]);
            }
          }, 10);
        }
        return [{}, { volume: 42, muted: false, fixed: false }];
      }),
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      }),
      off: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h: Function) => h !== handler);
        }
      }),
    } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'GROUP_1',
    getPlayerId: () => 'PLAYER_1',
  };
}

describe('VolumeControl', () => {
  describe('individual speaker (default)', () => {
    it('get() returns playerVolume', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      const result = await vol.get();
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      expect(send.mock.calls[0][0][0].namespace).toBe('playerVolume:1');
      expect(result).toEqual({ volume: 42, muted: false, fixed: false });
    });

    it('set() sends playerVolume setVolume', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      await vol.set(50);
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      const [headers, body] = send.mock.calls[0][0];
      expect(headers.namespace).toBe('playerVolume:1');
      expect(headers.command).toBe('setVolume');
      expect(body.volume).toBe(50);
    });

    it('relative() sends playerVolume setRelativeVolume', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      await vol.relative(5);
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      const [headers, body] = send.mock.calls[0][0];
      expect(headers.namespace).toBe('playerVolume:1');
      expect(headers.command).toBe('setRelativeVolume');
      expect(body.volumeDelta).toBe(5);
    });

    it('mute() sends playerVolume setMute', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      await vol.mute(true);
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      const [headers, body] = send.mock.calls[0][0];
      expect(headers.namespace).toBe('playerVolume:1');
      expect(headers.command).toBe('setMute');
      expect(body.muted).toBe(true);
    });
  });

  describe('group volume', () => {
    it('group.get() returns groupVolume', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      const result = await vol.group.get();
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      expect(send.mock.calls[0][0][0].namespace).toBe('groupVolume:1');
      expect(result).toBeDefined();
    });

    it('group.set() sends groupVolume setVolume', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      await vol.group.set(30);
      const send = ctx.connection.send as ReturnType<typeof vi.fn>;
      const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
      expect(lastCall[0].namespace).toBe('groupVolume:1');
      expect(lastCall[0].command).toBe('setVolume');
      expect(lastCall[1].volume).toBe(30);
    });

    it('group.relative() sends groupVolume setRelativeVolume and waits for event', async () => {
      const ctx = mockContext();
      const vol = new VolumeControl(ctx);
      const result = await vol.group.relative(5);
      expect(result.volume).toBe(47); // from the simulated event
    });
  });
});

describe('VolumeControl.group.relative edge cases', () => {
  // A context whose socket delivers the given events right after
  // setRelativeVolume is answered, and whose other commands are scripted.
  function scriptedContext(opts: {
    events?: Array<[Record<string, unknown>, Record<string, unknown>]>;
    setRelative?: () => Promise<unknown>;
    getVolume?: () => Promise<unknown>;
  }) {
    const listeners: Function[] = [];
    const send = vi.fn(async (req: any) => {
      const [headers] = req;
      if (headers.command === 'setRelativeVolume') {
        const reply = opts.setRelative ? await opts.setRelative() : [{}, {}];
        setTimeout(() => { for (const e of opts.events ?? []) for (const h of [...listeners]) h(e); }, 10);
        return reply;
      }
      if (headers.command === 'getVolume') {
        return opts.getVolume ? opts.getVolume() : [{}, { volume: 42, muted: false, fixed: false }];
      }
      return [{}, {}];
    });
    const off = vi.fn((_e: string, h: Function) => {
      const i = listeners.indexOf(h);
      if (i >= 0) listeners.splice(i, 1);
    });
    const ctx: NamespaceContext = {
      connection: {
        send,
        on: vi.fn((_e: string, h: Function) => { listeners.push(h); }),
        off,
      } as unknown as SonosConnection,
      getHouseholdId: () => 'HH_1',
      getGroupId: () => 'GROUP_1',
      getPlayerId: () => 'PLAYER_1',
    };
    return { ctx, send, off, listeners };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a groupVolume event for another group on the coordinator's socket", async () => {
    const { ctx } = scriptedContext({
      events: [
        [{ namespace: 'groupVolume:1', groupId: 'OTHER' }, { _objectType: 'groupVolume', volume: 99, muted: false, fixed: false }],
        [{ namespace: 'groupVolume:1', groupId: 'GROUP_1' }, { _objectType: 'groupVolume', volume: 47, muted: false, fixed: false }],
      ],
    });
    const result = await new VolumeControl(ctx).group.relative(5);
    expect(result.volume).toBe(47);
  });

  it('rejects instead of inventing a volume when no event comes and the read fails', async () => {
    vi.useFakeTimers();
    const { ctx } = scriptedContext({ getVolume: () => Promise.reject(new Error('read failed')) });
    const pending = new VolumeControl(ctx).group.relative(5);
    const outcome = expect(pending).rejects.toThrow('read failed');
    await vi.advanceTimersByTimeAsync(2000);
    await outcome;
  });

  it('removes its listener and timer when setRelativeVolume fails', async () => {
    vi.useFakeTimers();
    const { ctx, send, listeners } = scriptedContext({ setRelative: () => Promise.reject(new Error('refused')) });

    await expect(new VolumeControl(ctx).group.relative(5)).rejects.toThrow('refused');
    expect(listeners).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls.map(([req]: any) => req[0].command)).toEqual(['setRelativeVolume']);
  });
});
