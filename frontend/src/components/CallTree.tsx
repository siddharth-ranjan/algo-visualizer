import { useEffect, useMemo, useRef } from "react";
import { type TreeNode, layoutTree, statusAt } from "../lib/replay";
import { scalarText } from "../lib/trace";

interface Props {
  roots: TreeNode[];
  seq: number;
  newestFid: number | null;
  onPick: (callSeq: number) => void;
}

const COL = 132;
const ROW = 74;
const PAD = 20;

/**
 * The call tree as it stands at the current step.
 *
 * Only calls that have already happened are laid out, so the tree grows as you
 * step rather than sitting there fully drawn. For recursive code this is the
 * recursion tree unfolding; for iterative code with helpers it flattens into a
 * call timeline, which is the honest picture rather than a fabricated hierarchy.
 */
export function CallTree({ roots, seq, newestFid, onPick }: Props) {
  const { pos, nodes, cols, rows } = useMemo(() => layoutTree(roots, seq), [roots, seq]);
  const followRef = useRef<SVGGElement>(null);

  // Keep the call that just happened on screen as the tree grows past the viewport.
  useEffect(() => {
    if (newestFid === null) return;
    followRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [newestFid]);

  if (nodes.length === 0) {
    return (
      <div className="tree-pane">
        <div className="pane-head"><span>Call tree</span></div>
        <div className="empty">The tree builds as you step.</div>
      </div>
    );
  }

  const width = cols * COL + PAD * 2;
  const height = rows * ROW + PAD * 2;
  const cx = (n: TreeNode) => pos.get(n.fid)!.x * COL + COL / 2 + PAD;
  const cy = (n: TreeNode) => pos.get(n.fid)!.y * ROW + PAD + 14;

  return (
    <div className="tree-pane">
      <div className="pane-head">
        <span>Call tree</span>
        <span className="muted">
          {nodes.length} call{nodes.length === 1 ? "" : "s"} so far · click to jump
        </span>
      </div>
      <div className="tree-scroll">
        <svg width={width} height={height}>
          {nodes.flatMap((n) =>
            n.children
              .filter((c) => pos.has(c.fid))
              .map((c) => (
                <path
                  key={`${n.fid}-${c.fid}`}
                  className={`edge ${statusAt(c, seq)}`}
                  d={`M${cx(n)},${cy(n) + 16} C${cx(n)},${cy(n) + 44} ${cx(c)},${cy(c) - 44} ${cx(c)},${cy(c) - 16}`}
                />
              )),
          )}
          {nodes.map((n) => {
            const st = statusAt(n, seq);
            const args = Object.entries(n.args)
              .map(([k, v]) => `${k}=${scalarText(v)}`)
              .join(", ");
            return (
              <g
                key={n.fid}
                ref={n.fid === newestFid ? followRef : undefined}
                className={`node ${st}${n.fid === newestFid ? " newest" : ""}`}
                transform={`translate(${cx(n)},${cy(n)})`}
                onClick={() => onPick(n.callSeq)}
              >
                <rect x={-58} y={-17} width={116} height={34} rx={8} />
                <text y={-2} className="node-label">{n.m}</text>
                <text y={11} className="node-args">
                  {truncate(st === "done" && n.ret ? `→ ${scalarText(n.ret)}` : args, 20)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
