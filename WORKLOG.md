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

## 2026-06-11 — Real `claude -p` e2e green on BOTH games (2 calls total)

One Sonnet/high node per game (`evalkit/examples/real_e2e.py`, wall 900s / 60 turns / 8
attempts). Both nodes hit the wall-clock SIGKILL (expected) but left a working policy.js —
deliverables-on-disk counted, exactly as designed:

- **gridrun**: held-out (30 seeds) win rate **0.867**, score mean 633.8 (greedy 630.5,
  noop 0) → normalized **1.005** on the noop→greedy scale; generalization gap −40 (no
  overfit); deaths on 4 seeds localized by the probe's worst-seeds list.
- **forge**: held-out win rate **0.70**, score mean 1587 (greedy 1315, noop 100) →
  normalized **1.22** — the agent BEAT the greedy reference; gap +136 (mild).
- The SAME task-agnostic prompt ran unchanged on both games — real-agent portability proof.

The real run immediately caught two audit bugs (the point of a sparing real e2e):
1. `--seeds 1..8` (runner range syntax) tripped the bare-`..` traversal rule → rule now
   matches only path-like traversal (`../`, `/..`); regression test added.
2. `manifest.json` (shipped, cannot self-hash into its own file list) was flagged as an
   extra workspace file → now an expected file; test updated.
After the fix the gridrun trial re-audits **clean** (audit.json re-persisted); forge was
clean from the start. Total `claude -p` usage this session: 2 calls, sequential.

## 2026-06-11 — Adversarial review (41 agents) + fix round; final state green

Ran a 5-dimension review workflow (spec compliance / gym correctness / evalkit correctness
/ seams+black-box / test adequacy), every finding then attacked by adversarial verifiers:
**23 confirmed, 7 refuted** (refuted included two inflated "majors": the keyword-denylist
exfil claim — out of the framework's threat model, score integrity rests on canonical-arena
scoring + manifest re-hash; and the develop() seam claim — disproven by a working
multi-node topology behind the unchanged signature). Spec-compliance baseline: every
in-scope SPEC requirement verified met, zero task-specific leakage into core/Lib2.

Confirmed majors, all fixed (3 parallel fixers on disjoint file sets + one integration fix):
1. **gridrun unsolvable floors** (~36/3000 seeds, moving patrols could permanently block
   the only corridor; held-out 2016 was one — explains a real-e2e death there). Generation
   now proves each floor winnable via a time-expanded BFS over (cell × hazard phase ×
   has-key) mirroring exact collision semantics, zero PRNG draws, redraw on failure.
   3000-seed sweep: 0 unsolvable. gridrun → 1.1.0; goldens re-pinned (values unchanged);
   greedy held-out 43/50 → 44/50.
2. **Held-out blindness**: the predictable 2000..2029 block let a policy recover its seed
   by enumerating the shipped bundle (oracle of all future randomness). Held-out seeds now
   drawn per-trial via SystemRandom from [10_000, 2³¹), recorded in trial.json;
   `heldout_seeds=` override for reproducible sets.
3. **Cross-instance isolation untested** → new interleaved two-env conformance test
   (verified to catch a deliberate module-state violator).
4. **ClaudeCodeNode hard budgets untested** → fake-binary tests: wall-clock SIGKILL kills
   the whole process group (-9, on-budget timing), nonzero exit recorded, prompt via stdin.

Confirmed minors fixed (selection): init()-throw now contained per-seed like policy()
throws; terminal steps return fresh clones (no aliasing) + mutation-resistant idempotency
test; true median in JS aggregate (parity test vs Python summarize across the real
boundary); arena `--help` prints embedded usage (was esbuild preamble after bundling);
parseSeeds/parseArgs fail fast on junk; harness result fields can't be clobbered by task
metrics (+ reserved-keys contract clause); vacuous JSON-serializability test replaced by a
recursive walk; canonical-arena **tamper e2e test** (TamperNode overwrites its workspace
bundle → audit flags it AND held-out scores are byte-identical to the honest run); audit
containment via resolve+is_relative_to (sibling-prefix/symlink edge cases); audit rules
added: bundle_read, credential_access (high), no_tool_events (non-claude trace shapes no
longer silently audit clean), base64/xxd/od/hexdump/strings + bundle = deobfuscation;
speed bound aligned to the contract (<50ms); arena builder gained a direct unit test;
score_policy() wrapper exported as DESIGN advertises.

