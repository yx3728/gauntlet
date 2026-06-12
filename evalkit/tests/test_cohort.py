"""Cohort-runner tests: frozen shared draw, parallel arms, pooled tables with
Wilson CIs, condition diff, registry, cross_score."""

import json
from pathlib import Path

import evalkit
from evalkit.agents import MockNode

GYM_ROOT = Path(__file__).resolve().parents[2] / "gym"
FORGE_GREEDY = (GYM_ROOT / "tasks" / "forge" / "baselines" / "greedy.js").read_text()
FORGE_NOOP = (GYM_ROOT / "tasks" / "forge" / "baselines" / "noop.js").read_text()


def test_cohort_frozen_draw_parallel_arms_and_tables(tmp_path):
    runs = tmp_path / "runs"
    out = evalkit.run_cohort(
        "forge",
        [
            {"name": "greedy-arm", "node": lambda: MockNode(policy_source=FORGE_GREEDY), "reps": 2},
            {"name": "noop-arm", "node": lambda: MockNode(policy_source=FORGE_NOOP), "reps": 2},
        ],
        cohort_name="mock-cohort",
        n_heldout=6,
        concurrency=4,
        runs_dir=runs,
        workspace_root=tmp_path / "ws",
    )
    report = out["report"]

    # The frozen draw was persisted BEFORE arms and reached EVERY trial identically.
    cohort_meta = json.loads((out["cohort_dir"] / "cohort.json").read_text())
    frozen = cohort_meta["heldout_seeds"]
    assert len(frozen) == 6
    trial_dirs = sorted(p for p in runs.iterdir() if p.is_dir() and p.name.startswith("mock-cohort-"))
    assert len(trial_dirs) == 4
    for td in trial_dirs:
        t = json.loads((td / "trial.json").read_text())
        assert t["split"]["heldout"] == frozen
        assert t["status"] == "complete"

    # Parallel determinism: both reps of the same arm produce IDENTICAL per-seed
    # results (separate processes; the frozen draw is the same exam).
    for arm in ("greedy-arm", "noop-arm"):
        reps = out["trials"][arm]
        assert len(reps) == 2
        r0 = sorted(reps[0].heldout.results, key=lambda r: r["seed"])
        r1 = sorted(reps[1].heldout.results, key=lambda r: r["seed"])
        assert r0 == r1

    # Tables: per-rep + pooled (n=12) with Wilson CIs; greedy beats noop.
    gt = report["arms_table"]["greedy-arm"]
    nt = report["arms_table"]["noop-arm"]
    assert gt["pooled_heldout"]["n"] == 12 and nt["pooled_heldout"]["n"] == 12
    assert "clear_rate_wilson95" in gt["pooled_heldout"]
    assert gt["pooled_heldout"]["mean"] > nt["pooled_heldout"]["mean"]
    assert (out["cohort_dir"] / "COHORT.md").exists()

    # Conditions recorded per rep (mock telemetry); no errors.
    assert gt["reps"][0]["conditions"]["cost_usd"] == 0.0
    assert not report.get("errors")

    # Registry has all four trials.
    reg = [json.loads(l) for l in (runs / "registry.jsonl").read_text().splitlines()]
    assert len([r for r in reg if r["name"].startswith("mock-cohort-")]) == 4


def test_cohort_survives_an_arm_failure(tmp_path):
    class BoomNode(MockNode):
        def run(self, workspace, prompt, budgets):
            raise RuntimeError("boom")

    out = evalkit.run_cohort(
        "forge",
        [
            {"name": "ok", "node": lambda: MockNode(policy_source=FORGE_NOOP), "reps": 1},
            {"name": "boom", "node": lambda: BoomNode(policy_source=""), "reps": 1},
        ],
        cohort_name="mock-cohort-fail",
        n_heldout=3,
        concurrency=2,
        runs_dir=tmp_path / "runs",
        workspace_root=tmp_path / "ws",
    )
    assert len(out["trials"]["ok"]) == 1
    assert out["report"]["errors"]["boom"][0]["error"] == "boom"


def test_cross_score_rescoring_on_frozen_seeds(tmp_path):
    policy = tmp_path / "p.js"
    policy.write_text(FORGE_GREEDY)
    out = evalkit.cross_score({"v1-greedy": policy}, [10001, 10002, 10003], task="forge", timeout_s=600)
    br = out["v1-greedy"]
    assert br.ok and len(br.results) == 3
    assert br.task["id"] == "forge"
