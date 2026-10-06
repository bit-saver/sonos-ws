# Speaker Adoption and Subscription Upkeep — Design

**Date:** 2026-10-06
**Status:** Approach approved by the owner 2026-10-04 ("1. Yes."); the warning item and go-ahead for the whole change
2026-10-06 07:18 CDT ("yes, go ahead").

## Why

Three known follow-ups in `SonosHousehold` (CLAUDE.md, Known-open follow-ups) and one log-noise item:

1. **A speaker that joins the household mid-session never gets diagnostic subscriptions.** `subscribeDiagnostics()`
   runs once, in first-connect setup; a handle `refreshTopology()` creates later never gets its group-volume, playback
   and home-theater intents. Its own socket also waits for the next primary reconnect, where `reconnectSpeakers()`
   opens it.
2. **`connect()` while the socket is down re-runs first-connect setup, which re-declares diagnostics** and so undoes an
   earlier `unsubscribe()` of them.
3. **`autoConnect: false` does not survive a primary reconnect.** `reconnectSpeakers()`'s second loop opens a socket to
   every player not in `speakerConnections`, which under `autoConnect: false` is every player.
4. **`Failed to restore event subscriptions for <player>` reaches the owner's running log on every regroup.** 47 times
   since 10-01 in Neurotto's detail logs, always mid-regroup. A re-send triggered by an in-between topology read goes
   to a group whose coordinator is moving; Sonos answers `groupCoordinatorChanged`, `settleAll` rejects with an
   `AggregateError`, and `resubscribeAll()` warns. The next membership change, at the settled topology, re-sends and
   succeeds: 10-06 06:22:02, round one failed for Arc and Bedroom, round two (the final `| Arc | Office | Bedroom |`
   read) was answered for every subscription with no warning, and Arc group-volume events kept arriving (06:22:49,
   07:02:36).

Neurotto never calls `unsubscribe()` and never sets `autoConnect: false`; items 1-3 are library correctness, and item
1 is the only one that could reach the house (a new speaker joining while Neurotto runs). Item 4 is the one the owner
sees.

## What already exists

- `SonosHousehold.refreshTopology()` (src/household/SonosHousehold.ts:230): creates a handle for a new player (:245-250)
  and re-sends subscriptions on a membership change (:262-269).
- `subscribeDiagnostics()` (:310): declares group-volume, playback and home-theater intents for every handle, not
  awaited, failures warned; called once, from first-connect setup (:613).
- `resubscribeAll()` (:330): re-sends every handle's intents; warns per handle on failure (:333-334).
- `connectToSpeaker(player)` (:405): reuses the primary for the primary speaker, reuses an existing socket, else
  creates one; stores it and points the handle at it before awaiting `connect()`; never rethrows a connect failure.
- `connectAllSpeakers()` (:386) and `reconnectSpeakers()` (:551, second loop :564-577).
- `handleReconnected()` (:588): first-connect branch gated on `_initialConnectDone` (:77, set :614, cleared by
  `connect()` :181); reconnect branch (:619).
- `disconnect()` (:186): closes and clears `speakerConnections`, then the primary.
- The debug-or-warn idiom: `this.log[reported ? 'debug' : 'warn'](...)` (:443). A Sonos error code compared as a
  string literal on a `CommandError` (GroupingEngine.ts:407).

## New names and files

- `private readonly diagnosed = new WeakSet<PlayerHandle>()` in `SonosHousehold`: the record of handles whose
  diagnostics were declared. Nothing existing records it; `BaseNamespace`'s per-namespace `subscribed` flag says what
  is wanted now, which is exactly what an `unsubscribe()` clears and a re-declare must not override.
- `private adopt(handle, player)` in `SonosHousehold`: the adoption step `refreshTopology()` calls for a handle created
  after setup. A method rather than inline code because it holds the two not-awaited steps and their logging.
- No new file, type or public name.

## Design

All in `src/household/SonosHousehold.ts`.

