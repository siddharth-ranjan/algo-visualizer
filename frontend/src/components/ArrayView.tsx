import { type FrameState, type Snapshot } from "../lib/replay";
import { type JVal, arrayCells, isArray } from "../lib/trace";

interface Props {
  snap: Snapshot | null;
}

interface Pointer {
  label: string;
  index: number;
}

/**
 * Renders the array being mutated, with every in-range integer local drawn as
 * a pointer beneath the cell it addresses. That heuristic is what makes a
 * partition loop legible without the user configuring anything.
 */
export function ArrayView({ snap }: Props) {
  if (!snap) return <Empty />;

  const refs = Object.keys(snap.arrays).map(Number);
  if (refs.length === 0) return <Empty />;

  // Prefer the array with the most cells — the one the algorithm works on.
  const ref = refs.reduce((best, r) =>
    (snap.arrays[r].n ?? 0) > (snap.arrays[best].n ?? 0) ? r : best,
  refs[0]);

  const val = snap.arrays[ref];
  const cells = arrayCells(val);
  const changed = new Set(snap.changed[ref] ?? []);
  const pointers = collectPointers(snap.stack, cells.length);

  return (
    <div className="array-view">
      <div className="pane-head">
        <span>Array</span>
        <span className="muted">{val.t} · {cells.length} elements</span>
      </div>
      <div className="cells-wrap">
        <div className="cells">
          {cells.map((c, i) => {
            const marks = pointers.filter((p) => p.index === i);
            return (
              <div key={i} className="cell-col">
                <div className={`cell${changed.has(i) ? " changed" : ""}${marks.length ? " pointed" : ""}`}>
                  {String(c)}
                </div>
                <div className="idx">{i}</div>
                <div className="marks">
                  {marks.map((m) => (
                    <span key={m.label} className="mark">{m.label}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Integer locals that address a valid slot become pointers; inner frames win. */
function collectPointers(stack: FrameState[], len: number): Pointer[] {
  const seen = new Map<string, Pointer>();
  const counts = new Map<string, number>();

  for (const f of stack) {
    for (const name of Object.keys(f.vars)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  for (const f of stack) {
    for (const [name, val] of Object.entries(f.vars)) {
      if (!isIndexLike(val)) continue;
      const idx = Number(val.v);
      if (!Number.isInteger(idx) || idx < 0 || idx >= len) continue;
      const label = (counts.get(name) ?? 0) > 1 ? `${f.m}.${name}` : name;
      seen.set(label, { label, index: idx });
    }
  }
  return [...seen.values()];
}

const isIndexLike = (v: JVal) =>
  !isArray(v) && (v.t === "int" || v.t === "long" || v.t === "short");

const Empty = () => (
  <div className="array-view">
    <div className="pane-head"><span>Array</span></div>
    <div className="empty">No array in scope at this step.</div>
  </div>
);
