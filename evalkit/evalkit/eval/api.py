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

import datetime
import os
import platform
import threading

from ..agents import AgentNode, NodeBudgets, NodeResult, develop
from ..boundary import BatchResult, default_gym_root, run_policy_batch
from ..seeds import SeedSplit, split_for
from .audit import audit
from .baselines import run_baselines
from .criterion import criterion_fn, criterion_summary
from .probe import diagnostic_probe
from .scoring import summarize

PROMPT_TEMPLATE = Path(__file__).resolve().parents[1] / "agents" / "prompts" / "policy_dev.md"

# v2: node workspaces default OUTSIDE any repo (the structural fix for v1's
# cross-arm contamination — one `cd ..` from a workspace must reach nothing).
DEFAULT_WORKSPACE_ROOT = Path.home() / ".gauntlet" / "workspaces"
_REGISTRY_LOCK = threading.Lock()  # parallel arms append to one registry


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _git_repo_above(path: Path) -> Path | None:
    for p in [path, *path.parents]:
        if (p / ".git").exists():
            return p
    return None


def _provenance(repo_root: Path) -> dict:
    """Stamped AT RUN START (v1 lesson: HEAD moved during sessions and the SHA
    had to be reconstructed from timestamps)."""
    prov = {"started_at": _now_iso(), "platform": platform.platform(),
            "python": platform.python_version()}
    try:
        prov["node_version"] = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        pass
    try:
        sha = subprocess.run(["git", "-C", str(repo_root), "rev-parse", "--short=12", "HEAD"],
                             capture_output=True, text=True, timeout=10)
        if sha.returncode == 0:
            prov["gauntlet_sha"] = sha.stdout.strip()
            dirty = subprocess.run(["git", "-C", str(repo_root), "status", "--porcelain"],
                                   capture_output=True, text=True, timeout=10)
            prov["gauntlet_dirty"] = bool(dirty.stdout.strip())
    except Exception:
        pass
    return prov


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
    criterion: dict = field(default_factory=dict)  # the task-owned comparable (v2 seam)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "node_name": self.node_name,
            "status": self.status,
            "audit_verdict": self.audit_verdict,
            "criterion": self.criterion,
            "heldout_summary": self.heldout_summary,
            "training_summary": self.training_summary,
            "baseline_summaries": self.baseline_summaries,
            "probe": self.probe,
        }

    def render(self) -> str:
        """Human-readable markdown summary."""
        L = [f"# Analysis — {self.task_id} / {self.node_name}", ""]
        L.append(f"- status: **{self.status}**, audit: **{self.audit_verdict}**")
        c = self.criterion
        if c.get("kind") and c.get("heldout", {}).get("n"):
            ch, ct = c["heldout"], c.get("training", {})
            L.append(
                f"- criterion `{c['kind']}` held-out (n={ch['n']}): mean **{ch.get('mean')}**, "
                f"clear rate **{ch.get('clear_rate')}** {ch.get('clear_rate_wilson95')}"
                + (f", win_step median {ch['win_step']['median']}" if ch.get("win_step") else "")
            )
            if ct.get("n"):
                L.append(
                    f"- criterion generalization: training clear {ct.get('clear_rate')} / mean {ct.get('mean')} "
                    f"vs held-out clear {ch.get('clear_rate')} / mean {ch.get('mean')} (gap {c.get('gap')})"
                )
            for bname, bsum in sorted(c.get("baselines", {}).items()):
                L.append(f"- criterion baseline `{bname}`: mean {bsum.get('mean')}, clear rate {bsum.get('clear_rate')}")
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
    workspace_root: str | Path | None = None,
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

    provenance = _provenance(repo_root)

    # 1. Pinned arena for this trial (canonical copy used for all scoring).
    arena_dir = trial_dir / "arena"
    manifest = _build_arena(task, arena_dir, gym_root, node_bin)
    split = split_for(manifest["training_seeds"], n_heldout=n_heldout, heldout_seeds=heldout_seeds)

    # 2. Neutral, OUT-OF-REPO workspace for the node. trial_dir (and with it the
    #    frozen seed split, prior trials, and the framework itself) is not
    #    reachable from the node's cwd by construction.
    ws_root = Path(workspace_root).resolve() if workspace_root else DEFAULT_WORKSPACE_ROOT
    ws_parent = ws_root / name
    ws_parent.mkdir(parents=True, exist_ok=False)
    repo_above = _git_repo_above(ws_parent)
    if repo_above is not None:
        shutil.rmtree(ws_parent, ignore_errors=True)
        raise RuntimeError(
            f"workspace root {ws_parent} sits inside a git repo ({repo_above}); "
            "node workspaces must live outside any repo (v2 isolation rule) — pass workspace_root="
        )
    workspace = ws_parent / "workspace"
    shutil.copytree(arena_dir, workspace)

    # 3. Crash-safe early persist: the split + running status exist on disk
    #    BEFORE the (multi-hour) node starts; resume(trial_dir) can finish a
    #    crashed trial from here.
    prompt_text = prompt if prompt is not None else PROMPT_TEMPLATE.read_text().replace("$ATTEMPTS", str(budgets.attempts))
    (trial_dir / "prompt.txt").write_text(prompt_text)
    _persist_running(trial_dir, manifest, split, node.name, provenance, ws_parent,
                     {"task": task, "config": config, "batch_timeout_s": batch_timeout_s,
                      "gym_root": str(gym_root), "node_bin": node_bin})

    # 4. The black-box node develops a policy (the agents seam).
    node_result = develop(workspace, prompt_text, node, budgets)
    provenance["finished_at"] = _now_iso()

    # 5. Copy the node's outputs back into the trial dir (the persisted record);
    #    the neutral dir is removed once the copy succeeds.
    node_result = _collect_workspace(trial_dir, ws_parent, node_result)
    workspace = trial_dir / "workspace"

    # 6. Integrity audit (trace + workspace tamper check + tool-surface check).
    trace = node_result.trace_path or (trial_dir / "trace.jsonl")
    tm = node_result.meta.get("trace_meta", {})
    audit_result = audit(trace, workspace, manifest, repo_root,
                         allowed_tools=getattr(node, "allowed_tools", None),
                         session=tm.get("session"))

    # 7. Score the FINAL policy on the canonical substrate (held-out + training):
    #    the pinned arena bundle when present, else the canonical repo task.
    if (arena_dir / "task.bundle.js").exists():
        score_kw = {"arena_dir": arena_dir}
    else:
        score_kw = {"task": task, "gym_root": gym_root}
    heldout = training = None
    if node_result.policy_path:
        heldout = run_policy_batch(node_result.policy_path, split.heldout, **score_kw, config=config, timeout_s=batch_timeout_s)
        training = run_policy_batch(node_result.policy_path, split.training, **score_kw, config=config, timeout_s=batch_timeout_s)

    # 8. Baselines on the same held-out seeds and the same pinned substrate.
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
    _persist(trial, provenance=provenance)
    return trial


