"""The per-batch Lib1<->Lib2 boundary, exercised against the REAL JS runner
and the minitask fixture (fast: episodes are milliseconds)."""

import pytest

from evalkit.boundary import run_policy_batch


def test_repo_mode_batch_against_minitask(minitask_path, tmp_policy):
    policy = tmp_policy()
    br = run_policy_batch(policy, [1, 2, 3], task=str(minitask_path))
    assert br.ok, br.error
    assert br.task["id"] == "minitask"
    assert br.task["bundle_sha"] and br.task["bundle_sha"] != "unknown"
    assert br.seeds == [1, 2, 3]
    assert len(br.results) == 3
    for r in br.results:
        assert isinstance(r["score"], (int, float))
        assert 0 <= r["progress"] <= 1
        assert r["done_reason"] in ("win", "death", "timeout")
    assert br.aggregate["n"] == 3
    assert "done_reason_rates" in br.aggregate


def test_batch_is_deterministic(minitask_path, tmp_policy):
    policy = tmp_policy()
    a = run_policy_batch(policy, [5, 6], task=str(minitask_path))
    b = run_policy_batch(policy, [5, 6], task=str(minitask_path))
    assert a.ok and b.ok
    assert a.results == b.results


def test_crashing_policy_is_contained(minitask_path, tmp_policy):
    policy = tmp_policy("module.exports = { policy: () => { throw new Error('dead'); } };\n")
    br = run_policy_batch(policy, [1], task=str(minitask_path))
    assert br.ok  # failure is data, not an orchestration error
    assert "dead" in br.results[0]["policy_error"]
    assert br.aggregate["policy_error_rate"] == 1


def test_missing_policy_reports_error(minitask_path, tmp_path):
    br = run_policy_batch(tmp_path / "nope.js", [1], task=str(minitask_path))
    assert not br.ok
    assert "policy not found" in br.error


def test_bad_task_reports_error(tmp_policy):
    br = run_policy_batch(tmp_policy(), [1], task="no-such-task")
    assert not br.ok
    assert br.error


def test_mode_arguments_are_exclusive(tmp_policy):
    with pytest.raises(ValueError):
        run_policy_batch(tmp_policy(), [1])
    with pytest.raises(ValueError):
        run_policy_batch(tmp_policy(), [1], task="x", arena_dir="/tmp")
