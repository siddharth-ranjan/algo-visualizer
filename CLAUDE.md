# CLAUDE.md

Working notes for Claude Code in this repository.

## What this is

A step-through visualizer for Java algorithms. Code is compiled and run under a
**real debugger** (JDI); the UI replays what the JVM actually did. Nothing about
the execution is simulated or inferred from source — if a view shows a value, a
debugger read it out of a live frame.

Keep it that way. If a feature would require guessing at semantics instead of
observing them, that is a signal the tracer should emit more, not that the
frontend should infer more.

## Commands

```bash
./dev.sh                                        # backend :8137 + UI :5173
backend/.venv/bin/python -m pytest -q           # backend tests (needs a JDK)
cd frontend && npx tsc -b                       # frontend typecheck
cd frontend && npm run build                    # production build
```

There is no frontend test runner. `tsc -b` plus a scratch Node script bundled
with `npx esbuild` is how the replay logic has been verified; see "Verifying
replay logic" below.

## Layout

```
backend/av/driver.py          entry-point detection, JSON → Java literals, RNG seeding
backend/av/runner.py          compile + trace orchestration, limits, error cleanup
backend/av/main.py            /api/run, /api/inspect, /api/health
backend/av/java/AvTracer.java the JDI tracer — runs as its own JVM process
frontend/src/lib/trace.ts     event + value types shared by every view
frontend/src/lib/replay.ts    events → snapshots + incremental call tree
frontend/src/lib/narrate.ts   one-line English explanation per step
frontend/src/components/      CodePane, ArrayView, CallStack, CallTree, Player
```

## Invariants worth not breaking

- **The trace format is language-agnostic on purpose.** `AvTracer.java` is one
  producer of it. Adding C++ (gdb's Python API single-steps the same way) should
  need no frontend change. Do not leak Java-specific assumptions into
  `replay.ts` or the components.
- **Source rewrites must be line-preserving.** Event line numbers address the
  source the user is reading. `make_deterministic` seeds `new Random()` in place
  for exactly this reason. Any future rewrite must not add or remove lines.
- **`line` events carry only changed variables.** Replay reconstructs full state
  by folding. Do not "fix" this by emitting everything.
- **Snapshots are immutable and independent.** `replay()` rebuilds frames and
  the array table copy-on-write so scrubbing is O(1). Do not mutate a snapshot.
- **The call tree grows with the step cursor.** `layoutTree(roots, seq)` lays out
  only calls already made. Do not reintroduce a full-tree layout with the future
  greyed out — an unrevealed child must prune its whole subtree.
- **Traces are bounded.** Event budget and wall clock are the reason a bad input
  truncates instead of hanging. Keep both.

## Gotchas

- Variables are only visible to JDI when compiled with `javac -g`. `runner.py`
  passes it; without it `visibleVariables()` throws `AbsentInformationException`
  and every frame renders empty.
- `MethodExitEvent.returnValue()` is the only place a return value exists. Once
  the frame pops it is gone.
- Compiler errors are rewritten to strip the temp directory so they reference
  `Solution.java`. A test asserts `/tmp` never appears in them.
- The tracer is a separate JVM launched by JDI. Its heap flags live in the
  `options` connector argument in `AvTracer.java`, not in `runner.py`.
- Traced code runs **unsandboxed** as a local subprocess. Anything that widens
  input handling needs to say so loudly.

## Verifying replay logic

The pure logic can be exercised without a browser, which is how the narration
attribution bug and the nested-array literal bug were both caught:

```bash
curl -s -X POST localhost:8137/api/run -H 'Content-Type: application/json' \
  -d '{"source":"...","inputs":[...]}' > run.json
npx esbuild check.ts --bundle --platform=node --outfile=check.cjs && node check.cjs run.json
```

Import `replay` / `layoutTree` from `frontend/src/lib/` by absolute path and
assert invariants per step. Prefer this over a browser for anything that is not
strictly visual.

## Conventions

- Comments explain *why*, not what. The existing density is the target.
- Errors surface in the user's terms ("expects 2 argument(s) (nums, k)"), never
  as raw stack traces or internal paths.
- No new runtime dependencies without a reason; the frontend deliberately has
  only React, and the tree layout is hand-written rather than pulling in d3.
