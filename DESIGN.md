# DESIGN — gauntlet MVP

`SPEC_framework.md` is the north star; this file records the concrete implementation
decisions and the shape of the three seams. Most mechanisms are productized from the
battle-tested `~/ai_playtest_pipeline` code (see WORKLOG for the mapping).

## Layout

```
gym/                     Lib1 — the gym (JS, CommonJS, zero runtime deps)
  core/                  prng, episode harness, aggregation, contract docs
  runner/run_policy.js   generic batch runner (also shipped into arenas, bundled)
  tasks/<id>/            pluggable tasks: env.js + DESCRIPTION.md + INTERFACE.task.md + baselines/
  tasks/registry.js      id -> module resolution
  arena/build_arena.js   task -> black-box arena dir (bundle + runner + docs + template + manifest)
  tests/                 zero-dep harness; conformance suite parameterized over all tasks
evalkit/                 Lib2 — eval + orchestration (Python, stdlib only)
  evalkit/boundary.py    the per-batch Lib1<->Lib2 boundary (one subprocess per policy x seed-batch)
  evalkit/seeds.py       train / held-out split
  evalkit/agents/        module 1: black-box node layer (the shim)
  evalkit/eval/          module 2: run/analyze API, scoring, baselines, probe, audit
  tests/                 pytest
```

**Language call:** Lib1 is plain modern CommonJS + JSDoc, not TypeScript. Rationale:
policies the agents write are CJS (proven contract), the reused code is CJS, arenas must run
on bare `node` with zero deps, and the interface contract gets its teeth from the
conformance test suite rather than a compiler. esbuild is the only (dev) dependency, used
solely by the arena builder.

## The task interface (seam 1 — Lib1)

A task is a directory `gym/tasks/<id>/` whose `env.js` exports `{ meta, createEnv }`:

- `meta = { id, name, version, max_steps_default, training_seeds }`
- `createEnv()` → env with:
  - `reset(seed, config) -> { obs }` — episode is a pure function of (seed, action seq).
  - `step(action) -> { obs, done, event }` — `event` is `null` or one `{kind, ...}` object
    per step (highest-priority only); `game_over` event with `reason` is mandatory at end.
- **Metrics envelope** (the task-agnostic part of obs): `obs.metrics` always contains
  `score` (number, the comparable), `progress` (0..1, **monotonic running max**, 1.0 = task
  cleared), `done_reason` (`null|"win"|"death"|"timeout"`), plus any task-specific numeric
  /boolean fields. Lib2 aggregates the envelope by introspection (numbers → distributions,
  booleans → rates) and never names task-specific fields.
- **Sanitize, never throw:** malformed/missing actions are coerced to a safe default; every
  pending decision has a safe default so the env can never stall.
- **Pending decisions live in obs** (`obs.pending_decision = { options: [...] }`), not only
  in events — policies only see obs (hard-won lesson).
- Determinism: all randomness from `core/prng.SeededPRNG(seed)` constructed in `reset`.
  The episode harness additionally installs a seeded global `Math.random` override per
  episode as a safety net (and as the mechanism for porting existing games later).
- Docs: `DESCRIPTION.md` (black-box-safe goal, "store page" register, strategy-silent) and
  `INTERFACE.task.md` (the task-specific obs/action/event schema, appended to the generic
  `INTERFACE.core.md` at arena build).
- Baselines: `baselines/noop.js` (floor) + `baselines/greedy.js` (documented-interface
  heuristic reference). Run orchestrator-side only; never shipped in arenas.

Policy contract (unchanged from proven code): a CJS module
`{ init?() -> mem, policy(obs, mem) -> { action, mem } }`; falsy return → safe default
action; `mem` replaced only when the `mem` key is present; a throwing policy ends the
episode with `policy_error` recorded — never crashes the batch.

## The per-batch boundary (Lib1 <-> Lib2)

`node run_policy.js --task <id-or-path> --policy <file> --seeds 1,2,5..9 --json`
→ exactly one JSON line on stdout:
`{ task: {id, version, bundle_sha}, config, seeds, results: [...], aggregate: {...} }`.
Python invokes this once per policy×seed-batch (never per step). In an arena the runner
defaults `--task` to `./task.bundle.js`.

## The arena (black-box integrity)

`build_arena.js --task <id> --out <dir>` produces the **only** files a node ever sees:
`task.bundle.js` (esbuild, minified, banner), `run_policy.js` (self-contained bundle of the
generic runner, readable), `INTERFACE.md` (core + task section), `DESCRIPTION.md`,
`policy.template.js`, `manifest.json` (task id/version, sha256 of every shipped file,
training seeds). No source, no held-out seeds. Held-out scoring runs in the **canonical**
arena (not the node's workspace copy) so a tampered workspace can't affect scores; the
audit also re-hashes workspace files against the manifest.

## Lib2 `agents` (seams 2 and 3)

- **Node-type seam:** `AgentNode.run(workspace, prompt, budgets) -> NodeResult{status,
  policy_path, report, trace_path, wall_ms, meta}`. MVP nodes: `MockNode` (writes a fixed
  policy + synthetic trace; the e2e workhorse) and `ClaudeCodeNode` (the hardened proven
  recipe: `claude -p --model <model> --effort <effort> --output-format stream-json
  --verbose --permission-mode default --allowedTools Bash Read Write Edit Glob Grep
  --strict-mcp-config --disallowedTools WebFetch WebSearch Task --max-turns N`, prompt via
  stdin, cwd=workspace, process-group SIGKILL at wall-clock). Future node kinds
  (local-agent harness, API loop) implement the same method.
- **Coordination seam:** `agents.develop(workspace, prompt, node, budgets) -> NodeResult`
  is the pass-through shim (one node). Future topologies (instruction scaffold, multi-agent
  with on-disk reports) keep the same signature; `eval` is indifferent to what happens
  inside.
- The dev prompt is **task-agnostic** (same text for every task; only budget numbers are
  substituted) — running unchanged across both games is the portability proof.

## Lib2 `eval`

API functions (no CLI): `run(task, node, ...) -> Trial`, `analyze(trial) -> Analysis`,
plus exposed low-levels `score_policy(...)` and `run_baselines(...)`.
`run` = build arena → workspace copy → `agents.develop` → audit trace + workspace
integrity → score policy on held-out seeds AND on training seeds → run baselines →
persist `trial.json` + artifacts under `runs/`. `analyze` = distributions + baseline
comparison + the **diagnostic probe**: generalization gap (train vs held-out),
failure breakdown (done_reason rates, progress quartiles, policy_error count), and
baseline position ((policy − noop) / (greedy − noop)).
Seeds: training seeds come from task meta (visible, baked into arena docs; always
`< 10_000`); held-out seeds are drawn fresh per trial via `SystemRandom` from
`[10_000, 2**31-1]` (30 by default; explicit `heldout_seeds=` for reproducible sets) —
never a predictable block an in-arena policy could enumerate against the shipped bundle.
Disjointness asserted, the drawn split recorded in `trial.json`, never written into any
workspace.

## Out of scope (the seams accommodate them; do not build)

More tasks / non-game tasks; local-agent + API-loop nodes; scaffolding-ladder topologies;
play_step (direct play); human recorder; films; GUI/CLI; the big roguelike.
