"""Ingestion of an external manual trial: substrate + prompt consistency checks
and canonical scoring, built from a real arena so the substrate sha is authoritative."""

import json
import shutil
import subprocess
from pathlib import Path

import evalkit
from evalkit.eval.external import canonical_substrate, ingest_external_trial

GYM = Path(__file__).resolve().parents[2] / "gym"
FORGE_GREEDY = (GYM / "tasks" / "forge" / "baselines" / "greedy.js").read_text()


def _build_external_trial(tmp_path, *, bundle_ok=True, prompt="THE PROMPT", policy=FORGE_GREEDY):
    """Make a fake 'external trial' dir: build the real forge arena, copy its
    pinned bundle + a policy + a prompt into a workspace, optionally tampering
    the bundle to simulate a substrate mismatch."""
    arena = tmp_path / "arena"
    subprocess.run(["node", str(GYM / "arena" / "build_arena.js"), "--task", "forge", "--out", str(arena)],
                   check=True, capture_output=True)
    manifest = json.loads((arena / "manifest.json").read_text())
    bundle_file = manifest["bundle_file"]
    ext = tmp_path / "ext-trial"
    ws = ext / "workspace"
    ws.mkdir(parents=True)
    shutil.copy2(arena / bundle_file, ws / bundle_file)
    if not bundle_ok:
        (ws / bundle_file).write_text((ws / bundle_file).read_text() + "\n// tampered\n")
    (ws / "policy.js").write_text(policy)
    (ext / "PROMPT.md").write_text(prompt)
    return ext


def test_canonical_substrate_reports_bundle_and_criterion():
    sub = canonical_substrate("roguelike", GYM)
    assert sub["bundle_file"] == "env.bundle.js"
    assert len(sub["bundle_sha256"]) == 64
    assert sub["criterion"] == {"kind": "win_speed", "cap": 90000}


def test_ingest_consistent_external_trial(tmp_path):
    ext = _build_external_trial(tmp_path, bundle_ok=True, prompt="THE PROMPT")
    rec = ingest_external_trial(ext, task="forge", heldout_seeds=[10001, 10002, 10003],
                                fixed_seeds=[2000, 2001], reference_prompt="THE PROMPT")
    assert rec["substrate"]["match"] is True
    assert rec["prompt"]["match"] is True
    assert rec["consistent"] is True
    assert rec["heldout"]["ok"] and len(rec["heldout"]["results"]) == 3
    assert rec["fixed"]["ok"] and len(rec["fixed"]["results"]) == 2
    # criterion summary present (forge has no win_speed criterion -> 'score' fallback)
    assert rec["criterion"] in ("score", "win_speed")
    assert "clear_rate" in rec["heldout"]["summary"]


def test_ingest_flags_substrate_mismatch(tmp_path):
    ext = _build_external_trial(tmp_path, bundle_ok=False)
    rec = ingest_external_trial(ext, task="forge", heldout_seeds=[10001])
    assert rec["substrate"]["match"] is False
    assert rec["consistent"] is False
    # it still scores (so a mismatched run can be reported, not silently dropped)
    assert rec["heldout"]["ok"]


def test_ingest_flags_prompt_mismatch(tmp_path):
    ext = _build_external_trial(tmp_path, bundle_ok=True, prompt="DIFFERENT PROMPT")
    rec = ingest_external_trial(ext, task="forge", heldout_seeds=[10001],
                                reference_prompt="THE PROMPT")
    assert rec["substrate"]["match"] is True
    assert rec["prompt"]["match"] is False
    assert rec["consistent"] is False


def test_ingest_missing_policy_raises(tmp_path):
    (tmp_path / "empty" / "workspace").mkdir(parents=True)
    try:
        ingest_external_trial(tmp_path / "empty", task="forge", heldout_seeds=[10001])
        assert False, "should raise"
    except FileNotFoundError:
        pass


def test_export():
    assert hasattr(evalkit, "ingest_external_trial")
