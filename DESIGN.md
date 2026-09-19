# Design

## Goal

Show what an algorithm *actually did*, step by step, from a real execution —
not an animation authored to look like the algorithm.

That constraint drives everything below. The system observes a running program
and replays the observation; it never models the language's semantics itself.

## Pipeline

```
source ─▶ driver synthesis ─▶ javac -g ─▶ JDI tracer ─▶ events.jsonl ─▶ replay ─▶ views
          (driver.py)                     (AvTracer)                    (replay.ts)
```

Each stage has one job and a narrow interface to the next. The seam that matters
is `events.jsonl`: everything upstream is Java-specific, everything downstream
is not.

### 1. Driver synthesis — `backend/av/driver.py`

LeetCode-style submissions are a bare `class Solution` with no entry point, so
there is nothing to run. This stage:

- finds the class and its first `public` method (private helpers are skipped, so
  `swap` never wins over `findKthLargest`),
- renders the JSON input as Java literals (`[3,2,1]` → `new int[]{3, 2, 1}`),
- generates an `AvMain` that constructs the class and calls the method,
- seeds `new Random()` so the run reproduces.

Parameter parsing is depth-aware over `<>` so `Map<String, Integer>` survives.
Only the outermost array dimension spells out `new T[]{...}`; inner dimensions
are bare brace initialisers, because that is what Java's grammar requires.

### 2. Tracing — `backend/av/java/AvTracer.java`

A JDI debugger launches the program under its own JVM and observes it:

| Signal | Source | Gives |
| --- | --- | --- |
| `call` | `MethodEntryRequest` (class-filtered) | callee, depth, argument values |
| `return` | `MethodExitRequest` | the return value, which exists nowhere else |
| `line` | `StepRequest` STEP_LINE/STEP_INTO, package-excluded | current line + visible locals |

Frames get an invocation-unique `fid`, so two recursive calls to the same method
never collide. Depth comes from the thread's frame count, not from parsing.

Single-stepping costs roughly a millisecond per step. That is the price of
observing rather than simulating, and it is why the budgets below exist.

### 3. Trace format

One JSON object per line. Values are tagged `{t, v}`; heap objects also carry a
`ref`, which is what lets the UI know that the array in `swap` is the *same*
array as the one in `findKthLargest`.

```json
{"ev":"call","seq":9,"fid":3,"parent":2,"depth":1,"cls":"Solution",
 "m":"findKthLargest","line":6,
 "args":{"nums":{"t":"int[]","ref":56,"n":6,"v":[{"t":"int","v":3}]},
         "k":{"t":"int","v":2}}}
{"ev":"line","seq":10,"fid":3,"line":7,"vars":{"target":{"t":"int","v":4}}}
{"ev":"return","seq":162,"fid":3,"line":31,"value":{"t":"int","v":5}}
```

`line` events carry **only variables that changed**. Replay reconstructs full
state by folding, so nothing is lost and traces stay small.

### 4. Replay — `frontend/src/lib/replay.ts`

One pass folds the event stream into one immutable `Snapshot` per step, and
grows the call tree as it goes.

- Frames and the array table are rebuilt **copy-on-write**, so each snapshot is
  an independent view and scrubbing to any step is O(1).
- Tree nodes are created when their `call` event is reached, so at any step only
  calls that have actually happened exist.
- `revealedCalls` is the tree's growth cursor; `newestFid` is what the view
  follows.

### 5. Views

Every view reads the same step cursor, which is the only reason they stay in
sync.

- **CodePane** — the line about to execute, plus a hit-count heat gutter.
- **ArrayView** — the array being mutated. Any integer local that is a valid
  index is drawn as a pointer under its cell, which is why `lt`/`i`/`gt` appear
  with no configuration. Names colliding across frames are qualified.
- **CallStack** — frames innermost-first with their live variables.
- **CallTree** — `layoutTree(roots, seq)` lays out only the calls made so far.
  An unrevealed child prunes its whole subtree, because a child's `callSeq`
  always exceeds its parent's; so the layout costs what is on screen and never
  reserves space for the future.
- **Player** — the shared cursor, with keyboard transport.

Narration describes the effect of the line that *just ran*, not the highlighted
one: a `line` event fires on the line about to execute, so an observed change
was produced by its predecessor.

## Bounds

| Bound | Default | Why |
| --- | --- | --- |
| Event budget | 20 000 | `fib(30)` would otherwise trace forever |
| Wall clock | 15 s | truncate rather than hang |
| Heap | 256 MB | traced program is a separate JVM |
| Array render | 256 cells | keeps events small |

Hitting a bound truncates the trace and the UI says so.

## Security

The traced program runs as an ordinary local subprocess. It is **not**
sandboxed. This is acceptable for a local tool and is not acceptable for a
hosted one; the run step would need a container per submission.

## Extending to another language

Write a tracer that emits the same events. The frontend needs no changes. For
C++, gdb's Python API single-steps the same way: `MethodEntry`/`MethodExit`
become breakpoint plus `FinishBreakpoint`, and locals come from walking the
block chain at each stop.
