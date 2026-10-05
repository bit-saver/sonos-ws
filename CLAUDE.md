# sonos-ws — project guide

TypeScript client for the **Sonos local WebSocket Control API** (port 1443, `wss://<ip>:1443/websocket/api`, subprotocol `v1.api.smartspeaker.audio`). It exists because the legacy UPnP/SOAP API on port 1400 batches CEC notifications, so volume changes reached the TV's on-screen display late; this API does not.

Its one production consumer is **Neurotto** (`~/workspace/neurotto`), a home-automation controller running under **Bun** in Docker. Almost every non-obvious decision in this repo traces to Bun or to that deployment.

## Current state

- Branch `main` after merge, clean, level with `origin` (`git@github.com:bit-saver/sonos-ws.git`).
- Slow reconnect tail merged 2026-09-29: last source commit `52cac16`, `bbdafee` is its `dist` rebuild. Live in Neurotto since its container start 2026-10-01 20:12 CDT: pin `bbdafee`, policy `{ maxAttempts: Infinity, slowAfter: 94, slowDelay: 300_000 }`, alert on `RECONNECT_SLOWED` (the Neurotto session shipped it; checked 10-03 in the deployed `node_modules` and `dist`). Neurotto committed that pin and policy as `0f39e8a` (2026-10-03).
- Shared connection setup merged 2026-10-03 (spec `2026-10-03-shared-connection-setup-design.md`): `SonosClient` and `SonosHousehold` set up through one `ConnectionSetup`; reconnect defaults live once, in `SonosConnection.ts`. A refactor with no behavior change for Neurotto; it shipped with the next change.
- Transfer by moving the group merged 2026-10-05 (spec `2026-10-03-music-context-transfer-design.md`, its 2026-10-05 fourth addendum binding; the addenda before it are the history): `group(..., { transfer })` moves the source group with `setGroupMembers([target])` from its coordinator and, for a single target, returns once Sonos has added it (live 10-05: 5.5 s for `group arc` from a playing `( Office + Bedroom )`; the Arc plays at once, the removed players go idle as Sonos finishes the handoff). The 10-03 copy (`createGroup` + `musicContextGroupId`) failed in production on 10-04 06:30 for a bare Spotify Connect session and was rolled back (Neurotto `97f0bd9`); later copy-first attempts showed Sonos holding later group commands behind a copy for ~20 s. Live in Neurotto since its container start 2026-10-05 12:37 CDT (Neurotto commit `fa52e4d`, pin `2958e6e`).
- 201 tests (`npx vitest run`), `npx tsc --noEmit` clean.

## Layout

| Path | Holds |
|---|---|
| `src/client/` | `SonosConnection` (one WebSocket per speaker: lifecycle, reconnect, keepalive, send), `MessageCorrelator` (cmdId → pending promise), `discoverHouseholdId` (shared household-ID lookup used by both `SonosClient` and `SonosHousehold`), `ConnectionSetup` (runs an owner's setup once per socket: the handshake a `connect()` awaits, or the ladder's; shared by `SonosClient` and `SonosHousehold`), `SonosClient` (single-speaker facade) |
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
- Neurotto finishes its own setup on the household's `'connected'` event, so its behavior is a contract: it fires once per successful setup, before `connect()` resolves on a first attempt that succeeds, and never after a `disconnect()` that lands mid-setup. Covered in `tests/household/SonosHousehold.connect.test.ts` and `tests/client/SonosClient.test.ts`.
- `RECONNECT_SLOWED` fires once per outage: the attempt counter only rises within an outage and resets only on open, and the signal fires as it crosses `slowAfter`. `scheduleReconnect()` arms the next timer before it logs or emits, so a listener's `disconnect()` cancels it. With `slowAfter`/`slowDelay` unset the ladder is exactly the pre-09-29 one (pinned).
- The household's `'error'` is its primary's. Speaker sockets' errors are the household's to log (a warn on the first failure and at each phase change, debug otherwise), never to emit — Neurotto alerts on `RECONNECT_SLOWED`, and a speaker must not trigger it.

## Testing

