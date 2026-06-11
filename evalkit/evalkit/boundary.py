"""boundary.py — the per-batch Lib1<->Lib2 boundary.

Python invokes the gym's JS runner ONCE per policy x seed-batch (never per
step) and parses the single-JSON-line batch protocol:

    node run_policy.js --task <...> --policy <...> --seeds <csv> --log none --json
    -> { task, config, seeds, results: [...], aggregate: {...} }

Two modes:
  - arena mode (the normal eval path): run the runner that ships inside a
    built arena directory, against its pinned ./task.bundle.js;
  - repo mode (tests/dev): run gym/runner/run_policy.js against a task id or
    an env.js path.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


def default_gym_root() -> Path:
    env = os.environ.get("GAUNTLET_GYM_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[2] / "gym"


@dataclass
class BatchResult:
    ok: bool
    seeds: list
    results: list
    aggregate: dict
    task: dict = field(default_factory=dict)
    config: dict = field(default_factory=dict)
    error: str | None = None
    stderr_tail: str | None = None
    exit_code: int | None = None
    wall_ms: int | None = None

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "task": self.task,
            "config": self.config,
            "seeds": self.seeds,
            "results": self.results,
            "aggregate": self.aggregate,
            "error": self.error,
            "stderr_tail": self.stderr_tail,
            "exit_code": self.exit_code,
            "wall_ms": self.wall_ms,
        }


def _error(msg: str, proc=None) -> BatchResult:
    return BatchResult(
        ok=False,
        seeds=[],
        results=[],
        aggregate={},
        error=msg,
        stderr_tail=(proc.stderr[-2000:] if proc is not None and proc.stderr else None),
        exit_code=(proc.returncode if proc is not None else None),
    )


def run_policy_batch(
    policy_path: str | Path,
    seeds,
    *,
    arena_dir: str | Path | None = None,
    task: str | None = None,
    gym_root: str | Path | None = None,
    max_steps: int = 0,
    config: dict | None = None,
    timeout_s: int = 600,
    node_bin: str = "node",
) -> BatchResult:
    """Score one policy on a batch of seeds via the JS runner. Exactly one of
    `arena_dir` (arena mode) or `task` (repo mode) must be given."""
    if (arena_dir is None) == (task is None):
        raise ValueError("pass exactly one of arena_dir= or task=")

    policy_path = Path(policy_path).resolve()
    if not policy_path.exists():
        return _error(f"policy not found: {policy_path}")

    if arena_dir is not None:
        cwd = Path(arena_dir).resolve()
        runner = cwd / "run_policy.js"
        task_args = []  # the arena runner defaults to ./task.bundle.js
    else:
        cwd = Path(gym_root).resolve() if gym_root else default_gym_root()
        runner = cwd / "runner" / "run_policy.js"
        task_args = ["--task", str(task)]
    if not runner.exists():
        return _error(f"runner not found: {runner}")

    seeds = [int(s) for s in seeds]
    cmd = [
        node_bin,
        str(runner),
        *task_args,
        "--policy", str(policy_path),
        "--seeds", ",".join(str(s) for s in seeds),
        "--log", "none",
        "--json",
    ]
    if max_steps:
        cmd += ["--max_steps", str(int(max_steps))]
    if config:
        cmd += ["--config", json.dumps(config)]

    import time

    t0 = time.time()
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return _error(f"runner timeout after {timeout_s}s")
    wall_ms = int((time.time() - t0) * 1000)

    if proc.returncode != 0:
        return _error(f"runner exit {proc.returncode}", proc)

    # Protocol: exactly one JSON line on stdout. Be tolerant of stray noise:
    # parse the last non-empty line.
    lines = [ln for ln in proc.stdout.strip().splitlines() if ln.strip()]
    if not lines:
        return _error("runner produced no stdout", proc)
    try:
        data = json.loads(lines[-1])
    except json.JSONDecodeError as e:
        return _error(f"runner stdout is not JSON: {e}", proc)

    return BatchResult(
        ok=True,
        task=data.get("task", {}),
        config=data.get("config", {}),
        seeds=data.get("seeds", seeds),
        results=data.get("results", []),
        aggregate=data.get("aggregate", {}),
        exit_code=proc.returncode,
        wall_ms=wall_ms,
    )
