# Fatal Error Prevention Design

## Problem

When the initial WebSocket connection to a Sonos speaker fails at app
startup (e.g. network unavailable), sonos-ws propagates an uncaught
exception that crashes the host application. Observed crash from
Neurotto:

```
uncaughtException: ConnectionError: Failed to connect: WebSocket
connection to 'wss://192.168.68.96:1443/websocket/api' failed
    at onError (…/src/client/SonosConnection.ts:164:15)
```

Followed by Neurotto's own crash-loop detector:

```
CRASH LOOP DETECTED (3) — holding inert
```

Three interlinked defects:

1. **`emit('error', ...)` throws when no listener is attached.** Node's
   `EventEmitter` treats an `'error'` event with zero listeners as fatal.
   sonos-ws emits `'error'` in three places (initial `onError`,
   post-open `ws.on('error')`, and reconnect exhaustion). Any of them can
   crash the host if a listener isn't attached at that moment.
2. **Initial connect failure gives up entirely.** No reconnect loop is
   started after `onError`, so a momentary network problem at startup
   leaves the household permanently dead until someone calls `connect()`
   again.
3. **Per-speaker connection failure orphans the speaker.** If
   `connectToSpeaker()`'s initial `await conn.connect()` rejects, the
   `SonosConnection` is discarded — no reconnect loop keeps trying.

## Goals

- The library never causes an uncaught exception in the host app.
- Connections that fail on initial attempt self-heal in the background
  when the network recovers.
- The caller learns about the first failure immediately (promise still
  rejects) but doesn't need to reset anything to benefit from later
  recovery.
- Reconnect exhaustion emits a well-defined signal the caller can
  respond to (e.g. push notification).

## Approach

Layered defensive fixes in `SonosConnection`, `SonosHousehold`, and
Neurotto's `Sonos` wrapper. No new abstractions.

---

## 1. Safety-net error listener

Guarantee `emit('error', ...)` always has ≥1 listener.

### SonosConnection

In the constructor, immediately after `super()`, attach an internal listener that logs via the configured logger:

```typescript
this.on('error', (err) => {
  this.log.error(`Unhandled connection error: ${err.message}`);
});
```

- User-attached listeners still fire alongside this one.
- The distinctive `Unhandled connection error` prefix lets operators spot cases where the user forgot to attach their own listener.
- Only `'error'` needs this treatment; other events don't throw-on-no-listener.

### SonosHousehold

Same pattern in the household constructor for the household-level `'error'` event that its listener re-emits:

```typescript
this.on('error', (err) => {
  this.log.error(`Unhandled household error: ${err.message}`);
});
```

---

## 2. Retry initial connect failure

In `SonosConnection.onError` (the initial-connect error handler), start
the reconnect loop after rejecting the promise.

### Change

Add to `onError`, after `reject(connErr)`:

```typescript
if (this.options.reconnect.enabled && !this.intentionalClose) {
  this.scheduleReconnect();
}
```

### Semantics

- The rejected promise informs the caller immediately (they may log,
  toast, or set up manual retry).
- The reconnect loop takes over silently, using existing exponential
  backoff (initialDelay → factor → maxDelay, up to maxAttempts).
- If the loop eventually succeeds, `'connected'` fires — the caller's
  attached listeners react normally (see Section 3 for initial-setup
  handling).
- If `maxAttempts` is exhausted, the existing `scheduleReconnect`
  emits `ConnectionError(RECONNECT_EXHAUSTED)` via `'error'` and
  `'disconnected'` with reason `'reconnect exhausted'`.

---

## 3. First-connect-after-fail setup

Refactor `SonosHousehold.handleReconnected()` to run the full initial
setup (household ID discovery, topology refresh, speaker connections)
on the first successful `'connected'` event — regardless of which
attempt it is.

### Current problem

`connect()` runs the initial setup inline after `await this.connection.connect()`:

```typescript
await this.connection.connect();
await this.discoverHouseholdId();
await this.refreshTopology();
if (this.autoConnectSpeakers) await this.connectAllSpeakers();
this._initialConnectDone = true;
```

If the first line rejects, none of the rest runs — even if a background reconnect later succeeds.

### New handleReconnected

```typescript
private async handleReconnected(): Promise<void> {
  if (!this._initialConnectDone) {
    try {
      await this.discoverHouseholdId();
      await this.refreshTopology();
      if (this.autoConnectSpeakers) {
        await this.connectAllSpeakers();
      }
      this._initialConnectDone = true;
    } catch (err) {
      this.log.warn('Failed initial setup on connect', err);
    }
  } else {
    await this.refreshTopology().catch((err) =>
      this.log.warn('Failed to refresh topology on reconnect', err));
    await this.reconnectSpeakers();
    for (const handle of this._players.values()) {
      try { await handle.volume.subscribe(); } catch { /* best effort */ }
    }
  }
  this.emit('connected');
}
```

### connect() coordination

The `'connected'` event fires synchronously inside `SonosConnection.onOpen`, right before the connect promise resolves. To ensure `await household.connect()` doesn't return before initial setup finishes, `connect()` awaits a setup-complete signal:

