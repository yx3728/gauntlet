"""Ingest the 3 external GPT-5.5/xhigh manual trials through gauntlet's canonical
path: verify substrate + prompt consistency, then score each on (a) the cohort's
FROZEN n=80 held-out draw — to place GPT in the primary capability ladder — and
(b) the fixed 2000-2029 set — to reproduce the manual pipeline's own numbers as a
cross-check. Read-only on the external trials; writes the record here.

Usage: python3 experiments/external-gpt/ingest_gpt.py
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
sys.path.insert(0, str(REPO / "experiments" / "roguelike-opus48"))

from common import build_prompt  # the canonical bare cohort prompt (sha-gated assembler)
import evalkit

PIPE = Path("/Users/REDACTED/ai_playtest_pipeline/trials")
RUNS = {
    "r1": PIPE / "roguelike-gptcodex-max",
    "r2": PIPE / "roguelike-gptcodex-max-r2",
    "r3": PIPE / "roguelike-gptcodex-max-r3",
}
FIXED = list(range(2000, 2030))


def main():
    frozen = json.loads((REPO / "runs" / "cohorts" / "cohort-v2-n2" / "cohort.json").read_text())["heldout_seeds"]
    assert len(frozen) == 80
    ref_prompt = build_prompt()

    out = {"model": "gpt-5.5/xhigh (external manual)", "frozen_n": len(frozen), "runs": {}}
    for name, tdir in RUNS.items():
        rec = evalkit.ingest_external_trial(
            tdir, task="roguelike",
            heldout_seeds=frozen, fixed_seeds=FIXED,
            reference_prompt=ref_prompt, timeout_s=7200,
        )
        out["runs"][name] = rec
        s = rec["substrate"]; p = rec["prompt"]
        fh = rec["heldout"]["summary"]; ff = rec["fixed"]["summary"]
        print(f"{name}: substrate_match={s['match']} prompt_match={p.get('match')} consistent={rec['consistent']}")
        print(f"    frozen n=80:   clear {fh.get('clears')}/{fh.get('n')} = {fh.get('clear_rate')} {fh.get('clear_rate_wilson95')}  crit {fh.get('mean')}  winmed {fh.get('win_step',{}).get('median','-')}")
        print(f"    fixed 2000-29: clear {ff.get('clears')}/{ff.get('n')} = {ff.get('clear_rate')}  crit {ff.get('mean')}  winmed {ff.get('win_step',{}).get('median','-')}")

    # pooled across the 3 runs (per-seed concat), both bases
    def pool(base):
        rs = [r for run in out["runs"].values() for r in run[base]["results"]]
        from evalkit.eval.criterion import criterion_fn, criterion_summary
        _, fn = criterion_fn({"kind": "win_speed", "cap": 90000})
        return criterion_summary(rs, fn)
    out["pooled_frozen"] = pool("heldout")
    out["pooled_fixed"] = pool("fixed")
    # per-run scalar summary for the report table
    out["per_run"] = {
        name: {"frozen_clear": rec["heldout"]["summary"].get("clears"),
               "frozen_n": rec["heldout"]["summary"].get("n"),
               "frozen_crit": rec["heldout"]["summary"].get("mean"),
               "fixed_clear": rec["fixed"]["summary"].get("clears"),
               "fixed_crit": rec["fixed"]["summary"].get("mean")}
        for name, rec in out["runs"].items()
    }
    cr = [out["per_run"][n]["frozen_clear"] / out["per_run"][n]["frozen_n"] for n in RUNS]
    out["frozen_clear_rate_mean"] = round(statistics.mean(cr), 4)
    out["frozen_clear_rate_range"] = [round(min(cr), 4), round(max(cr), 4)]

    (HERE / "gpt_ingest.json").write_text(json.dumps(out, indent=2, default=str))
    print("\n=== POOLED (3 runs) ===")
    pf, px = out["pooled_frozen"], out["pooled_fixed"]
    print(f"frozen n=240: clear {pf['clears']}/{pf['n']} = {pf['clear_rate']} {pf['clear_rate_wilson95']}  crit {pf['mean']}  winmed {pf.get('win_step',{}).get('median','-')}")
    print(f"fixed  n=90:  clear {px['clears']}/{px['n']} = {px['clear_rate']} {px['clear_rate_wilson95']}  crit {px['mean']}")
    print(f"frozen clear-rate per run: {[round(x,3) for x in cr]}  mean {out['frozen_clear_rate_mean']} range {out['frozen_clear_rate_range']}")
    print("wrote experiments/external-gpt/gpt_ingest.json")


if __name__ == "__main__":
    main()
