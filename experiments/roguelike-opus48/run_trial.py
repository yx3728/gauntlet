"""One real trial: a single Claude node (model/effort from argv) on the
roguelike, end-to-end through gauntlet, NO artificial horizon (8h wall / 2000
turns are RUNAWAY BACKSTOPS only — the prompt's "no budget" promise is
operative; the session ends when the agent finishes its deliverables).

All trials in the series run under IDENTICAL conditions; only the model
differs.

Usage: python3 experiments/roguelike-opus48/run_trial.py [model] [trial_name]
       (default: claude-opus-4-8 roguelike-opus48-max)
"""

from __future__ import annotations

import json
import sys

from common import REPO, build_prompt, heldout_table

import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "claude-opus-4-8"
    trial_name = sys.argv[2] if len(sys.argv) > 2 else "roguelike-opus48-max"
    node = ClaudeCodeNode(model=model, effort="max")
    budgets = NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000)  # backstops, not budgets
    prompt = build_prompt()

    print(f"=== roguelike x {node.name} through gauntlet (backstop {budgets.wall_clock_s}s / {budgets.max_turns} turns) ===", flush=True)
    trial = evalkit.run(
        "roguelike",
        node,
        budgets=budgets,
        prompt=prompt,
        runs_dir=REPO / "runs",
        trial_name=trial_name,
        batch_timeout_s=7200,
    )
    print(f"trial dir: {trial.trial_dir}")
    print(f"node status: {trial.node.status} in {trial.node.wall_ms / 1000 / 60:.1f} min; trial: {trial.status}; audit: {trial.audit['verdict']}")
    if trial.node.report:
        print("subject report.json:", json.dumps(trial.node.report, ensure_ascii=False)[:1200])

    if trial.status == "complete":
        analysis = evalkit.analyze(trial)
        print(analysis.render())
        table = heldout_table(trial.heldout.results)
        print("eval-comparable table (canonical held-out):", json.dumps(table, indent=2))
        (trial.trial_dir / "eval_score_table.json").write_text(json.dumps(table, indent=2))
    return 0 if trial.status == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
