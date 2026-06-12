"""Shared pieces of the roguelike-opus48 experiment: prompt assembly, the
eval_score comparable (Step 3), and win-step statistics.

The eval comparable is deliberately computed HERE (post-hoc, from gauntlet's
persisted per-seed results) and never shown to the subject during play.
"""

from __future__ import annotations

import hashlib
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))

CAP = 90000
PROMPT_BASE_SHA256 = "aac306f538ee3b71d19447e07f7fc5a1d155a72daccc439d52320d24f8ccf9f0"
MANUAL_HELDOUT_SEEDS = list(range(2000, 2030))  # the manual trial's fixed held-out set


def build_prompt() -> str:
    """The v2 T1 prompt VERBATIM (sha-checked) + the one deliberate addition."""
    base = (HERE / "PROMPT.base.md").read_bytes()
    if hashlib.sha256(base).hexdigest() != PROMPT_BASE_SHA256:
        raise RuntimeError("PROMPT.base.md no longer matches template v2 — STOP (silent drift)")
    return base.decode() + "\n" + (HERE / "PROMPT.scoring.md").read_text()


def eval_score(result: dict, cap: int = CAP) -> float:
    """Step-3 comparable: wins in (1, 2] (earlier = higher); non-wins = progress in [0, 1)."""
    if result.get("done_reason") == "win":
        win_step = result.get("win_step") or result.get("steps")
        return 1.0 + (cap - win_step) / cap
    return float(result.get("progress") or 0.0)


def heldout_table(results: list[dict], cap: int = CAP) -> dict:
    """The aggregate gauntlet reports for this trial (Step 3)."""
    n = max(1, len(results))
    wins = [r for r in results if r.get("done_reason") == "win"]
    win_steps = sorted((r.get("win_step") or r.get("steps")) for r in wins)
    scores = [eval_score(r, cap) for r in results]
    out = {
        "n_seeds": len(results),
        "clear_rate": round(len(wins) / n, 4),
        "clears": len(wins),
        "eval_score_mean": round(statistics.mean(scores), 4) if scores else 0.0,
        "eval_score_median": round(statistics.median(scores), 4) if scores else 0.0,
        "done_reason_rates": {},
        "progress_mean": round(statistics.mean(float(r.get("progress") or 0) for r in results), 4) if results else 0.0,
    }
    reasons: dict[str, int] = {}
    for r in results:
        key = str(r.get("done_reason"))
        reasons[key] = reasons.get(key, 0) + 1
    out["done_reason_rates"] = {k: round(c / n, 4) for k, c in sorted(reasons.items())}
    if wins:
        out["win_step_mean"] = round(statistics.mean(win_steps), 1)
        out["win_step_median"] = statistics.median(win_steps)
        out["win_step_min"] = win_steps[0]
        out["win_step_max"] = win_steps[-1]
        out["win_steps"] = win_steps
    return out
