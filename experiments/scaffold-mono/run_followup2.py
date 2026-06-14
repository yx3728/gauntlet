"""User-directed 2nd follow-up: 2 Opus + 1 Haiku + 1 Sonnet, concurrent, frozen
n=80 draw + scaffold-mono (+cognitive) prompt. Brings +cognitive arms toward
N=3 each. Usage: python3 run_followup2.py"""
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
import evalkit
from evalkit.agents import ClaudeCodeNode, NodeBudgets

frozen = json.loads((REPO / "runs" / "cohorts" / "cohort-v2-n2" / "cohort.json").read_text())["heldout_seeds"]
assert len(frozen) == 80
prompt = (HERE / "PROMPT.md").read_text()

out = evalkit.run_cohort(
    "roguelike",
    [
        {"name": "opus48",   "reps": 2, "node": lambda: ClaudeCodeNode(model="claude-opus-4-8", effort="max")},
        {"name": "haiku45",  "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-haiku-4-5-20251001", effort="max")},
        {"name": "sonnet46", "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-sonnet-4-6", effort="max")},
    ],
    cohort_name="cohort-v2-cog-followup2",
    heldout_seeds=frozen,
    concurrency=4,
    prompt=prompt,
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
