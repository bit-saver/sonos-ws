# Socket-Failure Resilience — Design

**Date:** 2026-09-12
**Commits:** `17dc065` (fix), `2942ea3` (dist)
**Status:** COMPLETE — shipped and deployed to Neurotto 2026-09-12 12:06 CDT.

## Problem

A single transiently-unreachable speaker could take the host application
down, and then leave Sonos dead until a human intervened. Both halves were
observed in production in Neurotto.

The acute failure, 2026-09-12 10:55: Office (`192.168.68.225`) failed its
initial WebSocket connect. The host died with

```
error [fatal] uncaughtException: Error: Unhandled error. (ErrorEvent { isTrusted: [Getter] })
    at native
    at emitError (node:events:60:30)
    at ws:197:19
```

three times in 11 seconds, tripping Neurotto's crash-loop guard at 3
(`CRASH LOOP DETECTED (3) — holding inert`). The controller stayed inert
until restarted by hand.

The chronic failure, 2026-09-10: a reconnect ladder logged
`Reconnecting in 2000ms (attempt 2)` at 12:00:25 and then went silent for
roughly six hours — no attempt 3, no `RECONNECT_EXHAUSTED` — while all
three speakers were reachable the whole time.

## Root causes

Two independent defects, both reachable from one flaky speaker.

### 1. Abandoned sockets were left as unlistened error emitters

Three paths detached our handlers and dropped our reference while the
socket was still alive inside `ws`:

| Path | Site |
|---|---|
| initial connect failure | `onError` inside `connect()` |
| intentional close | `disconnect()` |
| keepalive failure | pong-timeout handler in `startPing()` |

Each called `removeAllListeners()` and set `this.ws = null`. The
*persistent* `'error'` listener is attached only in `onOpen`, which never
runs on a failed connect — so the socket was left with zero `'error'`
listeners.

A dropped reference does not kill the socket. It can still emit `'error'`,
and under Bun it reliably does, with a browser-style `ErrorEvent` rather
than a Node `Error` (the same Bun/`ws` divergence behind the
`NODE_TLS_REJECT_UNAUTHORIZED` workaround and the
`terminate()`-does-not-fire-`close` fix of 2026-08-19). Node's
`EventEmitter` throws on an `'error'` event with no listener, and that
throw escapes as an `uncaughtException`.

The safety-net listener added by the 2026-07-09 fatal-error-prevention work
sits on `SonosConnection` — the wrong emitter. It caught the
connection-level `emit('error')`; the raw socket's second emit went
unhandled.

**Amplification.** That work also made an initial connect failure start a
reconnect loop rather than fail once. Each attempt builds a fresh socket
and repeats the trick, converting one latent throw into a burst. The
uncaughtException itself was not new — it also hit 08/18, 08/25 and 09/08 —
but it only became fatal to the host once it could fire three times inside
the crash-loop window.

### 2. A close-before-open left `connectPromise` set and unsettled

`connect()` guards re-entry with `if (this.connectPromise) return
this.connectPromise`. That field was cleared in exactly three places:
`onOpen`, `onError`, and `disconnect()`. `handleClose()` cleared nothing.

`resolve` and `reject` are captured only in the `onOpen`/`onError`
closures, so a socket that emits `'close'` having never emitted `'open'`
or `'error'` — a handshake aborted mid-flight — settles nothing either.
The promise is therefore left **both set and permanently unsettled**.

The reconnect timer then calls `await this.connect()`, short-circuits onto
that promise, and waits forever. No new socket is constructed, no further
attempt is scheduled, and `RECONNECT_EXHAUSTED` never fires. Recovery is
silently, permanently wedged.

This also meant the exhaustion signal was unreliable in general: any
consumer hanging recovery off `RECONNECT_EXHAUSTED` would simply never be
told, which made the library look like it had given up quietly.

## Design

Both fixes are local to `SonosConnection`. No new abstractions, no API
change, no change to the `connect()` contract.

**Error sink on abandonment.** A private `abandonSocket(ws)` replaces the
three bare `removeAllListeners()` calls. It detaches everything, then
attaches one permanent `'error'` listener that logs at debug and returns.
No failure path can leave an unlistened emitter.

It deliberately attaches no `'close'` listener, preserving the property the
2026-08-19 pong-timeout fix depends on: detaching before `terminate()` so a
late `'close'` cannot double-fire `handleClose`/`scheduleReconnect`.

**Settle the pending connect on close.** `connectReject` is held on the
instance, assigned in the promise executor and cleared wherever
`connectPromise` is. `handleClose()` now clears both and rejects the
pending caller with `CONNECTION_LOST` / "Connection closed before open".
When the close follows a normal open, `connectPromise` is already null and
the block is a no-op.

## Tests

Four regression tests in `tests/client/SonosConnection.test.ts`, each
watched failing before implementation:

- a late error after an initial connect failure
- a late error after an intentional disconnect
- a late error after a ping timeout terminates the socket
- the reconnect ladder still builds a new socket after a close-before-open

The `ws` mock's `_emit` now mirrors Node's semantics, throwing on an
`'error'` event with no listeners. Without that the mock silently dropped
the emit and could not reproduce either defect — the three error tests
passed vacuously. This is the load-bearing part of the test setup.

61 tests pass; `tsc --noEmit` clean.

## Not in scope

- Why a speaker becomes transiently unreachable. Measured over 26 days the
  underlying flakiness is flat, not worsening — ping timeouts peaked at 20
  on 09/03 and were 1 on 09/12. What changed was severity, not frequency.
- A watchdog reconciling `_state` against `ws.readyState` outside the ping
  path. Still unhandled; carried over from
  `2026-08-19-terminate-recovery-design.md:73`.
- Retrying in-flight commands after reconnection. Unchanged.
- Neurotto's crash-loop hold behaviour, and whether it should self-heal.
  Consumer-side, and Tyler's call.
- Neurotto's `reconnect: { maxAttempts: 20 }` override
  (`Sonos.ts:112`). Against the library default of `Infinity` this caps
  recovery at roughly 8 minutes — 1+2+4+8+16s then 15×30s — after which the
  library gives up by instruction and a manual `sonos reconnect` is
  required. Raising or removing the cap is the simplest route to
  background self-healing, but it trades away the exhaustion notification.
  Consumer-side decision, raised with the Neurotto session.
