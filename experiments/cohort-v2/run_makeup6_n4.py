"""Extend Haiku and Sonnet to N=4: 1x Haiku + 1x Sonnet, concurrent, SAME frozen
draw / prompt / budgets. Runs alongside the makeup5 redo wave.
Usage: python3 run_makeup6_n4.py"""
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
sys.path.insert(0, str(REPO / "experiments" / "roguelike-opus48"))
from common import build_prompt
import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets

frozen = json.loads((REPO / "runs" / "cohorts" / "cohort-v2-n2" / "cohort.json").read_text())["heldout_seeds"]
assert len(frozen) == 80
arms = [
    {"name": "haiku45",  "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-haiku-4-5-20251001", effort="max")},
    {"name": "sonnet46", "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-sonnet-4-6", effort="max")},
]
out = evalkit.run_cohort(
    "roguelike", arms,
    cohort_name="cohort-v2-n2-makeup6-n4",
    heldout_seeds=frozen,
    concurrency=2,
    prompt=build_prompt(),
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
