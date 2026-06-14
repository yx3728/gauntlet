"""Promising-path follow-up: 1 Haiku + 1 Sonnet + 1 Opus, concurrent, frozen n=80
draw + scaffold-mono (+cognitive) prompt. Opus tests whether the cognitive
structure pays off where coder execution is NOT the bottleneck. Usage: python3 run_followup.py"""
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
        {"name": "haiku45",  "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-haiku-4-5-20251001", effort="max")},
        {"name": "sonnet46", "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-sonnet-4-6", effort="max")},
        {"name": "opus48",   "reps": 1, "node": lambda: ClaudeCodeNode(model="claude-opus-4-8", effort="max")},
    ],
    cohort_name="cohort-v2-cog-followup",
    heldout_seeds=frozen,
    concurrency=3,
    prompt=prompt,
    budgets=NodeBudgets(wall_clock_s=8 * 3600, max_turns=2000),
    runs_dir=REPO / "runs",
    batch_timeout_s=7200,
)
print((out["cohort_dir"] / "COHORT.md").read_text())
sys.exit(1 if out["report"].get("errors") else 0)
