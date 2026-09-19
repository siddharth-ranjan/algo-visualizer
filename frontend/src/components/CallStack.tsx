import { type Snapshot } from "../lib/replay";
import { scalarText } from "../lib/trace";

/** Live stack frames, innermost first, with each frame's variables. */
export function CallStack({ snap }: { snap: Snapshot | null }) {
  const frames = snap ? [...snap.stack].reverse() : [];
  return (
    <div className="stack-pane">
      <div className="pane-head">
        <span>Call stack</span>
        <span className="muted">depth {frames.length}</span>
      </div>
      <div className="stack-scroll">
        {frames.length === 0 && <div className="empty">Stack is empty.</div>}
        {frames.map((f, i) => (
          <div key={f.fid} className={`frame${i === 0 ? " top" : ""}`}>
            <div className="frame-head">
              <span className="frame-name">{f.cls}.{f.sig}</span>
              <span className="frame-line">:{f.line}</span>
            </div>
            <div className="vars">
              {Object.entries(f.vars).map(([k, v]) => (
                <div key={k} className="var">
                  <span className="var-name">{k}</span>
                  <span className="var-val">{scalarText(v)}</span>
                </div>
              ))}
              {Object.keys(f.vars).length === 0 && <span className="muted">no locals yet</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