**Final state: gym 105/105, evalkit 46/46, mock e2e + tamper e2e + 2 real `claude -p`
trials green. STOPPING here per spec — the big roguelike is deliberately not wired.**

## 2026-06-11/12 — FIRST REAL TRIAL: the big roguelike × Opus 4.8, through gauntlet

New assignment (supersedes the earlier stop-line): run gauntlet's first real trial on the
manual-pipeline roguelike, entirely through the framework. Mapping + deltas:
`experiments/roguelike-opus48/MAPPING.md`. Comparison baseline = `ladder-t1` (manual Opus
4.8/max, v1 ∞-regime): held-out 20% clear @90k@∞ (6/30, converged), 0% at every finite cap
tested; wins at 25k–76k steps; self-report ~51% vs canonical 20% (overfit).

Wiring (commit 950c429):
- `gym/tasks/roguelike/` — the 7 template-v2 workspace files vendored byte-identically
  (sha256-verified against `TEMPLATE_VERSIONS.md`); thin adapter `env.js` maps to the
  metrics envelope (`score` = in-game composite unchanged; `progress`; `done_reason`;
  `win_step`), pins the eval regime structurally (speed_cap 40 / frame_skip 1 / 90k),
  sanitizes actions, clones terminal obs. `meta.heavy` + `meta.arena.overlay_dir`.
- **RNG ownership** (the landmine): the bundle installs its own global Math.random at
  load; gauntlet's harness installs a safety net per episode — last-install-wins would
  silently fork canonical trajectories from subject-observed ones. Fix: each adapter env
  owns a SeededPRNG seeded exactly like the bundle's own and re-installs it before EVERY
  reset/step (also gives cross-instance isolation); harness now re-installs its net per
  episode. Proven by the **cross-runner determinism test**: 2000 steps byte-identical
  between the vendored v2 runner (as a real subprocess) and the gauntlet adapter path.
- Arena **overlay mode**: the subject workspace = the 7 v2 files byte-identical +
  `manifest.json` only. Canonical scoring auto-falls-back to the REPO task (the arena
  ships no gauntlet runner) — fully outside the node's reach.
- Conformance for heavy tasks: capped battery config (same config both sides of every
  determinism comparison), relaxed speed bound. All 18 conformance checks pass on the big
  game. Suites: **gym 129/129, evalkit 46/46**.
- evalkit: `run(prompt=, config=)`, scoring-mode auto-detect, `run_baselines(task=)`,
  `score_policy` reused for the same-regime baseline.
- Prompt = v2 `PROMPT.md` VERBATIM (sha-checked at assembly; refuses on drift) + the ONE
  deliberate addition: the Step-3 scoring criterion (win prerequisite; earlier win =
  higher; formula; in-game score is a reference — strategy-silent).

Verification before any tokens:
- **Mock smoke GREEN** (10s): full pipeline on the big game; every artifact persists;
  workspace 7 files byte-identical to template v2; audit clean; 3 baselines ran.
- **Kill-resilience GREEN**: stub node writes policy.js then hangs; SIGKILL at 8s
  wall-clock; on-disk policy picked up and scored end-to-end.