def _persist_running(trial_dir: Path, manifest: dict, split: SeedSplit, node_name: str,
                     provenance: dict, ws_parent: Path, rerun: dict) -> None:
    (trial_dir / "trial.json").write_text(
        json.dumps(
            {
                "format": "gauntlet_trial_v1",
                "status": "running",
                "created_at": int(time.time()),
                "task": manifest,
                "node": {"node": node_name},
                "split": {"training": list(split.training), "heldout": list(split.heldout)},
                "provenance": provenance,
                "workspace_parent": str(ws_parent),
                "rerun": rerun,  # everything resume() needs to re-enter at scoring
            },
            indent=2,
        )
    )


def _collect_workspace(trial_dir: Path, ws_parent: Path, node_result: NodeResult) -> NodeResult:
    """Copy workspace + trace + stderr from the neutral location into the trial
    dir, re-point NodeResult paths at the persisted copies, then remove the
    neutral dir. On copy failure the neutral dir is left in place (data first)."""
    dst_ws = trial_dir / "workspace"
    shutil.copytree(ws_parent / "workspace", dst_ws, dirs_exist_ok=True)
    for f in ("trace.jsonl", "stderr.log"):
        src = ws_parent / f
        if src.exists():
            shutil.copy2(src, trial_dir / f)
    if node_result.policy_path:
        node_result.policy_path = dst_ws / "policy.js"
    if node_result.trace_path and (trial_dir / "trace.jsonl").exists():
        node_result.trace_path = trial_dir / "trace.jsonl"
    shutil.rmtree(ws_parent, ignore_errors=True)
    return node_result


