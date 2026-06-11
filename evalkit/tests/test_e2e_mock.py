"""Mock-node e2e (the workhorse): a stub node returns a fixed policy -> the
FULL pipeline runs (arena -> agents -> policy -> held-out eval -> baselines ->
probe) -> assert it scores. Runs on BOTH games with the SAME task-agnostic
pipeline and prompt — the first generality proof.
"""

import json
from pathlib import Path

import pytest

import evalkit
from evalkit.agents import MockNode, NodeBudgets

GYM_ROOT = Path(__file__).resolve().parents[2] / "gym"

TASKS = ["gridrun", "forge"]


def greedy_source(task_id: str) -> str:
    p = GYM_ROOT / "tasks" / task_id / "baselines" / "greedy.js"
    if not p.exists():
        pytest.skip(f"task {task_id} not built yet")
    return p.read_text()


@pytest.mark.parametrize("task_id", TASKS)
def test_mock_e2e_full_pipeline(task_id, tmp_path):
    node = MockNode(policy_source=greedy_source(task_id))
    trial = evalkit.run(
        task_id,
        node,
        budgets=NodeBudgets(attempts=1),
        n_heldout=8,
        runs_dir=tmp_path / "runs",
    )

    # The trial completed and was scored on held-out seeds.
    assert trial.status == "complete"
    assert trial.task_id == task_id
    assert trial.heldout is not None and trial.heldout.ok, trial.heldout and trial.heldout.error
    assert len(trial.heldout.results) == 8
    for r in trial.heldout.results:
        assert isinstance(r["score"], (int, float))
        assert 0 <= r["progress"] <= 1
    assert trial.training is not None and trial.training.ok

    # Version pinning: scored against the exact arena bundle.
    manifest = json.loads((trial.trial_dir / "arena" / "manifest.json").read_text())
    assert trial.heldout.task["bundle_sha"] == manifest["bundle_sha1_12"]

    # Baselines ran on the same held-out seeds.
    assert "noop" in trial.baselines and "greedy" in trial.baselines
    assert trial.baselines["noop"].ok and trial.baselines["greedy"].ok
    assert trial.baselines["greedy"].seeds == list(trial.split.heldout)

    # A clean mock session audits clean.
    assert trial.audit["verdict"] == "clean", trial.audit

    # Artifacts persisted.
    for f in ["trial.json", "heldout.json", "training.json", "baselines.json", "audit.json", "prompt.txt"]:
        assert (trial.trial_dir / f).exists(), f

    # Black-box integrity: the workspace docs disclose ONLY training seeds —
    # the held-out seed list exists nowhere under the trial's workspace/arena
    # (it lives only in evalkit's SeedSplit and the orchestrator-side records).
    assert set(trial.split.heldout).isdisjoint(manifest["training_seeds"])
    heldout_csv = ",".join(str(s) for s in trial.split.heldout)
    ws = trial.trial_dir / "workspace"
    for p in ws.iterdir():
        if p.is_file() and p.suffix in (".md", ".json", ".js"):
            assert heldout_csv not in p.read_text(errors="ignore")

    # analyze() produces the comparable numbers + the diagnostic probe.
    analysis = evalkit.analyze(trial)
    assert analysis.heldout_summary["n"] == 8
    assert analysis.baseline_summaries["noop"]["n"] == 8
    probe = analysis.probe
    assert set(probe) == {"generalization_gap", "failure_breakdown", "baseline_position"}
    # The mock policy IS greedy, so it must sit at ~1.0 on the noop->greedy scale.
    if "normalized_vs_baselines" in probe["baseline_position"]:
        assert abs(probe["baseline_position"]["normalized_vs_baselines"] - 1.0) < 1e-6
    assert (trial.trial_dir / "ANALYSIS.md").exists()

    # The greedy reference must clearly beat the noop floor (interface sufficiency).
    noop_mean = analysis.baseline_summaries["noop"]["score"]["mean"]
    greedy_mean = analysis.baseline_summaries["greedy"]["score"]["mean"]
    assert greedy_mean > noop_mean


@pytest.mark.parametrize("task_id", TASKS)
def test_trial_reload_from_disk(task_id, tmp_path):
    node = MockNode(policy_source=greedy_source(task_id))
    trial = evalkit.run(task_id, node, n_heldout=4, runs_dir=tmp_path / "runs")
    reloaded = evalkit.Trial.from_dir(trial.trial_dir)
    assert reloaded.task_id == trial.task_id
    assert reloaded.split == trial.split
    assert reloaded.heldout.results == trial.heldout.results
    a1, a2 = evalkit.analyze(trial), evalkit.analyze(reloaded)
    assert a1.to_dict() == a2.to_dict()


def test_workspace_bundle_tamper_is_flagged_and_cannot_move_heldout_scores(tmp_path):
    """Black-box integrity: held-out scoring runs in the CANONICAL arena, so a
    node that overwrites its workspace bundle with an always-win stub gets
    flagged by the audit AND gains nothing on the held-out score."""
    src = greedy_source("forge")
    always_win = (
        "const obs = { metrics: { score: 1e9, progress: 1, done_reason: 'win' } };\n"
        "module.exports = { meta: { id: 'forge', version: '0.0.0', max_steps_default: 1, training_seeds: [1] },\n"
        "  createEnv: () => ({ reset: () => ({ obs }),\n"
        "    step: () => ({ obs, done: true, event: { kind: 'game_over', reason: 'win' } }) }) };\n"
    )

    class TamperNode(MockNode):
        def run(self, workspace, prompt, budgets):
            meta = super().run(workspace, prompt, budgets)
            (workspace / "task.bundle.js").write_text(always_win)
            return meta

    heldout_seeds = [10001, 10002, 10003, 10004]  # same held-out set for both trials
    honest = evalkit.run("forge", MockNode(policy_source=src), heldout_seeds=heldout_seeds, runs_dir=tmp_path / "runs")
    tampered = evalkit.run("forge", TamperNode(policy_source=src), heldout_seeds=heldout_seeds, runs_dir=tmp_path / "runs")

    assert honest.audit["verdict"] == "clean", honest.audit
    assert tampered.audit["verdict"] == "flagged"
    assert any(f["rule"] == "shipped_file_modified" for f in tampered.audit["workspace"]["findings"])

    assert honest.heldout.ok and tampered.heldout.ok
    assert tampered.split.heldout == honest.split.heldout == tuple(heldout_seeds)

    def score_mean(trial):
        return sum(r["score"] for r in trial.heldout.results) / len(trial.heldout.results)

    # Same policy, same seeds, same CANONICAL bundle: identical held-out scores
    # (and nowhere near the stub's 1e9) — workspace tampering moved nothing.
    assert score_mean(tampered) == score_mean(honest)
    assert [r["score"] for r in tampered.heldout.results] == [r["score"] for r in honest.heldout.results]
    assert score_mean(tampered) < 1e9


def test_no_policy_node_yields_no_policy_trial(tmp_path):
    if not (GYM_ROOT / "tasks" / "gridrun" / "env.js").exists():
        pytest.skip("gridrun not built yet")

    class EmptyNode(MockNode):
        def run(self, workspace, prompt, budgets):
            meta = super().run(workspace, prompt, budgets)
            (workspace / "policy.js").unlink()
            return meta

    trial = evalkit.run("gridrun", EmptyNode(policy_source="x"), n_heldout=4, runs_dir=tmp_path / "runs")
    assert trial.status == "no_policy"
    assert trial.heldout is None
    analysis = evalkit.analyze(trial)
    assert analysis.status == "no_policy"
    assert analysis.probe == {}
