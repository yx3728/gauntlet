"""Real-agent e2e — run SPARINGLY (each run is a real `claude -p` session).

One black-box claude-code node per task: it gets the arena workspace + the
task-agnostic prompt, writes a policy, and is scored on held-out seeds.
Running it on both games with the unchanged prompt is the real-agent
portability proof.

Usage:  python3 examples/real_e2e.py [task ...]      (default: gridrun)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets


def main() -> int:
    tasks = sys.argv[1:] or ["gridrun"]
    node = ClaudeCodeNode(model="sonnet", effort="high")
    budgets = NodeBudgets(wall_clock_s=900, max_turns=60, attempts=8)
    failures = 0
    for task in tasks:
        print(f"=== real e2e: {task} / {node.name} (wall {budgets.wall_clock_s}s, turns {budgets.max_turns}) ===", flush=True)
        trial = evalkit.run(task, node, budgets=budgets)
        print(f"trial dir: {trial.trial_dir}")
        print(f"node status: {trial.node.status} in {trial.node.wall_ms}ms; trial status: {trial.status}; audit: {trial.audit['verdict']}")
        if trial.status != "complete":
            failures += 1
            continue
        analysis = evalkit.analyze(trial)
        print(analysis.render(), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
