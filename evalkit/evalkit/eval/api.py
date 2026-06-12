"""api.py — the eval API: a few functions, no CLI.

    trial = evalkit.run("gridrun", node)      # arena -> node -> policy -> held-out scores
    results = evalkit.analyze(trial)          # distributions + baselines + diagnostic probe

`run` owns the trial lifecycle: build a PINNED arena for this trial, copy it
into an isolated workspace, hand the workspace to the agents layer (a black
box), audit what came back, then score the final policy on held-out AND
training seeds in the CANONICAL arena (never the node's workspace copy).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..agents import AgentNode, NodeBudgets, NodeResult, develop
from ..boundary import BatchResult, default_gym_root, run_policy_batch
from ..seeds import SeedSplit, split_for
from .audit import audit
from .baselines import run_baselines
from .probe import diagnostic_probe
from .scoring import summarize

PROMPT_TEMPLATE = Path(__file__).resolve().parents[1] / "agents" / "prompts" / "policy_dev.md"


@dataclass
class Trial:
    trial_dir: Path
    task_id: str
    task_version: str
    status: str  # "complete" | "no_policy"
    node: NodeResult
    split: SeedSplit
    audit: dict
    heldout: BatchResult | None
    training: BatchResult | None
    baselines: dict[str, BatchResult] = field(default_factory=dict)
    manifest: dict = field(default_factory=dict)

    @classmethod
    def from_dir(cls, trial_dir: str | Path) -> "Trial":
        trial_dir = Path(trial_dir)
        t = json.loads((trial_dir / "trial.json").read_text())

        def load_batch(name) -> BatchResult | None:
            p = trial_dir / name
            if not p.exists():
                return None
            d = json.loads(p.read_text())
            return BatchResult(**d)

        baselines = {}
        bpath = trial_dir / "baselines.json"
        if bpath.exists():
            baselines = {k: BatchResult(**v) for k, v in json.loads(bpath.read_text()).items()}
        node = NodeResult(
            node=t["node"]["node"],
            status=t["node"]["status"],
            wall_ms=t["node"]["wall_ms"],
            policy_path=Path(t["node"]["policy_path"]) if t["node"]["policy_path"] else None,
            report=t["node"]["report"],
            trace_path=Path(t["node"]["trace_path"]) if t["node"]["trace_path"] else None,
            meta=t["node"]["meta"],
        )
        return cls(
            trial_dir=trial_dir,
            task_id=t["task"]["task_id"],
            task_version=t["task"]["task_version"],
            status=t["status"],
            node=node,
            split=SeedSplit(training=tuple(t["split"]["training"]), heldout=tuple(t["split"]["heldout"])),
            audit=t["audit"],
            heldout=load_batch("heldout.json"),
            training=load_batch("training.json"),
            baselines=baselines,
            manifest=t["task"],
        )


@dataclass
class Analysis:
    task_id: str
    node_name: str
    status: str
    audit_verdict: str
    heldout_summary: dict
    training_summary: dict
    baseline_summaries: dict
    probe: dict

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "node_name": self.node_name,
            "status": self.status,
            "audit_verdict": self.audit_verdict,
            "heldout_summary": self.heldout_summary,
            "training_summary": self.training_summary,
            "baseline_summaries": self.baseline_summaries,
            "probe": self.probe,
        }

    def render(self) -> str:
        """Human-readable markdown summary."""
        L = [f"# Analysis — {self.task_id} / {self.node_name}", ""]
        L.append(f"- status: **{self.status}**, audit: **{self.audit_verdict}**")
        h = self.heldout_summary
        if h.get("n"):
            score, prog = h.get("score", {}), h.get("progress", {})
            L.append(
                f"- held-out (n={h['n']}): score mean **{score.get('mean')}** ± {score.get('stdev')} "
                f"(median {score.get('median')}, max {score.get('max')}), progress mean **{prog.get('mean')}**"
            )
            L.append(f"- done reasons: {h.get('done_reason_rates')}  policy errors: {h.get('policy_error_rate')}")
        for name, s in sorted(self.baseline_summaries.items()):
            L.append(f"- baseline `{name}`: score mean {s.get('score', {}).get('mean')}, progress mean {s.get('progress', {}).get('mean')}")
        p = self.probe
        if p:
            gap = p["generalization_gap"]
            L.append(f"- generalization: training score {gap['training']['score_mean']} vs held-out {gap['heldout']['score_mean']} (gap {gap['score_gap']})")
            bp = p["baseline_position"]
            if "normalized_vs_baselines" in bp:
                L.append(f"- baseline position: {bp['normalized_vs_baselines']} on the noop→greedy scale")
            fb = p["failure_breakdown"]
            L.append(f"- failure breakdown: {fb['done_reason_rates']}, worst seeds {fb['worst_seeds']}")
        return "\n".join(L) + "\n"


def score_policy(
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
    """Score one policy on a batch of seeds (the exposed low-level: a thin
    wrapper over the per-batch boundary). Exactly one of `arena_dir` (arena
    mode) or `task` (repo mode: a task id or env.js path) must be given."""
    return run_policy_batch(
        policy_path,
        seeds,
        arena_dir=arena_dir,
        task=task,
        gym_root=gym_root,
        max_steps=max_steps,
        config=config,
        timeout_s=timeout_s,
        node_bin=node_bin,
    )


def _build_arena(task: str, out_dir: Path, gym_root: Path, node_bin: str) -> dict:
    cmd = [node_bin, str(gym_root / "arena" / "build_arena.js"), "--task", task, "--out", str(out_dir)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"arena build failed for task '{task}': {proc.stderr[-2000:]}")
    return json.loads((out_dir / "manifest.json").read_text())


def run(
    task: str,
    node: AgentNode,
    *,
    budgets: NodeBudgets | None = None,
    n_heldout: int = 30,
    heldout_seeds=None,
    gym_root: str | Path | None = None,
    runs_dir: str | Path | None = None,
    trial_name: str | None = None,
    batch_timeout_s: int = 600,
    node_bin: str = "node",
    prompt: str | None = None,
    config: dict | None = None,
) -> Trial:
    """Full pipeline for ONE trial: arena -> agent node -> audit -> held-out
    scoring -> baselines. Returns a Trial (also fully persisted on disk).
    Held-out seeds are drawn fresh per trial (see `seeds.split_for`) unless an
    explicit `heldout_seeds=` set is given; the split is recorded in trial.json.

    `prompt` overrides the built-in task-agnostic dev prompt (verbatim text).
    `config` is the task config used for ALL canonical scoring (policy held-out
    + training + baselines) — passed through opaquely (CONTRACT.md).

    Scoring substrate: if the built arena ships gauntlet's `task.bundle.js`
    (standard arenas), scoring runs inside that pinned arena. Overlay arenas
    (ported tasks shipping their own surface, e.g. a reproduced external trial
    workspace) carry no gauntlet runner, so scoring runs through the canonical
    REPO task module instead — equally outside the node's reach."""
    budgets = budgets or NodeBudgets()
    gym_root = Path(gym_root).resolve() if gym_root else default_gym_root()
    repo_root = gym_root.parent
    runs_dir = Path(runs_dir).resolve() if runs_dir else repo_root / "runs"

    safe_node = re.sub(r"[^A-Za-z0-9._-]+", "-", node.name)
    name = trial_name or f"{task}-{safe_node}-{int(time.time())}"
    trial_dir = runs_dir / name
    if trial_dir.exists():
        name = f"{name}-{int(time.time() * 1000) % 100000}"
        trial_dir = runs_dir / name
    trial_dir.mkdir(parents=True)

    # 1. Pinned arena for this trial (canonical copy used for all scoring).
    arena_dir = trial_dir / "arena"
    manifest = _build_arena(task, arena_dir, gym_root, node_bin)
    split = split_for(manifest["training_seeds"], n_heldout=n_heldout, heldout_seeds=heldout_seeds)

    # 2. Isolated workspace for the node (its own copy of the arena).
    workspace = trial_dir / "workspace"
    shutil.copytree(arena_dir, workspace)

    # 3. The black-box node develops a policy (the agents seam).
    prompt_text = prompt if prompt is not None else PROMPT_TEMPLATE.read_text().replace("$ATTEMPTS", str(budgets.attempts))
    (trial_dir / "prompt.txt").write_text(prompt_text)
    node_result = develop(workspace, prompt_text, node, budgets)

    # 4. Integrity audit (trace + workspace tamper check).
    trace = node_result.trace_path or (trial_dir / "trace.jsonl")
    audit_result = audit(trace, workspace, manifest, repo_root)

    # 5. Score the FINAL policy on the canonical substrate (held-out + training):
    #    the pinned arena bundle when present, else the canonical repo task.
    if (arena_dir / "task.bundle.js").exists():
        score_kw = {"arena_dir": arena_dir}
    else:
        score_kw = {"task": task, "gym_root": gym_root}
    heldout = training = None
    if node_result.policy_path:
        heldout = run_policy_batch(node_result.policy_path, split.heldout, **score_kw, config=config, timeout_s=batch_timeout_s)
        training = run_policy_batch(node_result.policy_path, split.training, **score_kw, config=config, timeout_s=batch_timeout_s)

    # 6. Baselines on the same held-out seeds and the same pinned substrate.
    baseline_kw = dict(score_kw)
    baseline_kw.setdefault("gym_root", gym_root)
    baselines = run_baselines(task, split.heldout, config=config, timeout_s=batch_timeout_s, **baseline_kw)

    status = "complete" if node_result.policy_path else "no_policy"
    trial = Trial(
        trial_dir=trial_dir,
        task_id=manifest["task_id"],
        task_version=manifest["task_version"],
        status=status,
        node=node_result,
        split=split,
        audit=audit_result,
        heldout=heldout,
        training=training,
        baselines=baselines,
        manifest=manifest,
    )
    _persist(trial)
    return trial


