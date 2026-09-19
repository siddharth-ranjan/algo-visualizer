# Decisions

Why the system is built the way it is. Each entry records the alternatives that
were actually considered, so a future change can tell whether the reasoning
still holds.

---

## 1. Trace a real execution instead of simulating one

**Decision.** Compile the code and observe it under a debugger.

**Alternatives.** Interpret the source in JS; or pattern-match known algorithms
and play a canned animation.

**Why.** A simulator is a second implementation of Java's semantics, and it will
disagree with the real one exactly where a learner most needs the truth. Canned
animations cannot show *your* code. Observing costs ~1 ms/step, which is
affordable for illustrative inputs and is the only approach that cannot lie.

**Cost.** Needs a JDK; single-stepping is slow; budgets are mandatory.

---

## 2. JDI rather than bytecode instrumentation

**Decision.** Drive the program with the Java Debug Interface.

**Alternatives.** Rewrite bytecode with ASM/Javassist to inject trace calls; or
rewrite source before compiling.

**Why.** Instrumentation runs at native speed but has to *reconstruct* what the
debugger simply reports: line boundaries, which locals are in scope at each
point, and return values. It also changes the code being studied, which
undermines the whole premise. JDI ships in the JDK, needs no dependency, and
`MethodExitEvent.returnValue()` gives return values that are otherwise
unobservable.

**Cost.** ~1 ms per step, so large inputs truncate.

**Revisit if.** Traces of tens of thousands of steps become a normal workload.

---

## 3. The trace format is language-agnostic

**Decision.** Tracers emit `call` / `line` / `return` with tagged `{t, v}` values
and heap `ref`s. The frontend knows nothing about Java.

**Why.** The first plan for this project was C++ via gdb; it changed to Java
mid-flight. That happened cheaply because the seam was in the right place, and
it is the main reason adding a language later is a backend-only change.

---

## 4. Synthesise an entry point

**Decision.** Detect the public method and generate a `main` that calls it with
the user's JSON input.

**Alternatives.** Require the user to write their own `main`; or hand-configure
the invocation in the UI.

**Why.** The target input is a LeetCode-style `class Solution` with no entry
point. Requiring a `main` means editing the code you wanted to study.

**Cost.** Input types are limited to primitives, `String`, `List<T>` and arrays;
anything else is rejected before compiling, with a message naming the type.

---

## 5. Seed `new Random()`, line-preservingly

**Decision.** Rewrite `new Random()` to `new Random(42L)` before tracing, tell
the user in the UI, and allow opting out.

**Why.** The benchmark this was built against picks random pivots. Unseeded, no
two runs agree, so you cannot reason about what you just watched or share it.
The rewrite is line-preserving **because event line numbers address the source
the user is reading** — inserting a line would silently misalign every
highlight.

**Cost.** The traced run is not the production distribution of pivots. The UI
says so rather than hiding it.

---

## 6. `line` events carry only changed variables

**Decision.** Diff each frame's locals against the previous step; emit the delta.

**Why.** Full state per line is mostly repetition. The delta is also exactly
what narration needs to say what a line *did*, so the format serves both.

**Cost.** Consumers must fold to get full state — which replay does anyway.

---

## 7. Snapshots are immutable, built copy-on-write

**Decision.** Fold the event stream into one snapshot per step up front.

**Alternatives.** Re-fold from the start on every scrub; or keep one mutable
state object.

**Why.** Scrubbing must be instant and must work backwards. Mutable state cannot
go backwards without replaying anyway. Copy-on-write keeps memory proportional
to what actually changed.

---

## 8. The call tree grows with the step cursor

**Decision.** Build tree nodes during the replay fold and lay out only calls
already made: `layoutTree(roots, seq)`.

**Superseded.** The first version built the whole tree up front and greyed out
`pending` nodes.

**Why the change.** Drawing the future is a spoiler, it re-rendered every node on
every step, and it reserved space for calls that had not happened, so the tree
never appeared to grow. Pruning is free because a child's `callSeq` always
exceeds its parent's, so one comparison prunes a whole subtree.

**Cost.** The tree reflows sideways as it widens. Pinning x at reveal time would
remove the motion at the price of a less tidy layout; it is contained to
`layoutTree` if that trade ever looks better.

---

## 9. Array pointers are inferred, not configured

**Decision.** Any integer local holding a valid index into the displayed array is
drawn as a pointer under that cell.

**Alternatives.** Annotations or a UI for naming pointer variables.

**Why.** It makes a partition loop legible with zero setup — `lt`, `i`, `gt`,
`pivotIndex` all appear on their own. Configuration would be a tax on every use.

**Cost.** A heuristic: an unrelated integer that happens to be in range shows up
as a pointer. Names colliding across frames are qualified (`swap.i` vs
`findKthLargest.i`).

---

## 10. Bound every trace

**Decision.** Event budget (20 000) and wall clock (15 s); truncate and say so.

**Why.** `fib(30)` is a reasonable thing to type and an unreasonable thing to
single-step. A truncated trace that explains itself beats a hung tab.

---

## 11. Not sandboxed, and said plainly

**Decision.** Run traced code as a local subprocess with a capped heap, and
document the exposure instead of implying safety.

**Why.** Per-submission containers are the right answer for a hosted service and
overkill for a local tool. The honest move is to state the limit where someone
deploying it will see it, which the README does.

**Revisit if.** This is ever exposed beyond localhost — then the run step needs
container isolation before anything else.
