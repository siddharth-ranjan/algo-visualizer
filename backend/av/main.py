"""HTTP surface for the algorithm visualizer."""

from __future__ import annotations

import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import driver, runner

app = FastAPI(title="algo-visualizer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    language: str = "java"
    source: str
    inputs: list = Field(default_factory=list)
    method: str | None = None
    seed: bool = True
    max_events: int = Field(default=20000, ge=100, le=200000)


class RunResponse(BaseModel):
    ok: bool
    stage: str | None = None
    error: str | None = None
    entry: str | None = None
    events: list = Field(default_factory=list)
    stdout: str = ""
    source: str = ""
    user_classes: list = Field(default_factory=list)
    seeded: bool = False
    summary: dict = Field(default_factory=dict)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/inspect")
def inspect(body: RunRequest):
    """Report the detected entry point so the UI can prompt for arguments."""
    try:
        entry = driver.find_entry(body.source, prefer=body.method)
    except driver.DriverError as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "cls": entry.cls,
        "method": entry.method,
        "ret": entry.ret,
        "label": entry.label,
        "params": [{"type": p.type, "name": p.name} for p in entry.params],
    }


@app.post("/api/run", response_model=RunResponse)
def run(body: RunRequest):
    if body.language != "java":
        return RunResponse(ok=False, stage="language",
                           error=f"Language {body.language!r} is not supported yet.")
    try:
        result = runner.run_java(
            body.source, body.inputs, method=body.method, seed=body.seed,
            limits=runner.Limits(max_events=body.max_events),
        )
    except driver.DriverError as exc:
        return RunResponse(ok=False, stage="driver", error=str(exc))
    except runner.RunError as exc:
        return RunResponse(ok=False, stage=exc.stage, error=exc.message)
    except subprocess.TimeoutExpired:
        return RunResponse(ok=False, stage="timeout",
                           error="The program took too long to trace and was stopped.")

    return RunResponse(
        ok=True,
        entry=result.entry,
        events=result.events,
        stdout=result.stdout,
        source=result.display_source,
        user_classes=result.user_classes,
        seeded=result.seeded,
        summary=result.summary,
    )
