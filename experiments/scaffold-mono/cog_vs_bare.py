#!/usr/bin/env python3
"""cog_vs_bare.py — the reproducible computational appendix for the +cognitive
(M1-analog) experiment. Recomputes EVERY headline number for the bare-vs-+cognitive
comparison from persisted run artifacts (no network, no LLM calls, no game runs).
Emits experiments/scaffold-mono/cog_vs_bare.json and prints a human summary.
Run: python3 experiments/scaffold-mono/cog_vs_bare.py

Style/conventions mirror experiments/cohort-v2/master_analysis.py (its sibling
appendix for the bare cohort). It REUSES evalkit.eval.criterion and READS the
bare-arm numbers straight out of master_analysis.json so the two appendices can
never disagree about the bare baseline.

Inputs (all under runs/, gitignored bulk; the derived JSON it writes is committed):
  - the frozen n=80 held-out draw           runs/cohorts/cohort-v2-n2/cohort.json
  - every +cognitive trial                  runs/cohort-v2-cog-*-*/{trial,heldout}.json
  - the bare baseline (already aggregated)   experiments/cohort-v2/master_analysis.json
  - the +cognitive workspace memory files    runs/cohort-v2-cog-*-*/workspace/{GAME_MODEL,WORKLOG}.md

Definitions (fixed, identical to master_analysis.py and the gym task meta):
  criterion 'win_speed':  win -> 1 + (90000 - win_step)/90000 in (1,2]; else progress in [0,1).
  clear (通关): done_reason == 'win'. CAP = 90000 steps, speed_cap = 40 px/tick (the v2 regime).
  A rep is CLEAN iff trial.json node.status == 'ok' (finished its own dev loop);
  status == 'running' is IN-FLIGHT (no heldout yet -> skipped); any other status is
  partial/terminated (recovered + scored, excluded from clean pooled stats).

  The +cognitive arms (M1-analog) run the SAME frozen draw, SAME substrate bundle,
  SAME win_speed criterion as the bare cohort (M0-analog). The only intended delta is
  the added "How to work" cognitive structure (see ../scaffold-mono/PROMPT.md). NOTE a
  caveat the prose must carry: the cog prompt ALSO drops the bare prompt's report.json
  deliverable and adds a multi-seed practice hint -- verified by prompt_delta() below.
"""
from __future__ import annotations
import json, math, statistics, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "evalkit"))
from evalkit.eval.criterion import criterion_fn, criterion_summary, wilson95  # noqa: E402

CAP = 90000
_, CRIT = criterion_fn({"kind": "win_speed", "cap": CAP})
RUNS = REPO / "runs"
COHORT = RUNS / "cohorts" / "cohort-v2-n2"
MASTER = REPO / "experiments" / "cohort-v2" / "master_analysis.json"
MODELS = ["haiku45", "sonnet46", "opus48"]  # fable not part of the cog experiment


def load(p):
    return json.loads(Path(p).read_text())


def two_prop_z(k1, n1, k2, n2):
    """Two-proportion z-test (pooled) p-value, two-sided (same fn as master_analysis)."""
    if n1 == 0 or n2 == 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 1.0
    z = (p1 - p2) / se
    return round(2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2)))), 6)


def classify_cog_trials():
    """Every +cognitive trial -> dict(model, status, clean/in_flight/partial, results, trace_meta...)."""
    frozen = load(COHORT / "cohort.json")["heldout_seeds"]
    rows = []
    for td in sorted(RUNS.glob("cohort-v2-cog-*-*")):
        tj = td / "trial.json"
        if not tj.exists():
            continue
        t = load(tj)
        name = td.name
        model = next((m for m in MODELS if m in name), None)
        status = t["node"].get("status")  # 'ok' clean; None+top status 'running' = in-flight; else partial
        top_status = t.get("status")
        in_flight = top_status == "running" or status is None
        clean = status == "ok"
        hl = td / "heldout.json"
        results = load(hl)["results"] if hl.exists() else []
        # integrity guard: confirm this arm scored the frozen draw (not some other seed set)
        split = t.get("split", {}).get("heldout", [])
        on_frozen = split == frozen
        tm = t["node"].get("meta", {}).get("trace_meta", {}) if t.get("node") else {}
        ws = td / "workspace"
        rows.append({
            "name": name, "model": model, "dir": td,
            "in_flight": in_flight, "clean": clean,
            "node_status": status, "top_status": top_status,
            "on_frozen_draw": on_frozen,
            "results": results,
            "trace_meta": tm,
            "audit": t.get("audit", {}).get("verdict"),
            "served_model": tm.get("session", {}).get("model"),
            "has_game_model": (ws / "GAME_MODEL.md").exists(),
            "has_worklog": (ws / "WORKLOG.md").exists(),
            "game_model_bytes": (ws / "GAME_MODEL.md").stat().st_size if (ws / "GAME_MODEL.md").exists() else 0,
            "worklog_bytes": (ws / "WORKLOG.md").stat().st_size if (ws / "WORKLOG.md").exists() else 0,
            "policy_lines": sum(1 for _ in open(ws / "policy.js")) if (ws / "policy.js").exists() else 0,
        })
    return rows


