# WORKLOG — gauntlet (long-horizon agent-eval framework MVP)

Running log of build decisions, progress, and lessons. Newest entries at the bottom.

---

## 2026-06-11 — Session start: read spec, map the playtest pipeline

- Read `SPEC_framework.md` (the north star) and the kickstart prompt.
- Launched a parallel deep-read over `~/ai_playtest_pipeline` (7 subsystem readers +
  completeness critic) to map reusable pieces; read the most critical files directly:
  - `env/prng.js` — determinism story: mulberry32 + splitmix32 seeded PRNG, installed as a
    global `Math.random` override; reseed (not reinstall) between episodes. **Copy nearly verbatim.**
  - `arena/run_policy.js` — the policy runner: `{init?, policy(obs, mem) -> {action, mem}}`
    contract, per-episode step loop with policy-error containment, light/full game logs,
    `--json` per-batch output. **Adapt to be task-agnostic** (it currently hardcodes
    roguelike metric names in aggregate/printing).
  - `orchestrator/orchestrate.py` — `claude -p` node spawning: curated workspace copy,
    strict allowlist sandbox (`--permission-mode default` + `--allowedTools Bash Read Write
    Edit Glob Grep`, `--strict-mcp-config`, explicit `--disallowedTools WebFetch WebSearch
    Task`), stream-json trace to `trace.jsonl`, process-group kill on wall-clock timeout.
    **Adapt into the ClaudeCodeNode.**
  - `orchestrator/heldout_eval.py` — held-out scoring via one `node run_policy.js --seeds
    <csv> --json` subprocess per policy (the per-batch boundary), distribution summary.
    **Adapt into evalkit scoring.**
  - `orchestrator/seeds.py` — disjoint train/held-out split (train = small ints baked into
    the arena runner; held-out = 2000+ range, orchestrator-side only, never in workspace).
- Constraints from the user: git repo here (done, `main`), commit incrementally, keep this
  worklog, real `claude -p` allowed but ≤8 concurrent and ≪1000 total calls.

## 2026-06-11 — Pipeline map complete; design pinned (DESIGN.md)

Workflow (7 readers + completeness critic, ~448k tokens) returned a detailed map. The
load-bearing lessons adopted into the design:

- **Copy nearly verbatim:** `prng.js` (mulberry32+splitmix32, install-once/reseed-per-episode,
  draws counter); the step-loop semantics (try/catch → `policy_error`, falsy-action default,
  `'mem' in out` rule, `max_steps+5` backstop); the `--json` single-line batch protocol; the
  trajectory-hash determinism battery (closed-loop / fresh-instance / open-loop replay +
  different-seeds-differ); state-only golden hashes (exclude metrics so additive metric fields
  don't re-pin goldens); the hardened `claude -p` recipe incl. NOT bypassPermissions; the
  zero-dep JS test harness; esbuild bundle config (cjs/node18/minify/banner).
- **Design rules extracted from scars:** pending decisions must be mirrored INTO obs (policies
  never see events); per-tick units consistent at any frame_skip; progress = monotonic running
  max in [0,1]; capped farmable score components; goal lives in the PROMPT, metrics are
  references; never let an episode cap silently make the stated goal unreachable; light logs
  in memory, written once (per-step I/O was a ~100x trap); version-pin the bundle per run
  (sha; the arena was once rebalanced mid-build and broke comparability); score in the
  CANONICAL arena, not the node's workspace; verify the audit catches planted escapes;
  baselines as conformance artifacts (noop floor + documented-interface heuristic).
- **Empirical anchors:** Sonnet policy subject ≈ $1.3–2.1 / 1200s wall / ≤80 turns; env speed
  ~70–180k steps/s makes "thousands of free rollouts" real; wall-clock SIGKILL lost 2/3
  reports → prompt says "write report.json EARLY"; held-out gap is real (self-reported 19.9k
  vs held-out 11.7k).
- Wrote `DESIGN.md` (layout, the three seams, metrics envelope, arena, boundary protocol).
- Decision: Lib1 = plain CommonJS + JSDoc (not TS) — policies/agents write CJS, arenas run on
  bare node with zero deps, the contract is enforced by a conformance suite; esbuild only at
  arena build time. Names: `gym/` (Lib1), `evalkit/` (Lib2; `evalkit.agents`, `evalkit.eval`).

## 2026-06-11 — Lib1 core + Lib2 + both games built; mock e2e green

- **Lib1 core** (commit 325c4ba): `core/prng.js` (ported), `core/episode.js` (proven step-loop
  semantics), `core/aggregate.js` (aggregation by introspection of the metrics envelope),
  `core/CONTRACT.md` (the task-interface law), generic `runner/run_policy.js` (single-JSON-line
  batch protocol; dynamic requires so arena bundles leak no source), `arena/build_arena.js`
  (esbuild minified task bundle + bundled readable runner + assembled INTERFACE.md + sha256
  manifest as the version pin), `tasks/registry.js`, zero-dep test harness, conformance suite
  (16 checks × every task), minitask fixture. 31/31 green in 57ms.
- **Lib2 evalkit** (commit dce70d8): `boundary.py` (per-batch subprocess, tolerant single-line
  JSON parse), `seeds.py` (disjoint split, held-out ≥2000), `agents/` (AgentNode seam;
  MockNode writes policy + synthetic trace; ClaudeCodeNode = the hardened recipe; `develop()`
  pass-through shim collects deliverables-from-disk), `eval/` (`run`/`analyze`, summarize,
  baselines, diagnostic probe = generalization gap + failure breakdown + baseline position,
  audit = trace scan on path/command fields only + workspace re-hash vs manifest). 24 unit
  tests green (e2e skipped pending games).
- **Games** (commit 487601f) — built by two parallel subagents against CONTRACT.md, verified
  independently: `gridrun` (spatial: 9×9 ×3 floors, key/exit/gems/patrol hazards, boon
  pending-decision; noop can never die → timeout/score 0; greedy wins 7/8 training and 43/50
  held-out) and `forge` (economic: 60-day market/craft/upgrade loop, trader-offer
  pending-decisions; noop pinned at start value; greedy wins 5/8 training, 17/30 held-out —
  real headroom left for smart policies). Goldens pinned on seeds 2000/2001 for both.
  Full suites: **91/91 JS, 29/29 Python** — mock-node e2e passes on BOTH games through the
  identical pipeline + prompt (first generality proof).
- Notable catch by the conformance-first flow: gridrun's win-step progress initially computed
  1.167 (>1) — caught by the builder's own win-path test before integration.
- Next: real `claude -p` e2e (one node per game, sequential — limits: ≤8 concurrent, ≪1000
  total), then the adversarial review pass.
