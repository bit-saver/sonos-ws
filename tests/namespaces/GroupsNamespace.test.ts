import { describe, it, expect, vi } from 'vitest';
import { GroupsNamespace } from '../../src/namespaces/GroupsNamespace.js';
import { contextWith } from './contextWith.js';

describe('GroupsNamespace.createGroup', () => {
  const bodyOf = (send: ReturnType<typeof vi.fn>) => send.mock.calls[0][0][1];

  it('sends only the players when no music context is given', async () => {
    const send = vi.fn().mockResolvedValue([{}, { group: {} }]);

    await new GroupsNamespace(contextWith(send)).createGroup(['A']);

    expect(bodyOf(send)).toStrictEqual({ playerIds: ['A'] });
  });

  it('sends the group whose audio the new group takes over', async () => {
    const send = vi.fn().mockResolvedValue([{}, { group: {} }]);

    await new GroupsNamespace(contextWith(send)).createGroup(['A'], 'G_B');

    expect(bodyOf(send)).toStrictEqual({ playerIds: ['A'], musicContextGroupId: 'G_B' });
  });
});
