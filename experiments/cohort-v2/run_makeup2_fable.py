"""Second clean Fable rep (cohort-v2-n2-makeup2): ONE Fable 5 arm, same frozen
draw / prompt / budgets as the main cohort. Usage: python3 run_makeup2_fable.py"""
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
    [{"name": "fable5", "node": lambda: ClaudeCodeNode(model="claude-fable-5", effort="max"), "reps": 1}],
    cohort_name="cohort-v2-n2-makeup2",
    heldout_seeds=frozen,
    concurrency=1,
    prompt=build_prompt(),
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
