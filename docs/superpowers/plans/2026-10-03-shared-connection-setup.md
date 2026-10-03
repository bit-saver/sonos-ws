# Shared Connection Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One connect/setup bookkeeping path, `ConnectionSetup`, used by both `SonosClient` and `SonosHousehold`, and one copy of the reconnect defaults.

**Architecture:** A small class in `src/client/` owns the setup queue, owned-handshake count, socket epochs, disconnect count and the "Disconnected during setup" tail; each owner hands in its own setup work and its `'connected'` emit. `DEFAULT_RECONNECT`/`resolveReconnectOptions` move into `SonosConnection.ts`. Pure refactor: the existing contract suites are the guard.

**Tech Stack:** TypeScript (NodeNext, strict), vitest 2, `SonosConnection` mocked per suite.

**Spec:** `docs/superpowers/specs/2026-10-03-shared-connection-setup-design.md` — read it first.

## What already exists

The block being merged, per the spec's table: `src/client/SonosClient.ts:60-71` (fields + getter), `:131-140` (`connect`), `:147-162` (`enqueue`, `onConnected`), `:164-181` (`setUp` tail); `src/household/SonosHousehold.ts:92-106` (fields + getter), `:202-230` (`connect`, `onPrimaryConnected`, `enqueueSetup`), `:234` (`disconnects++`), `:634-635` and `:691-701` (`handleReconnected` capture + tail). Reconnect defaults: `SonosClient.ts:34-37`, `:257-263`; `SonosHousehold.ts:20-28`, `:706-716`. Precedent for a shared unit: `src/client/discoverHouseholdId.ts`.

## New names and files

- `src/client/ConnectionSetup.ts` (class `ConnectionSetup`): neither peer class can hold code the other imports without one depending on the other; `SonosConnection` is the socket, not an owner's setup. Not exported from `src/index.ts`.
- `resolveReconnectOptions` becomes an export of `src/client/SonosConnection.ts` (not of the barrel); `DEFAULT_RECONNECT` stays module-private there.

## Global Constraints

- No behavior change. The public API, the `'connected'` contract (CLAUDE.md, Invariants) and every existing test's expectations stay as they are; tests change only in comments naming moved members and in the five `vi.mock` factories of Task 1.
- `ConnectionSetup`'s `'connected'` listener must be the connection's first `'connected'` listener and must return its setup run (`tests/client/SonosClient.test.ts:230`, `tests/household/SonosHousehold.test.ts:315, :636, :682` call `_listeners.get('connected')[0]` and await it).
- Follow the style guide in project memory (`codebase-conventions.md`): explicit field assignment in constructors (no parameter properties), `.js` import suffixes, `import type` for types, JSDoc on exports, brief comments (`~/.claude/rules/code-comments.md`).
- Do NOT touch `dist/`. Conventional commit prefixes; no `Co-Authored-By` line. American spelling.
- Mutation-verify each moved guard (break it, see a named test fail, restore); a named test failing alongside others is fine.
- Commands: `npx vitest run <file>`, `npx vitest run`, `npx tsc --noEmit`. Baseline: 188 tests pass, tsc clean.

---

### Task 1: One copy of the reconnect defaults

**Files:**
- Modify: `src/client/SonosConnection.ts` (after `ConnectionOptions`, ~line 70)
- Modify: `src/client/SonosClient.ts:3,34-37,257-263`
- Modify: `src/household/SonosHousehold.ts` (imports, `:20-28`, `:706-716`)
- Modify: the `vi.mock('../../src/client/SonosConnection.js', …)` factories in `tests/client/SonosClient.test.ts:7`, `tests/household/SonosHousehold.test.ts:8`, `tests/household/SonosHousehold.connect.test.ts:18`, `tests/household/SonosHousehold.disconnect-during-setup.test.ts:14`, `tests/household/SonosHousehold.multi.test.ts:19`

**Interfaces:**
- Produces: `export function resolveReconnectOptions(input: Partial<ReconnectOptions> | boolean | undefined): ReconnectOptions` from `src/client/SonosConnection.ts`.

- [ ] **Step 1: Move the defaults into `SonosConnection.ts`**

Add after the `ConnectionOptions` interface:

```ts
/** Reconnect behavior when the caller passes none. */
const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: Infinity,
  pingInterval: 30000,
  pongTimeout: 10000,
};

/** Fills a caller's partial reconnect options from the defaults; `false` turns reconnecting off. */
export function resolveReconnectOptions(input: Partial<ReconnectOptions> | boolean | undefined): ReconnectOptions {
  if (input === false) return { ...DEFAULT_RECONNECT, enabled: false };
  if (input === true || input === undefined) return { ...DEFAULT_RECONNECT };
  return { ...DEFAULT_RECONNECT, ...input };
}
```

