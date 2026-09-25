# Lessons

Agent-facing. Patterns that caused a wrong statement or a wasted hour, written so the next session doesn't repeat them.

## 2026-09-12 — Asserting a mechanism from an inference that doesn't support it

Three statements this session were wrong, all the same shape: a real observation, then a confident causal claim the observation didn't license.

| Claimed | Actually | What the observation really proved |
|---|---|---|
| "Production doesn't include Tyler's uncommitted `API.ts` work" | It had been live since 09-09 | A zero rsync delta proves two trees *match*, not what either contains |
| "Sonos init failure propagates and is fatal" | `Sonos.ts:98-101` swallows it, no rethrow | An error logged at init says nothing about whether it was rethrown |
| "The API server never bound :4200" | It bound twice; the third crash beat the third bind | A red healthcheck proves the end state, not the causal step |

**The tell:** in all three I had evidence for a *state* and narrated a *mechanism*. The fix is mechanical — when about to claim why something happened, name the command that distinguishes it from the nearest alternative, and run that. `grep` the deployed file rather than diffing trees; `grep -n throw` the function rather than reading a log line; check the bind log rather than the healthcheck.

**How they were caught:** all three by someone else checking, or by a later grep I nearly didn't run. None by re-reading my own reasoning. Re-reading does not catch this class — only a distinguishing command does.

## 2026-09-12 — The retraction is when you write the next stale claim

Observed in the Neurotto session and worth stealing: it introduced a wrong statement *in the very commit that retracted the previous wrong statement*, while its attention was supposedly on exactly that failure mode. Its words: "retracting a claim is when I'm most likely to write the replacement carelessly, because the retraction feels like the work."

**How to apply:** a correction is not done when the wrong text is gone. Hold the replacement to the same bar as an original claim — verify it with a command before committing it. Budget the scrutiny for the *new* sentence, not the deletion.

## 2026-09-12 — A guard test nobody has watched fail is decoration

`tests/household/SonosHousehold.test.ts` pins the backoff defaults a downstream consumer computes a wall-clock window from. It passed the moment it was written, which proves nothing. Mutating `maxDelay` 30000 → 20000 and watching it fail (window collapsing 45.0 → 30.2 min) is what established it was load-bearing.

Same principle caught a real hole in the same session: the `ws` mock's `_emit` silently dropped `'error'` events with no listeners, so three tests written to catch an unlistened-emitter crash would all have passed *against the live bug*. Giving the mock Node's real throw-on-unhandled-`'error'` semantics is what made them mean anything.

**How to apply:** for any test asserting an invariant rather than driving a feature, break the thing deliberately and watch it go red before trusting it. If a mock stands between the test and the mechanism, verify the mock reproduces the mechanism first.

## 2026-09-12 — Guards can be one-directional; say which way

The backoff-contract test fails loudly if *we* change a default, and fails not at all if the *consumer* changes its cap — the consumer's 94 is a literal input on our side, so their move leaves the test green and asserting about a number nobody uses. Silent staleness reads as verified truth, which is worse than a red test.

**How to apply:** when a test guards a cross-repo coupling, state at the point of use which direction it protects and which it doesn't, and point at the other repo's source of truth rather than restating its value — a restated value is a third copy waiting to drift.

## 2026-09-18 — After a correct diagnosis, pick the narrowest remedy it implies

Deploying to Neurotto, `bun update sonos-ws` reported success and installed the *old* commit. I diagnosed it correctly with `bun update --verbose`: Bun fetched the tarball of the sha already in the lockfile and never re-resolved the branch. Then I chose the remedy with the widest blast radius — delete the lock entry and let Bun re-resolve — and `bun install` failed to resolve the package and regenerated the entire lockfile, upgrading dozens of unrelated packages in another session's workspace. The narrow remedy was sitting in the diagnosis: if Bun fetches by the locked sha, change the locked sha. That one-line edit worked first time. The snapshot I had taken beforehand is the only reason the detour was cheap.

The diagnosis was not the failure. The step after it was: "make the tool re-resolve" asks a tool to decide scope for you, and it is entitled to decide the scope is everything.

**How to apply:** once you know *why* something no-ops, list the remedies and prefer the one that changes only the thing you diagnosed; reject any that hands scope back to the tool ("re-resolve", "regenerate", `--force`) unless the narrow one has failed. Before touching state another session owns — a lockfile, a `node_modules`, a config — snapshot it and name the exact command that restores it. The working deploy recipe lives in memory: `feedback_deploy_sonos_ws_to_neurotto`.

## 2026-09-25 — A guard that only prints is not a guard

Republishing a vault note, I checked whether the destination still matched my own last reflow before force-overwriting it. The scratchpad holding the comparison baseline had been wiped between sessions, so the check could not run — and it printed `VAULT DIFFERS — stop and ask` while the very next line in the same script force-published anyway. The message was an `echo`, not a `guard`. I overwrote a user-facing note with no idea whether it held hand edits.

Two compounding causes: the verification depended on state in a scratch directory that does not survive a session, and the "stop" was a string rather than control flow.

**How to apply:** when a script checks something before a destructive step, make the failure branch *exit* — `cmp -s a b || { echo …; exit 1; }` — never a bare echo followed by the step. And never let a safety check depend on a file in the session scratchpad: if a verification matters enough to write, its inputs and its tooling belong somewhere durable (`~/.local/bin/vault-reflow` now carries the vault reflow step and documents why the next publish always reports a conflict).
