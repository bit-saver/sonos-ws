# Command Routing, Subscription Upkeep and SonosClient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route group-level commands through the group coordinator's socket, keep event subscriptions alive across regroups and reconnects, forward every speaker's events to listeners with a source tag, and make `SonosClient` work.

**Architecture:** `PlayerHandle` already has a coordinator context (used by group volume); playback, metadata and the favorites/playlists `load` commands move onto it. Subscriptions become *intents* on each namespace; the household re-sends every wanted subscription whenever one may have died (idempotent on the wire, verified live). The household listens for events on every socket it owns and tags each with the `playerId`/`groupId` from its headers. Setup runs are serialized on a promise chain in both `SonosHousehold` and `SonosClient`.

**Tech Stack:** TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), `ws` 8, vitest 2, tsup. Runtime in production is Bun.

**Spec:** `docs/superpowers/specs/2026-09-25-routing-and-subscription-upkeep-design.md` — read it before starting any task. It holds the live evidence behind each change.

## Global Constraints

- Branch: `routing-and-subscription-upkeep`. Commit after every task; conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`). **Never add a `Co-Authored-By` line.**
- Verify with `npx vitest run` (all tests) and `npx tsc --noEmit` before every commit. Both must be clean.
- **Do not rebuild or commit `dist/` in Tasks 1–9.** Task 10 rebuilds it once.
- Bun ignores `ws` constructor options; every mechanism must be library-level. Bun's `'error'` listeners receive a browser-style `ErrorEvent`.
- The `ws` mock in `tests/client/SonosConnection.test.ts` throws on an unlistened `'error'` on purpose. Do not weaken it.
- **Mutation-verify every test that guards an invariant:** break the guarded line, run the test, confirm exactly that test fails, restore. Each task names which tests need it. Report the result in your summary.
- `connect()` must always settle, exactly once. Every handler inside `SonosConnection.connect()` acts on its captured `socket`, never `this.ws`.
- American spelling in comments and docs. Match the surrounding comment density: explain *why*, not *what*.
- `tests/` is not type-checked by `tsc` (tsconfig includes only `src/`), but keep test code type-plausible.

---

### Task 1: Small cleanups — `node:crypto`, `tsx`, stray docstring

**Files:**
- Create: `tests/namespaces/BaseNamespace.test.ts`
- Modify: `src/namespaces/BaseNamespace.ts:99`, `src/household/SonosHousehold.ts:297-333,450`, `src/client/SonosClient.ts:108`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `tests/namespaces/BaseNamespace.test.ts` with a `contextWith(send)` helper that Task 3b extends.

- [ ] **Step 1: Write the failing test**

Create `tests/namespaces/BaseNamespace.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlayerVolumeNamespace } from '../../src/namespaces/PlayerVolumeNamespace.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function contextWith(send: ReturnType<typeof vi.fn>): NamespaceContext {
  return {
    connection: { send } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'G_1',
    getPlayerId: () => 'P_1',
  };
}

