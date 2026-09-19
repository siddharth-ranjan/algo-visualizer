import { useCallback, useMemo, useState } from "react";
import { ArrayView } from "./components/ArrayView";
import { CallStack } from "./components/CallStack";
import { CallTree } from "./components/CallTree";
import { CodePane } from "./components/CodePane";
import { Player } from "./components/Player";
import { narrate } from "./lib/narrate";
import { replay } from "./lib/replay";
import { type RunResponse, type TraceEvent } from "./lib/trace";
import { SAMPLE_INPUT, SAMPLE_SOURCE } from "./sample";

/** Stable identity: a fresh [] each render would invalidate the replay memo. */
const NO_EVENTS: TraceEvent[] = [];

export function App() {
  const [source, setSource] = useState(SAMPLE_SOURCE);
  const [inputText, setInputText] = useState(SAMPLE_INPUT);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);

  const events = run?.events ?? NO_EVENTS;
  const { snapshots: snaps, roots } = useMemo(() => replay(events), [events]);
  const sourceLines = useMemo(() => (run?.source ?? source).split("\n"), [run, source]);

  const hits = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of events) if (e.ev === "line") m.set(e.line, (m.get(e.line) ?? 0) + 1);
    return m;
  }, [events]);

  const snap = snaps[step] ?? null;
  const story = narrate(events[step], snaps[step], snaps[step - 1], sourceLines);

  const doRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const inputs = JSON.parse(inputText);
      if (!Array.isArray(inputs)) throw new Error("Input must be a JSON array of arguments.");
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "java", source, inputs }),
      });
      const data: RunResponse = await res.json();
      if (!data.ok) {
        setError(`${data.stage ?? "error"}: ${data.error}`);
        setRun(null);
      } else {
        setRun(data);
        setStep(0);
        setPlaying(false);
        setEditing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [source, inputText]);

  const jumpToSeq = useCallback((seq: number) => {
    const i = snaps.findIndex((s) => s.seq === seq);
    if (i >= 0) { setPlaying(false); setStep(i); }
  }, [snaps]);

  return (
    <div className="app">
      <header>
        <h1>Algorithm Visualizer</h1>
        <div className="entry">{run?.entry ?? "Paste a Java solution and press Run"}</div>
        <div className="controls">
          <label>
            Input
            <input value={inputText} onChange={(e) => setInputText(e.target.value)}
                   spellCheck={false} placeholder="[[3,2,1], 2]" />
          </label>
          <button onClick={() => setEditing((v) => !v)}>{editing ? "Hide code" : "Edit code"}</button>
          <button className="primary" onClick={doRun} disabled={busy}>
            {busy ? "Tracing…" : "Run"}
          </button>
        </div>
      </header>

      {error && <div className="banner error"><strong>Failed:</strong> <pre>{error}</pre></div>}
      {run?.seeded && (
        <div className="banner note">
          <code>new Random()</code> was seeded so the run is reproducible — pivots are
          deterministic here, unlike in production.
        </div>
      )}
      {run?.summary?.stopReason && run.summary.stopReason !== "completed" && (
        <div className="banner warn">
          Trace stopped early ({run.summary.stopReason}). Showing the first {snaps.length} steps.
        </div>
      )}

      {editing && (
        <textarea className="editor" value={source} spellCheck={false}
                  onChange={(e) => setSource(e.target.value)} />
      )}

      <div className="narration">{story}</div>

      <main>
        <CodePane source={run?.source ?? source} snap={snap} hits={hits}
                  activeClass={snap?.cls ?? ""} userClasses={run?.user_classes ?? []} />
        <div className="col">
          <ArrayView snap={snap} />
          <CallTree roots={roots} seq={snap?.seq ?? -1}
                    newestFid={snap?.newestFid ?? null} onPick={jumpToSeq} />
        </div>
        <CallStack snap={snap} />
      </main>

      <footer>
        <Player step={step} total={snaps.length} playing={playing} speed={speed}
                onStep={setStep} onPlay={setPlaying} onSpeed={setSpeed} />
        {run && (
          <div className="stats">
            <span>{run.summary.calls ?? 0} calls</span>
            <span>depth {run.summary.maxDepth ?? 0}</span>
            <span>output <code>{run.stdout.trim() || "—"}</code></span>
          </div>
        )}
      </footer>
    </div>
  );
}
