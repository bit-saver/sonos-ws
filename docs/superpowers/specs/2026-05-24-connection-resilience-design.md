# Connection Resilience Design

## Problem

Sonos speakers close idle WebSocket connections (close code 1000). After
connections drop, the library does not recover — all subsequent commands
fail permanently with `ConnectionError: Not connected`.

Three root causes:

1. **No keepalive** — nothing prevents idle-timeout disconnections.
2. **Per-speaker connections orphaned on reconnect** —
   `SonosHousehold.handleReconnected()` only handles the primary
   connection; per-speaker connections stay dead.
3. **`send()` throws immediately during reconnection** — commands that
   arrive while the connection is re-establishing fail instead of waiting.

## Approach

Layered fixes in the existing `SonosConnection` and `SonosHousehold`
classes. No new abstractions.

---

## 1. Keepalive (SonosConnection)

Send WebSocket pings at a regular interval and monitor pong replies. If a
pong is not received within a deadline, force-close the socket to trigger
reconnection.

### Configuration

Add optional fields to `ReconnectOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `pingInterval` | `number` | `30000` | Ms between pings. `0` disables. |
| `pongTimeout` | `number` | `10000` | Ms to wait for a pong before declaring connection dead. |

### Lifecycle

- `startPing()` — called at the end of `onOpen`, after state is
  `'connected'`. Starts a `setInterval` that sends `ws.ping()` every
  `pingInterval` ms. After each ping, starts a one-shot `setTimeout` of
  `pongTimeout` ms.
- `stopPing()` — called in `disconnect()` and at the top of
  `handleClose()`. Clears the interval and the pong deadline timer.
- Pong received (`ws.on('pong')`) — clears the pong deadline timer.
- Pong timeout — logs a warning, calls `ws.terminate()` (hard close).
  `terminate()` fires the `close` event, which triggers `handleClose()`
  and the existing reconnect logic.

### Why `terminate()` not `close()`

If the connection is truly dead (no pongs), a graceful `close()` handshake
will also hang. `terminate()` immediately destroys the socket and fires the
close event.

---

## 2. Send-during-reconnect (SonosConnection)

When `send()` is called while the connection is in the `'reconnecting'`
state, wait for reconnection instead of throwing immediately.

### Mechanism

- `send()` gains an early check: if `_state === 'reconnecting'`, call a
  private `waitForReconnect()` before proceeding.
- `waitForReconnect()` returns a promise that:
  - **Resolves** when the `'connected'` event fires.
  - **Rejects** with `ConnectionError` (code `CONNECTION_LOST`) if the
    `'disconnected'` event fires first (e.g. reconnect exhausted).
  - **Rejects** with `ConnectionError` after `requestTimeout` ms if
    neither event fires.
- If `_state` is `'disconnected'` (not trying to reconnect), `send()`
  still throws immediately — no point waiting.
- In-flight commands at disconnect time are NOT retried. The existing
  `correlator.rejectAll()` in `handleClose()` still fails them
  immediately. Only NEW commands arriving during reconnection wait.

### Concurrency

Multiple commands arriving during reconnection each call
`waitForReconnect()` independently. They all listen for the same
`'connected'` event. When it fires, all proceed in parallel. No queue
structure is needed.

### Cleanup

`waitForReconnect()` registers listeners for `'connected'` and
`'disconnected'`. These must be removed after the promise settles
(whether it resolves, rejects, or times out) to avoid listener leaks.

---

## 3. Speaker reconnection on primary reconnect (SonosHousehold)

When the primary connection reconnects, ensure all per-speaker connections
are alive.

### Mechanism

In `handleReconnected()`, after `refreshTopology()` succeeds:

1. Iterate `speakerConnections`. For each entry:
   - If `state === 'disconnected'`, call `connect()` on it.
   - If `state === 'reconnecting'`, leave it alone (already trying).
   - If `state === 'connected'`, skip.
2. For any player discovered by `refreshTopology()` that has no entry in
   `speakerConnections`, create a new connection via `connectToSpeaker()`.
3. After reconnecting, re-run `setSpeakerConnection()` and
   `setCoordinatorConnectionResolver()` for all player handles. This
   handles topology changes during the outage (new coordinator, new
   players).

Run speaker reconnects in parallel via `Promise.allSettled`. Wrap each in
try/catch so one failing speaker does not block the others.

### Relationship to per-speaker auto-reconnect

Per-speaker `SonosConnection` instances already have their own
`scheduleReconnect()`. The household-level check is a safety net. If a
speaker connection reconnected on its own, its state is `'connected'` and
we skip it.

---

## Files changed

| File | Changes |
|---|---|
| `src/client/SonosConnection.ts` | Add ping/pong timers, `startPing()`, `stopPing()`, pong handler, `waitForReconnect()`, update `send()` |
| `src/client/SonosConnection.ts` | Add `pingInterval` and `pongTimeout` to `ReconnectOptions` with defaults |
| `src/household/SonosHousehold.ts` | Update `handleReconnected()` to reconnect dead speaker connections and re-wire player handles |
| `tests/household/SonosHousehold.test.ts` | Test speaker reconnection on primary reconnect |
| `tests/client/SonosConnection.test.ts` | New file: test keepalive ping/pong and send-during-reconnect |

## Not in scope

- Retrying in-flight commands after reconnection.
- Extracting a separate health monitor class.
- Changes to Neurotto (the library should handle this transparently).
