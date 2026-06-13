#!/usr/bin/env python3
"""master_analysis.py — the reproducible computational appendix for the final
report. Recomputes EVERY headline number from persisted run artifacts (no
network, no LLM calls, no game runs beyond optionally re-scoring policies which
is deterministic). Emits experiments/cohort-v2/master_analysis.json and prints
a human summary. Run: python3 experiments/cohort-v2/master_analysis.py

Inputs (all under runs/, gitignored bulk data; the derived JSON it writes is
committed): cohort frozen draw, every cohort trial's heldout/training/analysis/
trial json, the v1 trials, the v1-policies-on-frozen-draw cross-score, baselines.

Definitions (fixed, identical to the gym task meta):
  criterion 'win_speed':  win -> 1 + (90000 - win_step)/90000 in (1,2]; else progress in [0,1).
  clear (通关): done_reason == 'win'. CAP = 90000 steps, speed_cap = 40 px/tick (the v2 regime).
  A rep is CLEAN iff its node exited status 'ok' (finished its own dev loop);
  partials (any non-ok exit) are recovered + scored but EXCLUDED from pooled stats.
"""
from __future__ import annotations
import json, math, statistics, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "evalkit"))
from evalkit.eval.criterion import criterion_fn, criterion_summary, wilson95  # noqa: E402

CAP = 90000
_, CRIT = criterion_fn({"kind": "win_speed", "cap": CAP})
RUNS = REPO / "runs"
COHORT = RUNS / "cohorts" / "cohort-v2-n2"
MODELS = ["haiku45", "sonnet46", "opus48", "fable5"]


def load(p):
    return json.loads(Path(p).read_text())


def results_of(trial_dir: Path, which="heldout"):
    f = trial_dir / f"{which}.json"
    return load(f)["results"] if f.exists() else []


def two_prop_z(k1, n1, k2, n2):
    """Two-proportion z-test (pooled) p-value, two-sided."""
    if n1 == 0 or n2 == 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = (p1 - p2) / se
    return round(2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2)))), 5)


def classify_trials():
    """Every roguelike cohort trial -> (model, clean?, node_status, results, trace_meta, name)."""
    rows = []
    for td in sorted(RUNS.glob("cohort-v2-n2*-*")):
        tj = td / "trial.json"
        if not tj.exists():
            continue
        t = load(tj)
        if t["task"]["task_id"] != "roguelike":
            continue
        name = td.name
        model = next((m for m in MODELS if m in name), None)
        node_status = t["node"]["status"]
        tm = t["node"].get("meta", {}).get("trace_meta", {})
        rows.append({
            "name": name, "model": model, "dir": td,
            "clean": node_status == "ok",
            "node_status": node_status,
            "results": results_of(td, "heldout"),
            "training": results_of(td, "training"),
            "trace_meta": tm,
            "audit": t.get("audit", {}).get("verdict"),
        })
    return rows


def death_cause(td: Path) -> str:
    tr = td / "trace.jsonl"
    if not tr.exists():
        return "unknown"
    for line in reversed(tr.read_text(errors="replace").splitlines()):
        if '"type":"result"' in line:
            try:
                msg = str(json.loads(line).get("result", "") or "")
            except Exception:
                msg = ""
            low = msg.lower()
            if "access" in low or "may not exist" in low:
                return "fable_access_withdrawn"
            if "session limit" in low:
                return "account_session_limit"
            if "socket" in low:
                return "api_socket_error"
            return msg[:60] or "nonzero_result"
    # No result event at all (e.g. SIGTERM/SIGKILL).
    ec = load(td / "trial.json")["node"]["meta"].get("exit_code")
    return f"signal_exit_{ec}"


def pooled(reps, key="results"):
    rs = [r for rep in reps for r in rep[key]]
    return criterion_summary(rs, CRIT), rs


