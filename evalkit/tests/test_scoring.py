import pytest

import evalkit
from evalkit.eval.probe import baseline_position, diagnostic_probe, failure_breakdown, generalization_gap
from evalkit.eval.scoring import summarize

RESULTS = [
    {"seed": 2000, "steps": 10, "score": 100, "progress": 0.5, "done_reason": "win", "cleared": True},
    {"seed": 2001, "steps": 20, "score": 300, "progress": 1.0, "done_reason": "win", "cleared": True},
    {"seed": 2002, "steps": 30, "score": 0, "progress": 0.0, "done_reason": "timeout", "cleared": False, "policy_error": "boom"},
    {"seed": 2003, "steps": 40, "score": 100, "progress": 0.25, "done_reason": "death", "cleared": False},
]


def test_summarize_distributions_and_rates():
    s = summarize(RESULTS)
    assert s["n"] == 4
    assert s["score"]["mean"] == 125
    assert s["score"]["min"] == 0 and s["score"]["max"] == 300
    assert s["score"]["stdev"] > 0
    assert s["cleared_rate"] == 0.5
    assert s["done_reason_rates"] == {"win": 0.5, "timeout": 0.25, "death": 0.25}
    assert s["policy_error_rate"] == 0.25
    assert "done_reason" not in s  # not a numeric field
    assert summarize([]) == {"n": 0}


def test_generalization_gap():
    training = [{"score": 200, "progress": 1.0}, {"score": 200, "progress": 1.0}]
    gap = generalization_gap(RESULTS, training)
    assert gap["training"]["score_mean"] == 200
    assert gap["heldout"]["score_mean"] == 125
    assert gap["score_gap"] == 75
    assert gap["relative_score_gap"] == 0.375


def test_failure_breakdown_worst_seeds():
    fb = failure_breakdown(RESULTS, worst_k=2)
    assert fb["policy_error_count"] == 1
    assert [w["seed"] for w in fb["worst_seeds"]] == [2002, 2003]
    assert fb["done_reason_rates"]["win"] == 0.5
    assert set(fb["progress_quartiles"]) == {"p25", "p50", "p75"}


def test_baseline_position_normalization():
    baselines = {
        "noop": [{"score": 25}],
        "greedy": [{"score": 225}],
    }
    bp = baseline_position(RESULTS, baselines)
    # (125 - 25) / (225 - 25) = 0.5
    assert bp["normalized_vs_baselines"] == 0.5
    assert bp["above_noop"] is True
    assert bp["above_greedy"] is False


def test_diagnostic_probe_shape():
    p = diagnostic_probe(RESULTS, [{"score": 100, "progress": 0.5}], {"noop": [{"score": 10}]})
    assert set(p) == {"generalization_gap", "failure_breakdown", "baseline_position"}


def test_summarize_agrees_with_js_aggregate(minitask_path, tmp_policy):
    """Parity: Python summarize() over a REAL batch must agree with the JS
    runner's aggregate on every distribution and rate it shares (even seed
    count so the median check exercises the true even-n median)."""
    br = evalkit.score_policy(tmp_policy(), [1, 2, 3, 4, 5, 6], task=str(minitask_path))
    assert br.ok, br.error
    s = summarize(br.results)
    agg = br.aggregate
    assert s["n"] == agg["n"] == 6

    dist_keys = {k for k, v in agg.items() if isinstance(v, dict) and "mean" in v}
    assert {"score", "progress"} <= dist_keys
    assert dist_keys == {k for k, v in s.items() if isinstance(v, dict) and "mean" in v}
    for k in sorted(dist_keys):
        assert s[k]["mean"] == pytest.approx(agg[k]["mean"], abs=2e-4), k
        assert s[k]["min"] == agg[k]["min"], k
        assert s[k]["max"] == agg[k]["max"], k
        assert s[k]["median"] == pytest.approx(agg[k]["median"], abs=2e-4), k

    rate_keys = {k for k in agg if k.endswith("_rate")}
    assert rate_keys == {k for k in s if k.endswith("_rate")}
    for k in sorted(rate_keys):
        assert s[k] == pytest.approx(agg[k], abs=2e-4), k
    assert s["done_reason_rates"] == pytest.approx(agg["done_reason_rates"], abs=2e-4)
