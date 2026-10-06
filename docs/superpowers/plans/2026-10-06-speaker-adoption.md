# Speaker Adoption and Subscription Upkeep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A speaker discovered after setup gets its socket and diagnostics at once, diagnostics are declared once per handle, `autoConnect: false` survives a primary reconnect, and a re-send Sonos refuses mid-regroup stops warning.

**Architecture:** All production changes are in `src/household/SonosHousehold.ts`: a `WeakSet` of diagnosed handles, an `adopt()` step that `refreshTopology()` runs for a handle it creates after setup, `disconnect()` clearing `_initialConnectDone` first, `reconnectSpeakers()` losing its discovery loop, and `resubscribeAll()` logging a `groupCoordinatorChanged`-only failure at debug. Tests go in `tests/household/SonosHousehold.multi.test.ts`, whose per-host socket mocks show which socket carried what.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest 2 (no config file), `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-10-06-speaker-adoption-design.md`

## What already exists

(Line numbers in `src/household/SonosHousehold.ts` at the plan's base, `a5a50f5`.)

- `refreshTopology()` :230 — creates a handle for a new player (:245-250); re-sends subscriptions on a membership change (:262-269).
- `subscribeDiagnostics()` :310 — declares group-volume, playback and home-theater intents for every handle; called once, from first-connect setup (:613).
- `resubscribeAll()` :330 — re-sends every handle's intents; warns per handle on failure (:333-334).
- `connectAllSpeakers()` :386 and `connectToSpeaker(player)` :405 — the latter stores the socket and points the handle at it before awaiting `connect()`, and never rethrows a connect failure.
- `reconnectSpeakers()` :551 — first loop reconnects dropped speaker sockets; second loop (:564-577) opens sockets for players not in `speakerConnections`.
- `handleReconnected()` :588 — first-connect branch gated on `_initialConnectDone` (:77; set :614; cleared by `connect()` :181).
- `disconnect()` :186 — closes and clears `speakerConnections`, then the primary.
- The debug-or-warn idiom `this.log[reported ? 'debug' : 'warn'](...)` :443; a Sonos error code compared as a string literal on a `CommandError` (GroupingEngine.ts:407).
- Test harness `tests/household/SonosHousehold.multi.test.ts`: per-host mock sockets (`instances`, `socket(host)`, `sentVia`, `fireConnected`, `connectedHousehold`, fixtures `solo`, `officeUnderBedroom`, players `ARC`, `OFFICE`, `BED`, `KITCHEN`).

## New names and files

- `private readonly diagnosed = new WeakSet<PlayerHandle>()` — records which handles had diagnostics declared. `BaseNamespace`'s `subscribed` flag says what is wanted now, which is exactly what `unsubscribe()` clears and a re-declare must not override, so it cannot hold this.
- `private adopt(handle, player)` — the step `refreshTopology()` runs for a handle created after setup; holds the two not-awaited steps and their logging.
- `function refusedMidMove(err: unknown): boolean` (module-private) — the one test `resubscribeAll()` needs to pick debug over warn.
- Test fixture `withKitchen` — the `solo` topology plus Kitchen alone, for discovery after setup.
- No new file, type or public name.

## Global Constraints

- Lines at most 120 columns. Plain strings in single quotes; a long call breaks after `(` with one argument per line and a trailing comma.
- No new dependency, file, type or public name.
- Best-effort async is caught and logged, never rethrown: `.catch((err: unknown) => this.log.warn('…', err))`.
- Comments say what a reader needs now, ~30 words at most per block; history and figures go in the commit message.
- Vocabulary: household, player, handle, speaker (a player's own socket), primary, intent, diagnostics, adopt.
- Neurotto's `'connected'` contract is unchanged; `tests/household/SonosHousehold.connect.test.ts` must stay green.
- Mutation-verify every guard: break the guarded line, run, confirm exactly the named test fails, restore.
- Run the whole suite (`npx vitest run`) and `npx tsc --noEmit` before each commit.

---

### Task 1: Diagnostics declared once per handle

**Files:**
- Modify: `src/household/SonosHousehold.ts:83-90` (fields), `:300-321` (`subscribeDiagnostics`), `:613` (its call)
- Test: `tests/household/SonosHousehold.multi.test.ts` (`describe('diagnostic subscriptions')`, ~line 280)

**Interfaces:**
- Produces: `private subscribeDiagnostics(handles: Iterable<PlayerHandle>): void` — declares the three diagnostic intents for each handle not yet in `diagnosed`, and adds it. Task 2 calls it with `[handle]`.

- [ ] **Step 1: Write the failing test**

Add inside `describe('diagnostic subscriptions', () => {` in `tests/household/SonosHousehold.multi.test.ts`, after the existing test:

```ts
  it('keeps a diagnostic unsubscribed through disconnect() and connect()', async () => {
    const household = await connectedHousehold(solo);
    // connect() after disconnect() opens new sockets to the same hosts, so count across all of them.
    const subscribes = (host: string, namespace: string) => instances
      .filter((i) => i.host === host)
      .flatMap((i) => i.send.mock.calls.map(([req]: any) => req[0]))
      .filter((h: any) => h.namespace === namespace && h.command === 'subscribe').length;
    await household.player('Office').homeTheater.unsubscribe();
    const before = subscribes(OFFICE_IP, 'homeTheater:1');

    await household.disconnect();
    await household.connect();

    expect(subscribes(OFFICE_IP, 'homeTheater:1')).toBe(before);
    expect(subscribes(BED_IP, 'homeTheater:1')).toBeGreaterThan(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "keeps a diagnostic unsubscribed"`
Expected: FAIL — `expected 2 to be 1` (first-connect setup re-declared Office's home-theater diagnostic).

- [ ] **Step 3: Implement**

In `src/household/SonosHousehold.ts`, add the field after `private readonly setup: ConnectionSetup;`:

```ts
  /** Handles whose diagnostics were declared; a re-run of first-connect setup skips them, so an unsubscribe() stays. */
  private readonly diagnosed = new WeakSet<PlayerHandle>();
```

Replace `subscribeDiagnostics()` and its JSDoc with:

```ts
  /**
   * Subscribes players to the events that say what an external controller did: group volume (a group set is
   * otherwise indistinguishable from a player set), playback, and home theater (a TV input switch).
   * Best effort and not awaited: a send to an offline speaker can wait out the whole request timeout, and diagnostics
   * must never stop or stall a household connecting. Each intent is recorded before its send, so an offline speaker's
   * are re-sent when its socket connects.
   * Declared once per handle; resubscribeAll() keeps them alive after.
   */
  private subscribeDiagnostics(handles: Iterable<PlayerHandle>): void {
    for (const handle of handles) {
      if (this.diagnosed.has(handle)) continue;
      this.diagnosed.add(handle);
      const subscriptions: [string, () => Promise<void>][] = [
        ['groupVolume', () => handle.volume.group.subscribe()],
        ['playback', () => handle.playback.subscribe()],
        ['homeTheater', () => handle.homeTheater.subscribe()],
      ];
      for (const [name, subscribe] of subscriptions) {
        void subscribe().catch((err: unknown) => this.log.warn(`Failed to subscribe ${handle.name} to ${name} events`, err));
      }
    }
  }
```

In `handleReconnected()`'s first-connect branch, change `this.subscribeDiagnostics();` to:

```ts
        this.subscribeDiagnostics(this._players.values());
```

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "keeps a diagnostic unsubscribed"` → PASS.
Run: `npx vitest run` → all pass. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Mutation-verify**

Delete the line `if (this.diagnosed.has(handle)) continue;`, run the new test → it must FAIL; restore. Run the suite again → green.

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "fix: declare diagnostics once per handle, so connect() after disconnect() keeps an unsubscribe()"
```

---

### Task 2: Adopt a speaker discovered after setup; drop the reconnect discovery loop

**Files:**
- Modify: `src/household/SonosHousehold.ts` — `disconnect()` (:186), `refreshTopology()` new-handle branch (:245-250), new private `adopt()` (right after `connectAllSpeakers()`), `reconnectSpeakers()` (:546-580)
- Test: `tests/household/SonosHousehold.multi.test.ts` — new fixture `withKitchen`, new `describe('adopting a speaker discovered after setup')`, rewrite of the test "re-sends a new speaker's player-level subscriptions only on its own socket once that connects" (~line 251)

**Interfaces:**
- Consumes: `subscribeDiagnostics(handles: Iterable<PlayerHandle>)` from Task 1; existing `connectToSpeaker(player: Player): Promise<SonosConnection>` (stores the socket and points the handle at it synchronously, never rethrows a connect failure).
- Produces: `private adopt(handle: PlayerHandle, player: Player): void`.

- [ ] **Step 1: Add the fixture**

In `tests/household/SonosHousehold.multi.test.ts`, after the `officeUnderBedroom` fixture:

```ts
const withKitchen = {
  groups: [...solo.groups, { id: 'G_KIT', name: 'Kitchen', coordinatorId: 'RINCON_KITCHEN', playerIds: ['RINCON_KITCHEN'] }],
  players: [ARC, OFFICE, BED, KITCHEN],
} as GroupsResponse;
```

- [ ] **Step 2: Write the failing tests**

Add a new top-level describe after `describe('subscription upkeep', ...)`:

```ts
describe('adopting a speaker discovered after setup', () => {
  const diagnostics = ['groupVolume:1', 'playback:1', 'homeTheater:1'];
  const kitchenDiagnosticsVia = (host: string) => diagnostics.map((namespace) =>
    sentVia(host, namespace, 'subscribe').some((h: any) => h.groupId === 'G_KIT' || h.playerId === 'RINCON_KITCHEN'));

  it('opens its own socket and declares its diagnostics there', async () => {
    const household = await connectedHousehold(solo);

    topology = withKitchen;
    await household.refreshTopology();

    expect(socket(KITCHEN_IP).state).toBe('connected');
    await vi.waitFor(() => expect(kitchenDiagnosticsVia(KITCHEN_IP)).toEqual([true, true, true]));
  });

  it('declares its diagnostics but opens no socket under autoConnect: false', async () => {
    const household = await connectedHousehold(solo, { autoConnect: false });

    topology = withKitchen;
    await household.refreshTopology();

    await vi.waitFor(() => expect(kitchenDiagnosticsVia(PRIMARY)).toEqual([true, true, true]));
    expect(instances.map((i) => i.host)).toEqual([PRIMARY]);
  });

  it('opens no speaker socket on a primary reconnect under autoConnect: false', async () => {
    await connectedHousehold(solo, { autoConnect: false });

    await fireConnected(PRIMARY);

    expect(instances.map((i) => i.host)).toEqual([PRIMARY]);
  });

  it('adopts nothing from a topology read that lands once disconnect() has begun', async () => {
    const household = await connectedHousehold(solo);
    topology = withKitchen;

    const read = household.refreshTopology();
    await household.disconnect();
    await read;

    expect(instances.some((i) => i.host === KITCHEN_IP)).toBe(false);
  });
});
```

Replace the test "re-sends a new speaker's player-level subscriptions only on its own socket once that connects" (in `describe('subscription upkeep')`) with:

```ts
  it("sends a new speaker's player-level subscriptions on its own socket, and re-sends them there when it reconnects", async () => {
    const household = await connectedHousehold(solo);
    topology = withKitchen;
    await household.refreshTopology();

    await household.player('Kitchen').volume.subscribe();
    socket(KITCHEN_IP)._emit('connected');

    await vi.waitFor(() => expect(wantedOn(KITCHEN_IP, 'playerVolume:1', { playerId: 'RINCON_KITCHEN' })).toBe(2));
    expect(wantedOn(PRIMARY, 'playerVolume:1', { playerId: 'RINCON_KITCHEN' })).toBe(0);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "adopting a speaker"`
Expected: "opens its own socket…" FAILS (`no socket for 10.0.0.4`); "declares its diagnostics but opens no socket…" FAILS (diagnostics `[false, false, false]`); "opens no speaker socket on a primary reconnect…" FAILS (hosts include `10.0.0.2`, `10.0.0.3`). "adopts nothing…" may pass before the change (nothing adopts yet); it is verified by mutation in Step 6.
Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "sends a new speaker"` → FAILS (`no socket for 10.0.0.4`).

- [ ] **Step 4: Implement**

In `disconnect()`, insert right after `this.setup.noteDisconnect();`:

```ts
    // A topology read that lands from here on adopts nothing, so no socket opens after the map is cleared.
    this._initialConnectDone = false;
```

In `refreshTopology()`, replace the new-handle branch with:

```ts
      } else {
        const handle = new PlayerHandle(player, group, householdId, this.connection, this.connection);
        // Set at creation, so a handle made after setup (a new speaker) routes group commands correctly too.
        handle.setCoordinatorConnectionResolver(() => this.connectionForPlayer(handle.coordinatorId));
        this._players.set(player.id, handle);
        // Setup covers the handles it finds; one found later is adopted here.
        if (this._initialConnectDone) this.adopt(handle, player);
      }
```

Add after `connectAllSpeakers()`:

```ts
  /**
   * Gives a speaker discovered after setup what setup gives every speaker it finds: its own socket (with
   * `autoConnect`) and its diagnostics. Not awaited.
   */
  private adopt(handle: PlayerHandle, player: Player): void {
    if (this.autoConnectSpeakers) {
      void this.connectToSpeaker(player).catch((err: unknown) => this.log.warn(`Failed to connect to ${player.name}:`, err));
    }
    this.subscribeDiagnostics([handle]);
  }
```

Replace `reconnectSpeakers()` and its JSDoc with:

```ts
  /**
   * Reconnects any per-speaker connections that have dropped. Called as a safety net after the primary connection
   * reconnects; a speaker discovered meanwhile is adopted by refreshTopology().
   */
  private async reconnectSpeakers(): Promise<void> {
    const reconnectPromises: Promise<void>[] = [];

    for (const [playerId, conn] of this.speakerConnections) {
      if (conn.state === 'disconnected') {
        this.log.info(`Reconnecting speaker ${playerId}`);
        reconnectPromises.push(
          conn.connect().catch((err: unknown) =>
            this.log.debug(`Failed to reconnect speaker ${playerId}:`, err)),
        );
      }
    }

    await Promise.allSettled(reconnectPromises);
  }
```

- [ ] **Step 5: Run the tests and the suite**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts` → all pass.
Run: `npx vitest run` → all pass. `npx tsc --noEmit` → clean.

- [ ] **Step 6: Mutation-verify** (one at a time; restore after each)

- Delete `this._initialConnectDone = false;` from `disconnect()` → "adopts nothing from a topology read that lands once disconnect() has begun" must FAIL.
- Remove `if (this.autoConnectSpeakers)` in `adopt()` (always connect) → "declares its diagnostics but opens no socket under autoConnect: false" must FAIL.
- Delete `this.subscribeDiagnostics([handle]);` in `adopt()` → both diagnostics tests in the new describe must FAIL.
- Restore the old second loop in `reconnectSpeakers()` → "opens no speaker socket on a primary reconnect under autoConnect: false" must FAIL.
- Remove the `if (this._initialConnectDone)` condition (adopt always) → report what fails. If nothing does, say so: during first-connect setup an extra adoption only repeats what setup does, and the guard that matters is the `disconnect()` one above.

- [ ] **Step 7: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "feat: adopt a speaker discovered after setup, and stop opening speaker sockets on reconnect under autoConnect: false"
```

---

### Task 3: A re-send Sonos refuses mid-regroup logs at debug

**Files:**
- Modify: `src/household/SonosHousehold.ts` — imports (:13-15), new module-level function after `TOPOLOGY_EVENT_DEBOUNCE_MS` (:26), `resubscribeAll()` and its JSDoc (:323-336)
- Test: `tests/household/SonosHousehold.multi.test.ts` (`describe('subscription upkeep')`)

**Interfaces:**
- Produces: `function refusedMidMove(err: unknown): boolean` (module-private).

- [ ] **Step 1: Write the failing test**

Add the import at the top of `tests/household/SonosHousehold.multi.test.ts`:

```ts
import { CommandError } from '../../src/errors/CommandError.js';
```

Add inside `describe('subscription upkeep', () => {`:

```ts
  it.each([
    { why: 'only because the coordinator is moving', level: 'debug', code: () => 'groupCoordinatorChanged' },
    { why: 'for another reason', level: 'warn', code: () => 'ERROR_COMMAND_FAILED' },
    {
      why: 'partly for another reason',
      level: 'warn',
      code: (namespace: string) => (namespace === 'groupVolume:1' ? 'groupCoordinatorChanged' : 'ERROR_COMMAND_FAILED'),
    },
  ] as const)('logs a re-send Sonos refuses $why at $level', async ({ level, code }) => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await connectedHousehold(solo, { logger: log });
    socket(OFFICE_IP).send.mockImplementation(async ([headers]: any) => {
      if (headers.command === 'subscribe') throw new CommandError(code(headers.namespace), 'refused');
      return [{ success: true }, {}];
    });

    socket(OFFICE_IP)._emit('connected');

    const logged = (at: 'debug' | 'warn') =>
      log[at].mock.calls.some((call: unknown[]) => call[0] === 'Failed to restore event subscriptions for Office');
    await vi.waitFor(() => expect(logged(level)).toBe(true));
    expect(logged(level === 'debug' ? 'warn' : 'debug')).toBe(false);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "logs a re-send Sonos refuses"`
Expected: the `debug` row FAILS (logged at warn); the two `warn` rows pass.

- [ ] **Step 3: Implement**

In `src/household/SonosHousehold.ts`, add the import next to the other error imports:

```ts
import { CommandError } from '../errors/CommandError.js';
```

Add after the `TOPOLOGY_EVENT_DEBOUNCE_MS` constant:

```ts
/**
 * Whether Sonos refused a re-send only because the group's coordinator is moving, as it does mid-regroup. The
 * membership change that ends the move re-sends, so such a failure is not worth a warning.
 */
function refusedMidMove(err: unknown): boolean {
  return err instanceof AggregateError
    && err.errors.every((e: unknown) => e instanceof CommandError && e.code === 'groupCoordinatorChanged');
}
```

Replace `resubscribeAll()` and its JSDoc with:

```ts
  /**
   * Re-sends every subscription the handles want. Runs wherever one may have died:
   * - the end of setup and of each primary reconnect
   * - a speaker's own socket reconnecting
   * - a membership change (a player that leaves a group gets a new group ID)
   * Re-sending a live subscription is harmless, so nothing tracks which ones died. A re-send refused mid-regroup logs
   * at debug.
   */
  private async resubscribeAll(): Promise<void> {
    await Promise.all(
      [...this._players.values()].map((handle) =>
        handle.resubscribe().catch((err: unknown) =>
          this.log[refusedMidMove(err) ? 'debug' : 'warn'](`Failed to restore event subscriptions for ${handle.name}`, err))),
    );
  }
```

If that `this.log[...]` line exceeds 120 columns, break the call after `(` with one argument per line and a trailing comma.

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run tests/household/SonosHousehold.multi.test.ts -t "logs a re-send Sonos refuses"` → 3 PASS.
Run: `npx vitest run` → all pass. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Mutation-verify** (restore after each)

- Change `every` to `some` → the "partly for another reason" row must FAIL.
- Change `'groupCoordinatorChanged'` to `'x'` → the debug row must FAIL.
- Replace `refusedMidMove(err) ? 'debug' : 'warn'` with `'warn'` → the debug row must FAIL.

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "fix: a re-send Sonos refuses mid-regroup logs at debug, not warn"
```

---

### Task 4: Fit review

- [ ] **Step 1:** Invoke the `fit-review` skill with base = `git merge-base HEAD main`. Apply its fixes, run `npx vitest run` and `npx tsc --noEmit`, and commit them (`refactor: fit review …`). Report each check's outcome.