def _persist(trial: Trial) -> None:
    d = trial.trial_dir
    if trial.heldout:
        (d / "heldout.json").write_text(json.dumps(trial.heldout.to_dict(), indent=2))
    if trial.training:
        (d / "training.json").write_text(json.dumps(trial.training.to_dict(), indent=2))
    if trial.baselines:
        (d / "baselines.json").write_text(
            json.dumps({k: v.to_dict() for k, v in trial.baselines.items()}, indent=2)
        )
    (d / "audit.json").write_text(json.dumps(trial.audit, indent=2))
    (d / "trial.json").write_text(
        json.dumps(
            {
                "format": "gauntlet_trial_v1",
                "created_at": int(time.time()),
                "task": trial.manifest,
                "status": trial.status,
                "node": trial.node.to_dict(),
                "split": {"training": list(trial.split.training), "heldout": list(trial.split.heldout)},
                "audit": trial.audit,
            },
            indent=2,
        )
    )


def analyze(trial: Trial | str | Path) -> Analysis:
    """Turn a Trial into comparable numbers + the diagnostic probe."""
    if not isinstance(trial, Trial):
        trial = Trial.from_dir(trial)

    heldout_results = trial.heldout.results if trial.heldout and trial.heldout.ok else []
    training_results = trial.training.results if trial.training and trial.training.ok else []
    baseline_results = {k: v.results for k, v in trial.baselines.items() if v.ok}

    analysis = Analysis(
        task_id=trial.task_id,
        node_name=trial.node.node,
        status=trial.status,
        audit_verdict=trial.audit.get("verdict", "review"),
        heldout_summary=summarize(heldout_results),
        training_summary=summarize(training_results),
        baseline_summaries={k: summarize(v) for k, v in baseline_results.items()},
        probe=diagnostic_probe(heldout_results, training_results, baseline_results) if heldout_results else {},
    )
    (trial.trial_dir / "analysis.json").write_text(json.dumps(analysis.to_dict(), indent=2))
    (trial.trial_dir / "ANALYSIS.md").write_text(analysis.render())
    return analysis
