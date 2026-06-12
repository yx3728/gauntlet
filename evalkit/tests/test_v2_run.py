"""v2 lifecycle tests: out-of-repo workspaces, crash-safe persistence + resume,
telemetry/provenance into trial.json, new audit rules, criterion-aware analyze."""

import json
from pathlib import Path

import pytest

import evalkit
from evalkit.agents import MockNode, NodeBudgets
from evalkit.eval.audit import audit_trace

GYM_ROOT = Path(__file__).resolve().parents[2] / "gym"
GREEDY = GYM_ROOT / "tasks" / "forge" / "baselines" / "greedy.js"


def make_node():
    return MockNode(policy_source=GREEDY.read_text())


@pytest.fixture()
def ws_root(tmp_path):
    return tmp_path / "neutral-ws"


def test_workspace_outside_repo_and_copied_back(tmp_path, ws_root):
    trial = evalkit.run("forge", make_node(), n_heldout=4,
                        runs_dir=tmp_path / "runs", workspace_root=ws_root)
    # Copied back into the trial dir; neutral dir removed after collection.
    assert (trial.trial_dir / "workspace" / "policy.js").exists()
    assert (trial.trial_dir / "trace.jsonl").exists()
    assert not any(ws_root.iterdir()) or not (ws_root / trial.trial_dir.name).exists()
    # trial.json: complete, provenance stamped at run start, telemetry present.
    t = json.loads((trial.trial_dir / "trial.json").read_text())
    assert t["status"] == "complete"
    assert "started_at" in t["provenance"]
    tm = t["node"]["meta"]["trace_meta"]
    assert tm["session"]["session_id"] == "mock-session"
    assert tm["total_cost_usd"] == 0.0
    # Registry line appended.
    reg = [json.loads(l) for l in (tmp_path / "runs" / "registry.jsonl").read_text().splitlines()]
    assert any(r["name"] == trial.trial_dir.name and r["status"] == "complete" for r in reg)


def test_workspace_root_inside_repo_is_refused(tmp_path):
    repo_ws = Path(__file__).resolve().parents[2] / "runs" / "_test_ws_refuse"
    with pytest.raises(RuntimeError, match="inside a git repo"):
        evalkit.run("forge", make_node(), n_heldout=2,
                    runs_dir=tmp_path / "runs", workspace_root=repo_ws)


class CrashNode(MockNode):
    """Writes its policy, then the orchestrator 'dies' (raises)."""

    def run(self, workspace, prompt, budgets):
        super().run(workspace, prompt, budgets)
        raise RuntimeError("simulated orchestrator crash mid-trial")


def test_crash_then_resume_completes_scoring(tmp_path, ws_root):
    runs = tmp_path / "runs"
    with pytest.raises(RuntimeError, match="simulated orchestrator crash"):
        evalkit.run("forge", CrashNode(policy_source=GREEDY.read_text()), n_heldout=4,
                    runs_dir=runs, workspace_root=ws_root, trial_name="crash-trial")
    trial_dir = runs / "crash-trial"
    # Crash-safe early persist: running status + the full split exist on disk.
    t = json.loads((trial_dir / "trial.json").read_text())
    assert t["status"] == "running"
    assert len(t["split"]["heldout"]) == 4
    # The neutral workspace (with the policy) survived the crash.
    assert (Path(t["workspace_parent"]) / "workspace" / "policy.js").exists()

    trial = evalkit.resume(trial_dir)
    assert trial.status == "complete"
    assert trial.heldout is not None and trial.heldout.ok
    assert [r["seed"] for r in trial.heldout.results] == t["split"]["heldout"]
    t2 = json.loads((trial_dir / "trial.json").read_text())
    assert t2["status"] == "complete"
    assert "resumed_at" in t2["provenance"]
    # The collected workspace is now in the trial dir; neutral dir gone.
    assert (trial_dir / "workspace" / "policy.js").exists()
    assert not Path(t["workspace_parent"]).exists()


def test_resume_on_complete_trial_is_a_noop_load(tmp_path, ws_root):
    trial = evalkit.run("forge", make_node(), n_heldout=3,
                        runs_dir=tmp_path / "runs", workspace_root=ws_root)
    again = evalkit.resume(trial.trial_dir)
    assert again.status == "complete"
    assert again.heldout.results == trial.heldout.results