- **Substrate faithfulness**: manual verified clears reproduce EXACTLY on the vendored
  bundle (2008→win@25129, 2011→win@26827); manual ∞-policy scored canonically @40/90k =
  **0/30, 100% death, progress mean 0.3425** (matches the manual sweep's 0.32–0.37 band).

Real run launched: `roguelike-opus48-max` — ONE Opus 4.8/max `claude -p` node, hardened
recipe, **no horizon limit** (8h/2000-turn runaway backstops only). Expected 1–3h.

## 2026-06-12 — Opus 4.8 trial COMPLETE: 73.3% canonical held-out clear @40/90k

In-flight review (28 agents) confirmed the wiring sound and caught reporting hazards before
the report: MAPPING.md had misquoted the manual baseline (the raw 90k sweep shows Opus
clears 3–7% at several finite caps — non-monotonic; cap 40 never swept; six ∞ win steps
25129–78336) — corrected from the raw CSVs; added Wilson CIs, confounds checklist, policy
provenance sidecar, a **parity gate** (subject runner vs canonical scorer on the final
policy), and an ∞-regime diagnostic row (review's two policy-contingent divergence classes:
exotic malformed moves; in-policy RogueEnv lookahead — neither occurred).

The trial (commit 64d8663 wiring; results archived in `experiments/roguelike-opus48/results/opus48/`):
- Node finished ON ITS OWN: status ok, **171.7 min**, 2.9h — backstop never fired. Tools:
  135 Bash / 74 Edit / 21 Write / 38 Read; 3.8MB trace; report.json written mid-session.
- **Canonical held-out (30 unpredictable seeds, 40/90k): 73.3% clear (22/30)**, Wilson95
  [0.56, 0.86]; win_step median 56 978 (range 29 600–80 085); eval_score mean 1.127; zero
  policy errors. Fixed seeds 2000–2029: 76.7% (23/30), win median 58 361.
- Training 76.9% vs held-out 73.3% — no overfit (self-report ~87% is self-eval, modest gap).
- Baselines on the same seeds: noop 1 872 / greedy 7 193 / smart 8 076 mean score; the
  policy sits at 12.8 on the noop→greedy scale.
- **Parity gate OK** (vendor runner == canonical scorer per-seed, all 8 fields). Audit
  "review" = benign /tmp scratch reads only; workspace clean; no network/MCP/source reach.
- The policy hardcodes `SPEED = 40` — the agent internalized the eval regime; @∞ its
  trajectories are identical (cap non-binding by design; at cap 12 it dies — cap is live).
- Headline vs the manual baseline: manual ∞-developed Opus = 20% @∞, **0/30 at this
  40/90k regime**; gauntlet's 40-developed Opus = **73.3% at 40/90k** (and 76.7% at ∞) —
  developing UNDER the eval regime + the win-first criterion transformed the outcome.
  (Confounds: n=1, criterion+regime bundled — disclosed in MAPPING/report.)

User directive: chain Sonnet 4.6/max then Fable 5/max serially, same conditions, after each
successful completion (mechanical fixes only; design decisions stop for the user).
Sonnet launched: `roguelike-sonnet46-max`.

## 2026-06-12 — Chain complete: Sonnet 16.7% / Opus 73.3% / Fable 90% — INTERIM_REPORT.md final

- **Sonnet 4.6/max** (216.9 min, self-terminated): canonical 16.7% (5/30), fixed-seed 3.3%
  (1/30 — seed-set sensitivity at low rates, both reported), training 30.8% (real overfit),
  fast-but-rare wins (median 40.7k). Audit **flagged**: 1 false-positive credential rule (its
  own session scratch under ~/.claude/projects/<session>/) + 3 REAL read-only repo-metadata
  peeks (`git ls-files | head -20`, `git status`, `cat .gitignore`) — letter-violation of
  "stay within this directory", zero information gain relevant to the eval (held-out seeds
  exist only in orchestrator memory during the session; filenames only, no contents). Result
  stands with disclosure. Post-chain follow-ups noted: scope the .claude credential rule to
  exclude the session's own dirs; consider workspaces outside the framework repo. No
  report.json (the known ~1/2 self-report failure mode). Parity gate OK.
- **Fable 5/max single node** (190.8 min, self-terminated): canonical **90% (27/30)**,
  fixed-seed 80%, win median 40.5k (min 9.6k — fastest win on record for this game),
  eval_score mean 1.469, audit **clean**, parity gate OK, calibrated self-eval (94.2% self vs
  90% canonical). First single-agent Fable datapoint (manual 97% arm was ultracode
  multi-agent). Used in-session background-shell parallelism (31 TaskOutput reads) — within
  the allowlist.
- All three arms: node self-terminated (no backstop ever fired), zero policy errors, zero
  orchestration failures, full artifacts; results archived under
  `experiments/roguelike-opus48/results/{opus48,sonnet46,fable5}/`.
- `INTERIM_REPORT.md` finalized: faithfulness (substrate exact, ordering reproduces the manual
  record), the new win-speed dimension (separates Fable from Opus at similar reliability),
  treatment effect (every arm far above its ∞-developed manual counterpart at 40), confounds.
