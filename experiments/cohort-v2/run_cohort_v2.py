"""Phase B — the first parallel cohort: roguelike × {Haiku 4.5, Sonnet 4.6,
Opus 4.8, Fable 5} × N=2 reps, concurrency 4, through gauntlet v2.

Task/substrate/prompt/criterion UNCHANGED from v1 (the prompt builder is the
v1 experiment's sha-gated assembler — byte-identical base + the same scoring
section). The frozen shared held-out draw (n=80) is drawn ONCE by run_cohort
and persisted before any arm starts. No artificial horizon: 8h/2000-turn
runaway backstops only.

Usage: python3 experiments/cohort-v2/run_cohort_v2.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
sys.path.insert(0, str(REPO / "experiments" / "roguelike-opus48"))  # v1 prompt assembler

from common import build_prompt  # sha-gated: refuses on any drift from template v2

import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets

COHORT = "cohort-v2-n2"
MODELS = {
    "haiku45": "claude-haiku-4-5-20251001",
    "sonnet46": "claude-sonnet-4-6",
    "opus48": "claude-opus-4-8",
    "fable5": "claude-fable-5",
}


def main():
    prompt = build_prompt()
    budgets = NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000)  # backstops, not budgets

    arms = [
        {"name": name, "reps": 2, "node": (lambda m=model: ClaudeCodeNode(model=m, effort="max"))}
        for name, model in MODELS.items()
    ]

    print(f"=== {COHORT}: roguelike x {list(MODELS)} x2, concurrency 4, frozen draw n=80 ===", flush=True)
    out = evalkit.run_cohort(
        "roguelike",
        arms,
        cohort_name=COHORT,
        n_heldout=80,
        concurrency=4,
        prompt=prompt,
        budgets=budgets,
        runs_dir=REPO / "runs",
        batch_timeout_s=7200,
    )
    report = out["report"]
    print(f"cohort dir: {out['cohort_dir']}")
    print((out["cohort_dir"] / "COHORT.md").read_text())
    if report.get("errors"):
        print("ARM ERRORS:", json.dumps(report["errors"], default=str)[:2000])
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
