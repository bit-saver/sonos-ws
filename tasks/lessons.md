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

## 2026-09-18 — A recipe step that silently no-ops gets diagnosed, not out-muscled

Deploying to Neurotto, `bun update sonos-ws` reported success and installed the *old* commit. I escalated straight to a more forceful workaround — deleting the lock entry to force re-resolution — and `bun install` then failed to resolve the package and regenerated the entire lockfile, upgrading dozens of unrelated packages in another session's workspace. The snapshot I had taken first is the only reason it was cheap to undo.

`bun update --verbose` would have shown the cause in one command: it fetched the tarball of the *locked* sha and never re-resolved the branch. The fix was a one-line lock edit, found only after the damage.

**How to apply:** when a step that worked last time now reports success and changes nothing, the next action is `--verbose` (or the tool's equivalent), not a bigger hammer. And before touching state another session owns — a lockfile, a `node_modules`, a config — snapshot it and name the exact command that restores it, so the fallback exists before it is needed. The working deploy recipe lives in memory: `feedback_deploy_sonos_ws_to_neurotto`.