- [ ] **Step 2: Use it from both owners**

In `src/client/SonosClient.ts`: delete `DEFAULT_RECONNECT` (`:34-37`) and the local `resolveReconnectOptions` (`:257-263`); change line 2 to `import { SonosConnection, resolveReconnectOptions } from './SonosConnection.js';`. If `ReconnectOptions` (line 3) is then used only in `SonosClientOptions`, keep that `import type` line.

In `src/household/SonosHousehold.ts`: delete `DEFAULT_RECONNECT` (`:20-28`) and the local `resolveReconnectOptions` (`:706-716`); change line 1 to `import { SonosConnection, resolveReconnectOptions } from '../client/SonosConnection.js';`. Keep `import type { ReconnectOptions }` (the `reconnectOptions` field uses it).

- [ ] **Step 3: Keep the real export behind each mock**

In each of the five factories, make the factory `async (importOriginal) =>` and spread the real module first, so `resolveReconnectOptions` stays real while `SonosConnection` stays mocked:

```ts
// before
vi.mock('../../src/client/SonosConnection.js', () => {
  // …unchanged body…
  return { SonosConnection: vi.fn(make) };
});
// after
vi.mock('../../src/client/SonosConnection.js', async (importOriginal) => {
  // …unchanged body…
  return {
    ...(await importOriginal<typeof import('../../src/client/SonosConnection.js')>()),
    SonosConnection: vi.fn(make),
  };
});
```

For the two arrow-object factories (`SonosClient.test.ts:7`, `SonosHousehold.multi.test.ts:19`), `() => ({ SonosConnection: … })` becomes `async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/client/SonosConnection.js')>()), SonosConnection: … })`.

- [ ] **Step 4: Run**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 188 pass; tsc clean. Without Step 3 the household suites fail at construction (`resolveReconnectOptions is not a function`) — if you skipped it to watch that, record it.

- [ ] **Step 5: Mutation-verify**

In `SonosConnection.ts`'s `DEFAULT_RECONNECT`, set `maxDelay: 20000`: `tests/household/SonosHousehold.test.ts` › `default backoff shape is a published contract` fails (proves the household reads the moved copy). Restore.

- [ ] **Step 6: Commit**

```bash
git add src/client/SonosConnection.ts src/client/SonosClient.ts src/household/SonosHousehold.ts tests/client/SonosClient.test.ts tests/household/SonosHousehold.test.ts tests/household/SonosHousehold.connect.test.ts tests/household/SonosHousehold.disconnect-during-setup.test.ts tests/household/SonosHousehold.multi.test.ts
git commit -m "refactor: one copy of the reconnect defaults, in SonosConnection"
```

---

### Task 2: `ConnectionSetup`, adopted by `SonosClient`