describe('command IDs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not depend on a global crypto, which Node 18 exposes only behind a flag', async () => {
    vi.stubGlobal('crypto', undefined);
    const send = vi.fn().mockResolvedValue([{}, {}]);

    await new PlayerVolumeNamespace(contextWith(send)).getVolume();

    expect(send.mock.calls[0][0][0].cmdId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/namespaces/BaseNamespace.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'randomUUID')`. If it passes instead, the stub did not remove the global; stop and report rather than weakening the test.

- [ ] **Step 3: Import `randomUUID` from `node:crypto` in all three places**

`src/namespaces/BaseNamespace.ts` — add at the top, after the existing imports:

```typescript
import { randomUUID } from 'node:crypto';
```

and change `cmdId: crypto.randomUUID(),` to `cmdId: randomUUID(),`.

`src/household/SonosHousehold.ts` and `src/client/SonosClient.ts` — add the same import and change `crypto.randomUUID()` to `randomUUID()` (one occurrence each).

Confirm none remain: `grep -rn "crypto.randomUUID" src` prints nothing.

- [ ] **Step 4: Move the stray docstring back onto `subscribeToTopology`**

In `src/household/SonosHousehold.ts`, the block starting `Subscribes to household group changes, so topology follows every regroup` (currently directly above the `subscribeDiagnostics` docstring) belongs to `subscribeToTopology`. Cut that whole `/** … */` block and paste it immediately above `private async subscribeToTopology(): Promise<void> {`. Nothing else changes.

- [ ] **Step 5: Add `tsx` so `examples/smoke.ts` runs as documented**

Run: `npm install --save-dev tsx`
Then: `npx tsx --version` prints a version.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (87), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/namespaces/BaseNamespace.ts src/household/SonosHousehold.ts src/client/SonosClient.ts tests/namespaces/BaseNamespace.test.ts package.json package-lock.json
git commit -m "fix: import randomUUID from node:crypto so Node 18 works as engines claims

Also re-home the subscribeToTopology docstring and add tsx, which
examples/smoke.ts documents but was never installed."
```

---

### Task 2: `SonosConnection` — wait out a handshake in `send()`, name the host in log lines

**Files:**
- Modify: `src/client/SonosConnection.ts` (`send()` at `:343-362`, `handleMessage()` at `:401-403`)
- Test: `tests/client/SonosConnection.test.ts` (the `send-during-reconnect` and `event logging` describes)

**Interfaces:**
- Produces: log line formats `Sending <ns>.<command> @<host> [<cmdId>]` and `Event: <ns>.<type> @<host> <body>`. Memory and docs in Task 10 quote these.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('SonosConnection send-during-reconnect', …)` in `tests/client/SonosConnection.test.ts`:

```typescript
  it('waits for a ladder attempt that is still handshaking instead of throwing', async () => {
    const conn = new SonosConnection(makeOptions());
    const connecting = conn.connect();
    getLastMockWs()._emit('open');
    await connecting;

    getLastMockWs()._emit('close', 1006, Buffer.from(''));
    expect(conn.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100); // the ladder's first attempt starts

    const ws2 = getLastMockWs();
    ws2.readyState = 0; // CONNECTING: the handshake has not finished
    expect(conn.state).toBe('connecting');

    let settled = false;
    const sending = conn.send([{ cmdId: 'c1', namespace: 'test:1', command: 'test' }, {}]);
    sending.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    ws2.readyState = 1;
    ws2._emit('open');
    await vi.advanceTimersByTimeAsync(0);

    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws2.send.mock.calls[0][0])[0].cmdId).toBe('c1');
  });

  it('waits for the first connect too', async () => {
    const conn = new SonosConnection(makeOptions());
    const connecting = conn.connect();
    const ws = getLastMockWs();
    ws.readyState = 0;

    const sending = conn.send([{ cmdId: 'c2', namespace: 'test:1', command: 'test' }, {}]);
    sending.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.send).not.toHaveBeenCalled();

    ws.readyState = 1;
    ws._emit('open');
    await connecting;
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it('still fails fast once a lone attempt fails with reconnect disabled', async () => {
    const conn = new SonosConnection(makeOptions({ enabled: false }));
    conn.on('error', () => {});
    const connecting = conn.connect();
    connecting.catch(() => {});
    const ws = getLastMockWs();
    ws.readyState = 0;

    const sending = conn.send([{ cmdId: 'c3', namespace: 'test:1', command: 'test' }, {}]);
    ws._emit('error', new Error('refused'));

    await expect(sending).rejects.toThrow('Not connected');
  });
```

Add inside `describe('event logging', …)`:

```typescript
  it("names the socket's host on event and send lines", async () => {
    // A household holds a socket per speaker. Without the host, an event line
    // cannot say which speaker reported it, and a send line cannot say which
    // socket a command went through — the question every routing bug asks.
    const options = makeOptions({ pingInterval: 0 });
    const conn = new SonosConnection(options);
    conn.on('error', () => {});
    const pending = conn.connect();
    const ws = getLastMockWs();
    ws._emit('open');
    await pending;

    ws._emit('message', JSON.stringify([
      { namespace: 'playerVolume:1', type: 'playerVolume' },
      { _objectType: 'playerVolume', volume: 12, muted: false, fixed: false },
    ]));
    conn.send([{ cmdId: 'c4', namespace: 'test:1', command: 'test' }, {}]).catch(() => {});

    const logged = options.logger.debug.mock.calls.map((c: any[]) => String(c[0]));
    expect(logged).toContain('Sending test:1.test @192.168.68.96 [c4]');
    expect(logged.some((l: string) => l.startsWith('Event: playerVolume:1.playerVolume @192.168.68.96 {'))).toBe(true);
  });
```

- [ ] **Step 2: Run them and confirm the right ones fail**

Run: `npx vitest run tests/client/SonosConnection.test.ts`
Expected: FAIL for `waits for a ladder attempt…`, `waits for the first connect too` (both reject with `Not connected`) and `names the socket's host…`. `still fails fast…` passes before and after the change; it pins the bound.

- [ ] **Step 3: Implement**

In `send()`, replace

```typescript
    if (this._state === 'reconnecting') {
      await this.waitForReconnect();
    }
```

with

```typescript
    // Every ladder attempt passes through 'connecting' on its way back, so a
    // command that lands in an attempt's handshake would fail where one sent
    // a moment earlier, in 'reconnecting', waits. Wait for the attempt to
    // settle instead. connect() always settles — connectTimeout bounds even a
    // handshake that emits nothing — so this wait is bounded too.
    if (this._state === 'connecting' && this.connectPromise) {
      await this.connectPromise.catch(() => {
        // Judged by the state checks below: a failed attempt leaves either
        // 'reconnecting' (wait for the ladder) or 'disconnected' (throw).
      });
    }

    if (this._state === 'reconnecting') {
      await this.waitForReconnect();
    }
```

Change the send log line to:

```typescript
    this.log.debug(`Sending ${namespace}.${command} @${this.options.host} [${cmdId}]`);
```

and the event log line in `handleMessage()` to:

```typescript
    this.log.debug(
      `Event: ${headers?.namespace}.${headers?.type ?? headers?.command} @${this.options.host} ${summarize(body)}`,
    );
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including the two existing `event logging` tests (they match on a prefix that is unchanged).

- [ ] **Step 5: Mutation-verify**

Delete the new `if (this._state === 'connecting' …)` block; run the file; confirm exactly `waits for a ladder attempt…` and `waits for the first connect too` fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts tests/client/SonosConnection.test.ts
git commit -m "fix: wait out a handshake in send() and name the host in socket log lines

A ladder attempt passes through 'connecting', so a command landing in its
handshake threw 'Not connected' instead of waiting like the rest of the
reconnect."
```

---

### Task 3a: Route group-level commands through the coordinator in `PlayerHandle`

**Files:**
- Modify: `src/player/PlayerHandle.ts`, `src/player/FavoritesAccess.ts`, `src/player/PlaylistsAccess.ts`
- Test: `tests/player/PlayerHandle.test.ts`

**Interfaces:**
- Produces: `PlayerHandle.coordinatorId: string` (getter). `FavoritesAccess(context, coordinatorContext = context)`, `PlaylistsAccess(context, coordinatorContext = context)`.

Live evidence (spec §1): through a grouped non-coordinator's own socket, `playback:1` and `playbackMetadata:1` fail with `groupCoordinatorChanged`; `playerVolume:1`, `settings:1`, `getFavorites` and `getPlaylists` work.

- [ ] **Step 1: Write the failing tests**

Append to `tests/player/PlayerHandle.test.ts`:

```typescript
describe('PlayerHandle routing for a grouped non-coordinator', () => {
  const officePlayer: Player = { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'] };
  const underBedroom: Group = {
    id: 'RINCON_BED:1',
    name: 'Bedroom + 1',
    coordinatorId: 'RINCON_BED',
    playerIds: ['RINCON_BED', 'RINCON_OFFICE'],
  };

  function office() {
    const speaker = mockConnection();
    const groups = mockConnection();
    const coordinator = mockConnection();
    const handle = new PlayerHandle(officePlayer, underBedroom, 'HH_1', speaker, groups);
    handle.setCoordinatorConnectionResolver(() => coordinator);
    return { handle, speaker, coordinator };
  }

  const sentOn = (conn: SonosConnection) =>
    (conn.send as ReturnType<typeof vi.fn>).mock.calls.map(([req]: any) => req[0]);

  it('exposes its coordinator', () => {
    const { handle } = office();
    expect(handle.coordinatorId).toBe('RINCON_BED');
    expect(handle.isCoordinator).toBe(false);
  });

  it.each([
    ['playback.pause', (h: PlayerHandle) => h.playback.pause(), 'playback:1', 'pause'],
    ['playback.getStatus', (h: PlayerHandle) => h.playback.getStatus(), 'playback:1', 'getPlaybackStatus'],
    ['playback.getMetadata', (h: PlayerHandle) => h.playback.getMetadata(), 'playbackMetadata:1', 'getMetadataStatus'],
    ['favorites.load', (h: PlayerHandle) => h.favorites.load('F1'), 'favorites:1', 'loadFavorite'],
    ['playlists.load', (h: PlayerHandle) => h.playlists.load('PL1'), 'playlists:1', 'loadPlaylist'],
  ])('%s goes through the coordinator socket', async (_name, call, namespace, command) => {
    const { handle, speaker, coordinator } = office();
    await call(handle);
    expect(sentOn(speaker)).toHaveLength(0);
    expect(sentOn(coordinator)).toEqual([
      expect.objectContaining({ namespace, command, groupId: 'RINCON_BED:1', playerId: 'RINCON_OFFICE' }),
    ]);
  });

  it.each([
    ['volume.set', (h: PlayerHandle) => h.volume.set(20), 'playerVolume:1', 'setVolume'],
    ['favorites.get', (h: PlayerHandle) => h.favorites.get(), 'favorites:1', 'getFavorites'],
    ['playlists.get', (h: PlayerHandle) => h.playlists.get(), 'playlists:1', 'getPlaylists'],
    ['homeTheater.get', (h: PlayerHandle) => h.homeTheater.get(), 'homeTheater:1', 'getOptions'],
    ['settings.get', (h: PlayerHandle) => h.settings.get(), 'settings:1', 'getPlayerSettings'],
  ])('%s stays on the player socket', async (_name, call, namespace, command) => {
    const { handle, speaker, coordinator } = office();
    await call(handle);
    expect(sentOn(coordinator)).toHaveLength(0);
    expect(sentOn(speaker)).toEqual([expect.objectContaining({ namespace, command })]);
  });
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run tests/player/PlayerHandle.test.ts`
Expected: FAIL — `exposes its coordinator` (`coordinatorId` undefined) and all five `goes through the coordinator socket` cases (sent on the speaker socket). The `stays on the player socket` cases pass.

- [ ] **Step 3: Implement `FavoritesAccess`**

Replace the class body in `src/player/FavoritesAccess.ts`:

```typescript
/** Access and load Sonos favorites. */
export class FavoritesAccess {
  private readonly ns: FavoritesNamespace;
  private readonly groupNs: FavoritesNamespace;

  /**
   * @param context — for reading favorites, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context: NamespaceContext, coordinatorContext: NamespaceContext = context) {
    this.ns = new FavoritesNamespace(context);
    this.groupNs = new FavoritesNamespace(coordinatorContext);
  }

  /** Retrieves the list of Sonos favorites. */
  async get(): Promise<FavoritesResponse> { return this.ns.getFavorites(); }

  /**
   * Loads a favorite into the queue.
   * @param id - Favorite ID.
   * @param options - Queue action and playback options.
   */
  async load(id: string, options?: LoadFavoriteOptions): Promise<void> { return this.groupNs.loadFavorite(id, options); }
}
```

- [ ] **Step 4: Implement `PlaylistsAccess` the same way**

Replace the class body in `src/player/PlaylistsAccess.ts`:

```typescript
/** Access and load Sonos playlists. */
export class PlaylistsAccess {
  private readonly ns: PlaylistsNamespace;
  private readonly groupNs: PlaylistsNamespace;

  /**
   * @param context — for reading playlists, which any speaker answers
   * @param coordinatorContext — for loading one, a group command that Sonos
   *   accepts only on the group coordinator's socket
   */
  constructor(context: NamespaceContext, coordinatorContext: NamespaceContext = context) {
    this.ns = new PlaylistsNamespace(context);
    this.groupNs = new PlaylistsNamespace(coordinatorContext);
  }

  /** Retrieves all Sonos playlists. */
  async get(): Promise<PlaylistsResponse> { return this.ns.getPlaylists(); }

  /**
   * Retrieves a specific playlist with its tracks.
   * @param id - Playlist ID.
   */
  async getPlaylist(id: string): Promise<PlaylistResponse> { return this.ns.getPlaylist(id); }

  /**
   * Loads a playlist into the queue.
   * @param id - Playlist ID.
   * @param options - Playback options.
   */
  async load(id: string, options?: LoadPlaylistOptions): Promise<void> { return this.groupNs.loadPlaylist(id, options); }
}
```

- [ ] **Step 5: Rewire `PlayerHandle`**

In `src/player/PlayerHandle.ts`, replace the coordinator-context comment

```typescript
    // Coordinator context — for group volume commands, which must go
    // through the group coordinator's connection. Falls back to speaker
    // connection if no resolver is set (e.g. SonosClient single-connection).
```

with

```typescript
    // Coordinator context — for group-level commands: group volume,
    // playback, playback metadata, and loading a favorite or playlist. Sonos
    // accepts these only on the group coordinator's socket; a grouped
    // non-coordinator's own socket answers groupCoordinatorChanged (verified
    // live 2026-09-25). Falls back to the speaker connection when no
    // resolver is set (SonosClient's single connection).
```

Replace the construction lines

```typescript
    this.playback = new PlaybackControl(speakerContext);
    this.favorites = new FavoritesAccess(speakerContext);
    this.playlists = new PlaylistsAccess(speakerContext);
```

with

```typescript
    this.playback = new PlaybackControl(coordinatorContext);
    this.favorites = new FavoritesAccess(speakerContext, coordinatorContext);
    this.playlists = new PlaylistsAccess(speakerContext, coordinatorContext);
```

Add the getter directly after `get isCoordinator()`:

```typescript
  /** RINCON ID of the coordinator of this player's current group. */
  get coordinatorId(): string {
    return this._group.coordinatorId;
  }
```

Update the `setCoordinatorConnectionResolver` docstring's second line to: `Used for group-level commands, which must go through the coordinator's WebSocket.`

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 7: Mutation-verify**

Change `new PlaybackControl(coordinatorContext)` back to `speakerContext`; confirm exactly the three playback cases fail. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/player tests/player/PlayerHandle.test.ts
git commit -m "fix: route playback, metadata and favorite/playlist loads through the coordinator

A grouped non-coordinator's own socket answers these with
groupCoordinatorChanged, so play/pause/skip on such a speaker failed.
Group volume was the only group-level command routed correctly."
```

---

### Task 3b: Subscription intents and `resubscribe()`

**Files:**
- Create: `src/util/settleAll.ts`
- Modify: `src/namespaces/BaseNamespace.ts:40-78`, `src/player/VolumeControl.ts`, `src/player/PlaybackControl.ts`, `src/player/HomeTheaterControl.ts`, `src/player/PlayerHandle.ts`
- Test: `tests/namespaces/BaseNamespace.test.ts`, `tests/player/PlayerHandle.test.ts`

**Interfaces:**
- Consumes: `contextWith(send)` from Task 1; the `office()` helper from Task 3a.
- Produces: `settleAll(tasks: Promise<unknown>[], message: string): Promise<void>`; `BaseNamespace.resubscribe()` (re-sends if wanted); `VolumeControl.resubscribe()`, `PlaybackControl.resubscribe()`, `HomeTheaterControl.resubscribe()` (all `@internal`); `PlaybackControl.subscribeMetadata()` / `unsubscribeMetadata()`; `PlayerHandle.resubscribe(): Promise<void>` — attempts every wanted subscription, rejects with an `AggregateError` of all failures.

Live evidence (spec, Decisions): subscribing twice to one target on one socket yields one event per change, and one `unsubscribe` removes it — so re-sending is safe.

- [ ] **Step 1: Write the failing tests**

Append to `tests/namespaces/BaseNamespace.test.ts`:

```typescript
describe('subscription intent', () => {
  const commands = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([req]: any) => req[0].command);

  it('keeps the intent when the subscribe send fails, so resubscribe retries it', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Not connected'))
      .mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await expect(ns.subscribe()).rejects.toThrow('Not connected');
    expect(ns.isSubscribed).toBe(true);

    await ns.resubscribe();
    expect(commands(send)).toEqual(['subscribe', 'subscribe']);
  });

  it('resubscribe sends nothing when events are not wanted', async () => {
    const send = vi.fn().mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await ns.resubscribe();
    expect(send).not.toHaveBeenCalled();
  });

  it('unsubscribe drops the intent even when its send fails', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce([{}, {}])
      .mockRejectedValueOnce(new Error('Not connected'))
      .mockResolvedValue([{}, {}]);
    const ns = new PlayerVolumeNamespace(contextWith(send));

    await ns.subscribe();
    await expect(ns.unsubscribe()).rejects.toThrow();
    expect(ns.isSubscribed).toBe(false);

    await ns.resubscribe();
    expect(commands(send)).toEqual(['subscribe', 'unsubscribe']);
  });
});
```

Append inside `describe('PlayerHandle routing for a grouped non-coordinator', …)` in `tests/player/PlayerHandle.test.ts`:

```typescript
  it('subscribeMetadata subscribes playbackMetadata:1 through the coordinator', async () => {
    const { handle, coordinator } = office();
    await handle.playback.subscribeMetadata();
    expect(sentOn(coordinator)).toEqual([
      expect.objectContaining({ namespace: 'playbackMetadata:1', command: 'subscribe', groupId: 'RINCON_BED:1' }),
    ]);
  });

  it('resubscribe re-sends every wanted subscription, each on its own socket, and nothing else', async () => {
    const { handle, speaker, coordinator } = office();
    await handle.volume.subscribe();
    await handle.volume.group.subscribe();
    await handle.playback.subscribe();
    await handle.homeTheater.subscribe();
    (speaker.send as ReturnType<typeof vi.fn>).mockClear();
    (coordinator.send as ReturnType<typeof vi.fn>).mockClear();

    await handle.resubscribe();

    const names = (conn: SonosConnection) => sentOn(conn).map((h: any) => `${h.namespace} ${h.command}`).sort();
    expect(names(speaker)).toEqual(['homeTheater:1 subscribe', 'playerVolume:1 subscribe']);
    expect(names(coordinator)).toEqual(['groupVolume:1 subscribe', 'playback:1 subscribe']);
  });

  it('resubscribe attempts them all and reports every failure', async () => {
    const { handle, speaker, coordinator } = office();
    await handle.volume.subscribe();
    await handle.homeTheater.subscribe();
    await handle.playback.subscribe();
    (speaker.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('speaker down'));
    (coordinator.send as ReturnType<typeof vi.fn>).mockClear();

    const failure = await handle.resubscribe().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(sentOn(coordinator)).toEqual([expect.objectContaining({ namespace: 'playback:1', command: 'subscribe' })]);
  });
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run tests/namespaces tests/player`
Expected: FAIL — the first and third `subscription intent` tests (intent set only after a successful send / cleared only after one), `subscribeMetadata…` (method missing), and both `resubscribe…` tests (`handle.resubscribe` is not a function).

- [ ] **Step 3: Create `src/util/settleAll.ts`**

```typescript
/**
 * Runs every task to completion, then rejects with one AggregateError that
 * holds every failure — nested AggregateErrors flattened — if any failed.
 *
 * Unlike Promise.all, one failure does not abandon the rest: restoring
 * subscriptions must still try the second socket when the first is down.
 */
export async function settleAll(tasks: Promise<unknown>[], message: string): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const errors = results.flatMap((result) => {
    if (result.status === 'fulfilled') return [];
    return result.reason instanceof AggregateError ? result.reason.errors : [result.reason];
  });
  if (errors.length > 0) throw new AggregateError(errors, message);
}
```

- [ ] **Step 4: Make the subscription state an intent in `BaseNamespace`**

In `src/namespaces/BaseNamespace.ts`, replace everything from the `isSubscribed` getter's docstring through the end of `resubscribe()` with:

```typescript
  /**
   * Whether events for this namespace are wanted: set by {@link subscribe},
   * cleared by {@link unsubscribe}. This is the intent, not proof that the
   * speaker holds a subscription right now — a reconnect drops every
   * subscription on the socket, and a regroup drops a group-level one — and
   * {@link resubscribe} is how the owner puts one back.
   */
  get isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * Subscribes to real-time events for this namespace.
   *
   * The intent is recorded before the command is sent, so it outlives a
   * failed send: a subscribe attempted while the socket is down is retried
   * by the next {@link resubscribe}. The promise still rejects, so the
   * caller learns this attempt failed.
   */
  async subscribe(): Promise<void> {
    this.subscribed = true;
    await this.send('subscribe');
  }

  /**
   * Unsubscribes from real-time events for this namespace.
   *
   * The intent is dropped before the command is sent, so a failed send does
   * not leave the subscription to be restored later. Sonos keeps one
   * subscription per socket and target, so for a group-level namespace this
   * also stops the events other handles in the same group asked for, until
   * the owner's next {@link resubscribe} restores theirs.
   */
  async unsubscribe(): Promise<void> {
    this.subscribed = false;
    await this.send('unsubscribe');
  }

  /**
   * Sends the subscribe again if events are wanted; does nothing otherwise.
   *
   * Re-sending a live subscription is harmless — Sonos keeps one per socket
   * and target, verified live — so the owner can call this after any change
   * that may have dropped it, without tracking which ones actually died.
   */
  async resubscribe(): Promise<void> {
    if (this.subscribed) await this.send('subscribe');
  }
```

- [ ] **Step 5: Add `resubscribe()` to the controls**

`src/player/VolumeControl.ts` — add `import { settleAll } from '../util/settleAll.js';` and, after `unsubscribe()` (end of the individual-speaker section), add:

```typescript
  /**
   * Re-sends the player and group volume subscriptions that are wanted.
   * @internal
   */
  async resubscribe(): Promise<void> {
    await settleAll([this._player.resubscribe(), this._group.resubscribe()], 'Failed to restore volume subscriptions');
  }
```

`src/player/PlaybackControl.ts` — add `import { settleAll } from '../util/settleAll.js';`, change the class docstring's first line to `Playback and metadata control for a Sonos player's group. Every command goes through the group coordinator's socket.`, and replace the two subscription methods at the end of the class with:

```typescript
  /** Subscribes to playback state change events. */
  async subscribe(): Promise<void> { await this.pb.subscribe(); }

  /** Unsubscribes from playback state events. */
  async unsubscribe(): Promise<void> { await this.pb.unsubscribe(); }

  /**
   * Subscribes to track metadata events. Separate from {@link subscribe}
   * because these events are large and arrive on every track change.
   */
  async subscribeMetadata(): Promise<void> { await this.meta.subscribe(); }

  /** Unsubscribes from track metadata events. */
  async unsubscribeMetadata(): Promise<void> { await this.meta.unsubscribe(); }

  /**
   * Re-sends the playback and metadata subscriptions that are wanted.
   * @internal
   */
  async resubscribe(): Promise<void> {
    await settleAll([this.pb.resubscribe(), this.meta.resubscribe()], 'Failed to restore playback subscriptions');
  }
```

`src/player/HomeTheaterControl.ts` — after `unsubscribe()`, add:

```typescript
  /**
   * Re-sends the home theater subscription if it is wanted.
   * @internal
   */
  async resubscribe(): Promise<void> { await this.ns.resubscribe(); }
```

- [ ] **Step 6: Add `PlayerHandle.resubscribe()`**

In `src/player/PlayerHandle.ts`, add `import { settleAll } from '../util/settleAll.js';` and, after `updateGroup()`, add:

```typescript
  /**
   * Re-sends every subscription this handle wants, each through the socket
   * it belongs on now — a group-level one follows the current coordinator
   * and group ID. Attempts all of them, then rejects with an AggregateError
   * of every failure.
   * @internal
   */
  async resubscribe(): Promise<void> {
    await settleAll(
      [this.volume.resubscribe(), this.playback.resubscribe(), this.homeTheater.resubscribe(), this.groups.resubscribe()],
      `Failed to restore event subscriptions for ${this.name}`,
    );
  }
```

- [ ] **Step 7: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 8: Mutation-verify**

In `BaseNamespace.subscribe()`, move `this.subscribed = true;` back below the send; confirm exactly `keeps the intent when the subscribe send fails…` fails. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/util/settleAll.ts src/namespaces/BaseNamespace.ts src/player tests/namespaces tests/player
git commit -m "feat: treat subscriptions as intents that the owner can re-send

subscribe() records the intent before sending, so a subscribe tried while
a socket is down is retried later; resubscribe() re-sends every wanted
subscription through the socket it now belongs on. Also adds
subscribeMetadata(), since metadata events had no way to be subscribed."
```

---

### Task 4: `VolumeControl.group.relative` — match its own group, never invent a volume, clean up on failure

**Files:**
- Modify: `src/player/VolumeControl.ts:93-121`
- Test: `tests/player/VolumeControl.test.ts`

Live evidence: a `getVolume` sent right after `setRelativeVolume` still returns the old value, so waiting for the `groupVolume` event stays the design. Events carry `groupId` in their headers.

- [ ] **Step 1: Update the existing test's simulated event and add the new tests**

In `tests/player/VolumeControl.test.ts`, the simulated event inside `mockContext()` must name the group, because the fixed code ignores events for other groups. Change

```typescript
              h([{ namespace: 'groupVolume:1' }, { _objectType: 'groupVolume', volume: 47, muted: false, fixed: false }]);
```

to

```typescript
              h([{ namespace: 'groupVolume:1', groupId: 'GROUP_1' }, { _objectType: 'groupVolume', volume: 47, muted: false, fixed: false }]);
```

Then append a new describe at the end of the file:

```typescript
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
```

Add `afterEach` to the vitest import at the top of the file.

- [ ] **Step 2: Run and confirm the three new tests fail**

Run: `npx vitest run tests/player/VolumeControl.test.ts`
Expected: FAIL — `ignores a groupVolume event for another group` (gets 99), `rejects instead of inventing a volume` (resolves with volume 0), `removes its listener and timer` (listener left, a stray `getVolume` sent). The existing `group.relative()` test passes.

- [ ] **Step 3: Implement**

In `src/player/VolumeControl.ts`, add near the top of the module (after the imports):

```typescript
/**
 * How long group.relative waits for the groupVolume event before reading the
 * volume instead. The event normally arrives within a second; it never does
 * if nothing subscribed this group on the coordinator's socket.
 */
const RELATIVE_EVENT_WAIT_MS = 2000;
```

Replace the whole `relative:` entry of the `group` object with:

```typescript
    relative: async (delta: number): Promise<GroupVolumeStatus> => {
      // setRelativeVolume answers with an empty body, and a getVolume sent
      // right after it still reads the old value (checked live 2026-09-25),
      // so the new volume is taken from the groupVolume event that follows.
      // The event must name this group: the coordinator's socket carries
      // events for every group subscribed on it.
      const conn = this.coordinatorContext.connection;
      const groupId = this.coordinatorContext.getGroupId();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let handler: (msg: SonosResponse) => void = () => {};
      const stopWaiting = () => {
        clearTimeout(timer);
        conn.off('message', handler);
      };

      const volumeEvent = new Promise<GroupVolumeStatus>((resolve, reject) => {
        handler = (msg: SonosResponse) => {
          const [headers, body] = msg;
          if (headers?.namespace === 'groupVolume:1' && headers.groupId === groupId && body?._objectType === 'groupVolume') {
            stopWaiting();
            resolve(body as unknown as GroupVolumeStatus);
          }
        };
        timer = setTimeout(() => {
          stopWaiting();
          // No event: most likely nothing subscribed this group on this
          // socket. By now a read is current. If it fails too, say so —
          // a made-up volume would be indistinguishable from a real one.
          this._group.getVolume().then(resolve, reject);
        }, RELATIVE_EVENT_WAIT_MS);
        conn.on('message', handler);
      });

      try {
        await this._group.setRelativeVolume(delta);
      } catch (err) {
        // The change was refused; leave nothing behind to fire later. The
        // abandoned volumeEvent never settles, so it cannot surface as an
        // unhandled rejection.
        stopWaiting();
        throw err;
      }
      return volumeEvent;
    },
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/player/VolumeControl.ts tests/player/VolumeControl.test.ts
git commit -m "fix: group.relative matches its own group's event and never invents a volume

It accepted a groupVolume event for any group on the coordinator's socket,
returned {volume:0} when the fallback read failed, and left its listener
and timer running when setRelativeVolume was refused."
```

---

### Task 5: `SonosHousehold` lifecycle — listeners once, serialized setup, logged reconnect failures

**Files:**
- Modify: `src/household/SonosHousehold.ts` (fields near `:79-82`, constructor, `connect()` `:157-192`, `handleReconnected()` reconnect branch `:590-610`)
- Test: `tests/household/SonosHousehold.test.ts` (harness refactor + new tests)

**Interfaces:**
- Produces: private `onPrimaryConnected(): Promise<void>` (returns the queued run, so tests can await the `'connected'` listener). The first `'connected'` listener on the primary connection is registered in the constructor.

Why the harness changes: the mocked `SonosConnection` is one shared object whose listener map every test clears *after* constructing the household. Once the household attaches its listeners in the constructor, that clear would strip them. The helper below clears first, then constructs.

- [ ] **Step 1: Refactor the test harness**

In `tests/household/SonosHousehold.test.ts`, add `import type { SonosHouseholdOptions } from '../../src/household/SonosHousehold.js';` and, after `getMockConnection()`, add:

```typescript
/**
 * The factory hands back one shared object on every call, so calling it
 * directly returns that object without constructing a household.
 */
function sharedMockConnection(): any {
  return (SonosConnection as unknown as () => any)();
}

/**
 * Clears the shared mock connection, then constructs the household. The order
 * matters: the household attaches its connection listeners in its
 * constructor, so clearing afterwards would strip them.
 */
function freshHousehold(options: SonosHouseholdOptions): { household: SonosHousehold; mockConn: any } {
  vi.clearAllMocks();
  const mockConn = sharedMockConnection();
  mockConn._listeners.clear();
  mockConn.state = 'connected';
  mockConn.on.mockImplementation((event: string, handler: Function) => {
    if (!mockConn._listeners.has(event)) mockConn._listeners.set(event, []);
    mockConn._listeners.get(event)!.push(handler);
    return mockConn;
  });
  (SonosConnection as unknown as ReturnType<typeof vi.fn>).mockClear();
  return { household: new SonosHousehold(options), mockConn };
}
```

Then, in each of these describes — `SonosHousehold`, `SonosHousehold grouping`, `SonosHousehold speaker reconnection`, `SonosHousehold first-connect-after-fail setup`, `SonosHousehold connect() unhandled rejection safety`, `SonosHousehold per-speaker resilience`, `topology follows group changes`, `diagnostic event subscriptions` — replace the sequence in `beforeEach` that runs from `vi.clearAllMocks();` through the `mockConn.on.mockImplementation(…);` block (including the `Constructor.mockClear()`, `new SonosHousehold(…)`, `getMockConnection()` and `_listeners.clear()` lines in between) with one line that keeps that describe's options:

```typescript
    ({ household, mockConn } = freshHousehold({ host: '192.168.68.96' }));
```

(`topology follows group changes` and `diagnostic event subscriptions` pass `{ host: '192.168.68.96', autoConnect: false }`; `topology follows group changes` keeps its `vi.useFakeTimers()` and `topology = mockTopology;` lines before the call.) Leave each block's `mockConn.send.mockImplementation(…)` and any `await household.connect()` after it unchanged. Leave `SonosHousehold safety-net error listener` and `default backoff shape is a published contract` alone.

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: all existing tests still pass (the harness change alone changes no behavior).

- [ ] **Step 2: Write the failing tests**

Append to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('household setup lifecycle', () => {
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

  it('attaches its connection listeners once, however many times connect() is called', async () => {
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      return Promise.resolve([{ success: true }, {}]);
    });

    await household.connect();
    await household.disconnect();
    await household.connect();

    for (const event of ['connected', 'disconnected', 'reconnecting', 'error', 'message']) {
      expect(mockConn._listeners.get(event)).toHaveLength(1);
    }
  });

  it('queues a second setup run behind the first instead of interleaving them', async () => {
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    mockConn.send.mockImplementation(async (request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups' && headers.householdId) {
        await readGate;
        return [{ householdId: 'HH_1', success: true }, mockTopology];
      }
      if (headers.command === 'getGroups') return [{ householdId: 'HH_1', success: true }, mockTopology];
      return [{ success: true }, {}];
    });
    const topologyReads = () =>
      mockConn.send.mock.calls.filter(([r]: any) => r[0].command === 'getGroups' && r[0].householdId).length;

    const connecting = household.connect();
    await flush();
    expect(topologyReads()).toBe(1);

    // The connection flaps while the first run waits on its topology read.
    const secondRun = mockConn._listeners.get('connected')[0]();
    await flush();
    expect(topologyReads()).toBe(1);

    releaseRead();
    await connecting;
    await secondRun;
    expect(topologyReads()).toBe(2);
  });

  it('logs a reconnect setup that fails', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { household, mockConn } = freshHousehold({ host: '192.168.68.96', autoConnect: false, logger });
    mockConn.send.mockImplementation((request: any) => {
      const [headers] = request;
      if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, mockTopology]);
      return Promise.resolve([{ success: true }, {}]);
    });
    await household.connect();

    // The socket drops again while the reconnect's setup is running.
    mockConn.state = 'disconnected';
    await mockConn._listeners.get('connected')[0]();

    expect(logger.warn).toHaveBeenCalledWith('Failed reconnect setup', expect.objectContaining({ message: 'Disconnected during setup' }));
  });
});
```

- [ ] **Step 3: Run and confirm failures**

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — `attaches its connection listeners once` (lengths 2), `queues a second setup run` (reads reach 2 before release), `logs a reconnect setup that fails` (no warn).

- [ ] **Step 4: Implement**

In `src/household/SonosHousehold.ts`, add these fields after `private _lastTopologyKey = '';`:

```typescript
  /**
   * Setup runs, chained so each starts only after the previous one settles.
   * A connection that flaps mid-setup fires 'connected' again; a second run
   * alongside the first would interleave two topology reads, two rounds of
   * speaker connections and two rounds of subscriptions.
   */
  private setupChain: Promise<void> = Promise.resolve();
  /** Settles the promise that the current connect() call is waiting on. */
  private pendingSetup: { resolve: () => void; reject: (err: unknown) => void } | null = null;
```

In the constructor, after the safety-net `this.on('error', …)` block, add:

```typescript
    // Attached once, here. connect() can be called again after disconnect(),
    // and attaching there stacked another copy of every listener each time.
    this.connection.on('connected', () => this.onPrimaryConnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));
```

Replace the body of `connect()` with:

```typescript
  async connect(): Promise<void> {
    this._initialConnectDone = false;

    const setup = new Promise<void>((resolve, reject) => {
      this.pendingSetup = { resolve, reject };
    });
    // If this.connection.connect() below rejects, this method throws before
    // ever reaching `await setup` — so nothing is listening to it yet. Should
    // the background reconnect ladder later succeed and then fail
    // first-connect setup, onPrimaryConnected() rejects this same promise,
    // which — with no listener — would surface as an unhandled rejection and
    // crash the host process. This no-op catch keeps that rejection from
    // ever being "unhandled"; the `await setup` below still observes it when
    // connect() succeeds and setup then fails.
    setup.catch(() => {});

    await this.connection.connect();
    await setup;
  }
```

Add this method directly after `connect()`:

```typescript
  /**
   * Queues a setup run for a primary 'connected' event behind any run still
   * in flight, and settles the pending connect() once first-connect setup
   * finishes or fails. Returns the queued run so tests can await it; the
   * emitter ignores it.
   */
  private onPrimaryConnected(): Promise<void> {
    const run = this.setupChain.then(async () => {
      try {
        await this.handleReconnected();
        if (this._initialConnectDone) this.pendingSetup?.resolve();
      } catch (err) {
        this.pendingSetup?.reject(err);
      }
    });
    this.setupChain = run;
    return run;
  }
```

In `handleReconnected()`, wrap the whole `else` branch body (everything from `// Reconnect after prior success` through `await this.subscribeDiagnostics();`) in a `try`/`catch` that mirrors the first-connect branch:

```typescript
    } else {
      // Reconnect after prior success — reconnect-specific work.
      try {
        // …the existing reconnect-branch body, unchanged…
      } catch (err) {
        this.log.warn('Failed reconnect setup', err);
        throw err;
      }
    }
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including `tests/household/SonosHousehold.disconnect-during-setup.test.ts`.

- [ ] **Step 6: Mutation-verify**

(a) In `onPrimaryConnected()`, replace `this.setupChain.then(async () => {` with `Promise.resolve().then(async () => {`; confirm exactly `queues a second setup run…` fails. Restore.
(b) Delete the constructor's `this.connection.on('message', …)` line and add it back inside `connect()`; confirm `attaches its connection listeners once…` fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "fix: attach household listeners once and serialize setup runs

connect() stacked another copy of every connection listener each call,
and a connection flapping mid-setup started a second setup over the
first. A failed reconnect setup was also swallowed without a log line."
```

---

### Task 6: One coordinator resolver, set when the handle is created

**Files:**
- Modify: `src/household/SonosHousehold.ts` (`refreshTopology()` handle creation `:250-258`, `connectAllSpeakers()` `:366-390`, `reconnectSpeakers()` `:544-554`)
- Create: `tests/household/SonosHousehold.multi.test.ts`

**Interfaces:**
- Consumes: `PlayerHandle.coordinatorId` (Task 3a).
- Produces: private `connectionForPlayer(playerId: string): SonosConnection`. The new test file and its helpers (`instances`, `topology`, `socket(host)`, `sentVia(host, namespace, command)`, `connectedHousehold(start)`, fixtures `solo`, `officeUnderBedroom`) — Tasks 7 and 8 add tests to it.

- [ ] **Step 1: Create the multi-connection test file with failing tests**

Create `tests/household/SonosHousehold.multi.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run and confirm the second test fails**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts`
Expected: the first test passes (Task 3a routing plus today's resolver); `routes a player discovered after setup…` FAILS — the new handle has no resolver, so its pause goes through the primary.

- [ ] **Step 3: Implement**

In `src/household/SonosHousehold.ts`, add this method after `connectToSpeaker()`:

```typescript
  /**
   * The socket to reach a player through: its own connection, or the primary.
   * The primary speaker has no entry in speakerConnections (it reuses the
   * primary), and with `autoConnect: false` no speaker does — in that case
   * group-level commands for a group led by another speaker go through the
   * primary and fail, which is the documented cost of that option.
   */
  private connectionForPlayer(playerId: string): SonosConnection {
    return this.speakerConnections.get(playerId) ?? this.connection;
  }
```

In `refreshTopology()`, replace

```typescript
        this._players.set(
          player.id,
          new PlayerHandle(player, group, householdId, this.connection, this.connection),
        );
```

with

```typescript
        const handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
        // Group-level commands follow the group's current coordinator. Set at
        // creation so a handle made after setup (a new speaker) routes
        // correctly without waiting for a reconnect to wire it.
        handle.setCoordinatorConnectionResolver(() => this.connectionForPlayer(handle.coordinatorId));
        this._players.set(player.id, handle);
```

In `connectAllSpeakers()`, delete the resolver block (the comment `// Set coordinator resolver …` and the whole `handle.setCoordinatorConnectionResolver(() => { … });` call), leaving `handle.setSpeakerConnection(conn);` inside the `if (handle)`.

In `reconnectSpeakers()`, delete the trailing block that starts `// Re-wire coordinator resolvers for all handles` through the end of its `for` loop.

Confirm: `grep -n "\['_group'\]" src` prints nothing.

Update the `autoConnect` option's doc comment in `SonosHouseholdOptions` to:

```typescript
  /**
   * Connect to all speakers at startup. @defaultValue true
   *
   * With `false`, no per-speaker sockets are opened, so every command goes
   * through the primary — and group-level commands for a group led by another
   * speaker fail with `groupCoordinatorChanged`.
   */
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Mutation-verify**

Comment out the `handle.setCoordinatorConnectionResolver(…)` line in `refreshTopology()`; confirm both tests in `routing group-level commands` fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "refactor: one coordinator resolver, set when the handle is created

The resolver was written out twice, read the private handle['_group'],
and was never set on a handle created after setup, so a newly discovered
speaker's group commands went through the primary."
```

---

### Task 7: Forward every speaker's events, tagged with their source

**Files:**
- Create: `src/util/eventSource.ts`
- Modify: `src/types/events.ts`, `src/household/SonosHousehold.ts` (`handleMessage()` `:474-507`, `connectToSpeaker()` `:418-425`)
- Test: `tests/household/SonosHousehold.multi.test.ts`

**Interfaces:**
- Produces: `interface EventSource { playerId?: string; groupId?: string }` exported from `src/types/events.ts` (and so from the package root). Every typed event and `rawMessage` in `SonosEvents` gains a second parameter `source: EventSource`. `sourceOf(headers: MessageHeaders | undefined): EventSource` in `src/util/eventSource.ts` — Task 9 uses it in `SonosClient`. Private `createSpeakerConnection(url: URL): SonosConnection` — Task 8 adds a listener there.

Live evidence: player-level events carry `playerId` in their headers (`playerVolume:1`), group-level events carry `groupId` (`groupVolume:1`, `playback:1`, `playbackMetadata:1`). `groupCoordinatorChanged` arrives with namespace `global`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/household/SonosHousehold.multi.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts`
Expected: FAIL — the first test hears nothing (speaker sockets are not listened to), the second hears a single argument, the third reads more than once (each report refreshes immediately) or never (Office/Bedroom not listened to).

- [ ] **Step 3: Add the type and the helper**

In `src/types/events.ts`, add after the imports:

```typescript
/**
 * Where an event came from, copied from its headers. Player-level namespaces
 * (playerVolume, homeTheater) name the player; group-level ones (groupVolume,
 * playback, playbackMetadata) name the group. Nothing says who caused the
 * change: Sonos events carry state, never origin.
 */
export interface EventSource {
  playerId?: string;
  groupId?: string;
}
```

and give every data event, `coordinatorChanged` and `rawMessage` in `SonosEvents` the extra parameter:

```typescript
  volumeChanged: (data: GroupVolumeStatus, source: EventSource) => void;
  playerVolumeChanged: (data: PlayerVolumeStatus, source: EventSource) => void;
  groupsChanged: (data: GroupsResponse, source: EventSource) => void;
  playbackChanged: (data: PlaybackStatus, source: EventSource) => void;
  metadataChanged: (data: MetadataStatus, source: EventSource) => void;
  favoritesChanged: (data: FavoritesResponse, source: EventSource) => void;
  playlistsChanged: (data: PlaylistsResponse, source: EventSource) => void;
  homeTheaterChanged: (data: HomeTheaterOptions, source: EventSource) => void;

  coordinatorChanged: (data: GroupCoordinatorChangedEvent, source: EventSource) => void;

  rawMessage: (message: SonosResponse, source: EventSource) => void;
```

Keep each event's existing doc comment, if it has one, and add to it: `@param source - The player or group the event is about.`

Create `src/util/eventSource.ts`:

```typescript
import type { MessageHeaders } from '../types/messages.js';
import type { EventSource } from '../types/events.js';

/**
 * The source tag for an event: the player or group its headers name. A key
 * the headers lack is left out rather than set to undefined.
 */
export function sourceOf(headers: MessageHeaders | undefined): EventSource {
  const source: EventSource = {};
  if (headers?.playerId) source.playerId = headers.playerId;
  if (headers?.groupId) source.groupId = headers.groupId;
  return source;
}
```

- [ ] **Step 4: Forward and tag in the household**

In `src/household/SonosHousehold.ts`, add `import { sourceOf } from '../util/eventSource.js';`.

Replace the start of `handleMessage()` and its coordinator branch and final emit so the method reads:

```typescript
  /**
   * Routes incoming unsolicited messages — from the primary and from every
   * speaker socket — to typed events, each tagged with its source.
   * Filters by `_objectType` to avoid double-firing and Volume: undefined.
   */
  private handleMessage(message: SonosResponse): void {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit('rawMessage', message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;

    // Capture householdId from any message
    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    // A regroup reports this on every socket whose subscriptions it touched,
    // so several can arrive together; one debounced read covers them all.
    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent, source);
      this.scheduleTopologyRefresh();
      return;
    }

    // Skip events with empty body (subscribe confirmations)
    if (!objectType) return;

    // Any groups:1 event carrying an object triggers a re-read, whatever its
    // _objectType value (the empty-body check above already filtered out
    // subscribe confirmations, which have none).
    if (namespace === 'groups:1') this.scheduleTopologyRefresh();

    // Route to typed event
    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body, source);
    }
  }
```

In `connectToSpeaker()`, replace

```typescript
    const conn = existing ?? new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });
```

with

```typescript
    const conn = existing ?? this.createSpeakerConnection(url);
```

and add after `connectToSpeaker()`:

```typescript
  /**
   * Builds a speaker's connection and wires it once. Its events reach
   * listeners exactly as the primary's do: after a regroup, a group's
   * subscriptions live on its coordinator's socket, whichever speaker that is.
   */
  private createSpeakerConnection(url: URL): SonosConnection {
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });
    conn.on('message', (msg) => this.handleMessage(msg));
    return conn;
  }
