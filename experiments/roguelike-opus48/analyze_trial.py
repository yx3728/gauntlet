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
import subprocess
import sys
from pathlib import Path

from common import CAP, MANUAL_BASELINE, MANUAL_HELDOUT_SEEDS, REPO, eval_score, heldout_table

import evalkit

VENDOR = REPO / "gym" / "tasks" / "roguelike" / "vendor"
PARITY_FIELDS = ("steps", "score", "done_reason", "progress", "kills", "level", "wave", "survived_ms")


def parity_gate(policy_path, seeds=(2000, 2008, 2017)) -> dict:
    """Replay the FINAL policy through the subject's vendored runner (subprocess,
    explicit 40/90k) and through gauntlet's canonical scorer; compare per-seed
    results exactly. Catches policy-contingent divergence classes (exotic
    malformed actions; in-policy RogueEnv lookahead hijacking the vendor RNG)
    that generic cross-runner tests cannot rule out for an arbitrary policy."""
    seeds_csv = ",".join(str(s) for s in seeds)
    out = subprocess.run(
        ["node", str(VENDOR / "run_policy.js"), "--policy", str(policy_path),
         "--seeds", seeds_csv, "--speed_cap", "40", "--frame_skip", "1",
         "--max_steps", str(CAP), "--log", "none", "--json"],
        capture_output=True, text=True, cwd=str(VENDOR), timeout=3600)
    if out.returncode != 0:
        return {"ok": False, "error": f"vendor runner exit {out.returncode}: {out.stderr[-500:]}"}
    vendor = {r["seed"]: r for r in json.loads(out.stdout.strip().splitlines()[-1])["results"]}

    br = evalkit.score_policy(policy_path, list(seeds), task="roguelike", timeout_s=3600)
    if not br.ok:
        return {"ok": False, "error": f"canonical scorer: {br.error}"}
    mine = {r["seed"]: r for r in br.results}

    mismatches = []
    for s in seeds:
        for f in PARITY_FIELDS:
            if vendor[s].get(f) != mine[s].get(f):
                mismatches.append({"seed": s, "field": f, "vendor": vendor[s].get(f), "canonical": mine[s].get(f)})
    return {"ok": not mismatches, "seeds": list(seeds), "fields": list(PARITY_FIELDS), "mismatches": mismatches}


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

    # 5. The manual-policy same-regime baseline (computed pre-run) + the manual
    #    ∞-regime headline numbers embedded from verified raw-sweep constants.
    mp = json.loads((Path(__file__).parent / "manual_policy_at_40_90k.json").read_text())
    out["manual_ladder_t1_policy_at_40_90k"] = heldout_table(mp["results"])
    out["manual_baseline"] = MANUAL_BASELINE

    # 6. PARITY GATE: the canonical scorer must reproduce the subject's own
    #    runner exactly on THIS policy (publish-blocker if it doesn't).
    out["parity_gate"] = parity_gate(trial.node.policy_path)
    print("parity gate:", json.dumps(out["parity_gate"]))

    # 7. Diagnostic only (NOT the eval): the new policy at the manual ∞ regime,
    #    via the vendored runner, for the regime-sensitivity picture.
    vr = subprocess.run(
        ["node", str(VENDOR / "run_policy.js"), "--policy", str(trial.node.policy_path),
         "--seeds", ",".join(str(s) for s in MANUAL_HELDOUT_SEEDS), "--speed_cap", "inf",
         "--frame_skip", "1", "--max_steps", str(CAP), "--log", "none", "--json"],
        capture_output=True, text=True, cwd=str(VENDOR), timeout=7200)
    if vr.returncode == 0:
        inf_results = json.loads(vr.stdout.strip().splitlines()[-1])["results"]
        for r in inf_results:
            if r.get("done_reason") == "win":
                r["win_step"] = r["steps"]
        out["diagnostic_inf_90k_fixed_seeds"] = heldout_table(inf_results)
        print("diagnostic @inf/90k (fixed seeds):", json.dumps(out["diagnostic_inf_90k_fixed_seeds"]))

    (trial_dir / "comparison.json").write_text(json.dumps(out, indent=2, default=str))
    print(f"\nwrote {trial_dir}/comparison.json")
    if not out["parity_gate"]["ok"]:
        print("\n!!! PARITY GATE FAILED — canonical numbers do not reproduce the subject runner; investigate before publishing !!!")
        return 1
    return 0


if __name__ == "__main__":
    main()
