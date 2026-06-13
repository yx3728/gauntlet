"""Makeup wave for cohort-v2-n2: ONE Sonnet 4.6 + ONE Fable 5 arm, concurrent
(concurrency 2), SAME frozen draw / prompt / budgets as the main cohort.
Replaces the limit-killed sonnet46-r2 and the operator-killed fable arms
(their records stay untouched — never delete).

Usage: python3 experiments/cohort-v2/run_makeup.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
sys.path.insert(0, str(REPO / "experiments" / "roguelike-opus48"))

from common import build_prompt  # sha-gated v1 prompt assembler

import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets


def main():
    frozen = json.loads((REPO / "runs" / "cohorts" / "cohort-v2-n2" / "cohort.json").read_text())["heldout_seeds"]
    assert len(frozen) == 80
    out = evalkit.run_cohort(
        "roguelike",
        [
            {"name": "sonnet46", "node": lambda: ClaudeCodeNode(model="claude-sonnet-4-6", effort="max"), "reps": 1},
            {"name": "fable5", "node": lambda: ClaudeCodeNode(model="claude-fable-5", effort="max"), "reps": 1},
        ],
        cohort_name="cohort-v2-n2-makeup",
        heldout_seeds=frozen,  # the SAME frozen exam as the main cohort
        concurrency=2,
        prompt=build_prompt(),
        budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
        runs_dir=REPO / "runs",
        batch_timeout_s=7200,
    )
    print((out["cohort_dir"] / "COHORT.md").read_text())
    return 1 if out["report"].get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