def resume(trial_dir: str | Path, *, batch_timeout_s: int | None = None, node_bin: str | None = None) -> Trial:
    """Finish a crashed/killed trial: collect the neutral workspace if it still
    exists, then re-enter at audit -> scoring -> baselines -> persist. Requires
    a policy.js (deliverables-on-disk is the unit of success)."""
    trial_dir = Path(trial_dir)
    t = json.loads((trial_dir / "trial.json").read_text())
    if t.get("status") == "complete":
        return Trial.from_dir(trial_dir)
    manifest = t["task"]
    rerun = t.get("rerun", {})
    task = rerun.get("task") or manifest["task_id"]
    gym_root = Path(rerun.get("gym_root")) if rerun.get("gym_root") else default_gym_root()
    repo_root = gym_root.parent
    config = rerun.get("config")
    timeout_s = batch_timeout_s or rerun.get("batch_timeout_s") or 600
    nb = node_bin or rerun.get("node_bin") or "node"
    split = SeedSplit(training=tuple(t["split"]["training"]), heldout=tuple(t["split"]["heldout"]))
    provenance = t.get("provenance", {})
    provenance["resumed_at"] = _now_iso()

    ws_parent = Path(t.get("workspace_parent", ""))
    if ws_parent.exists() and not (trial_dir / "workspace").exists():
        node_result = NodeResult(node=t["node"]["node"], status="resumed", wall_ms=0)
        node_result.trace_path = ws_parent / "trace.jsonl" if (ws_parent / "trace.jsonl").exists() else None
        pol = ws_parent / "workspace" / "policy.js"
        node_result.policy_path = pol if pol.exists() else None
        node_result = _collect_workspace(trial_dir, ws_parent, node_result)
    else:
        pol = trial_dir / "workspace" / "policy.js"
        tr = trial_dir / "trace.jsonl"
        node_result = NodeResult(node=t["node"]["node"], status="resumed", wall_ms=0,
                                 policy_path=pol if pol.exists() else None,
                                 trace_path=tr if tr.exists() else None)
    from ..agents.trace_meta import extract_trace_meta
    tm = extract_trace_meta(node_result.trace_path)
    if tm:
        node_result.meta["trace_meta"] = tm
    rep = trial_dir / "workspace" / "report.json"
    if rep.exists():
        try:
            node_result.report = json.loads(rep.read_text())
        except Exception:
            pass

    workspace = trial_dir / "workspace"
    trace = node_result.trace_path or (trial_dir / "trace.jsonl")
    audit_result = audit(trace, workspace, manifest, repo_root, session=tm.get("session") if tm else None)

    arena_dir = trial_dir / "arena"
    score_kw = {"arena_dir": arena_dir} if (arena_dir / "task.bundle.js").exists() else {"task": task, "gym_root": gym_root}
    heldout = training = None
    if node_result.policy_path:
        heldout = run_policy_batch(node_result.policy_path, split.heldout, **score_kw, config=config, timeout_s=timeout_s)
        training = run_policy_batch(node_result.policy_path, split.training, **score_kw, config=config, timeout_s=timeout_s)
    baseline_kw = dict(score_kw)
    baseline_kw.setdefault("gym_root", gym_root)
    baselines = run_baselines(manifest["task_id"], split.heldout, config=config, timeout_s=timeout_s, **baseline_kw)

    trial = Trial(
        trial_dir=trial_dir,
        task_id=manifest["task_id"],
        task_version=manifest["task_version"],
        status="complete" if node_result.policy_path else "no_policy",
        node=node_result,
        split=split,
        audit=audit_result,
        heldout=heldout,
        training=training,
        baselines=baselines,
        manifest=manifest,
    )
    _persist(trial, provenance=provenance)
    return trial


def _persist(trial: Trial, provenance: dict | None = None) -> None:
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
                "provenance": provenance or {},
            },
            indent=2,
        )
    )
    # Append-only trial registry (one line per completed trial).
    tm = trial.node.meta.get("trace_meta", {})
    reg = {
        "name": d.name,
        "created_at": int(time.time()),
        "task_id": trial.task_id,
        "task_version": trial.task_version,
        "node": trial.node.node,
        "status": trial.status,
        "audit_verdict": trial.audit.get("verdict"),
        "heldout_n": len(trial.split.heldout),
        "cost_usd": tm.get("total_cost_usd"),
        "compactions": tm.get("compaction_count"),
    }
    with _REGISTRY_LOCK, open(d.parent / "registry.jsonl", "a") as f:
        f.write(json.dumps(reg) + "\n")


def analyze(trial: Trial | str | Path) -> Analysis:
    """Turn a Trial into comparable numbers + the diagnostic probe."""
    if not isinstance(trial, Trial):
        trial = Trial.from_dir(trial)

    heldout_results = trial.heldout.results if trial.heldout and trial.heldout.ok else []
    training_results = trial.training.results if trial.training and trial.training.ok else []
    baseline_results = {k: v.results for k, v in trial.baselines.items() if v.ok}

    # The task-owned comparable (v2 criterion seam; falls back to raw score).
    # v1 lesson: running the generalization probe on the farmable raw score
    # produced a false overfit alarm — the gap below is on the criterion.
    kind, fn = criterion_fn(trial.manifest.get("criterion"))
    criterion_block: dict = {}
    if heldout_results:
        ch = criterion_summary(heldout_results, fn)
        ct = criterion_summary(training_results, fn)
        criterion_block = {
            "kind": kind,
            "heldout": ch,
            "training": ct,
            "gap": round((ct.get("mean") or 0) - (ch.get("mean") or 0), 4) if ct.get("n") else None,
            "baselines": {k: criterion_summary(v, fn) for k, v in baseline_results.items()},
        }

    analysis = Analysis(
        task_id=trial.task_id,
        node_name=trial.node.node,
        status=trial.status,
        audit_verdict=trial.audit.get("verdict", "review"),
        heldout_summary=summarize(heldout_results),
        training_summary=summarize(training_results),
        baseline_summaries={k: summarize(v) for k, v in baseline_results.items()},
        probe=diagnostic_probe(heldout_results, training_results, baseline_results) if heldout_results else {},
        criterion=criterion_block,
    )
    (trial.trial_dir / "analysis.json").write_text(json.dumps(analysis.to_dict(), indent=2))
    (trial.trial_dir / "ANALYSIS.md").write_text(analysis.render())
    return analysis
