/** Shapes emitted by the JDI tracer. Values are always tagged {t, v}. */

export interface JVal {
  t: string;
  v: unknown;
  ref?: number;
  n?: number;
  truncated?: boolean;
}

export type Vars = Record<string, JVal>;

export interface CallEvent {
  ev: "call"; seq: number; fid: number; parent: number | null;
  depth: number; cls: string; m: string; sig: string; line: number; args: Vars;
}
export interface LineEvent {
  ev: "line"; seq: number; fid: number; depth: number; line: number; vars: Vars;
}
export interface ReturnEvent {
  ev: "return"; seq: number; fid: number; depth: number; line: number; value: JVal | null;
}
export type TraceEvent = CallEvent | LineEvent | ReturnEvent;

export interface RunResponse {
  ok: boolean;
  stage?: string;
  error?: string;
  entry?: string;
  events: TraceEvent[];
  stdout: string;
  source: string;
  user_classes: string[];
  seeded: boolean;
  summary: { stopReason?: string; calls?: number; maxDepth?: number; events?: number };
}

export const isArray = (val: JVal | undefined): boolean =>
  !!val && val.t.endsWith("[]") && Array.isArray(val.v);

/** Unwraps a tagged array into plain values, one level deep. */
export function arrayCells(val: JVal): (number | string | boolean | null)[] {
  if (!Array.isArray(val.v)) return [];
  return (val.v as JVal[]).map((c) => (c && typeof c === "object" ? (c.v as never) : (c as never)));
}

export function scalarText(val: JVal | null | undefined): string {
  if (!val) return "—";
  if (val.t === "null") return "null";
  if (isArray(val)) return `[${arrayCells(val).join(", ")}]`;
  if (val.v === null && val.ref !== undefined) return `${short(val.t)}@${val.ref}`;
  if (val.t === "String") return JSON.stringify(val.v);
  if (val.t === "char") return `'${val.v}'`;
  return String(val.v);
}

export const short = (fqn: string) => fqn.slice(fqn.lastIndexOf(".") + 1);
