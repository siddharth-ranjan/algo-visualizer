import { type JVal, type TraceEvent, type Vars, isArray } from "./trace";

export interface FrameState {
  fid: number;
  cls: string;
  m: string;
  sig: string;
  depth: number;
  line: number;
  args: Vars;
  vars: Vars;
}

export interface TreeNode {
  fid: number;
  parent: number | null;
  cls: string;
  m: string;
  sig: string;
  depth: number;
  callSeq: number;
  retSeq: number | null;
  args: Vars;
  ret: JVal | null;
  children: TreeNode[];
}

export interface Snapshot {
  seq: number;
  kind: TraceEvent["ev"];
  line: number;
  cls: string;
  fid: number;
  stack: FrameState[];
  /** Latest contents of every array seen so far, keyed by heap ref. */
  arrays: Record<number, JVal>;
  /** Indices that changed in each array on *this* step. */
  changed: Record<number, number[]>;
  returned?: JVal | null;
  /** How many calls exist by this step — the tree's growth cursor. */
  revealedCalls: number;
  /** The call made on this step, if any; the tree scrolls to follow it. */
  newestFid: number | null;
}

export interface Replay {
  snapshots: Snapshot[];
  roots: TreeNode[];
  byFid: Map<number, TreeNode>;
}

/**
 * Folds the linear event stream into one snapshot per step, growing the call
 * tree as it goes.
 *
 * The tree is accrued during this pass rather than assembled up front, so at
 * any step only the calls that have actually happened exist. Frames and the
 * array table are rebuilt by copy-on-write, so every snapshot is an
 * independent immutable view and scrubbing is O(1).
 */
export function replay(events: TraceEvent[]): Replay {
  const snapshots: Snapshot[] = [];
  const byFid = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  let stack: FrameState[] = [];
  let arrays: Record<number, JVal> = {};
  let revealedCalls = 0;

  for (const e of events) {
    let changed: Record<number, number[]> = {};
    let returned: JVal | null | undefined;
    let newestFid: number | null = null;

    if (e.ev === "call") {
      const node: TreeNode = {
        fid: e.fid, parent: e.parent, cls: e.cls, m: e.m, sig: e.sig,
        depth: e.depth, callSeq: e.seq, retSeq: null,
        args: e.args, ret: null, children: [],
      };
      byFid.set(e.fid, node);
      const parent = e.parent !== null ? byFid.get(e.parent) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
      revealedCalls += 1;
      newestFid = e.fid;

      stack = [...stack, {
        fid: e.fid, cls: e.cls, m: e.m, sig: e.sig,
        depth: e.depth, line: e.line, args: e.args, vars: { ...e.args },
      }];
      [arrays, changed] = harvest(arrays, e.args);
    } else if (e.ev === "line") {
      const i = stack.findIndex((f) => f.fid === e.fid);
      if (i >= 0) {
        const cur = stack[i];
        const next = { ...cur, line: e.line, vars: { ...cur.vars, ...e.vars } };
        stack = [...stack.slice(0, i), next, ...stack.slice(i + 1)];
      }
      [arrays, changed] = harvest(arrays, e.vars);
    } else {
      returned = e.value;
      const node = byFid.get(e.fid);
      if (node) {
        node.retSeq = e.seq;
        node.ret = e.value;
      }
      stack = stack.filter((f) => f.fid !== e.fid);
    }

    const top = stack[stack.length - 1];
    snapshots.push({
      seq: e.seq,
      kind: e.ev,
      line: e.line,
      cls: e.ev === "call" ? e.cls : top?.cls ?? "",
      fid: e.fid,
      stack,
      arrays,
      changed,
      returned,
      revealedCalls,
      newestFid,
    });
  }
  return { snapshots, roots, byFid };
}

/** Records new array contents, returning the table plus indices that moved. */
function harvest(
  arrays: Record<number, JVal>,
  vars: Vars | undefined,
): [Record<number, JVal>, Record<number, number[]>] {
  const changed: Record<number, number[]> = {};
  if (!vars) return [arrays, changed];

  let next = arrays;
  for (const val of Object.values(vars)) {
    if (!isArray(val) || val.ref === undefined) continue;
    const prev = arrays[val.ref];
    if (prev === val) continue;

    if (prev && Array.isArray(prev.v)) {
      const a = prev.v as JVal[];
      const b = val.v as JVal[];
      const diff: number[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (JSON.stringify(a[i]?.v) !== JSON.stringify(b[i]?.v)) diff.push(i);
      }
      if (diff.length === 0) continue;
      changed[val.ref] = diff;
    }
    if (next === arrays) next = { ...arrays };
    next[val.ref] = val;
  }
  return [next, changed];
}

export type NodeStatus = "active" | "done";

export function statusAt(node: TreeNode, seq: number): NodeStatus {
  return node.retSeq !== null && seq >= node.retSeq ? "done" : "active";
}

export interface Layout {
  pos: Map<number, { x: number; y: number }>;
  nodes: TreeNode[];
  cols: number;
  rows: number;
}

/**
 * Tidy layout over the calls that exist at `maxSeq`: x from an in-order leaf
 * counter, y from call depth.
 *
 * Unrevealed children prune their whole subtree — a child's callSeq always
 * exceeds its parent's — so the walk costs only what is on screen, and the
 * layout never reserves space for calls that have not happened yet.
 */
export function layoutTree(roots: TreeNode[], maxSeq: number): Layout {
  const pos = new Map<number, { x: number; y: number }>();
  const nodes: TreeNode[] = [];
  let leaf = 0;
  let rows = 0;

  const walk = (n: TreeNode): number => {
    nodes.push(n);
    rows = Math.max(rows, n.depth + 1);
    const kids = n.children.filter((c) => c.callSeq <= maxSeq);
    let x: number;
    if (kids.length === 0) {
      x = leaf++;
    } else {
      const xs = kids.map(walk);
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(n.fid, { x, y: n.depth });
    return x;
  };

  for (const r of roots) if (r.callSeq <= maxSeq) walk(r);
  return { pos, nodes, cols: leaf, rows };
}
