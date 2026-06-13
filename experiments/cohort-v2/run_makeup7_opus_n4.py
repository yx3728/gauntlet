"""One more Opus rep to bring Opus to N=4 (everything except Fable at N=4).
SAME frozen draw / prompt / budgets. Usage: python3 run_makeup7_opus_n4.py"""
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
out = evalkit.run_cohort(
    "roguelike",
    [{"name": "opus48", "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-opus-4-8", effort="max")}],
    cohort_name="cohort-v2-n2-makeup7-opus-n4",
    heldout_seeds=frozen,
    concurrency=1,
    prompt=build_prompt(),
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
