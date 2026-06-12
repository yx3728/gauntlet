"""cohort.py — the light experiment runner (v2 fix #7).

One cohort = one task × several arms (models) × N reps, run in parallel under a
SINGLE FROZEN held-out draw (v2 fix #1: the v1 chain's per-trial draws made the
headline numbers non-comparable — every arm sat a different exam). The frozen
draw is persisted BEFORE any arm starts, in the cohort dir — which, with v2
fix #2 (workspaces outside any repo), is out of every node's reach by
construction.

Deliberately light: freeze → run arms (ThreadPool; node sessions and scoring
subprocesses release the GIL) → per-arm/pooled criterion tables with Wilson CIs
→ condition diff across arms → cohort_report.json + COHORT.md. The v1 chain's
hand-rolled run_trial.py/comparison.json — where the v1 reporting bugs came
from — is what this replaces.
"""

from __future__ import annotations

import json
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from ..boundary import BatchResult, default_gym_root, run_policy_batch
from ..seeds import split_for
from .api import Trial, _build_arena, _now_iso, _provenance, analyze, run
from .criterion import criterion_fn, criterion_summary

# Conditions that must match across arms of a controlled comparison — anything
# differing is emitted as an explicit confound (v1 lesson: Sonnet ran at 200k
# with 5 compactions under an "identical conditions" claim).
CONDITION_FIELDS = ("context_window", "claude_version", "gauntlet_sha")


def _task_meta(task: str, gym_root: Path, node_bin: str) -> dict:
    """Probe-build the arena once to read the task manifest (training seeds,
    criterion) before any trial exists."""
    with tempfile.TemporaryDirectory(prefix="gauntlet-cohort-probe-") as td:
        return _build_arena(task, Path(td) / "arena", gym_root, node_bin)


def _conditions(trial: Trial) -> dict:
    tm = trial.node.meta.get("trace_meta", {})
    cw = tm.get("context_windows") or {}
    prov = {}
    tj = trial.trial_dir / "trial.json"
    if tj.exists():
        prov = json.loads(tj.read_text()).get("provenance", {})
    return {
        "model": tm.get("session", {}).get("model"),
        "context_window": max((v for v in cw.values() if v), default=None),
        "compactions": tm.get("compaction_count"),
        "rate_limit_events": tm.get("rate_limit_events"),
        "claude_version": tm.get("session", {}).get("version") or tm.get("session", {}).get("claude_code_version"),
        "cost_usd": tm.get("total_cost_usd"),
        "num_turns": tm.get("num_turns"),
        "wall_ms": trial.node.wall_ms,
        "node_status": trial.node.status,
        "audit_verdict": trial.audit.get("verdict"),
        "gauntlet_sha": prov.get("gauntlet_sha"),
    }


def _arm_table(trials: list[Trial], fn) -> dict:
    """Per-rep + pooled criterion summaries (pooling concatenates per-seed
    results across reps so between-session variance stays visible next to it)."""
    reps = []
    pooled_results: list[dict] = []
    for t in trials:
        results = t.heldout.results if t.heldout and t.heldout.ok else []
        pooled_results.extend(results)
        reps.append({
            "trial": t.trial_dir.name,
            "status": t.status,
            "heldout": criterion_summary(results, fn),
            "training": criterion_summary(t.training.results if t.training and t.training.ok else [], fn),
            "conditions": _conditions(t),
        })
    return {"reps": reps, "pooled_heldout": criterion_summary(pooled_results, fn)}


def cross_score(
    policies: dict[str, str | Path],
    seeds,
    *,
    task: str,
    gym_root: str | Path | None = None,
    config: dict | None = None,
    timeout_s: int = 7200,
    node_bin: str = "node",
) -> dict[str, BatchResult]:
    """Re-score arbitrary policies (e.g. earlier trials' winners) on a given
    seed set against the canonical task — CPU-only, zero tokens."""
    gym_root = Path(gym_root).resolve() if gym_root else default_gym_root()
    return {
        name: run_policy_batch(path, seeds, task=task, gym_root=gym_root, config=config, timeout_s=timeout_s, node_bin=node_bin)
        for name, path in policies.items()
    }