- **Diagnostics declared once per handle.** `subscribeDiagnostics(handles)` takes the handles to declare and skips any
  in `diagnosed`, adding each it declares. First-connect setup passes every handle; a re-run of it (`connect()` after
  `disconnect()`) then skips the handles that outlived the disconnect, so an `unsubscribe()` stays. A speaker that
  leaves and returns gets a fresh handle from `refreshTopology()`, so fresh diagnostics.
- **A speaker discovered after setup is adopted at once.** When `refreshTopology()` creates a handle and setup is done
  (`_initialConnectDone`), it calls `adopt(handle, player)`: `connectToSpeaker(player)` when `autoConnect` is on (it
  stores the socket and points the handle at it synchronously, then connects; a speaker that returns reuses its old
  socket), and `subscribeDiagnostics([handle])`. Not awaited; failures are logged, as setup does. During first-connect
  setup the flag is still false, so setup's own `connectAllSpeakers()` and `subscribeDiagnostics()` cover every handle.
- **`disconnect()` clears `_initialConnectDone` first**, before its first await, so a topology read that lands during
  or after a `disconnect()` adopts nothing — no socket opened after `speakerConnections` is cleared. `connect()` on a
  down socket already clears it, so the next setup is first-connect setup, as today.
- **`reconnectSpeakers()` loses its second loop** ("connect newly discovered players"). Adoption reaches every new
  speaker, at discovery rather than at the next primary reconnect, and honors `autoConnect`; the loop was a second path
  to the same outcome and the `autoConnect: false` bug. Its first loop (reconnect dropped speaker sockets) stays.
- **A re-send Sonos refuses only because the coordinator is moving logs at debug.** In `resubscribeAll()`, when every
  error in the `AggregateError` is a `CommandError` with code `groupCoordinatorChanged`, log at debug, else warn. The
  membership change that ends the move re-sends.

## Behavior

- A speaker added to the household while connected: its socket opens (with `autoConnect`) and its diagnostics are
  declared as soon as a topology read sees it, not at the next primary reconnect.
- `unsubscribe()` of a diagnostic, then `disconnect()` and `connect()`: it stays unsubscribed.
- `autoConnect: false`: no speaker sockets, ever, including after a primary reconnect.
- A regroup: the in-between re-send failures log at debug; any other re-send failure still warns.
- Neurotto's `'connected'` contract and every existing call are unchanged.

## Not doing

- Closing the socket of a speaker that leaves the topology (needs a reopen-on-return path; CLAUDE.md follow-up).
- `unsubscribe()` on a group-level namespace stopping that group's events for every handle (separate follow-up).
- Diagnostics' own subscribe failures (`Failed to subscribe <player> to <name> events`) keep warning: they run at setup
  and adoption, not mid-move, and nothing re-sends them sooner.

## Testing

TDD in `tests/household/`, mutation-verifying each guard:

- `unsubscribe()` of a diagnostic, then `disconnect()` + `connect()`: no new subscribe for it.
- A player in a later topology read gets its own socket and its three diagnostic subscribes; under
  `autoConnect: false`, its diagnostics but no socket.
- A primary reconnect under `autoConnect: false` opens no speaker sockets.
- A topology read that lands after `disconnect()` began opens no socket (the leak check in
  `SonosHousehold.disconnect-during-setup.test.ts` is the model).
- A resubscribe rejected only with `groupCoordinatorChanged` logs at debug; one with any other error warns.
- `SonosHousehold.multi.test.ts`'s "re-sends a new speaker's player-level subscriptions only on its own socket once
  that connects" relies on the removed loop to open Kitchen's socket; it is rewritten to discover Kitchen through a
  topology read after setup.

## Ship

`npm run build` + `chore: rebuild dist`, merge, House of Auto and Neurotto told, deploy per memory
`feedback_deploy_sonos_ws_to_neurotto` (one restart). Live: after the deploy, the next regroup logs no
`Failed to restore event subscriptions` warn.
