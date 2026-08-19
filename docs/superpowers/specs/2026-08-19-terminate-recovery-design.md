# Ping-Timeout Recovery Independent of `terminate()` Design

## Problem

When keepalive detects no pong within `pongTimeout`, `SonosConnection` calls `ws.terminate()` and relies on the WebSocket's `'close'` event to trigger `handleClose()` → `scheduleReconnect()`. In Bun's WebSocket runtime, `terminate()` does not reliably fire `'close'` (or fires it with significant delay), so the recovery path never runs.

Observed in production (Neurotto against 192.168.68.96):

- `warn [SonosSocket] No pong received within 10000ms — terminating connection` at 22:03, 22:07, 22:09.
- Zero visible reconnect activity afterward.
- Hours later, a flood of `ConnectionError: Not connected` (`SonosConnection.ts:237` — state='connected', ws dead) and `Reconnection did not complete within 120000ms` (`SonosConnection.ts:381` — waitForReconnect timed out).

Root cause: the pong-timeout handler assumes `terminate()` will fire `'close'`. When it doesn't, `_state` stays `'connected'` from the class's perspective while the underlying socket is dead. `send()` throws immediately for a while, then something eventually flips state to `'reconnecting'` but the reconnect never completes.

## Approach

Drive the recovery path directly from the pong-timeout handler instead of relying on the `'close'` event. Prevent double-firing if the event does eventually arrive by detaching listeners from the dead WebSocket before invoking `handleClose` ourselves.

## Change

In `src/client/SonosConnection.ts`, replace the pong-timeout body inside `startPing()`:

```typescript
this.pongDeadlineTimer = setTimeout(() => {
  this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
  this.ws?.terminate();
}, pongTimeout);
```

with:

```typescript
this.pongDeadlineTimer = setTimeout(() => {
  this.log.warn(`No pong received within ${pongTimeout}ms — terminating connection`);
  const dead = this.ws;
  if (dead) {
    // Detach BEFORE terminate so a late 'close' event has no listener and
    // cannot double-fire handleClose / scheduleReconnect.
    dead.removeAllListeners();
    dead.terminate();
    this.ws = null;
  }
  // Drive recovery directly. In some runtimes (Bun) terminate() does not
  // reliably fire 'close', which leaves _state stuck at 'connected' while
  // the socket is dead.
  this.handleClose(1006, 'ping timeout');
}, pongTimeout);
```

## Why this is safe

- `handleClose` already handles nullification of pending correlator requests, stops the ping timer (idempotent since `stopPing` is null-safe), and schedules a reconnect when `reconnect.enabled` is true. Calling it directly reuses the same code path the `'close'` event would have.
- `removeAllListeners()` on the dead ws guarantees that if `'close'` DOES eventually fire from `terminate()`, it hits no handler and does not double-schedule. This prevents the same class of bug fixed in commit `96b51c4` (double `scheduleReconnect`).
- `this.ws = null` before calling `handleClose` matches the invariant expected downstream (a "dead" state means no live ws reference).
- `1006` is the RFC 6455 close code for abnormal closure without a control frame, which is what a `terminate()` semantically represents.

## Regression test

Add a test that mocks a WebSocket where `terminate()` does NOT fire `'close'`. Assert that after `pongTimeout` expires:

1. `conn.state` transitions to `'reconnecting'` (proves `handleClose` → `scheduleReconnect` ran).
2. A new WebSocket construction is attempted after the reconnect delay (proves `scheduleReconnect` timer fired `connect()`).

## Files changed

| File | Change |
|---|---|
| `src/client/SonosConnection.ts` | Replace pong-timeout body in `startPing()`. |
| `tests/client/SonosConnection.test.ts` | Add regression test: recovery works when `terminate()` does not fire `'close'`. |

## Not in scope

- Watchdog that reconciles `_state` vs. `ws.readyState` outside of the ping path (would be broader).
- Improving `send()`'s behavior when state/ws are inconsistent (fixed at the root instead).
- Neurotto changes (the library fix is transparent to callers).