def run_cohort(
    task: str,
    arms: list[dict],
    *,
    cohort_name: str,
    n_heldout: int = 80,
    heldout_seeds=None,
    concurrency: int = 4,
    prompt: str | None = None,
    budgets=None,
    gym_root: str | Path | None = None,
    runs_dir: str | Path | None = None,
    workspace_root: str | Path | None = None,
    batch_timeout_s: int = 600,
    node_bin: str = "node",
    analyze_each: bool = True,
) -> dict:
    """Run a cohort: `arms` is a list of {"name": str, "node": AgentNode-factory
    (callable returning a fresh node) , "reps": int}. Returns the cohort record
    (also persisted under <runs_dir>/cohorts/<cohort_name>/)."""
    gym_root = Path(gym_root).resolve() if gym_root else default_gym_root()
    repo_root = gym_root.parent
    runs_dir = Path(runs_dir).resolve() if runs_dir else repo_root / "runs"
    cohort_dir = runs_dir / "cohorts" / cohort_name
    cohort_dir.mkdir(parents=True, exist_ok=False)

    # FREEZE the draw before any arm starts (fix #1) and persist it.
    manifest = _task_meta(task, gym_root, node_bin)
    split = split_for(manifest["training_seeds"], n_heldout=n_heldout, heldout_seeds=heldout_seeds)
    frozen = list(split.heldout)
    cohort_meta = {
        "format": "gauntlet_cohort_v1",
        "name": cohort_name,
        "task": task,
        "task_version": manifest["task_version"],
        "criterion": manifest.get("criterion"),
        "heldout_seeds": frozen,
        "n_heldout": len(frozen),
        "arms": [{"name": a["name"], "reps": a.get("reps", 1)} for a in arms],
        "concurrency": concurrency,
        "started_at": _now_iso(),
        "provenance": _provenance(repo_root),
    }
    (cohort_dir / "cohort.json").write_text(json.dumps(cohort_meta, indent=2))

    jobs = []
    for a in arms:
        for rep in range(1, a.get("reps", 1) + 1):
            jobs.append((a["name"], rep, a["node"]))

    def _one(arm_name: str, rep: int, node_factory):
        node = node_factory() if callable(node_factory) else node_factory
        trial = run(
            task,
            node,
            heldout_seeds=frozen,
            prompt=prompt,
            budgets=budgets,
            gym_root=gym_root,
            runs_dir=runs_dir,
            workspace_root=workspace_root,
            trial_name=f"{cohort_name}-{arm_name}-r{rep}",
            batch_timeout_s=batch_timeout_s,
            node_bin=node_bin,
        )
        if analyze_each:
            analyze(trial)
        return trial

    results: dict[str, dict] = {a["name"]: {"trials": [], "errors": []} for a in arms}
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = {ex.submit(_one, an, rep, nf): (an, rep) for an, rep, nf in jobs}
        for fut in as_completed(futs):
            arm_name, rep = futs[fut]
            try:
                results[arm_name]["trials"].append(fut.result())
            except Exception as e:  # an arm failure must not kill the cohort
                results[arm_name]["errors"].append({"rep": rep, "error": str(e), "traceback": traceback.format_exc()[-2000:]})

    # Tables + condition diff.
    kind, fn = criterion_fn(manifest.get("criterion"))
    table = {an: _arm_table(r["trials"], fn) for an, r in results.items()}
    all_conditions = [(an, rep["conditions"]) for an, t in table.items() for rep in t["reps"]]
    condition_diffs = {}
    for field_name in CONDITION_FIELDS:
        values = {f"{an}#{i}": c.get(field_name) for i, (an, c) in enumerate(all_conditions)}
        if len({json.dumps(v) for v in values.values()}) > 1:
            condition_diffs[field_name] = values
    report = {
        **cohort_meta,
        "finished_at": _now_iso(),
        "criterion_kind": kind,
        "arms_table": table,
        "condition_diffs": condition_diffs,
        "errors": {an: r["errors"] for an, r in results.items() if r["errors"]},
    }
    (cohort_dir / "cohort_report.json").write_text(json.dumps(report, indent=2, default=str))
    (cohort_dir / "COHORT.md").write_text(_render(report))
    return {"cohort_dir": cohort_dir, "report": report,
            "trials": {an: r["trials"] for an, r in results.items()}}


def _render(report: dict) -> str:
    L = [f"# Cohort — {report['name']} ({report['task']}@{report['task_version']}, criterion `{report['criterion_kind']}`)", ""]
    L.append(f"- frozen held-out: n={report['n_heldout']}; concurrency {report['concurrency']}; started {report['started_at']}, finished {report.get('finished_at')}")
    L.append("")
    L.append("| arm | rep | clear (Wilson95) | criterion mean | win_step med | cost | turns | compact | ctx window | audit |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for an, t in report["arms_table"].items():
        for i, rep in enumerate(t["reps"], 1):
            h, c = rep["heldout"], rep["conditions"]
            ws = h.get("win_step", {}).get("median", "—")
            L.append(
                f"| {an} | r{i} | {h.get('clear_rate', '—')} {h.get('clear_rate_wilson95', '')} | {h.get('mean', '—')} | {ws} "
                f"| ${c.get('cost_usd') if c.get('cost_usd') is not None else '—'} | {c.get('num_turns', '—')} | {c.get('compactions', '—')} | {c.get('context_window', '—')} | {c.get('audit_verdict', '—')} |"
            )
        p = t["pooled_heldout"]
        ws = p.get("win_step", {}).get("median", "—")
        L.append(f"| **{an}** | **pooled** | **{p.get('clear_rate', '—')} {p.get('clear_rate_wilson95', '')}** | **{p.get('mean', '—')}** | **{ws}** | | | | | |")
    if report.get("condition_diffs"):
        L.append("")
        L.append("## Condition differences across arms (explicit confounds)")
        for f_, vals in report["condition_diffs"].items():
            L.append(f"- **{f_}** differs: {json.dumps(vals)}")
    if report.get("errors"):
        L.append("")
        L.append(f"## Arm errors: {json.dumps(report['errors'], default=str)[:1500]}")
    return "\n".join(L) + "\n"