```typescript
async connect(): Promise<void> {
  this._initialConnectDone = false;

  let resolveSetup: () => void;
  let rejectSetup: (err: unknown) => void;
  const initialSetupPromise = new Promise<void>((res, rej) => {
    resolveSetup = res;
    rejectSetup = rej;
  });

  this.connection.on('connected', async () => {
    try {
      await this.handleReconnected();
      if (this._initialConnectDone) resolveSetup!();
    } catch (err) {
      rejectSetup!(err);
    }
  });
  this.connection.on('disconnected', (r) => this.emit('disconnected', r));
  this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
  this.connection.on('error', (e) => this.emit('error', e));
  this.connection.on('message', (msg) => this.handleMessage(msg));

  await this.connection.connect();
  await initialSetupPromise;
}
```

Notes:

- `await this.connection.connect()` still rejects on initial failure —
  callers with a `try/catch` see it exactly as before.
- The reconnect loop from Section 2 keeps trying in the background. When
  it eventually succeeds, `handleReconnected` runs the initial setup and
  `'connected'` fires on the household. Callers who kept their event
  listeners attached (which persist through the rejected `await`) see
  the household come online.
- If the first attempt succeeds but the initial setup itself throws (e.g.
  `discoverHouseholdId` fails), `resolveSetup` is not called; the
  `connect()` promise doesn't resolve. In that case the reconnect loop
  can retry setup on the next `'connected'` event.

---

## 4. Per-speaker resilience

In `SonosHousehold.connectToSpeaker()`, store the `SonosConnection`
instance in the map BEFORE awaiting `connect()`. If the connect fails,
the instance's own reconnect loop (started by Section 2) keeps trying.

### Change

Replace the current sequence — `const conn = new SonosConnection(...); await conn.connect(); this.speakerConnections.set(player.id, conn);` — with:

```typescript
const conn = existing ?? new SonosConnection({
  host: url.hostname,
  port: parseInt(url.port) || 1443,
  reconnect: this.reconnectOptions,
  requestTimeout: this.requestTimeoutMs,
  logger: this.log,
});

// Store BEFORE awaiting connect so a failure still leaves the
// reconnect loop running in the background.
this.speakerConnections.set(player.id, conn);

try {
  await conn.connect();
  this.log.info(`Connected to ${player.name} at ${url.hostname}`);
} catch (err) {
  this.log.warn(`Initial connect to ${player.name} failed; reconnect loop will retry`, err);
  // Do not rethrow — connection is in the map with reconnect scheduled.
}

return conn;
```

### Effect on commands

`PlayerHandle`'s speaker context reads `_speakerConnection` dynamically.
Commands to a not-yet-connected speaker hit `SonosConnection.send()`
which — thanks to the prior connection-resilience work — waits for the
reconnection to complete instead of throwing immediately.

---

## 5. Neurotto Sonos.ts error handling and notification

In Neurotto's `src/classes/utility/Sonos.ts`, replace the current
minimal error listener and configure a finite `maxAttempts` so
exhaustion actually triggers.

### Constructor call

```typescript
this.household = new SonosHousehold({
  host: '192.168.68.96',
  logger: this.log,
  reconnect: { maxAttempts: 20 },
});
```

With default `initialDelay: 1000`, `factor: 2`, and `maxDelay: 30000`,
20 attempts spans roughly 9–10 minutes before exhaustion.

### Error listener

The current error listener is commented out in `Sonos.ts:47` (which is
why the uncaught exception happened in the first place — nothing was
listening on the household `'error'` event). Uncomment it and expand:

```typescript
this.household.on('error', (e) => {
  this.log.error('--- ERROR ---', e.message);
  if (e.code === 'RECONNECT_EXHAUSTED') {
    this.handlers.dispatcher.notify({
      title: 'Sonos WS Error',
      message: `Reconnect exhausted: ${e.message}. Sonos may be offline.`,
      category: 'neurotto',
    });
  }
});
```

### handlers access

`this.handlers` is already available — the `Sonos` class has a
`handlers: Handlers` field (`Sonos.ts:31`) initialized via
`Handlers.getInstance()` in `init()` (`Sonos.ts:40`). No new
plumbing needed.

---

## Files changed

| File | Change |
|---|---|
| `src/client/SonosConnection.ts` | Add safety-net error listener; schedule reconnect after initial `onError`. |
| `src/household/SonosHousehold.ts` | Add safety-net error listener; refactor `handleReconnected()` and `connect()` for first-connect-after-fail; make `connectToSpeaker()` store the connection before awaiting connect. |
| `tests/client/SonosConnection.test.ts` | Tests for safety-net listener + initial-connect reconnect scheduling. |
| `tests/household/SonosHousehold.test.ts` | Tests for handleReconnected initial-setup path + connectToSpeaker resilience. |
| `neurotto/src/classes/utility/Sonos.ts` | Configure finite `maxAttempts`; add exhaustion notification handler. |

## Not in scope

- Changing the semantics of `connect()` to never reject (would break existing callers).
- Retrying in-flight commands after reconnection (existing send-during-reconnect wait covers new commands).
- Auto-restart or self-healing at the Neurotto application level beyond
  the notification — the notification is the visible signal; user
  restarts the container.
