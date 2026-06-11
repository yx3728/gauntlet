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
