"""probe.py — the diagnostic probe: localizes WHY a policy fails, not just how
much it scores. Three task-agnostic lenses over the metrics envelope:

  - generalization gap: training-seed vs held-out performance (overfitting);
  - failure breakdown: done_reason mix, progress quartiles, worst seeds,
    policy errors (where episodes end);
  - baseline position: where the policy sits between the noop floor and the
    greedy reference ((policy - noop) / (greedy - noop)).
"""

from __future__ import annotations

import statistics


def _mean(results: list[dict], key: str) -> float:
    if not results:
        return 0.0
    return statistics.mean(float(r.get(key) or 0) for r in results)


def _quartiles(vals: list[float]) -> dict:
    if not vals:
        return {"p25": 0, "p50": 0, "p75": 0}
    q = statistics.quantiles(vals, n=4, method="inclusive") if len(vals) > 1 else [vals[0]] * 3
    return {"p25": round(q[0], 4), "p50": round(q[1], 4), "p75": round(q[2], 4)}


def generalization_gap(heldout_results: list[dict], training_results: list[dict]) -> dict:
    t_score, h_score = _mean(training_results, "score"), _mean(heldout_results, "score")
    t_prog, h_prog = _mean(training_results, "progress"), _mean(heldout_results, "progress")
    return {
        "training": {"n": len(training_results), "score_mean": round(t_score, 4), "progress_mean": round(t_prog, 4)},
        "heldout": {"n": len(heldout_results), "score_mean": round(h_score, 4), "progress_mean": round(h_prog, 4)},
        "score_gap": round(t_score - h_score, 4),
        "progress_gap": round(t_prog - h_prog, 4),
        # > 0 means the policy does worse on unseen seeds (overfit signal).
        "relative_score_gap": round((t_score - h_score) / abs(t_score), 4) if t_score else 0.0,
    }


def failure_breakdown(heldout_results: list[dict], worst_k: int = 3) -> dict:
    n = max(1, len(heldout_results))
    reasons: dict[str, int] = {}
    for r in heldout_results:
        key = "none" if r.get("done_reason") is None else str(r["done_reason"])
        reasons[key] = reasons.get(key, 0) + 1
    by_progress = sorted(heldout_results, key=lambda r: float(r.get("progress") or 0))
    return {
        "done_reason_rates": {k: round(c / n, 4) for k, c in sorted(reasons.items())},
        "policy_error_count": sum(1 for r in heldout_results if r.get("policy_error")),
        "progress_quartiles": _quartiles([float(r.get("progress") or 0) for r in heldout_results]),
        "worst_seeds": [
            {"seed": r.get("seed"), "progress": r.get("progress"), "done_reason": r.get("done_reason")}
            for r in by_progress[:worst_k]
        ],
    }


def baseline_position(heldout_results: list[dict], baseline_results: dict[str, list[dict]]) -> dict:
    """Normalize the policy's held-out score between the noop floor and the
    greedy reference. Extra baselines are reported as raw means."""
    policy = _mean(heldout_results, "score")
    means = {name: round(_mean(res, "score"), 4) for name, res in baseline_results.items()}
    out: dict = {"policy_score_mean": round(policy, 4), "baseline_score_means": means}
    noop, greedy = means.get("noop"), means.get("greedy")
    if noop is not None and greedy is not None and greedy != noop:
        out["normalized_vs_baselines"] = round((policy - noop) / (greedy - noop), 4)
    if noop is not None:
        out["above_noop"] = policy > noop
    if greedy is not None:
        out["above_greedy"] = policy > greedy
    return out


def diagnostic_probe(
    heldout_results: list[dict],
    training_results: list[dict],
    baseline_results: dict[str, list[dict]],
) -> dict:
    return {
        "generalization_gap": generalization_gap(heldout_results, training_results),
        "failure_breakdown": failure_breakdown(heldout_results),
        "baseline_position": baseline_position(heldout_results, baseline_results),
    }
