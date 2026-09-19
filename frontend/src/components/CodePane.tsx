import { type Snapshot } from "../lib/replay";

interface Props {
  source: string;
  snap: Snapshot | null;
  hits: Map<number, number>;
  activeClass: string;
  userClasses: string[];
}

/** Read-only source view with the executing line pinned and a hit-count gutter. */
export function CodePane({ source, snap, hits, activeClass, userClasses }: Props) {
  const lines = source.split("\n");
  const inUserCode = !snap || userClasses.includes(activeClass);
  const current = inUserCode ? snap?.line ?? -1 : -1;
  const maxHits = Math.max(1, ...hits.values());

  return (
    <div className="code-pane">
      <div className="pane-head">
        <span>Source</span>
        {snap && !inUserCode && <span className="muted">executing in {activeClass}</span>}
      </div>
      <div className="code-scroll">
        {lines.map((text, i) => {
          const n = i + 1;
          const hit = hits.get(n) ?? 0;
          const active = n === current;
          return (
            <div
              key={n}
              className={`code-line${active ? " active" : ""}`}
              ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            >
              <span className="heat" style={{ opacity: hit ? 0.15 + 0.85 * (hit / maxHits) : 0 }} />
              <span className="lineno">{n}</span>
              <span className="hits">{hit || ""}</span>
              <code>{text || " "}</code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