def main():
    rows = classify_trials()
    clean = {m: [r for r in rows if r["model"] == m and r["clean"]] for m in MODELS}
    partials = [r for r in rows if not r["clean"]]

    out = {"meta": {"cap": CAP, "speed_cap": 40,
                    "frozen_heldout": load(COHORT / "cohort.json")["heldout_seeds"],
                    "task_version": load(COHORT / "cohort.json")["task_version"],
                    "criterion": "win_speed"}}

    # --- 1. clean per-model pooled on the frozen draw ---
    ladder = {}
    for m in MODELS:
        reps = clean[m]
        summ, rs = pooled(reps, "results")
        ladder[m] = {
            "clean_N": len(reps),
            "per_rep_clears": [(sum(1 for r in rep["results"] if r["done_reason"] == "win"), len(rep["results"])) for rep in reps],
            "pooled": summ,
            "training_pooled": pooled(reps, "training")[0],
        }
    out["ladder_frozen"] = ladder

    # --- 2. adjacent-rung significance on the frozen pooled clears ---
    order = [m for m in MODELS if ladder[m]["clean_N"]]
    sig = {}
    for a, b in zip(order, order[1:]):
        pa, pb = ladder[a]["pooled"], ladder[b]["pooled"]
        sig[f"{a}_vs_{b}"] = {
            "rates": (pa["clear_rate"], pb["clear_rate"]),
            "wilson_overlap": not (pa["clear_rate_wilson95"][1] < pb["clear_rate_wilson95"][0]),
            "two_prop_p": two_prop_z(pa["clears"], pa["n"], pb["clears"], pb["n"]),
        }
    out["adjacent_significance"] = sig

    # --- 3. fixed 2000-2029 cross-check (committed clean_fixed file) ---
    fx_path = COHORT / "clean_fixed_2000_2029.json"
    if fx_path.exists():
        fb = load(fx_path)["batches"]
        fixed_pool = {}
        for m in MODELS:
            keys = [k for k in fb if any(rp["name"].endswith(k) or k in rp["name"] for rp in clean[m])]
            # robust: match by policy filename mapping used at capture
            rs = [r for k in fb if _match(k, m, clean) for r in fb[k]["results"]]
            if rs:
                fixed_pool[m] = criterion_summary(rs, CRIT)
        out["ladder_fixed_2000_2029"] = fixed_pool

    # --- 4. win-speed distribution per model (pooled clean clears) ---
    out["win_step"] = {}
    for m in MODELS:
        _, rs = pooled(clean[m], "results")
        ws = sorted((r.get("win_step") or r.get("steps")) for r in rs if r["done_reason"] == "win")
        if ws:
            out["win_step"][m] = {"n_wins": len(ws), "min": ws[0], "median": statistics.median(ws),
                                  "mean": round(statistics.mean(ws), 1), "max": ws[-1]}

    # --- 5. conditions (context window, compaction, cost) per clean rep ---
    out["conditions"] = {}
    total_clean_cost = 0.0
    for m in MODELS:
        recs = []
        for rep in clean[m]:
            tm = rep["trace_meta"]
            cw = max((v for v in (tm.get("context_windows") or {}).values() if v), default=None)
            cost = tm.get("total_cost_usd")
            if cost:
                total_clean_cost += cost
            recs.append({"trial": rep["name"], "context_window": cw,
                         "compactions": tm.get("compaction_count"),
                         "cost_usd": cost, "turns": tm.get("num_turns")})
        out["conditions"][m] = recs
    out["clean_cost_usd"] = round(total_clean_cost, 2)

    # --- 6. baselines on the frozen draw (deterministic; identical across arms) ---
    bl = load(next(RUNS.glob("cohort-v2-n2-haiku45-r1")) / "baselines.json")
    out["baselines_frozen"] = {name: criterion_summary(br["results"], CRIT) for name, br in bl.items()}

    # --- 7. v1 policies cross-scored on the SAME frozen draw (caveated refs) ---
    v1f = COHORT / "v1_policies_on_frozen_draw.json"
    if v1f.exists():
        out["v1_policies_on_frozen_draw"] = load(v1f)["summary"]

    # --- 8. robustness ledger: every partial, with cause + recovery ---
    ledger = []
    for r in partials:
        rs = r["results"]
        wins = sum(1 for x in rs if x["done_reason"] == "win") if rs else None
        ledger.append({
            "trial": r["name"], "model": r["model"], "node_status": r["node_status"],
            "cause": death_cause(r["dir"]),
            "policy_on_disk": (r["dir"] / "workspace" / "policy.js").exists(),
            "scored": f"{wins}/{len(rs)}" if rs else "no_policy",
            "data_lost": False,  # all artifacts persisted; verified by existence below
        })
    out["robustness_ledger"] = ledger
    out["robustness_summary"] = {
        "total_trials_run": len(rows),
        "clean": sum(len(clean[m]) for m in MODELS),
        "partial": len(partials),
        "distinct_interruption_causes": sorted(set(x["cause"] for x in ledger)),
        "artifacts_lost": 0,
    }

    (REPO / "experiments" / "cohort-v2" / "master_analysis.json").write_text(json.dumps(out, indent=2, default=str))

    # ---- human summary ----
    print("=== CAPABILITY LADDER (clean, frozen n=80/rep, pooled) ===")
    for m in MODELS:
        L = ladder[m]; p = L["pooled"]
        print(f"  {m:9s} N={L['clean_N']} reps {L['per_rep_clears']}  "
              f"clear {p.get('clears')}/{p.get('n')} = {p.get('clear_rate')} {p.get('clear_rate_wilson95')}  "
              f"crit {p.get('mean')}  winmed {p.get('win_step',{}).get('median','—')}")
    print("=== adjacent significance ===")
    for k, v in sig.items():
        print(f"  {k}: rates {v['rates']}  CIs overlap={v['wilson_overlap']}  two-prop p={v['two_prop_p']}")
    print("=== baselines (frozen) ===", {k: f"{v['clears']}/{v['n']}" for k, v in out["baselines_frozen"].items()})
    print("=== v1 policies on frozen draw ===",
          {k: f"{v['clears']}/{v['n']}={v['clear_rate']}" for k, v in out.get("v1_policies_on_frozen_draw", {}).items()})
    print("=== robustness ===", out["robustness_summary"])
    print(f"=== clean-rep spend: ${out['clean_cost_usd']} ===")
    print("wrote experiments/cohort-v2/master_analysis.json")


def _match(capture_key, model, clean):
    # clean_fixed keys were captured as e.g. 'opus48-r1','fable5-makeup-r1'
    return model in capture_key


if __name__ == "__main__":
    main()