def pooled(reps):
    rs = [r for rep in reps for r in rep["results"]]
    return criterion_summary(rs, CRIT), rs


def winmed(reps):
    _, rs = pooled(reps)
    ws = sorted((r.get("win_step") or r.get("steps")) for r in rs if r["done_reason"] == "win")
    return statistics.median(ws) if ws else None


def prompt_delta():
    """Honesty check: the cog prompt is NOT a pure superset of the bare prompt.
    Report the substantive deltas we found so the threats-to-validity is grounded."""
    bare = next(RUNS.glob("cohort-v2-n2-opus48-r1"), None)
    cog = next(RUNS.glob("cohort-v2-cog-followup-opus48-r1"), None)
    out = {"checked": False}
    if bare and cog and (bare / "prompt.txt").exists() and (cog / "prompt.txt").exists():
        bt = (bare / "prompt.txt").read_text()
        ct = (cog / "prompt.txt").read_text()
        out = {
            "checked": True,
            "bare_has_report_json_deliverable": "report.json" in bt,
            "cog_has_report_json_deliverable": "report.json" in ct,
            "cog_adds_cognitive_how_to_work": "How to work" in ct and "How to work" not in bt,
            "cog_requires_GAME_MODEL_and_WORKLOG": "GAME_MODEL.md" in ct and "WORKLOG.md" in ct,
            "note": ("cog prompt drops the bare report.json deliverable and adds a multi-seed practice "
                     "hint in addition to the cognitive section -- the only-delta claim is approximate"),
        }
    return out


