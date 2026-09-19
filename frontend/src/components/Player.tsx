import { useEffect } from "react";

interface Props {
  step: number;
  total: number;
  playing: boolean;
  speed: number;
  onStep: (n: number) => void;
  onPlay: (p: boolean) => void;
  onSpeed: (s: number) => void;
}

/** Transport controls; drives the shared step cursor every view reads from. */
export function Player({ step, total, playing, speed, onStep, onPlay, onSpeed }: Props) {
  useEffect(() => {
    if (!playing) return;
    if (step >= total - 1) { onPlay(false); return; }
    const t = setTimeout(() => onStep(step + 1), speed);
    return () => clearTimeout(t);
  }, [playing, step, total, speed, onStep, onPlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); onPlay(false); onStep(Math.min(total - 1, step + 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); onPlay(false); onStep(Math.max(0, step - 1)); }
      if (e.key === " ") { e.preventDefault(); onPlay(!playing); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, total, playing, onStep, onPlay]);

  const disabled = total === 0;
  return (
    <div className="player">
      <button onClick={() => onStep(0)} disabled={disabled} title="Restart">⏮</button>
      <button onClick={() => { onPlay(false); onStep(Math.max(0, step - 1)); }} disabled={disabled} title="Back (←)">◀</button>
      <button className="primary" onClick={() => onPlay(!playing)} disabled={disabled} title="Play/pause (space)">
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={() => { onPlay(false); onStep(Math.min(total - 1, step + 1)); }} disabled={disabled} title="Forward (→)">▶</button>
      <input
        type="range" min={0} max={Math.max(0, total - 1)} value={step} disabled={disabled}
        onChange={(e) => { onPlay(false); onStep(Number(e.target.value)); }}
      />
      <span className="counter">{disabled ? "0 / 0" : `${step + 1} / ${total}`}</span>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} title="Playback speed">
        <option value={600}>0.5×</option>
        <option value={300}>1×</option>
        <option value={120}>2.5×</option>
        <option value={40}>7×</option>
      </select>
    </div>
  );
}