```

- [ ] **Step 5: Fix the other emitters `tsc` now flags**

Run: `npx tsc --noEmit`. `src/client/SonosClient.ts` emits `rawMessage` and `coordinatorChanged` with one argument. Make the minimal change there now (Task 9 rewrites the file): add `import { sourceOf } from '../util/eventSource.js';`, compute `const source = sourceOf(message[0]);` at the top of its `handleMessage()`, and pass `source` as the second argument to `rawMessage`, `coordinatorChanged` and the typed `emit`.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. If an existing test in `SonosHousehold.test.ts` depended on the immediate topology refresh after `groupCoordinatorChanged`, it now needs `vi.advanceTimersByTimeAsync(250)`; none did when this plan was written.

- [ ] **Step 7: Mutation-verify**

Delete `conn.on('message', …)` in `createSpeakerConnection()`; confirm `delivers an event from a speaker's own socket…` fails. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/types/events.ts src/util/eventSource.ts src/household/SonosHousehold.ts src/client/SonosClient.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "feat: deliver every speaker's events, tagged with their player or group

The household listened only to the primary socket, so an event from a
subscription on any other speaker's socket was logged and dropped. Each
typed event now carries a second argument naming its player or group."
```

---

### Task 8: Keep subscriptions alive across reconnects and regroups

**Files:**
- Modify: `src/household/SonosHousehold.ts` (`refreshTopology()`, `createSpeakerConnection()`, `handleReconnected()`, new `resubscribeAll()`)
- Test: `tests/household/SonosHousehold.multi.test.ts`

**Interfaces:**
- Consumes: `PlayerHandle.resubscribe()` (Task 3b), `createSpeakerConnection()` (Task 7), `onPrimaryConnected()` (Task 5).
- Produces: private `resubscribeAll(): Promise<void>`.

Live evidence (spec §2): a player that leaves a group comes back under a new group ID (Office went `…207` → `…210` over three regroups), so its group-level subscriptions die; a coordinator that keeps its group keeps its ID; a reconnected socket has no subscriptions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/household/SonosHousehold.multi.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts`
Expected: FAIL — `re-subscribes a moved player's…` (nothing re-sent after a regroup), `restores a speaker's subscriptions…` (nothing listens for a speaker's `connected`), `a primary reconnect re-sends…` (the hand-written loop subscribes Office's and Bedroom's player volume, which nobody asked for). `does not re-send when only playback state changed` passes; it guards the membership key.

- [ ] **Step 3: Implement `resubscribeAll()` and the membership key**

In `src/household/SonosHousehold.ts`, add a field after `_lastTopologyKey`:

```typescript
  /** Group IDs, coordinators and members, without playback state. */
  private _lastMembershipKey = '';
```

Add the method after `subscribeDiagnostics()`:

```typescript
  /**
   * Re-sends every subscription a player handle wants. Called wherever one
   * may have died: at the end of setup and of every primary reconnect, when a
   * speaker's own socket reconnects, and when group membership changes — a
   * group-level subscription names a group ID, and a player that leaves a
   * group comes back under a new one. Re-sending a live subscription is
   * harmless, so nothing tracks which ones actually died.
   */
  private async resubscribeAll(): Promise<void> {
    await Promise.all(
      [...this._players.values()].map((handle) =>
        handle.resubscribe().catch((err: unknown) =>
          this.log.warn(`Failed to restore event subscriptions for ${handle.name}`, err))),
    );
  }
```

In `refreshTopology()`, directly before the existing `// Only emit topologyChanged if …` comment, add:

```typescript
    // Membership, not playback state, decides whether subscriptions moved:
    // playbackState changes on every play/pause. The first read has nothing
    // to compare against, and setup restores subscriptions itself.
    const membershipKey = result.groups
      .map((g) => `${g.id}:${g.coordinatorId}:${[...g.playerIds].sort().join(',')}`)
      .sort()
      .join('|');
    if (this._lastMembershipKey && membershipKey !== this._lastMembershipKey) {
      void this.resubscribeAll();
    }
    this._lastMembershipKey = membershipKey;
```

In `createSpeakerConnection()`, before `return conn;`, add:

```typescript
    // A reconnected socket holds no subscriptions.
    conn.on('connected', () => { void this.resubscribeAll(); });
```

- [ ] **Step 4: Rewire setup to use it**

In `handleReconnected()`'s first-connect branch, replace

```typescript
        await this.subscribeDiagnostics();
        this._initialConnectDone = true;
```

with

```typescript
        // Handles that outlived a disconnect() keep their intents; restore
        // those first. Fresh handles have none, so this sends nothing for them.
        await this.resubscribeAll();
        await this.subscribeDiagnostics();
        this._initialConnectDone = true;
```

In the reconnect branch, replace

```typescript
      for (const handle of this._players.values()) {
        try { await handle.volume.subscribe(); } catch { /* best effort */ }
      }

      await this.subscribeDiagnostics();
```

with

```typescript
      // The reconnected socket holds no subscriptions; re-send the ones
      // wanted (the diagnostic ones were declared at first connect).
      await this.resubscribeAll();
```

Update `subscribeDiagnostics()`'s docstring by appending: `Runs once, at first connect: it declares these subscriptions as wanted, and resubscribeAll() keeps them alive from then on.`

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including `diagnostic event subscriptions` in `SonosHousehold.test.ts` (3 subscribes each after connect, 6 after a reconnect).

- [ ] **Step 6: Mutation-verify**

(a) Remove `void this.resubscribeAll();` from the membership check; confirm exactly `re-subscribes a moved player's…` fails. Restore.
(b) Remove the `conn.on('connected', …)` line; confirm exactly `restores a speaker's subscriptions…` fails. Restore.
(c) Change the membership key to include `${g.playbackState}`; confirm exactly `does not re-send when only playback state changed` fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "fix: keep event subscriptions alive across regroups and speaker reconnects

A player that leaves a group comes back under a new group ID, which
silently kills its group-level subscriptions, and a speaker socket that
reconnects comes back with none. The household now re-sends every wanted
subscription after either, instead of only after a primary reconnect."
```

---

### Task 9: Make `SonosClient` work

**Files:**
- Create: `src/client/discoverHouseholdId.ts`
- Modify: `src/client/SonosClient.ts` (rewrite), `src/household/SonosHousehold.ts` (`discoverHouseholdId()` `:446-468`)
- Test: `tests/client/SonosClient.test.ts` (rewrite the mock; keep the safety-net test)

**Interfaces:**
- Consumes: `sourceOf` (Task 7), `PlayerHandle.resubscribe()` (Task 3b).
- Produces: `discoverHouseholdId(connection: SonosConnection): Promise<string | undefined>`.

Live evidence (spec §4): `getGroups` without a household ID is refused (`success:false`, `type:globalError`) but the refusal's headers carry `householdId`; the response headers never identify the connected player; each player's `websocketUrl` carries its IP. The shipped client resolves `connect()` with no handle and emits `connected` twice.

- [ ] **Step 1: Write the failing tests**

Replace the `vi.mock(…)` block at the top of `tests/client/SonosClient.test.ts` with a controllable one, and add the new tests after the existing describe:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosClient } from '../../src/client/SonosClient.js';
import { CommandError } from '../../src/errors/CommandError.js';

const conns: any[] = [];

vi.mock('../../src/client/SonosConnection.js', () => ({
  SonosConnection: vi.fn(() => {
    const listeners = new Map<string, Function[]>();
    const inst: any = {
      state: 'disconnected',
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(handler);
        return inst;
      }),
      off: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      removeAllListeners: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      connect: vi.fn(async () => {
        inst.state = 'connected';
        for (const h of listeners.get('connected') ?? []) h();
      }),
      disconnect: vi.fn(async () => { inst.state = 'disconnected'; }),
      send: vi.fn(),
      _listeners: listeners,
    };
    conns.push(inst);
    return inst;
  }),
}));
```

Keep the existing `SonosClient safety-net error listener` describe unchanged. Then append:

```typescript
const household = {
  groups: [
    { id: 'G_BED', name: 'Bedroom', coordinatorId: 'RINCON_BED', playerIds: ['RINCON_BED'] },
    { id: 'G_OFF', name: 'Office', coordinatorId: 'RINCON_OFFICE', playerIds: ['RINCON_OFFICE'] },
  ],
  players: [
    { id: 'RINCON_BED', name: 'Bedroom', capabilities: [], websocketUrl: 'wss://10.0.0.3:1443/websocket/api' },
    { id: 'RINCON_OFFICE', name: 'Office', capabilities: [], websocketUrl: 'wss://10.0.0.2:1443/websocket/api' },
  ],
};

/** Mirrors a real speaker: getGroups without a household ID is refused, but the refusal names the household. */
function speakerSend(request: any) {
  const [headers] = request;
  if (headers.command === 'getGroups' && !headers.householdId) {
    return Promise.reject(new CommandError('globalError', 'householdId required', {
      namespace: 'groups:1', command: 'getGroups', cmdId: headers.cmdId,
      cause: [{ namespace: 'groups:1', householdId: 'HH_1', success: false, type: 'globalError' }, {}],
    }));
  }
  if (headers.command === 'getGroups') return Promise.resolve([{ householdId: 'HH_1', success: true }, household]);
  return Promise.resolve([{ success: true }, { volume: 14, muted: false, fixed: false }]);
}

function newClient(host = '10.0.0.2') {
  conns.length = 0;
  const client = new SonosClient({ host });
  const conn = conns[0];
  conn.send.mockImplementation(speakerSend);
  return { client, conn };
}

describe('SonosClient against a speaker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds the player at its host and controls it', async () => {
    const { client, conn } = newClient('10.0.0.2');

    await client.connect();
    await client.volume.get();

    expect(client.householdId).toBe('HH_1');
    const last = conn.send.mock.calls.at(-1)[0][0];
    expect(last).toMatchObject({ namespace: 'playerVolume:1', command: 'getVolume', playerId: 'RINCON_OFFICE', groupId: 'G_OFF' });
  });

  it('emits connected once per connect', async () => {
    const { client } = newClient();
    const connected = vi.fn();
    client.on('connected', connected);

    await client.connect();

    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('rejects connect() when no player is at the configured host', async () => {
    const { client } = newClient('10.0.0.9');
    await expect(client.connect()).rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });

  it('attaches its connection listeners once', async () => {
    const { client, conn } = newClient();
    await client.connect();
    await client.disconnect();
    await client.connect();

    for (const event of ['connected', 'disconnected', 'reconnecting', 'error', 'message']) {
      expect(conn._listeners.get(event)).toHaveLength(1);
    }
  });

  it('keeps its handle across a reconnect and restores its subscriptions', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const volume = client.volume;
    await client.volume.subscribe();
    const subscribes = () => conn.send.mock.calls.filter(([r]: any) => r[0].namespace === 'playerVolume:1' && r[0].command === 'subscribe').length;

    await conn._listeners.get('connected')[0]();

    expect(client.volume).toBe(volume);
    expect(subscribes()).toBe(2);
  });

  it('tags events with their source', async () => {
    const { client, conn } = newClient();
    await client.connect();
    const heard: unknown[][] = [];
    client.on('playerVolumeChanged', (...args) => heard.push(args));

    conn._listeners.get('message')[0]([
      { namespace: 'playerVolume:1', type: 'playerVolume', playerId: 'RINCON_OFFICE' },
      { _objectType: 'playerVolume', volume: 20, muted: false, fixed: false },
    ]);

    expect(heard[0]?.[1]).toEqual({ playerId: 'RINCON_OFFICE' });
  });
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `npx vitest run tests/client/SonosClient.test.ts`
Expected: FAIL — `finds the player…` (`Not connected — call connect() first`), `emits connected once` (2), `rejects connect()…` (resolves), `attaches its connection listeners once` (2 each), `keeps its handle…` (throws). `tags events with their source` fails until the handle exists.

- [ ] **Step 3: Create the shared household-ID helper**

Create `src/client/discoverHouseholdId.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { SonosConnection } from './SonosConnection.js';
import type { SonosResponse } from '../types/messages.js';

/**
 * Reads the household ID from a speaker. Sonos refuses `getGroups` without
 * one (`success:false`, `type:globalError`) but names the household in the
 * refusal's headers, so the refusal is the answer. Returns undefined when
 * neither a reply nor a refusal carries one (a timeout, a lost connection).
 */
export async function discoverHouseholdId(connection: SonosConnection): Promise<string | undefined> {
  try {
    const [headers] = await connection.send([
      { namespace: 'groups:1', command: 'getGroups', cmdId: randomUUID() },
      {},
    ]);
    return headers.householdId;
  } catch (err: unknown) {
    // SonosConnection attaches the refused response as the error's cause.
    if (err instanceof Error && Array.isArray(err.cause)) {
      const [headers] = err.cause as SonosResponse;
      return headers?.householdId;
    }
    return undefined;
  }
}
```

In `src/household/SonosHousehold.ts`, add `import { discoverHouseholdId } from '../client/discoverHouseholdId.js';` and replace the body of the private `discoverHouseholdId()` method with:

```typescript
    this.log.debug('Discovering householdId...');
    this._householdId = (await discoverHouseholdId(this.connection)) ?? this._householdId;

    if (this._householdId) {
      this.log.debug(`Discovered householdId: ${this._householdId}`);
    } else {
      this.log.warn('Could not auto-discover householdId');
    }
```

Remove the `randomUUID` import from `SonosHousehold.ts` if nothing else there uses it (`npx tsc --noEmit` does not flag unused imports, so check with `grep -n randomUUID src/household/SonosHousehold.ts`).

- [ ] **Step 4: Rewrite `SonosClient`**

Replace `src/client/SonosClient.ts` with:

```typescript
import { randomUUID } from 'node:crypto';
import { SonosConnection } from './SonosConnection.js';
import type { ReconnectOptions } from './SonosConnection.js';
import { discoverHouseholdId } from './discoverHouseholdId.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import { sourceOf } from '../util/eventSource.js';
import type { SonosEvents, GroupCoordinatorChangedEvent } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import type { SonosResponse } from '../types/messages.js';
import type { GroupsResponse } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ErrorCode } from '../types/errors.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import type { VolumeControl } from '../player/VolumeControl.js';
import type { PlaybackControl } from '../player/PlaybackControl.js';
import type { FavoritesAccess } from '../player/FavoritesAccess.js';
import type { PlaylistsAccess } from '../player/PlaylistsAccess.js';
import type { AudioClipControl } from '../player/AudioClipControl.js';
import type { HomeTheaterControl } from '../player/HomeTheaterControl.js';
import type { SettingsControl } from '../player/SettingsControl.js';

