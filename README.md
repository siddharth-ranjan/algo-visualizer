# Algorithm Visualizer

Paste a Java solution, give it an input, and step through the actual execution:
the source line that is running, the call stack, the array being mutated, and
the call tree — all driven off one real trace.

Nothing is simulated. The code is compiled and run under a debugger, and the UI
replays what the JVM actually did.

## Quick start

```bash
./dev.sh          # backend on :8137, UI on :5173
```

Open <http://localhost:5173>. It loads the quickselect sample; press **Run**.

## How it works

```
source ──▶ driver synthesis ──▶ javac -g ──▶ JDI tracer ──▶ events.jsonl ──▶ replay ──▶ views
```

1. **Driver synthesis** (`backend/av/driver.py`). LeetCode-style classes have no
   `main`, so we locate the public method, render the JSON input as Java
   literals, and generate an `AvMain` that calls it.
2. **Tracing** (`backend/av/java/AvTracer.java`). A JDI debugger launches the
   program and single-steps it. `MethodEntry` / `MethodExit` requests give calls
   and return values; a `StepRequest` filtered to user classes gives line steps.
   Each event carries the variables visible in the frame.
3. **Replay** (`frontend/src/lib/replay.ts`). The linear event stream is folded
   into one immutable snapshot per step, so scrubbing is O(1). The call tree is
   accrued during that same fold, so at any step only the calls that have
   actually happened exist.

Every view reads the same step cursor, which is why they stay in sync.

## The trace format

One JSON object per event. Values are tagged `{t, v}`, and heap objects carry a
`ref` so the same array keeps one identity across frames:

```json
{"ev":"call","seq":9,"fid":3,"parent":2,"depth":1,"cls":"Solution",
 "m":"findKthLargest","line":6,
 "args":{"nums":{"t":"int[]","ref":56,"n":6,"v":[{"t":"int","v":3}]},
         "k":{"t":"int","v":2}}}
{"ev":"line","seq":10,"fid":3,"line":7,"vars":{"target":{"t":"int","v":4}}}
{"ev":"return","seq":162,"fid":3,"line":31,"value":{"t":"int","v":5}}
```

`line` events carry only the variables that **changed**, which keeps traces
small without losing anything on replay.

The format is deliberately language-agnostic. Adding C++ means writing a tracer
that emits these events (gdb's Python API single-steps the same way); no
frontend changes are needed.

## Things worth knowing

- **`new Random()` is seeded.** An unseeded RNG makes a run unreproducible, so
  the backend rewrites `new Random()` to `new Random(42L)` before tracing. The
  rewrite is line-preserving, so event line numbers still address the source you
  are reading. The UI says when this happened. Pass `"seed": false` to opt out.
- **Pointers are inferred.** Any integer local that is a valid index into the
  displayed array is drawn as a pointer under that cell. That is why `lt`, `i`,
  `gt` and friends appear without configuration. Names colliding across frames
  are qualified (`swap.i` vs `findKthLargest.i`).
- **The call tree grows as you step.** It is not drawn up front with the future
  greyed out: `layoutTree(roots, seq)` lays out only the calls made so far, and
  an unrevealed child prunes its whole subtree because a child's `callSeq`
  always exceeds its parent's. So the layout costs only what is on screen, never
  reserves space for calls that have not happened, and reflows as the tree
  widens. The view follows the newest call.
- **Traces are bounded** by an event budget (default 20k) and a wall clock
  (15s). Hitting either truncates the trace and the UI says so, rather than
  hanging. `fib(30)` will truncate; that is expected.
- **Single-stepping is slow** — roughly a millisecond per step. This is built for
  small illustrative inputs, not for profiling.

## Limits

- Java only.
- Input types: primitives, `String`, `List<T>`, and arrays of any dimension.
- The traced program runs as a normal local subprocess with a 256 MB heap. It is
  **not** sandboxed — do not expose this to untrusted input without putting the
  run step in a container.

## Layout

```
backend/
  av/driver.py           entry-point detection, JSON → Java literals, seeding
  av/runner.py           compile + trace orchestration, limits, error cleanup
  av/main.py             /api/run, /api/inspect, /api/health
  av/java/AvTracer.java  the JDI tracer
  tests/
frontend/
  src/lib/replay.ts      events → snapshots + incremental call tree, layout
  src/lib/narrate.ts     one-line English explanation of each step
  src/components/        CodePane, ArrayView, CallStack, CallTree, Player
```

## Tests

```bash
backend/.venv/bin/python -m pytest backend/tests -q   # needs a JDK
cd frontend && npx tsc -b
```

## License

MIT — see [LICENSE](LICENSE).
