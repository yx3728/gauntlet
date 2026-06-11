# gauntlet — a long-horizon agent-eval framework (MVP)

Evaluate LLM agents on long-horizon tasks: a **black-box agent node** develops a *policy*
against a pluggable, deterministic environment; the policy is scored on **held-out seeds**,
compared to baselines, and diagnosed (*why* it fails, not just how much it scores).

North star: `SPEC_framework.md`. Design decisions: `DESIGN.md`. Build log: `WORKLOG.md`.

## Two libraries

```
gym/        Lib1 (JS)      — the gym: pluggable tasks (reset/step), a task-agnostic
                             interface contract, the in-process policy runner, and the
                             black-box arena builder. Zero runtime dependencies.
evalkit/    Lib2 (Python)  — evalkit.agents: the black-box node layer (mock + claude -p);
                             evalkit.eval: run/analyze API — held-out scoring, baselines,
                             the diagnostic probe, integrity audit. Stdlib only. No CLI.
```

The Lib1↔Lib2 boundary is **per-batch**: Python invokes the JS runner once per
policy×seed-batch (`node run_policy.js --policy p.js --seeds 2000..2029 --json` → one JSON
line). Lib2 depends on the interface contract (`gym/core/CONTRACT.md`), never on a task's
specifics.

## Quickstart

```bash
cd gym && npm install && npm test          # 91 tests: contract conformance, determinism,
                                           # golden trajectories, runner semantics
cd ../evalkit && python3 -m pytest -q      # 29 tests incl. the mock-node e2e on both games
```

Run a trial from Python (no CLI — a few API functions):

```python
import evalkit
from evalkit.agents import ClaudeCodeNode, MockNode, NodeBudgets

node = ClaudeCodeNode(model="sonnet", effort="high")     # or MockNode(policy_source=...)
trial = evalkit.run("gridrun", node, budgets=NodeBudgets(wall_clock_s=900, max_turns=60))
analysis = evalkit.analyze(trial)                        # held-out dists + baselines + probe
print(analysis.render())
```

`evalkit.run` builds a **pinned arena** (minified task bundle + docs + runner + manifest —
no source, no held-out seeds), copies it into an isolated workspace, lets the node develop
`policy.js` under hard budgets (wall-clock process-group kill, max-turns, strict tool
allowlist), audits the trace + workspace integrity, then scores the final policy on
held-out AND training seeds **in the canonical arena** and runs the task's baselines.

## The two MVP tasks (e2e fixtures + generality proof)

| task | structure | episode |
|---|---|---|
| `gridrun` | spatial: 3-floor grid crawler — key, locked exit, gems, patrolling hazards, boon decisions | ≤400 steps, ~0.3ms |
| `forge` | economic (non-spatial): materials market, crafting, upgrades, trader offers, net-worth target | 60 days, ~0.05ms |

Same task-agnostic agent prompt runs unchanged on both (`evalkit/agents/prompts/policy_dev.md`).
Each task ships `noop` (floor) and `greedy` (documented-interface heuristic) baselines.

## The three seams (designed for v2, only the MVP is built)

1. **Lib1 task interface** (`gym/core/CONTRACT.md`) — add tasks (more games, eventually a
   non-game coding task) without touching Lib2; conformance suite enforces the contract.
2. **eval↔agents** (`evalkit.agents.develop(workspace, prompt, node, budgets) → NodeResult`)
   — the MVP is a pass-through shim around one node; coordination topologies
   (instruction scaffolds, multi-agent with on-disk reports) keep the same signature.
3. **Node types** (`evalkit.agents.AgentNode`) — `MockNode` and `ClaudeCodeNode` today; a
   local-agent harness or API-loop node is just another subclass.

## Determinism

Every episode is a pure function of `(seed, action sequence)`. All task randomness flows
through a seeded PRNG (`gym/core/prng.js`, mulberry32) created in `reset(seed)`; the
episode harness additionally installs a seeded global `Math.random` override as a safety
net (and as the proven mechanism for porting existing games). Enforced by a three-way
trajectory-hash battery (closed-loop, fresh-instance, open-loop replay) plus state-only
golden hashes per task.

## Out of scope (deliberately)

GUI/CLI, the big roguelike integration, multi-agent scaffolding, local-agent nodes,
non-game tasks, human-play recorder. The seams accommodate them; the MVP stops here.
