import { describe, it, expect, vi } from 'vitest';
import { SonosClient } from '../../src/client/SonosClient.js';

vi.mock('../../src/client/SonosConnection.js', () => {
  return {
    SonosConnection: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      state: 'disconnected',
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      removeAllListeners: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      send: vi.fn(),
    })),
  };
});

describe('SonosClient safety-net error listener', () => {
  it('does not throw when emit("error") fires with no user listener attached', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = new SonosClient({ host: '192.168.68.96', logger });

    const emit = (client as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit.bind(client);

    expect(() => emit('error', new Error('boom'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled client error: boom'),
    );
  });
});
