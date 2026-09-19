"""Compile + trace orchestration for Java submissions."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from . import driver

HERE = Path(__file__).resolve().parent
TRACER_SRC = HERE / "java" / "AvTracer.java"
TRACER_BIN = Path(os.environ.get("AV_CACHE", HERE.parent / ".cache")) / "tracer"


class RunError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.message = message


@dataclass
class Limits:
    max_events: int = 20000
    wall_ms: int = 15000
    compile_timeout: int = 30
    trace_timeout: int = 45


@dataclass
class RunResult:
    events: list = field(default_factory=list)
    stdout: str = ""
    source: str = ""
    display_source: str = ""
    entry: str = ""
    user_classes: list = field(default_factory=list)
    seeded: bool = False
    summary: dict = field(default_factory=dict)


def ensure_tracer() -> Path:
    """Compile the JDI tracer once and cache the classes."""
    stamp = TRACER_BIN / ".stamp"
    if stamp.exists() and stamp.read_text() == str(TRACER_SRC.stat().st_mtime):
        return TRACER_BIN
    TRACER_BIN.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["javac", "-d", str(TRACER_BIN), str(TRACER_SRC)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RunError("tracer_build", proc.stderr.strip())
    stamp.write_text(str(TRACER_SRC.stat().st_mtime))
    return TRACER_BIN


def run_java(source: str, inputs: list, *, method: str | None = None,
             seed: bool = True, limits: Limits | None = None) -> RunResult:
    limits = limits or Limits()
    tracer = ensure_tracer()

    display_source = source
    traced_source, seeded = driver.make_deterministic(source) if seed else (source, False)

    entry = driver.find_entry(traced_source, prefer=method)
    main_src = driver.build_main(entry, inputs)
    classes = driver.CLASS_RE.findall(traced_source)

    work = Path(tempfile.mkdtemp(prefix="av-run-"))
    try:
        (work / f"{entry.cls}.java").write_text(traced_source)
        (work / "AvMain.java").write_text(main_src)

        javac = subprocess.run(
            ["javac", "-g", "-nowarn", "-d", str(work),
             str(work / f"{entry.cls}.java"), str(work / "AvMain.java")],
            capture_output=True, text=True, timeout=limits.compile_timeout, cwd=work,
        )
        if javac.returncode != 0:
            raise RunError("compile", _clean_javac(javac.stderr, work))

        events_path, stdout_path = work / "events.jsonl", work / "stdout.txt"
        stdout_path.touch()
        trace = subprocess.run(
            ["java", "-cp", str(tracer), "AvTracer", str(work), "AvMain",
             ",".join(classes + ["AvMain"]), str(events_path), str(stdout_path),
             str(limits.max_events), str(limits.wall_ms)],
            capture_output=True, text=True, timeout=limits.trace_timeout, cwd=work,
        )
        if not events_path.exists():
            raise RunError("trace", (trace.stderr or trace.stdout or "tracer produced no events").strip())

        events, summary = [], {}
        for line in events_path.read_text().splitlines():
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("ev") == "summary":
                summary = ev
            else:
                events.append(ev)

        return RunResult(
            events=events,
            stdout=stdout_path.read_text()[:8192],
            source=traced_source,
            display_source=display_source,
            entry=entry.label,
            user_classes=classes,
            seeded=seeded,
            summary=summary,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _clean_javac(stderr: str, work: Path) -> str:
    """Strip temp paths so compiler errors point at the user's own file."""
    return stderr.replace(str(work) + "/", "").strip()
