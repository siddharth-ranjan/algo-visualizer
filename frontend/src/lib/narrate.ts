import { type Snapshot } from "./replay";
import { type TraceEvent, scalarText } from "./trace";

/**
 * A one-line, plain-English account of what a step did.
 *
 * Line steps are described by the variables that actually changed, which is
 * the part a reader cannot see by looking at the source alone.
 */
export function narrate(
  event: TraceEvent | undefined,
  snap: Snapshot | undefined,
  prev: Snapshot | undefined,
  sourceLines: string[],
): string {
  if (!event || !snap) return "Press play to walk through the run.";

  if (event.ev === "call") {
    const args = Object.entries(event.args)
      .map(([k, v]) => `${k} = ${scalarText(v)}`)
      .join(", ");
    return `Call ${event.m}(${args || "no arguments"})`;
  }

  if (event.ev === "return") {
    const who = prev?.stack.find((f) => f.fid === event.fid);
    const name = who ? who.m : "method";
    return event.value
      ? `Return ${scalarText(event.value)} from ${name}()`
      : `Return from ${name}()`;
  }

  // A line event fires on the line *about to* run, so any variable change we
  // observe was produced by the line that ran just before it. Attribute the
  // effect to that line, not to the one now highlighted.
  const deltas = describeDeltas(snap, prev);
  if (deltas && prev) {
    const ran = srcLine(sourceLines, prev.line);
    return `Ran line ${prev.line}${ran ? `: ${ran}` : ""}  —  ${deltas}`;
  }
  const text = srcLine(sourceLines, event.line);
  return text ? `At line ${event.line}: ${text}` : `At line ${event.line}`;
}

const srcLine = (lines: string[], n: number) =>
  (lines[n - 1] ?? "").trim().replace(/\s+/g, " ");

function describeDeltas(snap: Snapshot, prev: Snapshot | undefined): string {
  if (!prev) return "";
  const parts: string[] = [];

  const top = snap.stack[snap.stack.length - 1];
  const before = prev.stack.find((f) => f.fid === top?.fid);
  if (top && before) {
    for (const [k, v] of Object.entries(top.vars)) {
      const old = before.vars[k];
      if (!old) { parts.push(`${k} = ${scalarText(v)}`); continue; }
      if (JSON.stringify(old.v) !== JSON.stringify(v.v) && !v.t.endsWith("[]")) {
        parts.push(`${k}: ${scalarText(old)} → ${scalarText(v)}`);
      }
    }
  }

  for (const [ref, idxs] of Object.entries(snap.changed)) {
    const arr = snap.arrays[Number(ref)];
    const old = prev.arrays[Number(ref)];
    if (!arr || !old) continue;
    for (const i of idxs.slice(0, 4)) {
      const a = (old.v as { v: unknown }[])[i]?.v;
      const b = (arr.v as { v: unknown }[])[i]?.v;
      parts.push(`slot ${i}: ${a} → ${b}`);
    }
  }
  return parts.slice(0, 4).join(", ");
}
