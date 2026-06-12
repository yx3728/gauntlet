"""baselines.py — run a task's reference baselines (orchestrator-side only;
baselines are never shipped into arenas).

Each task directory provides baselines/<name>.js implementing the policy
contract. By convention: `noop` is the floor; `greedy` is the documented-
interface heuristic reference (the "interface sufficiency" proof).
"""

from __future__ import annotations

from pathlib import Path

from ..boundary import BatchResult, default_gym_root, run_policy_batch


def discover_baselines(task_id: str, gym_root: str | Path | None = None) -> dict[str, Path]:
    root = Path(gym_root) if gym_root else default_gym_root()
    bdir = root / "tasks" / task_id / "baselines"
    if not bdir.is_dir():
        return {}
    return {p.stem: p for p in sorted(bdir.glob("*.js"))}


def run_baselines(
    task_id: str,
    seeds,
    *,
    arena_dir: str | Path | None = None,
    task: str | None = None,
    gym_root: str | Path | None = None,
    config: dict | None = None,
    timeout_s: int = 600,
) -> dict[str, BatchResult]:
    """Score every discovered baseline on `seeds` against the same canonical
    substrate the policy is scored on: the pinned arena bundle (`arena_dir=`)
    or the canonical repo task (`task=`)."""
    if (arena_dir is None) == (task is None):
        raise ValueError("pass exactly one of arena_dir= or task=")
    kw = {"arena_dir": arena_dir} if arena_dir is not None else {"task": task, "gym_root": gym_root}
    out: dict[str, BatchResult] = {}
    for name, path in discover_baselines(task_id, gym_root).items():
        out[name] = run_policy_batch(path, seeds, **kw, config=config, timeout_s=timeout_s)
    return out
