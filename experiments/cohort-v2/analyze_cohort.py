"""Post-cohort analysis: fixed-seed (2000-2029) scoring per arm policy for
manual-trial comparability, the v1-reference rows, condition documentation,
and the final cross-arm tables. All inputs are persisted artifacts.

Usage: python3 experiments/cohort-v2/analyze_cohort.py [cohort_name]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))

import evalkit
from evalkit.eval.criterion import criterion_fn, criterion_summary

FIXED = list(range(2000, 2030))


def main():
    cohort = sys.argv[1] if len(sys.argv) > 1 else "cohort-v2-n2"
    cdir = REPO / "runs" / "cohorts" / cohort
    report = json.loads((cdir / "cohort_report.json").read_text())
    _, fn = criterion_fn(report.get("criterion"))

    # 1. Fixed-seed scoring of every arm policy (manual-trial comparability).
    policies = {}
    for arm, table in report["arms_table"].items():
        for rep in table["reps"]:
            pol = REPO / "runs" / rep["trial"] / "workspace" / "policy.js"
            if pol.exists():
                policies[rep["trial"]] = pol
    fixed_batches = evalkit.cross_score(policies, FIXED, task="roguelike", timeout_s=7200)
    fixed = {name: criterion_summary(br.results, fn) for name, br in fixed_batches.items() if br.ok}
    (cdir / "fixed_2000_2029.json").write_text(
        json.dumps({"seeds": FIXED, "batches": {k: v.to_dict() for k, v in fixed_batches.items()},
                    "summary": fixed}, indent=2))

    # 2. Pool fixed-seed results per ARM (concatenate reps).
    fixed_pooled = {}
    for arm, table in report["arms_table"].items():
        rs = []
        for rep in table["reps"]:
            br = fixed_batches.get(rep["trial"])
            if br and br.ok:
                rs.extend(br.results)
        fixed_pooled[arm] = criterion_summary(rs, fn)

    # 3. v1 references on the frozen draw (already scored pre-cohort).
    v1 = json.loads((cdir / "v1_policies_on_frozen_draw.json").read_text())["summary"]

    # 4. Assemble the final comparison.
    final = {
        "cohort": cohort,
        "frozen_n": report["n_heldout"],
        "arms_frozen": {a: t["pooled_heldout"] for a, t in report["arms_table"].items()},
        "arms_frozen_per_rep": {a: [r["heldout"] for r in t["reps"]] for a, t in report["arms_table"].items()},
        "arms_fixed_2000_2029_pooled": fixed_pooled,
        "v1_policies_on_frozen_draw_CAVEATED": v1,
        "conditions": {a: [r["conditions"] for r in t["reps"]] for a, t in report["arms_table"].items()},
        "condition_diffs": report.get("condition_diffs", {}),
        "total_cost_usd": round(sum(
            (r["conditions"].get("cost_usd") or 0)
            for t in report["arms_table"].values() for r in t["reps"]), 2),
    }
    (cdir / "final_comparison.json").write_text(json.dumps(final, indent=2, default=str))

    print(json.dumps({k: final[k] for k in ("arms_frozen", "arms_fixed_2000_2029_pooled",
                                            "v1_policies_on_frozen_draw_CAVEATED",
                                            "condition_diffs", "total_cost_usd")}, indent=2, default=str))
    print(f"\nwrote {cdir}/final_comparison.json")


if __name__ == "__main__":
    main()
