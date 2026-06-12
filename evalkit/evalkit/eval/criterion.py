"""criterion.py — the task-owned eval comparable (v2 fix #4: the criterion seam).

v1 lesson: the real comparable (win-first/win-speed eval_score) lived in
experiment scripts while evalkit's generic probe ran on the farmable raw score,
producing a false overfit alarm. Tasks now DECLARE their criterion in meta
(carried through the arena manifest); evalkit computes it everywhere the
comparable matters, falling back to raw score when absent.

Declarative on purpose: the spec is JSON in task meta (the gym stays JS, the
analysis stays Python), and the criterion is NEVER shown during play — it is
post-processing over the persisted metrics envelope. Semantics of "win_speed"
are byte-identical to the v1 experiment's eval_score:

    win  -> 1 + (cap - win_step) / cap        in (1, 2], earlier = higher
    else -> progress                          in [0, 1), below every win
"""

from __future__ import annotations

import statistics


def wilson95(k: int, n: int) -> tuple[float, float]:
    """95% Wilson score interval for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    z = 1.959963984540054
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z / denom) * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5)
    return (round(max(0.0, center - half), 4), round(min(1.0, center + half), 4))


def _win_speed(spec: dict):
    cap = int(spec.get("cap") or 0)
    if cap <= 0:
        raise ValueError("win_speed criterion requires a positive 'cap'")

    def fn(result: dict) -> float:
        if result.get("done_reason") == "win":
            win_step = result.get("win_step") or result.get("steps")
            return 1.0 + (cap - win_step) / cap
        return float(result.get("progress") or 0.0)

    return fn


def _raw_score(_spec: dict):
    def fn(result: dict) -> float:
        return float(result.get("score") or 0.0)

    return fn


KINDS = {"win_speed": _win_speed, "score": _raw_score}


def criterion_fn(spec: dict | None):
    """(name, callable) for a criterion spec; falls back to raw score."""
    if not spec or not isinstance(spec, dict):
        return "score", _raw_score({})
    kind = spec.get("kind", "score")
    if kind not in KINDS:
        raise ValueError(f"unknown criterion kind '{kind}' (known: {sorted(KINDS)})")
    return kind, KINDS[kind](spec)


def criterion_summary(results: list[dict], fn) -> dict:
    """Distribution of the comparable + the rate-like facts every comparison
    needs (clear rate with Wilson CI, win_step stats among clears)."""
    n = len(results)
    out: dict = {"n": n}
    if not n:
        return out
    values = [fn(r) for r in results]
    wins = [r for r in results if r.get("done_reason") == "win"]
    win_steps = sorted((r.get("win_step") or r.get("steps")) for r in wins)
    out.update(
        mean=round(statistics.mean(values), 4),
        median=round(statistics.median(values), 4),
        min=round(min(values), 4),
        max=round(max(values), 4),
        clears=len(wins),
        clear_rate=round(len(wins) / n, 4),
        clear_rate_wilson95=wilson95(len(wins), n),
    )
    if win_steps:
        out["win_step"] = {
            "mean": round(statistics.mean(win_steps), 1),
            "median": statistics.median(win_steps),
            "min": win_steps[0],
            "max": win_steps[-1],
        }
    return out
