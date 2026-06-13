"""Makeup wave to bring Haiku/Sonnet/Opus to N=3 clean reps each (Fable is
frozen at N=1 — access withdrawn). 1x Haiku + 2x Sonnet + 1x Opus = 4 arms,
concurrency 4, SAME frozen draw / prompt / budgets as the main cohort.

Current clean reps: Haiku 2, Sonnet 1, Opus 2 -> this wave adds 1/2/1.
Usage: python3 run_makeup4_n3.py"""
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
    {"name": "sonnet46", "reps": 2, "node": lambda: ClaudeCodeNode(model="claude-sonnet-4-6", effort="max")},
    {"name": "opus48",   "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-opus-4-8", effort="max")},
]
out = evalkit.run_cohort(
    "roguelike", arms,
    cohort_name="cohort-v2-n2-makeup4-n3",
    heldout_seeds=frozen,
    concurrency=4,
    prompt=build_prompt(),
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