export interface SonosClientOptions {
  /** The speaker's IP address, as Sonos reports it. Host names are not matched. */
  host: string;
  port?: number;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true, initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: Infinity,
  pingInterval: 30000, pongTimeout: 10000,
};

/**
 * Simple single-speaker API for controlling one Sonos player.
 *
 * Everything goes through this one speaker's socket. Sonos accepts group-level
 * commands (group volume, playback, loading a favorite or playlist) only from
 * the group's coordinator, so while this speaker is grouped under another one
 * those commands fail with `groupCoordinatorChanged`. For grouped speakers use
 * {@link SonosHousehold}, which routes them.
 *
 * @example
 * ```typescript
 * const client = new SonosClient({ host: '192.168.68.96' });
 * await client.connect();
 * await client.volume.set(50);
 * await client.disconnect();
 * ```
 */
export class SonosClient extends TypedEventEmitter<SonosEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private readonly host: string;
  private _handle: PlayerHandle | undefined;
  private _householdId: string | undefined;
  /** Setup runs, chained so each starts only after the previous one settles. */
  private setupChain: Promise<void> = Promise.resolve();
  /** Settles the promise that the current connect() call is waiting on. */
  private pendingSetup: { resolve: () => void; reject: (err: unknown) => void } | null = null;

  constructor(options: SonosClientOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.host = options.host;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 120000,
      logger: this.log,
    });

    // Safety-net error listener: guarantees emit('error') never throws for
    // lack of a listener (Node EventEmitter default), which would otherwise
    // crash the host app. User-attached listeners still fire alongside.
    this.on('error', (err) => {
      this.log.error(`Unhandled client error: ${err.message}`);
    });

    // Attached once, here. connect() can be called again after disconnect(),
    // and attaching there stacked another copy of every listener each time.
    this.connection.on('connected', () => this.onConnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));
  }

  get connected(): boolean { return this.connection.state === 'connected'; }
  get connectionState() { return this.connection.state; }
  get householdId(): string | undefined { return this._householdId; }

  get volume(): VolumeControl { return this.handle.volume; }
  get playback(): PlaybackControl { return this.handle.playback; }
  get favorites(): FavoritesAccess { return this.handle.favorites; }
  get playlists(): PlaylistsAccess { return this.handle.playlists; }
  get audioClip(): AudioClipControl { return this.handle.audioClip; }
  get homeTheater(): HomeTheaterControl { return this.handle.homeTheater; }
  get settings(): SettingsControl { return this.handle.settings; }

  private get handle(): PlayerHandle {
    if (!this._handle) throw new Error('Not connected — call connect() first');
    return this._handle;
  }

  /**
   * Connects and finds this speaker in its household. Resolves once the
   * player controls are usable; rejects if the connection or the lookup fails.
   */
  async connect(): Promise<void> {
    const setup = new Promise<void>((resolve, reject) => {
      this.pendingSetup = { resolve, reject };
    });
    // If connection.connect() rejects, nothing awaits `setup` — yet a later
    // background reconnect can still run setup and reject it. Without this
    // no-op catch that rejection would be unhandled and crash the host.
    setup.catch(() => {});

    await this.connection.connect();
    await setup;
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  /** Queues work behind any setup still running, so two runs never interleave. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.setupChain.then(task);
    this.setupChain = run.catch(() => {});
    return run;
  }

  /**
   * Runs setup for each connect and reconnect, then emits `connected` once.
   * Returns the queued run so tests can await it; the emitter ignores it.
   */
  private onConnected(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.locatePlayer();
      } catch (err) {
        this.log.warn('Setup after connect failed', err);
        this.pendingSetup?.reject(err);
        return;
      }
      this.pendingSetup?.resolve();
      this.emit('connected');
    });
  }

  /**
   * Finds the speaker at the configured host in its household and builds its
   * handle — or, when the handle already exists, moves it to its current group
   * and restores its event subscriptions, which died with the old socket.
   */
  private async locatePlayer(): Promise<void> {
    const householdId = await discoverHouseholdId(this.connection);
    if (!householdId) {
      throw new SonosError(ErrorCode.CONNECTION_FAILED, `Could not read the household ID from ${this.host}`);
    }
    this._householdId = householdId;

    const [, body] = await this.connection.send([
      { namespace: 'groups:1', command: 'getGroups', cmdId: randomUUID(), householdId },
      {},
    ]);
    const { groups = [], players = [] } = body as unknown as Partial<GroupsResponse>;
    const player = players.find((p) => hostOf(p.websocketUrl) === this.host);
    const group = player && groups.find((g) => g.playerIds.includes(player.id));
    if (!player || !group) {
      const known = players.map((p) => `${p.name} at ${hostOf(p.websocketUrl) ?? 'no address'}`).join(', ');
      throw new SonosError(
        ErrorCode.PLAYER_NOT_FOUND,
        `No player at ${this.host}. Sonos reports: ${known}. Use the speaker's IP address; host names are not matched.`,
      );
    }

    if (this._handle?.id === player.id) {
      this._handle.updateGroup(group);
      await this._handle.resubscribe().catch((err: unknown) =>
        this.log.warn('Failed to restore event subscriptions', err));
    } else {
      this._handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
    }
  }

  private handleMessage(message: SonosResponse): void {
    const [headers, body] = message;
    const source = sourceOf(headers);
    this.emit('rawMessage', message, source);
    const namespace = headers?.namespace;
    if (!namespace) return;

    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent, source);
      this.enqueue(() => this.locatePlayer()).catch((err: unknown) =>
        this.log.warn('Failed to refresh after coordinator change', err));
      return;
    }

    if (!objectType) return;

    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body, source);
    }
  }
}

