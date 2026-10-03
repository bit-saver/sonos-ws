# Shared Connection Setup — Design

**Date:** 2026-10-03
**Status:** Direction approved by the owner (08:19, "begin all recommended tasks", relayed by HOA): option 1, one
small class in `src/client/` plus the reconnect-defaults move. This spec awaits his review; the build waits on the plan.

## Why

`SonosClient` and `SonosHousehold` each carry the same connect/setup ownership block, about 100 lines. A fix to one
must be mirrored by hand in the other, and has not always been: `bee04d5` gave only the household its disconnect
counter. The owner's standing rule is one path per objective.

## What already exists

Both classes own one `SonosConnection` and run their own setup on every socket it brings up. The shared block:

| Piece | SonosClient | SonosHousehold |
|---|---|---|
| setup queue + `enqueue` | `setupChain` :61, `enqueue` :148 | `setupChain` :93, `enqueueSetup` :227 |
| handshakes a `connect()` awaits | `ownedHandshakes` :63 | `ownedHandshakes` :95 |
| socket epochs | `connectedEpoch` :65, `setupEpoch` :67 | `primaryEpoch` :97, `setupEpoch` :99 |
| "set up on this socket" | `setUpOnCurrentSocket` :70 | `setUpOnCurrentSocket` :104 |
| `connect()` | :131 | :202 |
| `'connected'` listener | `onConnected` :155 | `onPrimaryConnected` :218 |
| post-setup tail | in `setUp` :164-181 | end of `handleReconnected` (:633) :695-701 |
| disconnect counter | — | `disconnects` :101, checked :695 |

What differs, and stays in each class: the setup work itself (`locatePlayer()`; `handleReconnected()`'s first-connect
and reconnect branches), its failure log line, and the household's `_initialConnectDone`, which picks the branch and is
reset by `connect()` when the socket is down.

The same two files also duplicate `DEFAULT_RECONNECT` and `resolveReconnectOptions` (SonosClient.ts:34, :257;
SonosHousehold.ts:20, :706). `ReconnectOptions` itself lives in `src/client/SonosConnection.ts:36`.

Precedent for code both classes share: `src/client/discoverHouseholdId.ts` (one function, used by both).

## New names and files

- `src/client/ConnectionSetup.ts`, class `ConnectionSetup`. Neither owner can hold the block without the other
  importing from it, and they are peers by design (neither extends nor wraps the other). `SonosConnection` could hold
  it, but the block is about an owner's setup work riding on the connection, not about the socket, and putting it there
  would give the connection a callback into its owners. `discoverHouseholdId.ts` set the precedent for a shared unit
  beside them.
- No new public names: `ConnectionSetup` is not exported from `src/index.ts`.
- `DEFAULT_RECONNECT` and `resolveReconnectOptions` keep their names and move into `SonosConnection.ts` (no new file).

## Design

### `src/client/ConnectionSetup.ts`

It owns only the bookkeeping:

```ts
export class ConnectionSetup {
  constructor(
    connection: SonosConnection,
    setUp: () => Promise<void>,   // the owner's work; logs its own failure
    onSetUp: () => void,          // the owner emits 'connected'
    log: Logger,
  );
  connect(): Promise<void>;       // the owner's connect() delegates here
  noteDisconnect(): void;         // first line of the owner's disconnect()
}
```

- The constructor registers the connection's `'connected'` listener, which returns its setup run. Listener order is
  not load-bearing: nothing else in the library listens for that connection's `'connected'`, and consumers listen on
  the owner. Four test sites take `_listeners.get('connected')[0]` and await it (`SonosClient.test.ts:230`,
  `SonosHousehold.test.ts:315, :636, :682`); they change to run every `'connected'` listener and await them all, so
  no test depends on the order.
- `connect()`: return at once if set up on the current socket and connected; otherwise count the handshake as owned,
  await `connection.connect()`, uncount it, and queue a setup run.
- The listener: advance the epoch; if a `connect()` owns the handshake, do nothing; otherwise queue a setup run and
  swallow its rejection (no caller is left to see it).
- A setup run: skip if already set up on this socket; note the epoch and disconnect count; await `setUp()`; if a
  disconnect landed or the socket is down, log `Setup abandoned: disconnected during setup` at debug and throw
  `ConnectionError(CONNECTION_LOST, 'Disconnected during setup')`; else record the epoch and call `onSetUp()`.
- "Set up on the current socket" becomes `setupEpoch === connectedEpoch` alone. The extra conditions today
  (`_handle !== undefined`, `_initialConnectDone`) are implied: `setupEpoch` changes only when a run completes, and
  every handshake that `connect()` awaits from a down socket ends in `onOpen`, which emits `'connected'` and advances
  the epoch before `connect()` resolves.

### The owners

- `SonosClient`: builds `new ConnectionSetup(this.connection, <locatePlayer with its failure log>, () =>
  this.emit('connected'), this.log)`; `connect()` delegates; `disconnect()` calls `noteDisconnect()` first.
- `SonosHousehold`: the same, with `handleReconnected()` minus its tail as the work. `connect()` keeps its one
  household line, resetting `_initialConnectDone` when the socket is down, then delegates. `disconnect()` calls
  `noteDisconnect()` where it increments `disconnects` today.
- Removed from both: the queue, the counters, the epochs, the getter, the listener method, the tail.

### Reconnect defaults (add-on)

`DEFAULT_RECONNECT` and `resolveReconnectOptions` move into `src/client/SonosConnection.ts`, beside `ReconnectOptions`,
exported for the two classes but not from the barrel. Cost: the five test files that `vi.mock` that module
(`SonosClient.test.ts`, and the four household suites) must keep the real exports, by spreading
`await importOriginal()` into their factories.

## Behavior

No change intended. One deliberate, unobservable change: `SonosClient` gains the disconnect check. Its
`disconnect()` already flips the socket state synchronously, so the state check caught it before.

## Tests

The existing suites are the guard: `SonosClient.test.ts`, `SonosHousehold.connect.test.ts`,
`SonosHousehold.disconnect-during-setup.test.ts` and the setup tests in `SonosHousehold.test.ts` pin the
`'connected'` contract for both owners. They change only in comments naming moved members, the five mock
factories above, and the four listener-index sites. Each moved guard is mutation-verified through both owners (drop the owned-handshake skip, the epoch
match, the disconnect check, the queue). A mutation no existing test catches gets one focused test in a new
`tests/client/ConnectionSetup.test.ts`, and only then.

## Out of scope

The duplicated `handleMessage` routing (the household's also drives topology), the duplicated safety-net `'error'`
listener and event forwarding (a base-class question, option 2, not chosen), and known-open items 3 and 4 (diagnostics
for a mid-session speaker; first-connect setup rerun by `connect()` on a down socket), which get their own plan.
