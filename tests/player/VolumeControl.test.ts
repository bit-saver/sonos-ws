import { describe, it, expect, vi } from 'vitest';
import { VolumeControl } from '../../src/player/VolumeControl.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function mockContext(): NamespaceContext {
  return {
    connection: {
      send: vi.fn().mockResolvedValue([{}, { volume: 42, muted: false, fixed: false }]),
    } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'GROUP_1',
    getPlayerId: () => 'PLAYER_1',
  };
}

describe('VolumeControl', () => {
  it('get() delegates to GroupVolumeNamespace.getVolume()', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    const result = await vol.get();
    expect(result).toEqual({ volume: 42, muted: false, fixed: false });
  });

  it('set() sends setVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.set(50);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setVolume');
    expect(body.volume).toBe(50);
  });

  it('relative() sends setRelativeVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.relative(5);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setRelativeVolume');
    expect(body.volumeDelta).toBe(5);
  });

  it('mute() sends setMute command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.mute(true);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setMute');
    expect(body.muted).toBe(true);
  });

  it('player.get() delegates to PlayerVolumeNamespace', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    const result = await vol.player.get();
    expect(result).toBeDefined();
  });

  it('player.set() sends playerVolume setVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.player.set(30);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall[0].namespace).toBe('playerVolume:1');
    expect(lastCall[0].command).toBe('setVolume');
    expect(lastCall[1].volume).toBe(30);
  });
});