/** The hostname in a player's websocketUrl, or undefined if it has none. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function resolveReconnectOptions(
  input: Partial<ReconnectOptions> | boolean | undefined,
): ReconnectOptions {
  if (input === false) return { ...DEFAULT_RECONNECT, enabled: false };
  if (input === true || input === undefined) return { ...DEFAULT_RECONNECT };
  return { ...DEFAULT_RECONNECT, ...input };
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Mutation-verify**

In `locatePlayer()`, replace the `if (this._handle?.id === player.id) { … } else { … }` with just the `else` body (always build a new handle); confirm exactly `keeps its handle across a reconnect…` fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client/SonosClient.test.ts src/household/SonosHousehold.ts
git commit -m "fix: make SonosClient find its speaker and survive a reconnect

It sent getGroups without a household ID, which every speaker refuses,
so it never built a player handle: connect() resolved and every control
threw. It now reads the household ID from the refusal, finds its speaker
by IP, emits connected once, and keeps its handle and subscriptions
across a reconnect."
```

---

### Task 10: Docs and the `dist` rebuild

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-25-routing-and-subscription-upkeep-design.md`, `docs/superpowers/specs/2026-09-12-socket-failure-resilience-design.md`
- Rebuild: `dist/`

- [ ] **Step 1: Rewrite the README's usage sections**

`README.md` documents an API that no longer exists (`client.groupVolume`, `client.playerVolume`, `client.playbackMetadata`, `groupVolumeChanged`, `playbackStatusChanged`, `metadataStatusChanged`, `householdId`/`groupId`/`playerId` options) and never mentions `SonosHousehold`. Rewrite everything from `## Quick Start` through the end of `### Events` so it matches `src/`:

- **Quick Start** leads with `SonosHousehold` (the recommended API): `new SonosHousehold({ host })`, `await household.connect()`, `household.player('Arc')`, `arc.volume.group.relative(5)`, `arc.playback.pause()`, `household.group([arc, office], { transfer: true })`, `household.on('volumeChanged', (data, source) => …)`, `await household.disconnect()`.
- A short **`SonosClient`** section: single speaker; `host` must be the speaker's IP; group-level commands fail while it is grouped under another speaker; example with `client.volume.get()`, `client.volume.group.set(30)`, `client.playback.play()`.
- **Player controls** table from `PlayerHandle`: `volume` (`get`, `set`, `relative`, `mute`, `subscribe`, and `volume.group.{get,set,relative,mute,subscribe}`), `playback` (`play`, `pause`, `togglePlayPause`, `stop`, `skipToNextTrack`, `skipToPreviousTrack`, `seek`, `seekRelative`, `getStatus`, `setPlayModes`, `loadLineIn`, `getMetadata`, `subscribe`, `subscribeMetadata`), `favorites` (`get`, `load`), `playlists` (`get`, `getPlaylist`, `load`), `audioClip` (`load`, `cancel`), `homeTheater` (`get`, `set`, `subscribe`), `settings` (`get`, `set`). One sentence: group-level commands go through the group coordinator automatically.
- **Events** — the real names from `src/types/events.ts` (`volumeChanged`, `playerVolumeChanged`, `groupsChanged`, `playbackChanged`, `metadataChanged`, `favoritesChanged`, `playlistsChanged`, `homeTheaterChanged`, `coordinatorChanged`, `rawMessage`, plus `topologyChanged` on the household), each listener shown with `(data, source)`, and two sentences: `source` holds the `playerId` or `groupId` the event is about; subscriptions are kept alive across reconnects and regroups automatically once `subscribe()` has been called.

Keep the Discovery and Error Handling sections, changing `client.groupVolume.setVolume(50)` to `player.volume.group.set(50)`. Write each paragraph on one line (no hard wrapping); the README is user-facing.

- [ ] **Step 2: Update `CLAUDE.md`**

- **Current state:** branch `main` after merge, the new test count (run `npx vitest run` and use its number), and replace the "Last code commit" and "Deployed" lines with a placeholder line the controller fills in after the merge and deploy: `- Last code commit and deploy: see the routing spec's Status line.`
- **Layout:** add `src/util/` (`settleAll`, `eventSource`, logger, TypedEventEmitter) and `src/client/discoverHouseholdId.ts` to the relevant rows.
- **PlayerHandle contexts paragraph:** the coordinator context now carries group volume, playback, playback metadata and loading favorites/playlists; name the live evidence (a non-coordinator's socket answers `groupCoordinatorChanged`).
- **Invariants:** add two bullets — "Group-level commands and subscriptions go through the coordinator's socket; player-level ones through the player's own." and "Subscriptions are intents: `subscribe()` records one, and the household re-sends every wanted subscription after any reconnect or membership change. Re-sending is idempotent on the wire (verified live), so nothing tracks which ones died." Add: "Every socket's events reach listeners, tagged `{ playerId?, groupId? }`."
- **Known-open follow-ups:** replace the list with what remains: `connectTimeout` validation (not reachable until the option is exposed); `unsubscribe()` on a group-level namespace stops that group's events for every handle until the next re-send; `autoConnect: false` cannot route group commands.

- [ ] **Step 3: Close out the specs**

In the routing spec, set `**Status:**` to `COMPLETE — merged to main; deploy recorded below.` (the controller adds the commit and deploy line after merging). In the resilience spec's follow-up list at its end, mark the reconnect-abort log line, the interleaving `handleReconnected()` runs, and `send()` while `'connecting'` as resolved by `2026-09-25-routing-and-subscription-upkeep-design.md`; leave `connectTimeout` validation open.

- [ ] **Step 4: Rebuild `dist` and verify**

Run: `npm run build && npx vitest run && npx tsc --noEmit`
Then confirm the build carries the new code: `grep -c "resubscribeAll" dist/index.js` prints a number greater than 0, and `grep -c "crypto.randomUUID" dist/index.js` prints 0.

- [ ] **Step 5: Commit (two commits)**

```bash
git add README.md CLAUDE.md docs/superpowers/specs
git commit -m "docs: document routing, event sources and subscription upkeep

The README described an API that no longer existed and never mentioned
SonosHousehold."
git add dist
git commit -m "chore: rebuild dist with routing, subscription upkeep and the SonosClient fix"
```

---

## After Task 10 — controller only (not a subagent task)

1. Whole-branch code review (`superpowers:requesting-code-review`) over `main..routing-and-subscription-upkeep`; fix what it finds.
2. Live verification against the speakers through the **built** `dist/`, with Office and Bedroom idle and their grouping and volumes restored afterwards (probe scripts in the session scratchpad):
   - Office grouped under Bedroom: `household.player('Office').playback.getStatus()` and `.pause()` succeed.
   - A `playback` subscription made before a regroup keeps delivering events tagged with the new `groupId` after Office leaves and rejoins.
   - `npx tsx examples/smoke.ts 192.168.68.225` runs `SonosClient` end to end.
3. Merge to `main` (fast-forward) and push; `superpowers:finishing-a-development-branch`.
4. Deploy to Neurotto by memory `feedback_deploy_sonos_ws_to_neurotto`, exactly; confirm `/health`, three `:1443` sockets, and `Event: … @<host>` lines in `neurotto.detail.log`.
5. Neurotto handoff note (`volumeChanged` now fires for every group; filter on `source.groupId`).
6. Memory updates (`project_external_volume_controller`: new log format; `feedback_sonos_api_constraints`: routing table, group-ID churn, idempotent subscribe), `CLAUDE.md` state line, spec status line, vault republish of the spec and the README.
