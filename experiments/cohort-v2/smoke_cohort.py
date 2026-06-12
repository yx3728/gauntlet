"""Phase-A validation: concurrency-4 MOCK cohort on the BIG GAME (free, no
tokens) verifying every v2 fix before any real arm spends a dollar.

Checks (from the task brief):
  1. the frozen draw reached EVERY arm (identical heldout_seeds per trial.json);
  2. workspaces are OUTSIDE any repo; arms cannot see each other;
  3. determinism holds across PARALLEL arms (byte-identical scoring);
  4. conditions/cost telemetry populate; audit FP rate is down (clean verdicts
     despite /tmp-style scratch in v1); criterion seam drives the probe;
  5. resume works on a killed mock arm;
  6. the runner emits the cross-arm table with Wilson CIs.

Usage: python3 experiments/cohort-v2/smoke_cohort.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))

import evalkit
from evalkit.agents import MockNode
from evalkit.eval.api import _git_repo_above

GYM = REPO / "gym"
RL_GREEDY = (GYM / "tasks" / "roguelike" / "baselines" / "greedy.js").read_text()
RL_SMART = (GYM / "tasks" / "roguelike" / "baselines" / "smart.js").read_text()
SMOKE_SEEDS = None  # let the cohort freeze its own unpredictable draw
N_HELDOUT = 8  # small for speed; the mechanism is what's under test


def check(cond, msg):
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)
    print(f"  ok: {msg}")


def main():
    runs = REPO / "runs"
    prompt = "smoke prompt (mock nodes ignore it)"

    print("=== concurrent mock cohort on roguelike (4 arms, concurrency 4) ===")
    out = evalkit.run_cohort(
        "roguelike",
        [
            {"name": "greedy-a", "node": lambda: MockNode(policy_source=RL_GREEDY), "reps": 2},
            {"name": "greedy-b", "node": lambda: MockNode(policy_source=RL_GREEDY), "reps": 1},
            {"name": "smart-a", "node": lambda: MockNode(policy_source=RL_SMART), "reps": 1},
        ],
        cohort_name="smoke-v2",
        n_heldout=N_HELDOUT,
        concurrency=4,
        prompt=prompt,
        runs_dir=runs,
        batch_timeout_s=3600,
    )
    report = out["report"]
    cohort_dir = out["cohort_dir"]

    # 1. Frozen draw, persisted before arms, identical everywhere.
    frozen = json.loads((cohort_dir / "cohort.json").read_text())["heldout_seeds"]
    check(len(frozen) == N_HELDOUT, f"frozen draw n={N_HELDOUT}")
    trial_dirs = sorted(p for p in runs.iterdir() if p.name.startswith("smoke-v2-"))
    check(len(trial_dirs) == 4, "4 trials ran")
    for td in trial_dirs:
        t = json.loads((td / "trial.json").read_text())
        check(t["split"]["heldout"] == frozen, f"{td.name}: frozen draw reached the arm")
        check(t["status"] == "complete", f"{td.name}: complete")

    # 2. Workspaces outside any repo + no cross-arm visibility. The workspace
    #    parents were neutral dirs (removed after collection); verify the
    #    DEFAULT root is outside any git repo and trial dirs hold the copies.
    ws_root = evalkit.eval.api.DEFAULT_WORKSPACE_ROOT
    check(_git_repo_above(ws_root) is None, f"default workspace root {ws_root} is outside any git repo")
    for td in trial_dirs:
        check((td / "workspace" / "policy.js").exists(), f"{td.name}: workspace collected back")
    leftovers = [p for p in (list(ws_root.glob('smoke-v2-*')) if ws_root.exists() else [])]
    check(not leftovers, "no neutral workspace leftovers")

    # 3. Parallel determinism: same-policy arms, run CONCURRENTLY in separate
    #    processes, byte-identical per-seed canonical results.
    g_a = out["trials"]["greedy-a"]
    g_b = out["trials"]["greedy-b"]
    ra0 = sorted(g_a[0].heldout.results, key=lambda r: r["seed"])
    ra1 = sorted(g_a[1].heldout.results, key=lambda r: r["seed"])
    rb = sorted(g_b[0].heldout.results, key=lambda r: r["seed"])
    check(ra0 == ra1 == rb, "byte-identical canonical scoring across 3 parallel same-policy arms")
    s_res = sorted(out["trials"]["smart-a"][0].heldout.results, key=lambda r: r["seed"])
    check(s_res != ra0, "different policies genuinely differ (no cross-arm bleed)")

    # 4. Telemetry + audit + criterion.
    for td in trial_dirs:
        t = json.loads((td / "trial.json").read_text())
        tm = t["node"]["meta"]["trace_meta"]
        check(tm["total_cost_usd"] == 0.0 and "session" in tm, f"{td.name}: telemetry populated")
        check(t["provenance"].get("gauntlet_sha"), f"{td.name}: gauntlet SHA stamped at run start")
        check(t["audit"]["verdict"] == "clean", f"{td.name}: audit clean (FP classes whitelisted)")
        a = json.loads((td / "analysis.json").read_text())
        check(a["criterion"]["kind"] == "win_speed", f"{td.name}: criterion seam drives analysis")
        check("clear_rate_wilson95" in a["criterion"]["heldout"], f"{td.name}: Wilson CI present")

    # 5. Resume on a killed arm (simulated crash mid-trial).
    class CrashNode(MockNode):
        def run(self, workspace, prompt, budgets):
            super().run(workspace, prompt, budgets)
            raise RuntimeError("simulated kill")

    try:
        evalkit.run("roguelike", CrashNode(policy_source=RL_GREEDY), heldout_seeds=frozen,
                    runs_dir=runs, trial_name="smoke-v2-crashed", batch_timeout_s=3600)
        check(False, "crash should propagate")
    except RuntimeError:
        pass
    t = json.loads((runs / "smoke-v2-crashed" / "trial.json").read_text())
    check(t["status"] == "running", "crashed trial persisted as running (split on disk)")
    resumed = evalkit.resume(runs / "smoke-v2-crashed")
    check(resumed.status == "complete" and resumed.heldout.ok, "resume completed scoring")
    check(sorted(r["seed"] for r in resumed.heldout.results) == sorted(frozen), "resume used the frozen draw")
    check(sorted(resumed.heldout.results, key=lambda r: r["seed"]) == ra0, "resumed scoring byte-identical to live arms")

    # 6. Cross-arm table.
    check((cohort_dir / "COHORT.md").exists(), "COHORT.md emitted")
    check(report["arms_table"]["greedy-a"]["pooled_heldout"]["n"] == 2 * N_HELDOUT, "pooled across reps")
    check(not report.get("errors"), "no arm errors")
    print("=== SMOKE GREEN (v2 mechanisms verified on the big game, concurrency 4) ===")


if __name__ == "__main__":
    main()
