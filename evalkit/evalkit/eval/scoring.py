"""scoring.py — task-agnostic summarization of batch results.

Mirrors the gym's aggregate-by-introspection (numbers -> distributions,
booleans -> rates, done_reason -> rates) and adds stdev. Never names a
task-specific metric.
"""

from __future__ import annotations

import statistics

SKIP_KEYS = {"seed", "events", "policy_error", "done_reason", "_gamelog"}


def _dist(vals: list[float]) -> dict:
    vs = sorted(vals)
    return {
        "mean": round(statistics.mean(vs), 4),
        "median": round(statistics.median(vs), 4),
        "stdev": round(statistics.pstdev(vs), 4) if len(vs) > 1 else 0.0,
        "min": vs[0],
        "max": vs[-1],
    }


def summarize(results: list[dict]) -> dict:
    """Distribution summary over per-seed episode results (the metrics envelope)."""
    out: dict = {"n": len(results)}
    if not results:
        return out

    numeric: set[str] = set()
    boolean: set[str] = set()
    for r in results:
        for k, v in r.items():
            if k in SKIP_KEYS:
                continue
            if isinstance(v, bool):
                boolean.add(k)
            elif isinstance(v, (int, float)):
                numeric.add(k)

    n = len(results)
    for k in sorted(numeric):
        out[k] = _dist([float(r.get(k) or 0) for r in results])
    for k in sorted(boolean):
        out[f"{k}_rate"] = round(sum(1 for r in results if r.get(k)) / n, 4)

    reasons: dict[str, int] = {}
    for r in results:
        key = "none" if r.get("done_reason") is None else str(r["done_reason"])
        reasons[key] = reasons.get(key, 0) + 1
    out["done_reason_rates"] = {k: round(c / n, 4) for k, c in sorted(reasons.items())}
    out["policy_error_rate"] = round(sum(1 for r in results if r.get("policy_error")) / n, 4)
    return out