def test_criterion_seam_drives_analyze_for_declaring_tasks(tmp_path, ws_root):
    # roguelike declares win_speed; the mock policy (forge greedy) won't win, but
    # the analysis must carry the criterion block computed on the declared kind.
    rl_greedy = GYM_ROOT / "tasks" / "roguelike" / "baselines" / "noop.js"
    trial = evalkit.run("roguelike", MockNode(policy_source=rl_greedy.read_text()),
                        heldout_seeds=[2000, 2001], runs_dir=tmp_path / "runs",
                        workspace_root=ws_root, batch_timeout_s=3600)
    analysis = evalkit.analyze(trial)
    assert analysis.criterion["kind"] == "win_speed"
    ch = analysis.criterion["heldout"]
    assert ch["n"] == 2 and 0 <= ch["mean"] < 1  # noop never wins -> progress values
    assert "clear_rate_wilson95" in ch
    assert analysis.criterion["gap"] is not None
    # Fallback: forge declares no criterion -> kind "score".
    trial2 = evalkit.run("forge", make_node(), n_heldout=2,
                         runs_dir=tmp_path / "runs", workspace_root=ws_root)
    a2 = evalkit.analyze(trial2)
    assert a2.criterion["kind"] == "score"


def write_trace(tmp_path, tool_uses):
    p = tmp_path / "t.jsonl"
    events = [{"type": "system", "subtype": "init"}]
    for tu in tool_uses:
        events.append({"type": "assistant", "message": {"content": [dict(tu, type="tool_use")]}})
    events.append({"type": "result", "subtype": "success"})
    p.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return p


def test_audit_vcs_in_nonrepo_workspace_flagged(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    a = audit_trace(write_trace(tmp_path, [
        {"name": "Bash", "input": {"command": "git log --oneline -5"}},
        {"name": "Bash", "input": {"command": "git ls-files | head -20"}},
    ]), ws)
    assert sum(1 for f in a["findings"] if f["rule"] == "vcs_in_nonrepo_workspace") == 2
    assert a["verdict"] == "review"
    # ... but a workspace that IS a repo (agent ran `git init`) is not flagged.
    (ws / ".git").mkdir()
    a2 = audit_trace(write_trace(tmp_path, [{"name": "Bash", "input": {"command": "git log"}}]), ws)
    assert not any(f["rule"] == "vcs_in_nonrepo_workspace" for f in a2["findings"])


def test_audit_unexpected_tool_rule(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    trace = write_trace(tmp_path, [
        {"name": "Bash", "input": {"command": "ls"}},
        {"name": "TaskOutput", "input": {}},   # harness-internal: allowed
        {"name": "NotebookEdit", "input": {}}, # outside allowlist+internal: review
    ])
    a = audit_trace(trace, ws, allowed_tools=("Bash", "Read", "Write", "Edit", "Glob", "Grep"))
    rules = [f["rule"] for f in a["findings"]]
    assert rules.count("unexpected_tool") == 1
    assert any(f["detail"] == "NotebookEdit" for f in a["findings"])
    # Without allowed_tools the rule is off (backward compatible).
    a2 = audit_trace(trace, ws)
    assert not any(f["rule"] == "unexpected_tool" for f in a2["findings"])


def test_audit_own_scratch_downgraded_to_info(tmp_path):
    """The v1 false-positive classes: /tmp self-scratch and the session's own
    ~/.claude/projects/<slug>/ dirs must not drive the verdict."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    slug = str(ws.resolve()).replace("/", "-")
    own_claude = f"{Path.home()}/.claude/projects/{slug}/tool-results/x.txt"
    a = audit_trace(write_trace(tmp_path, [
        {"name": "Read", "input": {"file_path": "/tmp/eval24.txt"}},
        {"name": "Read", "input": {"file_path": own_claude}},
    ]), ws)
    assert a["verdict"] == "clean", a["findings"]
    assert sum(1 for f in a["findings"] if f["rule"] == "own_session_scratch_read") == 2
    assert not any(f["rule"] == "credential_access" for f in a["findings"])
    # A FOREIGN session's .claude dir is still credential-flagged.
    foreign = f"{Path.home()}/.claude/projects/-some-other-session/tool-results/x.txt"
    a2 = audit_trace(write_trace(tmp_path, [{"name": "Read", "input": {"file_path": foreign}}]), ws)
    assert any(f["rule"] == "credential_access" for f in a2["findings"])
