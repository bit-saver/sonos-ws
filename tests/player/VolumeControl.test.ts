import { describe, it, expect, vi } from 'vitest';
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
              h([{ namespace: 'groupVolume:1' }, { _objectType: 'groupVolume', volume: 47, muted: false, fixed: false }]);
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