**Files:**
- Create: `src/client/ConnectionSetup.ts`
- Modify: `src/client/SonosClient.ts` (fields `:60-71`, constructor's `'connected'` line, `connect` `:131-140`, `disconnect`, `enqueue`/`onConnected` `:147-162`, `setUp` `:164-181`, imports)
- Test: `tests/client/SonosClient.test.ts` (comments only, if any name a moved member)

**Interfaces:**
- Produces: `class ConnectionSetup` — `constructor(connection: SonosConnection, setUp: () => Promise<void>, onSetUp: () => void, log: Logger)`, `connect(): Promise<void>`, `noteDisconnect(): void`. Task 3 uses all three.

- [ ] **Step 1: Create `src/client/ConnectionSetup.ts`**

```ts
import type { SonosConnection } from './SonosConnection.js';
import type { Logger } from '../util/logger.js';
import { ConnectionError } from '../errors/ConnectionError.js';
import { ErrorCode } from '../types/errors.js';

/**
 * Runs an owner's setup once per socket its connection brings up. A connect() call sets up the handshake it awaited;
 * the 'connected' listener sets up the reconnect ladder's. Shared by SonosClient and SonosHousehold.
 */
export class ConnectionSetup {
  private readonly connection: SonosConnection;
  private readonly setUp: () => Promise<void>;
  private readonly onSetUp: () => void;
  private readonly log: Logger;
  /** Setup runs, chained so each starts after the previous one settles: a flap mid-setup must not run two at once. */
  private chain: Promise<void> = Promise.resolve();
  /** Handshakes a connect() call is awaiting: their setup is that call's to run, not the 'connected' listener's. */
  private ownedHandshakes = 0;
  /** Counts 'connected' events, so a completed setup can be matched to the socket it ran on. */
  private connectedEpoch = 0;
  /** The connectedEpoch the last completed setup started under. */
  private setupEpoch = -1;
  /** Counts disconnects, so a run parked mid-disconnect can tell one happened while the socket still reads 'connected'. */
  private disconnects = 0;

  /**
   * @param setUp - the owner's setup work; it logs its own failure
   * @param onSetUp - called when a run completes on a live socket; the owner emits 'connected' here
   */
  constructor(connection: SonosConnection, setUp: () => Promise<void>, onSetUp: () => void, log: Logger) {
    this.connection = connection;
    this.setUp = setUp;
    this.onSetUp = onSetUp;
    this.log = log;
    // Must be the connection's first 'connected' listener; returns the run so tests can await it.
    connection.on('connected', () => this.onConnected());
  }

  /** Set up on the socket that is up now, not merely set up once. */
  private get setUpOnCurrentSocket(): boolean {
    return this.setupEpoch === this.connectedEpoch;
  }

  /** Connects and sets up, unless already set up on the live socket. Rejects if the handshake or the setup fails. */
  async connect(): Promise<void> {
    if (this.setUpOnCurrentSocket && this.connection.state === 'connected') return;
    this.ownedHandshakes++;
    try {
      await this.connection.connect();
    } finally {
      this.ownedHandshakes--;
    }
    // Overlapping calls each queue this; the first to run sets up, the rest find it done.
    await this.enqueue();
  }

  /** Call first in the owner's disconnect(): a run in flight then abandons rather than announcing. */
  noteDisconnect(): void {
    this.disconnects++;
  }

  /** Sets up after a handshake no connect() call awaits: the reconnect ladder's. */
  private onConnected(): Promise<void> {
    this.connectedEpoch++;
    if (this.ownedHandshakes > 0) return Promise.resolve();
    // The run has logged its failure, and a background run has no caller to tell.
    return this.enqueue().catch(() => {});
  }

  /** Queues a run after any in flight; one queued ahead may already have set this socket up. Never rejects the chain. */
  private enqueue(): Promise<void> {
    const run = this.chain.then(() => (this.setUpOnCurrentSocket ? Promise.resolve() : this.run()));
    this.chain = run.catch(() => {});
    return run;
  }

  private async run(): Promise<void> {
    const epoch = this.connectedEpoch;
    const disconnects = this.disconnects;
    await this.setUp();
    // Disconnects too, not just state: an owner may close other sockets first, leaving this one 'connected' meanwhile.
    if (this.disconnects !== disconnects || this.connection.state !== 'connected') {
      this.log.debug('Setup abandoned: disconnected during setup');
      throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Disconnected during setup');
    }
    this.setupEpoch = epoch;
    this.onSetUp();
  }
}
```

- [ ] **Step 2: Move `SonosClient` onto it**

- Import: `import { ConnectionSetup } from './ConnectionSetup.js';`
- Replace the fields `setupChain`, `ownedHandshakes`, `connectedEpoch`, `setupEpoch` and the `setUpOnCurrentSocket` getter (`:60-71`) with `private readonly setup: ConnectionSetup;`.
- In the constructor, replace `this.connection.on('connected', () => this.onConnected());` with `this.setup = new ConnectionSetup(this.connection, () => this.setUp(), () => this.emit('connected'), this.log);` (same position: it stays the first `'connected'` registration).
- `connect()` keeps its JSDoc; its body becomes `await this.setup.connect();`.
- `disconnect()` becomes `this.setup.noteDisconnect();` then `await this.connection.disconnect();`.
- Delete `enqueue()` and `onConnected()`.
- `setUp()` keeps only the work and its log:

```ts
  /** Finds this speaker. Logs and rethrows a failure; ConnectionSetup announces success. */
  private async setUp(): Promise<void> {
    try {
      await this.locatePlayer();
    } catch (err) {
      this.log.warn('Setup after connect failed', err);
      throw err;
    }
  }
```

- Remove imports left unused (`ConnectionError` if nothing else in the file uses it — check with grep).

- [ ] **Step 3: Run**

Run: `npx vitest run tests/client/SonosClient.test.ts`, then `npx vitest run` and `npx tsc --noEmit`
Expected: all pass (188); tsc clean. If a test comment names `onConnected`/`enqueue` as a `SonosClient` member, update the comment only.

- [ ] **Step 4: Mutation-verify through `SonosClient`**

One at a time, each restored before the next; record which `SonosClient.test.ts` tests fail:
- delete `if (this.ownedHandshakes > 0) return Promise.resolve();`
- `setUpOnCurrentSocket` returns `false`
- `enqueue()` without the chain: `const run = this.setUpOnCurrentSocket ? Promise.resolve() : this.run(); return run;`
- delete `this.setupEpoch = epoch;`

Each must fail at least one test. A mutation no test catches: add one focused test to a new `tests/client/ConnectionSetup.test.ts` (a mock connection like `SonosClient.test.ts`'s, driving `connect()` and the `'connected'` listener), watch it fail under the mutation, and report it. (The disconnect-count check is unobservable through `SonosClient`; Task 3 verifies it.)

- [ ] **Step 5: Commit**

```bash
git add src/client/ConnectionSetup.ts src/client/SonosClient.ts tests/client/
git commit -m "refactor: SonosClient sets up through ConnectionSetup"
```

---

### Task 3: `SonosHousehold` onto `ConnectionSetup`; the project guide

**Files:**
- Modify: `src/household/SonosHousehold.ts` (fields `:92-106`, constructor's `'connected'` line, `connect` `:202-215`, `onPrimaryConnected`/`enqueueSetup` `:217-230`, `disconnect` `:234`, `handleReconnected` `:634-635`, `:691-701`, imports)
- Modify: `tests/household/*.ts` (comments naming moved members only)
- Modify: `CLAUDE.md` (Layout row for `src/client/`; Known-open follow-ups)

**Interfaces:**
- Consumes: `ConnectionSetup` from Task 2 (`constructor(connection, setUp, onSetUp, log)`, `connect()`, `noteDisconnect()`).

- [ ] **Step 1: Move `SonosHousehold` onto it**

- Import: `import { ConnectionSetup } from '../client/ConnectionSetup.js';`
- Replace the fields `setupChain`, `ownedHandshakes`, `primaryEpoch`, `setupEpoch`, `disconnects` and the `setUpOnCurrentSocket` getter (`:92-106`) with `private readonly setup: ConnectionSetup;`. Keep `_initialConnectDone`.
- In the constructor, replace `this.connection.on('connected', () => this.onPrimaryConnected());` with `this.setup = new ConnectionSetup(this.connection, () => this.handleReconnected(), () => this.emit('connected'), this.log);`.
- `connect()` keeps its JSDoc; its body becomes:

```ts
    // A new socket gets first-connect setup; a live one may have a ladder run in flight, which this call just waits for.
    if (this.connection.state !== 'connected') this._initialConnectDone = false;
    await this.setup.connect();
```

- Delete `onPrimaryConnected()` and `enqueueSetup()`.
- In `disconnect()`, `this.disconnects++;` becomes `this.setup.noteDisconnect();`.
- In `handleReconnected()`, delete `const epoch = this.primaryEpoch;` and `const disconnects = this.disconnects;`, and delete the tail after the `if/else` (the comment block, the disconnects/state check, `this.setupEpoch = epoch;`, `this.emit('connected');`). Add to its JSDoc: "ConnectionSetup announces the result."
- Remove imports left unused (check `ConnectionError`/`ErrorCode` — the mid-setup checks still use them).

- [ ] **Step 2: Run**

Run: `npx vitest run tests/household/`, then `npx vitest run` and `npx tsc --noEmit`
Expected: all pass (188, or more if Task 2 added focused tests); tsc clean. Update test comments that name `onPrimaryConnected`, `enqueueSetup` or `ownedHandshakes` as household members (e.g. `SonosHousehold.test.ts:350-354`, `SonosHousehold.connect.test.ts:274`) to name `ConnectionSetup`; no expectation changes.

- [ ] **Step 3: Mutation-verify through `SonosHousehold`**

One at a time in `ConnectionSetup.ts`, restored after each; record which household tests fail:
- delete `if (this.ownedHandshakes > 0) return Promise.resolve();`
- `setUpOnCurrentSocket` returns `false`
- `enqueue()` without the chain (as in Task 2)
- delete `this.disconnects !== disconnects ||` (expect the many-speakers disconnect test from `bee04d5` to fail)

Each must fail at least one test; if one survives, add a focused test to `tests/client/ConnectionSetup.test.ts` and report it.

- [ ] **Step 4: Project guide**

In `CLAUDE.md`:
- Layout table, `src/client/` row: after `discoverHouseholdId (…)`, add "`ConnectionSetup` (runs an owner's setup once per socket: the handshake a `connect()` awaits, or the ladder's; shared by `SonosClient` and `SonosHousehold`)".
- Known-open follow-ups: delete "the `ownedHandshakes`/`setupChain`/epoch block is duplicated in `SonosClient` and `SonosHousehold` (a fix to one must be mirrored); ". Keep the sentence grammatical.

- [ ] **Step 5: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/ tests/client/ CLAUDE.md
git commit -m "refactor: SonosHousehold sets up through ConnectionSetup; one setup path for both"
```

---

### Task 4: Fit review

- [ ] **Step 1:** Invoke the `fit-review` skill on the branch (base = the commit before Task 1) and apply what it finds, in the repo's style.
- [ ] **Step 2:** `npx vitest run` and `npx tsc --noEmit` pass; commit any fixes (`refactor:` or `docs:`).

The `dist/` rebuild (`npm run build`, `chore: rebuild dist …`, byte-identical check) runs after the final whole-branch review, as the finishing step.
