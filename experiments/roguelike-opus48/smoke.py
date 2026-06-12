"""Mock-smoke for the roguelike trial (Step 4.1 — free, no tokens).

1. MockNode (the vendored greedy baseline as its fixed policy) through the FULL
   gauntlet pipeline on the big game: overlay arena -> workspace -> node ->
   audit -> canonical 40/90k scoring (held-out + training) -> baselines.
   Asserts every artifact persists and the workspace is byte-identical to the
   manual-trial template v2.
2. Mid-run-kill resilience on the heavy game: a fake node writes policy.js then
   hangs; the harness SIGKILLs it at wall-clock; the on-disk policy is still
   picked up and scored.

Usage: python3 experiments/roguelike-opus48/smoke.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from common import REPO, build_prompt, heldout_table

import evalkit
from evalkit.agents import ClaudeCodeNode, MockNode, NodeBudgets

GYM = REPO / "gym"
GREEDY = GYM / "tasks" / "roguelike" / "baselines" / "greedy.js"
V2_SHAS = {
    "env.bundle.js": "424916b286c9efbbd95957caa5f4fabcf35d3812439ba04647f66996dac54b13",
    "INTERFACE.md": "0ea9b1b62e6047d56c6f3db6038a3b01fed2d77b83329e78d4d1b26769481386",
    "run_policy.js": "4e43412319100a11196e42ee4502cdba5f306d7a410efa1f855982a5df7979ce",
    "play_step.js": "70dfd78a85c1f217130c547b1059e5c6aee601dcc0b4b8da6805c1e1e4fd7748",
    "GAME_DESCRIPTION.md": "324e441b0ae6359cd6cb06c16b464e3ea2fde7cd6d195f3a105294e238a2d045",
    "policy.template.js": "6e699f7940f1ecaa869b0b3489e615ad92bb474953ebdbdabcafa16bf06e6e9b",
    "expand_trace.js": "61c4fb3d66ab0732cfeec20cf1a0945d65064700aa9c31eb05cd237c00a1c5bf",
}
SMOKE_SEEDS = [2000, 2001, 2002]


def check(cond, msg):
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)
    print(f"  ok: {msg}")


def common_assertions(trial, label):
    print(f"-- {label}: trial dir {trial.trial_dir}")
    check(trial.status == "complete", f"{label}: trial complete")
    check(trial.heldout is not None and trial.heldout.ok, f"{label}: held-out scored ({trial.heldout and trial.heldout.error})")
    check(len(trial.heldout.results) == len(SMOKE_SEEDS), f"{label}: {len(SMOKE_SEEDS)} held-out results")
    for r in trial.heldout.results:
        check(isinstance(r["score"], (int, float)) and 0 <= r["progress"] <= 1, f"{label}: seed {r['seed']} envelope sane")
        check("win_step" in r, f"{label}: seed {r['seed']} carries win_step")
    check(trial.training is not None and trial.training.ok and len(trial.training.results) == 13, f"{label}: 13 training seeds scored")
    for f in ["trial.json", "heldout.json", "training.json", "baselines.json", "audit.json", "prompt.txt"]:
        check((trial.trial_dir / f).exists(), f"{label}: {f} persisted")
    check((trial.trial_dir / "workspace" / "policy.js").exists(), f"{label}: policy.js on disk")
    check(trial.node.trace_path and Path(trial.node.trace_path).exists(), f"{label}: trace persisted")

    # Faithfulness: the workspace the node saw is byte-identical to template v2.
    ws = trial.trial_dir / "workspace"
    for name, want in V2_SHAS.items():
        got = hashlib.sha256((ws / name).read_bytes()).hexdigest()
        check(got == want, f"{label}: workspace/{name} byte-identical to template v2")

    analysis = evalkit.analyze(trial)
    check((trial.trial_dir / "ANALYSIS.md").exists(), f"{label}: ANALYSIS.md written")
    table = heldout_table(trial.heldout.results)
    print(f"  {label} held-out table: {json.dumps(table)}")
    return analysis


def main():
    runs_dir = REPO / "runs"
    prompt = build_prompt()

    print("=== smoke 1: MockNode full pipeline on the big game ===")
    node = MockNode(policy_source=GREEDY.read_text())
    trial = evalkit.run(
        "roguelike", node,
        heldout_seeds=SMOKE_SEEDS,
        prompt=prompt,
        runs_dir=runs_dir,
        trial_name="smoke-roguelike-mock",
        batch_timeout_s=3600,
    )
    common_assertions(trial, "mock")
    check(trial.audit["verdict"] == "clean", f"mock: audit clean (got {trial.audit['verdict']})")
    check(trial.manifest.get("arena_mode") == "overlay", "mock: overlay arena mode")
    check(trial.heldout.task.get("id") == "roguelike", "mock: scored through the canonical repo task")
    check("noop" in trial.baselines and "greedy" in trial.baselines and "smart" in trial.baselines, "mock: 3 baselines ran")

    print("=== smoke 2: mid-run kill resilience (policy on disk survives SIGKILL) ===")
    stub = runs_dir / "smoke-stub-claude.sh"
    stub.parent.mkdir(parents=True, exist_ok=True)
    stub.write_text(f'#!/bin/bash\ncp "{GREEDY}" policy.js\necho \'{{"type":"system","subtype":"init"}}\'\nsleep 600\n')
    os.chmod(stub, 0o755)
    killed_node = ClaudeCodeNode(claude_bin=str(stub))
    trial2 = evalkit.run(
        "roguelike", killed_node,
        budgets=NodeBudgets(wall_clock_s=8, max_turns=10),
        heldout_seeds=SMOKE_SEEDS,
        prompt=prompt,
        runs_dir=runs_dir,
        trial_name="smoke-roguelike-killed",
        batch_timeout_s=3600,
    )
    check(trial2.node.status == "timeout_killed", f"killed: node SIGKILLed at wall-clock (got {trial2.node.status})")
    common_assertions(trial2, "killed")
    print("=== SMOKE GREEN ===")


if __name__ == "__main__":
    main()
