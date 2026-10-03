import { describe, it, expect, vi } from 'vitest';
import { ConnectionSetup } from '../../src/client/ConnectionSetup.js';

function fakeConnection() {
  const listeners = new Map<string, Function[]>();
  const inst: any = {
    state: 'disconnected',
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return inst;
    }),
    connect: vi.fn(async () => {
      inst.state = 'connected';
      for (const h of listeners.get('connected') ?? []) await h();
    }),
    _listeners: listeners,
  };
  return inst;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ConnectionSetup.runAfterSetup', () => {
  it('holds the task until a setup run in flight settles', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const setUp = vi.fn(() => gate);
    const setup = new ConnectionSetup(fakeConnection(), setUp, vi.fn(), logger);

    const connecting = setup.connect();
    await flush();
    expect(setUp).toHaveBeenCalledTimes(1); // parked mid-setup

    const task = vi.fn(async () => {});
    const queued = setup.runAfterSetup(task);
    await flush();
    expect(task).not.toHaveBeenCalled();

    release();
    await Promise.all([connecting, queued]);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