def main():
    rows = classify_cog_trials()
    bare = load(MASTER)["ladder_frozen"]  # bare baseline, single source of truth

    out = {"meta": {
        "cap": CAP, "speed_cap": 40, "criterion": "win_speed",
        "frozen_heldout_n": len(load(COHORT / "cohort.json")["heldout_seeds"]),
        "task_version": load(COHORT / "cohort.json")["task_version"],
        "design": "M0-analog (bare cohort) vs M1-analog (+cognitive 'How to work' structure)",
    }}
    out["prompt_delta"] = prompt_delta()

    # --- 1. per-arm cog roster: status, served model, metric, memory-file compliance ---
    out["cog_arms"] = []
    for r in sorted(rows, key=lambda x: (x["model"] or "", x["name"])):
        s = criterion_summary(r["results"], CRIT) if r["results"] else {}
        out["cog_arms"].append({
            "name": r["name"], "model": r["model"],
            "state": "in_flight" if r["in_flight"] else ("clean" if r["clean"] else "partial"),
            "node_status": r["node_status"], "on_frozen_draw": r["on_frozen_draw"],
            "served_model": r["served_model"],
            "clears": s.get("clears"), "n": s.get("n"), "clear_rate": s.get("clear_rate"),
            "criterion_mean": s.get("mean"),
            "compactions": r["trace_meta"].get("compaction_count"),
            "num_turns": r["trace_meta"].get("num_turns"),
            "cost_usd": r["trace_meta"].get("total_cost_usd"),
            "audit": r["audit"],
            "GAME_MODEL.md_bytes": r["game_model_bytes"],
            "WORKLOG.md_bytes": r["worklog_bytes"],
            "policy_lines": r["policy_lines"],
        })

    # --- 2. the bare-vs-+cognitive comparison table, per model, clean only, pooled ---
    out["comparison"] = {}
    for m in MODELS:
        clean = [r for r in rows if r["model"] == m and r["clean"]]
        in_flight = [r for r in rows if r["model"] == m and r["in_flight"]]
        cs, _ = pooled(clean)
        b = bare.get(m, {}).get("pooled", {})
        per_rep = [(sum(1 for x in r["results"] if x["done_reason"] == "win"), len(r["results"])) for r in clean]
        out["comparison"][m] = {
            "bare": {"clean_N": bare.get(m, {}).get("clean_N"),
                     "clears": b.get("clears"), "n": b.get("n"),
                     "clear_rate": b.get("clear_rate"),
                     "wilson95": b.get("clear_rate_wilson95"),
                     "criterion_mean": b.get("mean"),
                     "win_step_median": b.get("win_step", {}).get("median")},
            "cog": {"clean_N": len(clean),
                    "in_flight_N": len(in_flight),
                    "per_rep_clears": per_rep,
                    "clears": cs.get("clears"), "n": cs.get("n"),
                    "clear_rate": cs.get("clear_rate"),
                    "wilson95": cs.get("clear_rate_wilson95"),
                    "criterion_mean": cs.get("mean"),
                    "win_step_median": winmed(clean)},
            "two_prop_p_bare_vs_cog": (
                two_prop_z(b.get("clears", 0), b.get("n", 0), cs.get("clears", 0), cs.get("n", 0))
                if cs.get("n") else None),
        }

    # --- 3. compliance summary (did the cognitive structure get followed?) ---
    clean_rows = [r for r in rows if r["clean"]]
    out["compliance"] = {
        "clean_arms": len(clean_rows),
        "wrote_GAME_MODEL.md": sum(1 for r in clean_rows if r["has_game_model"]),
        "wrote_WORKLOG.md": sum(1 for r in clean_rows if r["has_worklog"]),
        "both_files_all_clean_arms": all(r["has_game_model"] and r["has_worklog"] for r in clean_rows),
        "max_compactions_survived": max((r["trace_meta"].get("compaction_count") or 0) for r in clean_rows),
        "per_arm": [{"name": r["name"], "model": r["model"],
                     "GAME_MODEL.md": r["has_game_model"], "WORKLOG.md": r["has_worklog"],
                     "GAME_MODEL.md_bytes": r["game_model_bytes"], "WORKLOG.md_bytes": r["worklog_bytes"],
                     "compactions": r["trace_meta"].get("compaction_count")} for r in clean_rows],
    }

    (Path(__file__).parent / "cog_vs_bare.json").write_text(json.dumps(out, indent=2, default=str))

    # ---- human summary ----
    print("=== +COGNITIVE (M1-analog) vs BARE (M0-analog), frozen n=80, clean pooled ===")
    print(f"{'model':9s} {'bare clear':>22s}   {'cog clear':>22s}   {'crit b->c':>14s}   p(bare,cog)")
    for m in MODELS:
        c = out["comparison"][m]
        b, g = c["bare"], c["cog"]
        bstr = f"{b['clears']}/{b['n']}={b['clear_rate']} (N{b['clean_N']})"
        gstr = (f"{g['clears']}/{g['n']}={g['clear_rate']} (N{g['clean_N']}"
                + (f"+{g['in_flight_N']}IF" if g['in_flight_N'] else "") + ")")
        print(f"{m:9s} {bstr:>22s} -> {gstr:>22s}   {b['criterion_mean']}->{g['criterion_mean']}   "
              f"p={c['two_prop_p_bare_vs_cog']}")
    print()
    print("=== cog arm roster ===")
    for a in out["cog_arms"]:
        cl = f"{a['clears']}/{a['n']}" if a["clears"] is not None else "—"
        print(f"  {a['name']:42s} {a['state']:9s} served={str(a['served_model']):22s} "
              f"clears={cl:6s} comp={a['compactions']} GM={a['GAME_MODEL.md_bytes']}B WL={a['WORKLOG.md_bytes']}B")
    print()
    print("=== compliance ===", {k: v for k, v in out["compliance"].items() if k != "per_arm"})
    print("=== prompt delta (honesty) ===", out["prompt_delta"].get("note"))
    print("wrote experiments/scaffold-mono/cog_vs_bare.json")


if __name__ == "__main__":
    main()
