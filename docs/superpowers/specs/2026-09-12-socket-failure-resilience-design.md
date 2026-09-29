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
- Neurotto's crash-loop hold behavior, and whether it should self-heal.
  Consumer-side, and Tyler's call.
## Consumer follow-up (settled 2026-09-12)

Neurotto had capped recovery with `reconnect: { maxAttempts: 20 }`
(`Sonos.ts:112`), which against this library's backoff is roughly 8 minutes
— 1+2+4+8+16s then 15×30s — after which the library gives up *by
instruction* and a human has to run `sonos reconnect`. That cap, not a
library limit, was why Sonos stayed dead after exhaustion.

Raising it was the whole fix for background self-healing: no new machinery
on either side. Neurotto moved to `maxAttempts: 94` — a 45.0 minute ladder
(`31s + 89×30s = 2701s`) — deliberately finite, because `Infinity` would
self-heal forever but never emit `RECONNECT_EXHAUSTED` and would silently
trade away their "Sonos may be offline" notification.

Sequencing mattered: raising the cap *before* the close-before-open fix
would have built a longer ladder that still froze silently, since a wedged
ladder never reaches exhaustion at all.

**This gives us a consumer that computes a wall-clock window from three of
our defaults.** `DEFAULT_RECONNECT` is module-private, so no test of theirs
can assert against it, and changing `initialDelay`, `factor` or `maxDelay`
would silently resize their window with nothing failing anywhere. Pinned
here instead, in `tests/household/SonosHousehold.test.ts` ("default backoff
shape is a published contract") — asserted through the options handed to
`SonosConnection`, with the third test recomputing the derived window so it
catches a change in shape rather than a change in a literal.
Mutation-verified. Those values remain changeable; the test is the reminder
to tell consumers when you do.

Neurotto declined a bounded escape from the inert crash-hold: the guard
only fires after three crashes in 60s, so three genuine attempts have
already happened, and a fourth is just a slower crash loop. Staying inert
preserves `crash.log`, and the CRASH-HOLD push notification is confirmed
working end to end, so the state is alarmed rather than silent.

## Addendum 2026-09-18 — handshake timeout (`7822ad9`, dist `2e098aa`)

Neurotto reported three symptoms six days after the above shipped. Six days
of rotated detail logs (09/13–09/18) were analyzed programmatically.

### 3. A handshake that never ends (fixed)

On 09/15 at 20:52:03 a reconnect attempt to the Arc logged `Connecting to
wss://192.168.68.96:1443` and then produced nothing: zero socket lines of
any level for 73 minutes, no open, no error, no close, no next attempt.
Every command in that window threw `Not connected` (13 user-visible volume
failures) until a manual `sonos reconnect` at 22:09. A successful primary
reconnect always logs `Topology refreshed` within a second, so this was a
hung handshake, not a silent success.

`connect()` had no deadline. Under Bun a handshake can emit no event at all,
and `ws`'s own `handshakeTimeout` option cannot be relied on because Bun
ignores `ws` options. So the promise never settled, the ladder awaiting it
stalled, and `send()` — which only waits when `_state === 'reconnecting'` —
threw immediately in `'connecting'`.

Fix: a library-level handshake timer, `connectTimeout` default 10s. On expiry
it runs the existing `onError` path (abandon, reject, schedule next attempt)
and *then* terminates. Cleared on open, error, and close-before-open; guarded
by socket identity. Five tests; the close-clear, the identity guard and the
abandon-then-terminate order were each proven by a mutant that fails exactly
one test. Independently verified under real Bun 1.3.14 and Node 22 against a
server that accepts TCP and never answers the handshake.

That evening the Arc was flapping for ~30 minutes before the hang: repeated
`1013 Timeout` closes at ~117–120s and ping timeouts. That instability is
upstream of the library; the library's failure was only in not recovering
when it ended.

### Stale topology after a regroup (fixed — see the evening addendum below)

On 09/18 at 05:46:52, after Neurotto's morning preset regrouped the house,
`refreshTopology()` adopted a mid-transition `getGroups` snapshot: 3 players,
**1 group**. Arc and Office were in no group, so their handles kept the
groupId of the group they had just left. The player map is not truncated —
players are only deleted when absent from `players` — but `groups` is
adopted verbatim. Nothing corrected it for 38 minutes, because the household
never subscribes to `groups:1`: topology is re-read only on a primary
reconnect, a `groupCoordinatorChanged` reply, or a grouping call. It was
finally corrected by an unrelated user-initiated `ungroup`.

Source of the transitional read: `GroupingEngine.transferAudio` step 5
issues a final `modifyGroupMembers` and does not wait for it to settle.

Two candidate fixes were put to the user, because the first changes
Neurotto's event traffic (the user chose the subscription): subscribe to `groups:1` and refresh on change
(also catches regroups made from the Sonos app), or poll after each
mutation until every known player is in a group (quieter, misses external
changes).

### Ignored setVolume (resolved 2026-09-25 — external Spotify controller)

09/18 06:24:08–13: five consecutive `playerVolume:1.setVolume` calls on the
Arc resolved successfully and changed nothing — no `playerVolume` event, and
each next pre-read unchanged at 16 (four downs and one up, so not a floor or
clamp). Every set resolved rather than rejected: a `success:false` response
throws `CommandError` before Neurotto's follow-up read, and that read was
sent every time. The library sent the right command on the right socket.

It is the only genuine episode in six days (an apparent 09/12 one was a set
to the already-current value). It followed `togglePlayPause` by 5–10s, and
it is the only toggle in six days sent while the Arc's handle held a dead
groupId from the stale-topology window above. Neither condition alone
reproduces it: a set at 06:25:04 applied while topology was still stale,
and the user confirms toggle-then-volume normally works. Sets were working
again by 06:25:04 without intervention.

**RESOLVED 2026-09-25 — an external Spotify Connect controller, not this
library.** On 2026-09-25 06:46 the Arc jumped 4 → 100 in one step with no
command from Neurotto, while the House of Auto session was watching from the
Home Assistant side. It traced to the Spotify TV app on the Google TV
Streamer taking over the Arc's existing Spotify Connect session and asserting
its own volume. HDMI/CEC was ruled out with evidence: the Streamer's CEC log
shows only One Touch Play and System Audio Mode Request, no `Set Audio Volume
Level`, and its own CEC volume control is off.

The 09-18 episode has the same shape and the same setup — a Streamer wake
with the Arc on Spotify Connect, moving to the TV input 16s later. So the sets
were not ignored at all: they applied, and a second controller immediately set
the volume back. The earlier working hypothesis on this page (a group-scoped
command with a dead groupId) is superseded and was wrong.

Nothing to fix in this library: the API has no way to reject or even observe a
second controller, and `playerVolume` events carry state with no origin. Two
optional instruments would make a recurrence self-evident in one log rather
than needing Home Assistant cross-referencing: log the event body (value,
muted, fixed) instead of only namespace and type, and subscribe to
`homeTheater:1` / `playback:1` to catch the input switch.

### Reviewer findings deferred to a planned follow-up (first three fixed — see the evening addendum below)

Surfaced by the review of the handshake timeout; all pre-date it and none
block it. Each is a "promise never settles" or "two ladders" bug of the
kind this spec exists to eliminate, so they belong together in one planned
change rather than bolted onto this one.

- **`disconnect()` during a handshake never settles the caller.** It nulls
  `connectReject` without calling it and only closes sockets already OPEN,
  so a CONNECTING socket keeps handshaking with no listeners and can open as
  an orphan. Fix: reject the pending caller and `terminate()` when
  CONNECTING.
- **Two reconnect ladders can run at once.** An external `connect()` while
  `'reconnecting'` that then fails lets `onError` schedule a second ladder;
  `scheduleReconnect` overwrites `reconnectTimer` without clearing it. The
  reviewer reproduced `RECONNECT_EXHAUSTED` emitted twice. Reachable from
  `SonosHousehold.connectToSpeaker` on setup retry. Fix: clear the reconnect
  timer when a fresh attempt starts, and defensively in `scheduleReconnect`.
- **`onError` acts on `this.ws`, not its own socket**, and a close-before-open
  leaves `onOpen`/`onError` attached to the dead socket. A late `'error'` on
  it during the next attempt would abandon the *new* socket. Fix: have each
  attempt's handlers act only on their own socket.
- **`connectTimeout` accepts values that fail every handshake** (0,
  `Infinity`, `NaN`, negatives, > 2^31−1 all clamp to ~1ms). Unreachable
  today — `ConnectionOptions` is not exported and nothing forwards the
  option — so validate it when it becomes public.
- **`send()` throws immediately in `'connecting'`** rather than waiting as it
  does in `'reconnecting'`. *Resolved in
  `2026-09-25-routing-and-subscription-upkeep-design.md`:* every ladder
  attempt passes through `'connecting'`, so this was a bug, not a UX choice;
  `send()` now waits for the in-flight attempt, bounded by `connectTimeout`.

## Addendum 2026-09-18 (evening) — lifecycle and topology freshness

Plan: `docs/superpowers/plans/2026-09-18-lifecycle-and-topology-freshness.md`,
executed subagent-driven with a task review per task and a whole-branch
review. Merged to main at `24ceaaa` (dist), deployed to Neurotto 2026-09-18
19:37. 81 tests.

- **`disconnect()` mid-handshake** (`1eb4458`, test `596fb5e`): rejects the
  pending `connect()` with `CONNECTION_LOST 'Client disconnected'`, and
  abandons then terminates a socket that is not yet OPEN.
- **One reconnect ladder** (`54095a4`): `scheduleReconnect()` clears any
  pending timer first. The spec's other suggestion — clearing when a fresh
  attempt starts — was unnecessary: a successful external attempt makes the
  surviving timer hit `connect()`'s `connected` short-circuit.
- **Per-attempt handlers** (`c38af08`, test `025da35`): every handler in an
  attempt acts on its own captured `socket`; the `'close'` listener strips
  the attempt (`cleanup()`, `abandonSocket`) before `handleClose`. The
  plan's original regression test did not guard this once handlers were
  socket-scoped; the review caught it and the test now asserts that a
  stale socket cannot change `_state` or schedule a second reconnect.
- **Topology follows `groups:1`** (`c69cebe`): the household subscribes
  after first connect and every reconnect, and re-reads topology once a
  burst of `groups:1` events has been quiet for 250 ms. A side effect: the
  household now emits `groupsChanged` (it was routed before but never
  subscribed). Neurotto does not listen for it.
- **Setup aborts on a disconnect mid-setup** (`0580638`): found by the
  whole-branch review, and a defect in the plan — the best-effort subscribe
  swallowed the `Client disconnected` rejection, so setup went on to open
  per-speaker connections on a torn-down household and `connect()`
  resolved. `handleReconnected()` now throws `CONNECTION_LOST 'Disconnected
  during setup'` before `connectAllSpeakers()` / `reconnectSpeakers()` if
  the primary is no longer connected. In the reconnect branch that throw is
  absorbed without its own log line; the triggering drop is already logged
  by the connection, and the next successful reconnect re-runs setup.
- **Unhandled rejection of `initialSetupPromise`** (`bb3fdee`,
  pre-existing): if the first connect failed, the caller stopped awaiting
  setup, and a later setup failure after the background ladder succeeded
  became an unhandled rejection — a host-process crash. A no-op `.catch`
  keeps it handled while the awaiting caller still receives it.

Live verification at deploy: `groups:1.subscribe` sent and answered at
boot, no `Failed to subscribe to group changes`, three sockets up. The
regroup path itself is verified at the next regroup: expect `Event:
groups:1…` lines and one `Topology refreshed` ~250 ms after the last.

Still open (follow-ups): `connectTimeout` validation. The reconnect-branch
setup abort log line, the interleaving `handleReconnected()` runs, and
`send()` in `'connecting'` are resolved by
`2026-09-25-routing-and-subscription-upkeep-design.md`. The
subscribe-then-read ordering gap is closed in practice: Sonos sends a
`groups` event on subscribe (seen at the 19:37 deploy), which triggers the
debounced re-read.

## Addendum 2026-09-29 — slow reconnect tail

Approved by the owner 2026-09-28 07:58 (the behavior) and 2026-09-29 12:43
(this design, including the speaker handling). Agreed with the Neurotto
session, whose side is `neurotto/docs/superpowers/specs/2026-09-28-sonos-slow-retry-design.md`
(`7acf186`); HOA accepted the speaker handling 09-29 09:06.

### Why

09-28: the Arc hung from 03:56 to about 06:30. Neurotto's `maxAttempts: 94`
exhausted the ladder, alerted "Sonos may be offline", and then nothing
retried until a manual `sonos reconnect`. The owner's ruling: after the
alert, keep retrying every few minutes and recover by itself, "as long as the
logs don't get too spammed from it". A finite `maxAttempts` cannot do both:
it is the only thing that produces the alert, and it is what stops the
retrying.

### Behavior

`ReconnectOptions` gains two optional fields:

- `slowAfter?: number` — attempts on the exponential ladder before the slow
  phase starts.
- `slowDelay?: number` — the delay in ms before every attempt after that.

Attempt `n` (1-based) waits `min(initialDelay * factor^(n-1), maxDelay)`
for `n <= slowAfter`, and `slowDelay` for `n > slowAfter`. The exhaustion
check is unchanged and runs first: a finite `maxAttempts` still exhausts
(after the slow phase if it is larger than `slowAfter`, before it if not).
With `maxAttempts: Infinity` the ladder never exhausts. The attempt counter
already resets on a successful open, so the next outage starts fast again.

**Both unset means today's ladder exactly** — same delays, same attempt
count, same exhaustion, same log levels on the primary. A test pins this so
the new library can deploy ahead of Neurotto's policy change without
changing what production does.

Neurotto will pass `{ maxAttempts: Infinity, slowAfter: 94, slowDelay:
300_000 }`.

### The signal: `RECONNECT_SLOWED`

When `scheduleReconnect()` schedules attempt `slowAfter + 1`, the connection
emits `'error'` with `new ConnectionError(ErrorCode.RECONNECT_SLOWED,
'Reconnect slowed after <slowAfter> attempts; retrying every <slowDelay>ms')`
— an `Error`, like `RECONNECT_EXHAUSTED`. It fires once per outage by
construction: the counter only rises within an outage and resets only on
open, so it crosses `slowAfter` exactly once. An external `connect()` that
fails mid-ladder also goes through `scheduleReconnect()` and advances the
counter, so it cannot re-fire the signal either. The household forwards the
primary's, as it forwards every primary `'error'`. `'reconnecting'(attempt,
delay)` still fires on every attempt, slow ones included.

**Emits happen after the next timer is armed.** Today `'reconnecting'` is
emitted before the timer is set, so a listener that calls `disconnect()`
from it clears nothing, and the timer armed afterwards calls `connect()`,
which resets `intentionalClose` — the ladder survives the disconnect. A new
`'error'` at the same spot makes that likelier (an error is what a consumer
reacts to). `scheduleReconnect()` now arms the timer, then logs and emits;
if a listener cleared the timer (`disconnect()`), it stops emitting.

### Logging

- Fast phase: unchanged (`Connecting to …`, `Reconnecting in …` at info).
- The switch: one info line, the `RECONNECT_SLOWED` message.
- Slow phase: `Connecting to …` and `Reconnecting in …` drop to debug.
  `connect()` knows it is in the slow phase from `reconnectAttempt >
  slowAfter` (the ladder increments before its timer calls `connect()`).
- Per-attempt `CONNECTION_FAILED` `'error'` events are still emitted;
  Neurotto quiets its own per-attempt line (its side of the design).

### Speaker sockets

Every speaker connection gets the household's reconnect options, so under
Neurotto's policy the speakers get the slow tail too. That is wanted: today
a speaker whose ladder exhausts (Neurotto's 94) is revived only by the
primary reconnecting (`reconnectSpeakers()`), so an Office unplugged for an
hour stays dead until the Arc drops or Neurotto restarts. With the slow tail
it heals itself within `slowDelay` of coming back.

But nothing listens to a speaker socket's `'error'` except the connection's
safety net, so today every failed speaker attempt logs `Unhandled connection
error` at ERROR — ~94 lines per outage under a cap of 94, and every 5 min
forever under the new policy. **The household now owns each speaker
socket's `'error'` listener:**

- `CONNECTION_FAILED`: warn on the first failure since that socket was last
  connected, naming the speaker and host; debug after that. The socket's
  `'connected'` resets it.
- `RECONNECT_SLOWED`, `RECONNECT_EXHAUSTED`: warn (once each per outage by
  construction).
- Anything else: warn.
- **Never forwarded to the household's `'error'`**, so a speaker can never
  raise Neurotto's alert; only the primary (the Arc) does. A test pins this.

`connectToSpeaker`'s `Initial connect … failed` line drops to debug when the
rejection is `CONNECTION_FAILED`, which the listener already warned for; any
other rejection (a close before open emits no `'error'`) still warns there.
`reconnectSpeakers`' `Failed to reconnect speaker` line drops to debug: a
failed kick of an exhausted speaker re-exhausts at once, and the listener
warns `RECONNECT_EXHAUSTED`. A dead speaker then writes two warn lines per
outage (first failure, the switch) instead of ~94 errors.

⚠ **This applies with `slowAfter` unset too** — speakers log less than
today whatever the policy. It changes what production says, never what it
does; the ladder pin covers the doing. The commit message and the deploy
note call it out, so the missing ERROR lines are not read as a regression.

### Timing: 45 minutes of waits, ~61 minutes of outage

Neurotto's 94 attempts sum to 45.0 min of waits (1+2+4+8+16 s, then 89 ×
30 s). That is the whole story only when each attempt fails fast (a refused
connection). When the speaker hangs mid-handshake, as the Arc did on 09-28,
each attempt also spends `connectTimeout` (10 s) before it fails: 94 × 10 s
adds 15.7 min, so the switch comes about 61 min into the outage. 09-28
fits: the stall began 03:56 and the ladder exhausted 05:00:25. Neurotto's
alert states the measured duration from its own outage record rather than
a literal.

### Validation

`SonosConnection`'s constructor validates the reconnect options once, which
covers the household's primary, every speaker socket and `SonosClient`
(both construct their connection in their constructor, so a bad option
throws from `new SonosHousehold(…)` / `new SonosClient(…)`). `RangeError`
when only one of the pair is set, when `slowAfter` is not a positive
integer, or when `slowDelay` is not a number above 0 and at most 2147483647 ms (Node runs a longer timer after 1 ms). Nothing else
is validated here (`connectTimeout` validation stays a separate follow-up).

### Tests

Each guard is mutation-verified (break the line, watch exactly its test
fail, restore).

1. Unset pin: over a finite ladder, the `'reconnecting'` (attempt, delay)
   sequence, the single `RECONNECT_EXHAUSTED` and the info-level log lines
   equal today's; no `RECONNECT_SLOWED`.
2. The switch: delays follow the ladder through `slowAfter`, then equal
   `slowDelay`; with `maxAttempts: Infinity` nothing exhausts.
3. `RECONNECT_SLOWED` exactly once per outage, as a `ConnectionError` with
   that code, when attempt `slowAfter + 1` is scheduled — including when an
   external `connect()` fails in the slow phase.
4. Reset on success: a later outage starts at `initialDelay` and signals
   again. (The reset line has no test today.)
5. Finite cap above `slowAfter`: slows, then exhausts once.
6. Log levels: info in the fast phase, one info line at the switch, debug
   for `Connecting to` / `Reconnecting in` in the slow phase.
7. `disconnect()` from a `RECONNECT_SLOWED` listener, and from a
   `'reconnecting'` listener, stops the ladder: no socket after the delay.
8. Validation: each rejected shape throws `RangeError`; the valid pair and
   both-unset construct.
9. Household: the primary's `RECONNECT_SLOWED` reaches household `'error'`;
   a speaker's does not. Speaker logging: first failure warn, later debug,
   reset after `'connected'`; slowed/exhausted warn; no `Unhandled
   connection error`.
10. Speaker self-heal: a speaker socket built with the household's options
    keeps retrying past where a cap of `slowAfter` would have exhausted,
    reconnects when the speaker answers, and re-sends its subscriptions —
    without the primary reconnecting.
11. The published-contract test (`SonosHousehold.test.ts`): defaults still
    1000 / 2 / 30000 / Infinity, `slowAfter` and `slowDelay` unset; the
    ~45-minute window is now derived for `slowAfter: 94` (Neurotto's
    value); the comment gains the ~61-minute note and still points at
    Neurotto's `RECONNECT_POLICY` as the source of truth.

### Out of scope

- Closing a speaker's socket when it leaves the topology. Nothing reopens a
  socket for a returning speaker outside a primary reconnect, so closing
  would turn "retries every 5 min" into "dead until the Arc drops".
- Kicking slow-phase speakers when the primary returns:
  `reconnectSpeakers()` only reconnects speakers in `'disconnected'`, so
  after a long whole-house outage a speaker can lag the primary by up to
  `slowDelay`.
- The `connect()` settle-once contract (ruled out 09-28).

### Shipping

The library commit lands first; the new fields change nothing until a
consumer sets them. Neurotto bumps the pin in the same change that moves
`RECONNECT_POLICY` and switches its alert to `RECONNECT_SLOWED`, so the two
ship together. HOA and the Neurotto session get the sha, a diff summary and
the test evidence before anything deploys.
