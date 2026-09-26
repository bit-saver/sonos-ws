# sonos-ws — project guide

TypeScript client for the **Sonos local WebSocket Control API** (port 1443, `wss://<ip>:1443/websocket/api`, subprotocol `v1.api.smartspeaker.audio`). It exists because the legacy UPnP/SOAP API on port 1400 batches CEC notifications, so volume changes reached the TV's on-screen display late; this API does not.

Its one production consumer is **Neurotto** (`~/workspace/neurotto`), a home-automation controller running under **Bun** in Docker. Almost every non-obvious decision in this repo traces to Bun or to that deployment.

## Current state

- Branch `main` after merge, clean, level with `origin` (`git@github.com:bit-saver/sonos-ws.git`).
- Last source commit `d6b11f9`; `6fd41a9` is its `dist` rebuild. Deployed to Neurotto 2026-09-26 10:49 CDT, pin `a688ba7`.
- 150 tests (`npx vitest run`), `npx tsc --noEmit` clean.

## Layout

| Path | Holds |
|---|---|
| `src/client/` | `SonosConnection` (one WebSocket per speaker: lifecycle, reconnect, keepalive, send), `MessageCorrelator` (cmdId → pending promise), `discoverHouseholdId` (shared household-ID lookup used by both `SonosClient` and `SonosHousehold`), `SonosClient` (single-speaker facade) |
| `src/household/` | `SonosHousehold` (the recommended API: primary connection + per-speaker connections, topology, events), `GroupingEngine` (audio-preserving regrouping), `TopologySnapshot` |
| `src/player/` | `PlayerHandle` and its controls (volume, playback, homeTheater, favorites, playlists, audioClip, settings) |
| `src/namespaces/` | One wrapper per Sonos API namespace, all extending `BaseNamespace` (which owns `subscribe`/`send` and stamps `householdId`/`groupId`/`playerId` headers) |
| `src/util/` | `settleAll` (runs every task, then rejects with one `AggregateError` of the failures), `eventSource` (`sourceOf` — tags an event with the `playerId`/`groupId` its headers name), `logger` (the pluggable `Logger` interface, `noopLogger`, `consoleLogger`), `TypedEventEmitter` (the type-safe emitter `SonosClient` and `SonosHousehold` extend) |
| `docs/superpowers/specs/` | Design specs, date-stamped, the durable record. Start with `2026-09-12-socket-failure-resilience-design.md` — it carries the whole connection-resilience arc and its 09-18 and 09-25 addenda |
| `docs/superpowers/plans/` | Implementation plans (agent-facing; not published to the vault) |
| `tasks/lessons.md` | Process lessons from past sessions — read before a wrap or a deploy |

`PlayerHandle` builds three namespace contexts: **speaker** (per-player commands, retargetable via `setSpeakerConnection`), **groups** (always the primary connection), and **coordinator** (resolved live via `setCoordinatorConnectionResolver` — carries group volume, playback, playback metadata, and loading a favorite or a playlist, since Sonos accepts all of those only on the group coordinator's socket; verified live — sending one of these through a non-coordinator's own socket gets back `groupCoordinatorChanged`).

## Bun gotchas — the source of most bugs here

Bun replaces the `ws` package with its own WebSocket and **ignores `ws` constructor options**, so every mechanism must be library-level, never a `ws` option:

- `rejectUnauthorized: false` is ignored — the container sets `NODE_TLS_REJECT_UNAUTHORIZED=0` instead.
- `handshakeTimeout` is ignored — hence `connectTimeout` (default 10s) implemented as our own timer. Without it a handshake can hang forever with no `open`, `error` or `close`; that cost a 77-minute outage on 2026-09-15.
- `terminate()` does not reliably fire `'close'` — the pong-timeout path calls `handleClose` directly rather than waiting for it.
- Bun hands `'error'` listeners a browser-style **`ErrorEvent`**, not a Node `Error`. It has `.message` but `String()` on it yields `[object ErrorEvent]`.
- An `'error'` event with no listener **throws**, which escapes as an `uncaughtException` and kills the host. Every path that abandons a socket must leave an error sink on it — that is what `abandonSocket()` is for, and there are four such paths (`onError`, the close listener, `disconnect()`, the pong timeout).

## Invariants worth not breaking

- `connect()` must always settle, exactly once. Several outages were "the promise never settled": a close before open, a handshake with no events, a `disconnect()` mid-handshake.
- At most one reconnect ladder. `scheduleReconnect()` clears any pending timer first; two ladders emit `RECONNECT_EXHAUSTED` twice, which the consumer surfaces as a duplicate notification.
- Every handler inside `connect()` acts on its own captured `socket`, never `this.ws` — by the time a late event arrives, `this.ws` may be the next attempt's socket.
- Sonos events carry **state, never origin**. Nothing in the API says who set a volume; an external Spotify or Sonos-app controller is indistinguishable from any other.
- Group-level commands and subscriptions go through the coordinator's socket; player-level ones through the player's own.
- Subscriptions are intents: `subscribe()` records one, and the household re-sends every wanted subscription after any reconnect or membership change. Re-sending is idempotent on the wire (verified live), so nothing tracks which ones died.
- Every socket's events reach listeners, tagged `{ playerId?, groupId? }`.
- `connect()` sets up the handshake it awaits; the `'connected'` listener sets up only handshakes no `connect()` awaits; setup counts as done only for the socket it ran on (epochs).

## Testing

`vitest`, no config file (defaults). The `ws` mock in `tests/client/SonosConnection.test.ts` deliberately **mirrors Node's throw-on-unlistened-`'error'`** — without that, tests for unlistened-emitter bugs pass against the live bug. Do not weaken it.

**Mutation-verify any test that guards an invariant**: break the guarded line, confirm exactly that test fails, restore. Two guards in this repo were found to be decoration that way, and one test was found to pass against the very bug it was written for.

## dist/ is committed on purpose

`.gitignore` has no `dist` entry. Neurotto installs straight from the GitHub URL, which brings no devDependencies, so `prepare` cannot build — the checked-in `dist/` is the shipped artifact. **Any `src/` change needs `npm run build` and a `chore: rebuild dist …` commit**, or consumers silently get stale code.

## Deploying to Neurotto

Standing carve-out: a sonos-ws dependency bump in Neurotto is ours to make and deploy. **Follow the recipe in memory `feedback_deploy_sonos_ws_to_neurotto` exactly** — it is narrow on purpose (sync `node_modules` only; never `dist/`, `tsconfig.json` or `package.json`, which carry Neurotto's own in-flight work).

Two traps recorded there: `bun update sonos-ws` does **not** advance a git pin once the lock entry has an integrity hash (repoint the single lock line instead), and Neurotto's `bun.lock` is **gitignored**, so the deployed version leaves no git record.

## Known-open follow-ups

Documented in `docs/superpowers/specs/2026-09-25-routing-and-subscription-upkeep-design.md`'s Out of scope and Design sections, plus three found during review: `connectTimeout` validation (not reachable until the option is exposed); `unsubscribe()` on a group-level namespace stops that group's events for every handle until the next re-send; `autoConnect: false` cannot route group commands; the `ownedHandshakes`/`setupChain`/epoch block is duplicated in `SonosClient` and `SonosHousehold` (a fix to one must be mirrored); a speaker added to the household mid-session never gets diagnostic subscriptions (they are declared only at first connect); and `connect()` while the socket is down reruns first-connect setup, which re-declares diagnostics and undoes an `unsubscribe()` of them.
