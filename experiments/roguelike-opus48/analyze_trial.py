"""Post-run analysis for the roguelike-opus48 trial (Step 5 inputs).

Produces, from gauntlet's persisted artifacts:
  - the canonical held-out eval-comparable table (clear_rate, eval_score, win_step stats);
  - a SECONDARY scoring of the final policy on the manual trial's fixed seeds
    2000-2029 at 40/90k (direct comparability with the manual baseline numbers);
  - train-vs-held-out comparison (the overfit signal);
  - the comparison row against the manual ladder-t1 baseline.

Usage: python3 experiments/roguelike-opus48/analyze_trial.py [trial_dir]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from common import CAP, MANUAL_HELDOUT_SEEDS, REPO, eval_score, heldout_table

import evalkit


def main():
    trial_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "runs" / "roguelike-opus48-max"
    trial = evalkit.Trial.from_dir(trial_dir)
    analysis = evalkit.analyze(trial)
    print(analysis.render())

    out: dict = {"trial_dir": str(trial_dir), "node": trial.node.to_dict(), "audit": trial.audit["verdict"]}

    # 1. Canonical held-out (the unpredictable draw) — the primary table.
    canonical = heldout_table(trial.heldout.results)
    out["canonical_heldout"] = canonical
    print("canonical held-out:", json.dumps(canonical, indent=2))

    # 2. Secondary: the manual trial's fixed seeds 2000-2029, same canonical substrate.
    br = evalkit.score_policy(trial.node.policy_path, MANUAL_HELDOUT_SEEDS, task="roguelike", timeout_s=7200)
    assert br.ok, br.error
    fixed = heldout_table(br.results)
    out["fixed_2000_2029"] = fixed
    (trial_dir / "heldout_fixed_2000_2029.json").write_text(json.dumps(br.to_dict(), indent=2))
    print("fixed 2000-2029:", json.dumps(fixed, indent=2))

    # 3. Train vs held-out (overfit signal) on clear-rate and win_step.
    train = heldout_table(trial.training.results)
    out["training"] = train
    print("training seeds:", json.dumps(train, indent=2))

    # 4. Baselines (canonical seeds).
    out["baselines"] = {name: heldout_table(b.results) for name, b in trial.baselines.items() if b.ok}

    # 5. The manual-policy same-regime baseline (computed pre-run).
    mp = json.loads((Path(__file__).parent / "manual_policy_at_40_90k.json").read_text())
    out["manual_ladder_t1_policy_at_40_90k"] = heldout_table(mp["results"])

    (trial_dir / "comparison.json").write_text(json.dumps(out, indent=2, default=str))
    print(f"\nwrote {trial_dir}/comparison.json")


if __name__ == "__main__":
    main()