`vitest`, no config file (defaults). The `ws` mock in `tests/client/SonosConnection.test.ts` deliberately **mirrors Node's throw-on-unlistened-`'error'`** — without that, tests for unlistened-emitter bugs pass against the live bug. Do not weaken it.

**Mutation-verify any test that guards an invariant**: break the guarded line, confirm exactly that test fails, restore. Two guards in this repo were found to be decoration that way, and one test was found to pass against the very bug it was written for.

## dist/ is committed on purpose

`.gitignore` has no `dist` entry. Neurotto installs straight from the GitHub URL, which brings no devDependencies, so `prepare` cannot build — the checked-in `dist/` is the shipped artifact. **Any `src/` change needs `npm run build` and a `chore: rebuild dist …` commit**, or consumers silently get stale code.

## Deploying to Neurotto

Standing carve-out: a sonos-ws dependency bump in Neurotto is ours to make and deploy. **Follow the recipe in memory `feedback_deploy_sonos_ws_to_neurotto` exactly** — it is narrow on purpose (sync `node_modules` only; never `dist/` or `tsconfig.json`, which carry Neurotto's own in-flight work).

Since 2026-09-12 Neurotto pins sonos-ws by full sha **in `package.json`** (its CLAUDE.md makes that the version record): bump that line, `bun install`, check that only the two sonos-ws lines of `bun.lock` changed, then commit **only** `package.json` in Neurotto and push it if it is the only commit ahead. Updating the lock alone desynced the pin twice (09-18, 09-25). `bun.lock` is gitignored there, so the pin in `package.json` is the only record that travels.

## Known-open follow-ups

Documented in `docs/superpowers/specs/2026-09-25-routing-and-subscription-upkeep-design.md`'s Out of scope and Design sections, plus three found during review: `connectTimeout` validation (not reachable until the option is exposed); `unsubscribe()` on a group-level namespace stops that group's events for every handle until the next re-send; `autoConnect: false` cannot route group commands; a speaker added to the household mid-session never gets diagnostic subscriptions (they are declared only at first connect); and `connect()` while the socket is down reruns first-connect setup, which re-declares diagnostics and undoes an `unsubscribe()` of them. The slow reconnect tail (`slowAfter`/`slowDelay`, `RECONNECT_SLOWED`) is built per the 09-29 addendum to the resilience spec; two follow-ups from it: after a long whole-house outage `reconnectSpeakers()` kicks only `'disconnected'` speakers, so a slow-phase speaker can lag the primary by up to `slowDelay`; and a speaker that leaves the topology keeps its socket retrying (closing it needs a reopen-on-return path the household lacks). Grouping (memory `project_group_transfer_slow`): **owed next — a second single-player transfer within ~3 s of a move can silence the target**: the players a move removes briefly report PLAYING, so `resolveAudioSourceExcluding` takes one as a source and moves its empty group onto the target (live 10-05 12:17). Fix shape: players a transfer just removed are not sources for a few seconds; then live-check a double `group arc`. Also: the multi-target poll can time out before Sonos's coordinator handoff (~7 s for the Arc), after which `simpleGroup` may extract the target (explicit multi-player transfers only; Neurotto sends none); a target still BUFFERING is not covered by the paused-audio guard; Sonos sometimes answers `setGroupMembers` only after the handoff (5.4 s live). The `Failed to restore event subscriptions` warnings (~2 per move) are re-sends on mid-move topologies; the settled re-send succeeds. Reconnect follow-ups 3 and 4 (above) have an owner-approved design (2026-10-04): diagnostics declared once per handle (a WeakSet), a speaker discovered after setup adopted at once (socket if `autoConnect`, diagnostics), and `reconnectSpeakers()`'s new-player loop dropped (it also ignores `autoConnect: false`). `autoConnect: false` does not survive a primary reconnect: `handleReconnected()` calls `reconnectSpeakers()` without checking it, so the first reconnect opens a socket to every speaker (found by reading the code, untested; Neurotto uses the default). Also: `disconnect()` does not reset the attempt counter, so a reused instance whose `connect()` fails after a slow-phase `disconnect()` resumes in the slow phase with no new `RECONNECT_SLOWED` and logs `Connecting to` at debug (Neurotto builds a fresh household each time, so it is unaffected).
