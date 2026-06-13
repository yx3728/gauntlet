# Gauntlet: a determinism-first framework for long-horizon LLM-agent evaluation, with a four-model capability study on a bullet-hell roguelike

*Final report. All numbers are recomputed from persisted run artifacts by
`experiments/cohort-v2/master_analysis.py` (the computational appendix, §9);
the figures below are quoted from its output `master_analysis.json`. Repo state
at writing: gym 129/129 + evalkit 63/63 unit tests green.*

---

## Abstract

We present **gauntlet**, a two-library framework for evaluating LLM agents on
**long-horizon, forward-computable tasks**, and a study applying it to a hard
instance: a deterministic headless port of a bullet-hell roguelike whose win
condition (defeat a ~19.5M-HP boss chain) requires hours of in-game survival and
a self-improving build. An agent is a **black box** that develops a *policy*
(a program) against a pinned arena; gauntlet scores that policy on **held-out
seeds it never saw**, in a **canonical environment outside the agent's reach**,
under a **task-declared comparable** (here: win first, then win *fast*). Across
**four Claude models** (Haiku 4.5, Sonnet 4.6, Opus 4.8, Fable 5) on a single
**frozen 80-seed held-out draw**, gauntlet resolves a clean, statistically
separated capability ladder — **Haiku 0.0% ≪ Sonnet 5.3% ≪ Opus 47.1% ≪ Fable
86.3%** clear rate (every adjacent gap p < 1e-4) — and surfaces a second
discriminating axis, **win-speed**, on which Fable dominates Opus (median 40.6k
vs 64.5k steps) despite both clearing reliably. The study also became, by
accident, a severe reliability test: **21 agent sessions, 9 interrupted by six
distinct failure modes** — including an **unannounced provider-side retraction
of Fable access mid-run** and **three account session-limit deaths** — with
**zero artifacts lost** and every interrupted session honestly recovered or
recorded. We argue determinism + canonical scoring + deliverables-on-disk are
the three properties that make an agent eval both *discriminating* and *robust*,
and we release the full reproducibility chain.

---

## 1. Introduction & motivation

Most LLM benchmarks are short-horizon: one prompt, one gradable answer. Agentic
deployments are not — they unfold over hundreds of tool calls and hours of wall
time, where the failure modes are *accumulation* failures (drift, context loss,
giving up, over-fitting to what was tried) rather than single-step mistakes. We
wanted an eval that (a) is genuinely long-horizon, (b) **discriminates** between
frontier models, (c) **localizes why** a model fails, and (d) is **honest and
reproducible** under real-world operational chaos (rate limits, crashes,
provider changes). Games are a convenient first domain: forward-computable,
deterministically replayable, with an unambiguous win condition and a smooth
progress signal — but the framework targets any forward-computable, scorable
task.

The core design stance is **"design general, build minimal"**: the *interfaces*
(three seams) are shaped to admit new tasks, new agent-node kinds, and new
multi-agent coordination topologies; the *build* is a small set of clean API
functions with no CLI and no GUI.

---

## 2. The framework

### 2.1 Two libraries, one boundary

- **Lib1 — `gym/` (JavaScript, zero runtime deps): the environment.** Pluggable
  tasks behind a **task-agnostic interface contract** (`gym/core/CONTRACT.md`):
  `reset(seed,config) → {obs}`, `step(action) → {obs,done,event}`, and a
  **metrics envelope** every task fills (`score`, `progress∈[0,1]`,
  `done_reason∈{win,death,timeout}`, plus task fields). A task is a directory:
  the simulator, a black-box-safe `DESCRIPTION.md`, an `INTERFACE.task.md`, and
  baselines. A **conformance suite** mechanically enforces the contract
  (determinism battery, monotone progress, sanitize-never-throw, terminal
  idempotence, JSON-safety, reserved-key hygiene) over every registered task.
- **Lib2 — `evalkit/` (Python, stdlib only): eval + orchestration.** Two
  modules: `agents` (the **black-box-node** seam — `MockNode` for free e2e,
  `ClaudeCodeNode` for the hardened `claude -p` recipe) and `eval` (`run`,
  `analyze`, `run_cohort`, `cross_score`, `resume` — a few API functions, no
  CLI).
- **The boundary is per-batch.** Python invokes the JS runner once per
  policy×seed-batch (`node run_policy.js --policy … --seeds … --json` → one JSON
  line), never per step.

### 2.2 The three load-bearing properties

1. **Determinism.** Every episode is a pure function of `(seed, action
   sequence)`. All task randomness flows through one seeded PRNG (mulberry32);
   the harness additionally installs a per-episode global `Math.random`
   override. This is verified three ways (closed-loop rerun, fresh-instance
   rerun, open-loop action-log replay → identical trajectory hash) and pinned by
   **state-only golden hashes**. For the ported roguelike we additionally prove
   **cross-runner determinism**: the gauntlet adapter and the original vendored
   runner produce byte-identical 2,000-step trajectories (a subprocess test in
   the suite). Determinism is what makes held-out scoring cheap, replayable, and
   tamper-evident.
2. **Canonical scoring outside the agent's reach.** The agent develops in an
   isolated workspace, but its final policy is re-scored by gauntlet in the
   **pinned canonical arena**, on **held-out seeds that exist only in
   orchestrator memory during the session**. A tampered workspace cannot move a
   score — proven by a tamper-test (a node that overwrites its bundle with an
   "always-win" stub is flagged AND its held-out score is byte-identical to the
   honest run). A **parity gate** re-confirms, per trial, that the agent's own
   runner and the canonical scorer agree per-seed on the final policy.
3. **Deliverables-on-disk as the unit of success.** A policy that exists on disk
   gets scored *regardless of how the session ended*. This single decision is
   why the framework loses nothing under crashes, kills, and provider outages
   (§7).

### 2.3 Black-box integrity

The agent receives a **bundled, minified** task (no source), a neutral
`INTERFACE.md` that documents the *shape* of everything and **says nothing about
how to play well**, and a "store-page" `DESCRIPTION.md`. A trace+workspace
**audit** flags network/MCP use, out-of-workspace reach, source/credential
reads, VCS reach from a non-repo workspace, unexpected tools, and bundle
tampering (workspace re-hash against a sha256 manifest). Held-out seeds are
**never** written into any workspace.

### 2.4 v1 → v2 evolution (driven by a retrospective of the first chain)

The first real chain (§5) was audited adversarially; its validity defects were
fixed in **v2**, each with tests and validated by a free concurrent mock-smoke:

| v2 fix | what it closes |
|---|---|
| **Frozen shared held-out draw** (cohort-level, n≥60) | v1 ran each arm on a *different* unpredictable draw → non-comparable headline numbers |
| **Workspaces outside any repo** + stage results only after the chain | v1 workspaces sat inside the framework git repo; agents could (and did, read-only) reach prior arms' results in commit messages |
| **Condition + cost telemetry → `trial.json`** (context window, compactions, served model, cost, turns; provenance/SHA stamped at run start) | v1 ran one arm at 200k context with 5 auto-compactions under an "identical conditions" claim — undisclosed because the data sat unparsed in the trace |
| **Task-declared criterion seam** (`win_speed`) | v1's generic probe computed overfit on the *farmable raw score* → a false overfit alarm on the best model |
| **Crash-safe persist + `resume()`** | v1 wrote `trial.json` only at the end; an orchestrator crash forfeited the run |
| **Audit trust** (own-scratch whitelist, VCS-in-non-repo rule, unexpected-tool rule) | v1 audits were ~81% false positives from the harness's own scratch dirs, burying the one real finding |
| **Cohort runner** (`run_cohort`, `cross_score`, registry) | v1 hand-rolled per-trial scripts — the source of the v1 reporting bugs |

---

## 3. The game (the task substrate)

**Roguelike Skies** is a vertical bullet-hell shooter ("飞机大战"), ported from a
WeChat mini-game into a deterministic, headless, tick-based simulator (60
logical FPS, no wall clock, no rendering). It is the substrate of the original
manual-trial pipeline; gauntlet vendors the **byte-identical** v2 template
(sha256-verified, all 7 workspace files) so results are comparable to that
pipeline.

- **Controls.** The ship **auto-fires straight up**; the *only* control is
  movement (`move:[dx,dy]`, magnitude-clamped to the **speed cap**). So "playing
  well" is entirely about positioning: dodge dense bullet barrages while keeping
  x-alignment under enemies/boss for damage uptime, and collect the falling
  experience/power-ups.
- **Structure & win condition.** Time-based waves (wave 2 ≈ 60s, boss ≈ 90s),
  then a **chain of bosses** (variants *azure / crimson / void / voidCore*, each
  ~19.5M–50.9M HP). The base ship does ~2,000 DPS; clearing requires *snowballing
  a damage build* by farming the boss's add-swarms for XP → levels → upgrades,
  while surviving 200–350 simultaneous bullets at 450–900 dmg each. **Clearing
  (通关) = defeating the entire boss chain.** Surviving without killing the boss
  does **not** clear. Episodes are deterministic given (seed, actions); the env
  runs ~70k–180k steps/s headless, so thousands of held-out rollouts are nearly
  free.
- **Why it's a good long-horizon eval.** A clear lands at **~14k–90k steps**
  (≈4–25 minutes of game time) — the agent must reason about a *delayed,
  compounding* objective (build before boss), not a greedy one. The eval is
  **discriminating** (the score and progress separate strategies finely) and has
  a hard, unambiguous success bit (win/no-win). Naïve baselines confirm the
  difficulty: **noop, greedy, and a full-interface "smart" heuristic all clear
  0/80** held-out seeds (mean score 1,890 / 9,041 / 9,923) — every interesting
  policy lives in the win regime far above them.

### 3.1 The eval regime and the comparable

- **Regime (pinned, identical across all arms and to v1):** `speed_cap = 40`
  px/tick (a near-human movement ceiling; the original ∞/teleport regime made
  mobility a confound), `max_steps = 90,000` (a long game; most clears finish
  well under it). The agent develops under *exactly* these defaults and is
  scored under them.
- **The comparable (`win_speed`, the one deliberate addition to the v1 prompt,
  declared in task meta):**

      eval_score = cleared ?  1 + (90000 − win_step) / 90000     // a win ∈ (1, 2], earlier = higher
                           :  progress                            // a non-win ∈ [0, 1), below every win

  Winning is the prerequisite; among wins, **sooner is better**. The in-game
  `score` is a tracking reference only (and is farmable — capping survival,
  etc.), so it is **never** the comparable and is **not** shown to the agent as a
  target. The criterion is computed by gauntlet post-hoc and never displayed
  during play.

---

## 4. Methods

- **Subjects.** Four Claude models as black-box `claude -p` nodes, hardened
  recipe (`--strict-mcp-config`, tool allowlist `Bash Read Write Edit Glob
  Grep`, `--disallowedTools WebFetch WebSearch Task`), **effort max**, **no
  artificial horizon** (8h / 2000-turn runaway backstops only). Identical
  sha-gated prompt for every arm: the manual-trial T1 prompt **verbatim** + the
  `win_speed` criterion statement. The agent writes `policy.js`; how it gets
  there is a black box.
- **Held-out scoring.** One **frozen shared draw of 80 seeds** (drawn once,
  unpredictably, from [10⁴, 2³¹), persisted before any arm, passed to every
  arm), plus the manual pipeline's **fixed seeds 2000–2029** as a comparability
  cross-check, plus the three baselines — all on the canonical arena, identical
  across arms.
- **Replication.** Target **N=4 clean reps** per model (a *clean* rep = the node
  finished its own development loop, `node_status == "ok"`). Interrupted reps
  are recovered and scored but **excluded** from pooled statistics and archived
  separately. Pooling concatenates per-seed results across a model's clean reps
  (so between-session variance is visible alongside the pooled estimate).
- **Statistics.** Clear rate with **Wilson 95% intervals**; adjacent-rung
  separation by **two-proportion z-test**; win-speed by the distribution of
  `win_step` among clears. (Computed in `evalkit.eval.criterion` and the
  appendix script — no hand math in the report.)
- **Concurrency.** Arms run in parallel (concurrency 4) in separate processes
  (the global-RNG override is per-process; canonical scoring is a pure function
  of (policy, seed, bundle), so scheduling cannot perturb a result — verified
  byte-identical under parallelism in the mock-smoke).

---

## 5. Results I — the v1 chain (engineering proof, with errata)

The first study chained three models **serially** and established that gauntlet
can take a frontier agent through this game end-to-end and reproduce the manual
pipeline faithfully (vendored substrate byte-identical; the manual trial's
verified clears reproduce *byte-exactly*: seed 2008→win@25129, 2011→win@26827;
parity gate passed on every final policy). Headline: developing **under** the
40/90k regime with the win-first criterion transformed outcomes versus the
manual ∞-developed policies (e.g. the manual Opus policy scores **0/30** at
40/90k; the gauntlet-run Opus cleared ~3/4 of held-out seeds).

A post-hoc adversarial audit then found three **validity defects** in the v1
chain — all corrected in v2 and recorded as errata in `INTERIM_REPORT.md §7`:
(E6) per-arm draws made the headline cross-arm numbers non-comparable; (E3) one
arm silently ran at 200k context with 5 compactions under an "identical
conditions" claim; (E1/E2) results were committed mid-chain into the repo the
workspaces lived in, so later arms could read prior results. **The v2 cohort
(below) is the clean comparison; the v1 chain stands as the engineering proof +
the source of the fixes.** v1 policies, cross-scored on the v2 frozen draw as
caveated references, corroborate v2 (v1-Opus 66/80, v1-Fable 69/80, v1-Sonnet
10/80).

---

## 6. Results II — the v2 cohort (the clean capability study)

All numbers on the **frozen 80-seed draw**, criterion `win_speed`, clean reps
only, pooled. (`master_analysis.json → ladder_frozen`.)

### 6.1 The capability ladder

| model | clean N | per-rep clears /80 | **pooled clear rate** (Wilson 95%) | criterion mean | win_step median |
|---|---|---|---|---|---|
| **Haiku 4.5** | 4 | 0, 0, 0, 0 | **0.0%** (0/320) [0.0, 1.2] | 0.233 | — |
| **Sonnet 4.6** | 4 | 9, 5, 3, 0 | **5.3%** (17/320) [3.3, 8.3] | 0.443 | 53,990 |
| **Opus 4.8** | 3 | 47, 45, 21 | **47.1%** (113/240) [40.9, 53.4] | 0.915 | 64,501 |
| **Fable 5** | 1† | 69 | **86.3%** (69/80) [77.0, 92.2] | 1.460 | 40,604 |

†Fable is frozen at N=1 by **force majeure** — provider access to
`claude-fable-5` was retracted mid-cohort (§7). Its single clean rep is
corroborated exactly by the v1-Fable policy on the same draw (69/80).

**Every adjacent rung is separated with non-overlapping Wilson intervals and a
two-proportion z-test p-value:**

| comparison | rates | p (two-proportion) |
|---|---|---|
| Haiku vs Sonnet | 0.0% vs 5.3% | **3e-5** |
| Sonnet vs Opus | 5.3% vs 47.1% | **< 1e-12** |
| Opus vs Fable | 47.1% vs 86.3% | **< 1e-12** |

The ladder also reproduces on the independent **fixed 2000–2029** seed set
(Haiku 0%, Sonnet 10%, Opus 45%, Fable 93%) — same order, within CI — so the
ranking is not a draw artifact.

### 6.2 The win-speed dimension (a second, orthogonal discriminator)

Clear rate alone conflates "can it win" with "how well". `win_step` among clears
separates the two strong models that clear-rate nearly ties on capability:

| model | wins | win_step min / median / max |
|---|---|---|
| Sonnet 4.6 | 17 | 28,533 / 53,990 / 83,658 |
| Opus 4.8 | 113 | 16,740 / **64,501** / 89,809 |
| Fable 5 | 69 | 13,988 / **40,604** / 66,516 |

**Fable does not merely clear more often — it clears ~37% *faster* than Opus**
(median 40.6k vs 64.5k steps; criterion mean 1.46 vs 0.91). Opus is a patient
grinder that wins late in the budget; Fable wins decisively early. This is the
qualitative signature the manual pipeline (clear-rate only) could not see, now
quantified.

### 6.3 Between-session variance (why N matters)

The per-rep clears expose large session-to-session variance that single runs
cannot reveal — most starkly **Opus: 21, 45, 47 /80** (26% → 59% across
identical conditions and seeds). Sonnet's first-ever rep (9/80 = 11.3%) looked
like a real signal; four reps reveal a true rate near **5.3%** — the lucky-draw
correction made concrete. **N=1 is structurally unsafe for per-model rates on
this task; N≥3 is the floor.** (Haiku's 0/320 is the one case where N=1 would
already have been conclusive.)

### 6.4 Conditions — context window is confounded with model tier (REQUIRED caveat)

| model | context window | compactions / rep | cost / clean rep |
|---|---|---|---|
| Haiku 4.5 | **200k** | 0,0,0,0 | ~$1.0 |
| Sonnet 4.6 | **200k** | 3,5,5,3 | ~$13–27 |
| Opus 4.8 | **1M** | 0,0,0 | ~$46–57 |
| Fable 5 | **1M** | 0 | ~$87 |

Context window is **bound to tier** (the served default per model) and cannot be
equalized across models — a 200k Haiku and a 1M Opus are *different deployments*.
We therefore **record and caveat** rather than control: **this study measures
models-as-deployed, not context-controlled reasoning capability.** The
confound's mechanism is visible — only the 200k arms compact (Sonnet 3–5× per
session, periodically losing ~90% of working memory; the 1M arms never do), and
in the v1 chain a compaction demonstrably destroyed a deliverable. Cost spans
**~90× across the ladder**.

---

## 7. Results III — robustness (the framework as a scientific instrument)

The cohort was, unintentionally, the hardest reliability test gauntlet has
faced. Of **21 roguelike sessions run, 9 were interrupted** by **six distinct
failure modes**; **every artifact survived and every interrupted session was
honestly recovered or recorded** (`master_analysis.json → robustness_*`).

| failure mode | count | examples | gauntlet outcome |
|---|---|---|---|
| Operator kill (SIGKILL) | 2 | early fable arms | one had no policy → honest `no_policy`; one had a policy → collected + scored, marked truncated |
| **Account session-limit death** | 3 | sonnet46-r2; makeup4 opus + sonnet | policy-on-disk collected + scored; `nonzero_exit` recorded |
| **Provider retracts Fable access mid-run** | 2 | makeup2/3 fable | API: *"issue with the selected model… may not exist or you may not have access"*; one partial policy scored, one `no_policy`; both archived, **not counted** |
| API socket error | 1 | makeup sonnet | collected + scored, truncated |
| SIGTERM (exit 143) | 1 | makeup7 opus | collected + scored (55/80), truncated |
| *(orchestrator-crash path)* | — | proven in mock-smoke | `trial.json{status:running}`+split persisted pre-session; `resume()` re-enters at scoring, byte-identical |

**Result: 12 clean reps, 9 partials, 0 artifacts lost.** Every cost, context
window, compaction count, and death cause in this report was read back from the
persisted traces of these sessions — including the ones that died. The two Fable
terminations are the sharpest case: an **unannounced, irreversible, provider-side
capability retraction** (access withdrawn for all users, confirmed by a post-hoc
smoke) — an event no harness can prevent — and gauntlet still collected and
correctly classified both runs, lost nothing, and **kept the clean dataset
uncontaminated** (the partials are excluded by the `clean` predicate, archived
under `experiments/cohort-v2/results-partial/`). Per discipline, **no run was
ever deleted**; all 21 remain on disk.

Why nothing was lost, by design: *deliverables-on-disk* (a policy that exists is
scored however the session ended), *continuous trace persistence* (the trace is
the honest record), *per-arm failure containment* (one dead arm never aborts the
cohort), and *crash-safe early persist + resume*. For a scientific instrument,
surviving infrastructure chaos uncorrupted is itself a primary result.

### 7.1 Concurrency observations (first test of the parallel mechanism)

Concurrency-4 worked with **zero cross-arm interference**: parallel arms ran in
separate processes; the mock-smoke verified byte-identical canonical scoring
across 3 concurrent same-policy arms; the live cohort showed no cross-arm bleed
(distinct policies → distinct results; the registry append is lock-guarded).
Sessions are think/API-bound, not CPU-bound, so overbooking 4 multi-hour
sessions caused no result-affecting contention; throughput was bounded by the
slowest arm per wave. Determinism is independent of scheduling.

---

## 8. Discussion, limitations, threats to validity

- **N is uneven and Fable is N=1.** Haiku/Sonnet reached N=4, Opus N=3, Fable
  N=1 (force majeure). The Haiku null (0/320) and the Sonnet/Opus separations
  are robust; **Fable's 86.3% rests on one clean session** (corroborated by the
  v1-Fable policy at 69/80 on the same draw, but not independent development).
  Fable's *rank* (top) is safe; its *rate* should be read as N=1.
- **Context confound (§6.4).** The headline ladder is *models-as-deployed*.
  Disentangling tier from context window would require serving each model at a
  matched window — not generally possible — so we do not claim a
  context-controlled capability ordering.
- **Single task, single domain.** This is one game. The framework is
  task-agnostic by construction (two structurally different small games pass the
  same conformance suite and ran the same pipeline), but cross-domain
  generality (e.g. a coding task) is designed-for, not yet demonstrated.
- **Criterion choice is a value judgment.** `win_speed` rewards fast wins; a
  different deployment might weight robustness or cost. The seam makes the
  criterion a one-line task declaration, so alternatives are cheap to compute on
  the same data.
- **The agent is cooperative.** The audit is an integrity *triage* for honest
  agents (it caught the only real boundary event in v1 — a read-only repo peek),
  not a security sandbox against an adversary; the real score-integrity guarantee
  is structural (canonical scoring + memory-only seeds), not the audit.
- **Self-reports are lossy.** `report.json` capture is ~2/3 (compaction and
  kills eat it); it is never load-bearing — policy.js-on-disk is what's scored.

---

## 9. Reproducibility (computational appendix)

Everything in this report is recomputable from persisted artifacts, offline:

- **`experiments/cohort-v2/master_analysis.py`** — recomputes every number here
  (ladder, Wilson CIs, adjacent-rung p-values, win-speed distributions,
  conditions, baselines, v1 cross-scores, robustness ledger) and writes
  **`master_analysis.json`** (committed). Run: `python3
  experiments/cohort-v2/master_analysis.py`.
- **Determinism guarantee.** Re-scoring any policy on any seed set reproduces
  byte-identically (mulberry32 PRNG + pinned bundle, sha-recorded per trial);
  the cross-runner test in the gym suite proves the canonical scorer matches the
  vendored runner. So "derived" batches (e.g. the @∞ diagnostic, fixed-seed
  cross-checks) are regenerable from `policy.js` + the pinned task version.
- **Provenance.** Each `trial.json` records the task version + bundle sha256, the
  frozen split, gauntlet git SHA (stamped at run start in v2), node/CLI/OS
  versions, served model, context window, compactions, cost, and turns. The
  frozen draw lives in `runs/cohorts/cohort-v2-n2/cohort.json`.
- **Data layout.** Clean + partial runs under `runs/cohort-v2-n2*-*/` (bulk,
  gitignored, never deleted); committed derived artifacts and archives under
  `experiments/cohort-v2/` (incl. `results-partial/` with a README per
  terminated wave) and `experiments/roguelike-opus48/` (v1 + the vendored
  substrate's sha registry). Traces are sanitizable for sharing
  (system/rate-limit events stripped — they enumerate host tool inventory —
  $HOME/emails redacted) via the v1 salvage tooling.
- **Tests.** `cd gym && node tests/run_tests.js` (129/129) and `cd evalkit &&
  python3 -m pytest -q` (63/63) validate the contract, determinism, the criterion
  seam, audit rules, crash/resume, and the cohort runner.

---

## 10. Conclusion & future work

Gauntlet resolves frontier Claude models into a **clean, statistically separated
capability ladder** on a genuinely long-horizon task — **Haiku ≪ Sonnet ≪ Opus
≪ Fable** — and adds a second discriminating axis, **win-speed**, that
distinguishes the two strongest models beyond clear-rate. As much to the point,
it did so while absorbing **nine session interruptions across six failure modes,
including a mid-study provider access retraction, with zero data loss** — the
determinism-first, canonical-scoring, deliverables-on-disk design paying off
exactly where evals usually break.

**Immediate next step (flagged, not taken — held for budget/decision):** one more
clean Opus rep would bring Opus to the N=4 target; a second clean Fable rep is
foreclosed unless access returns. **Beyond:** the designed-but-unbuilt seams — a
**non-game task** (coding/algorithm) to claim cross-domain generality; a
**local-agent node** kind; **multi-agent coordination topologies** (the manual
pipeline's "scaffolding ladder") — plus a built-in heartbeat/`watch` for live
observability and an optional finalize-nudge for `report.json` capture.

**Experiment ledger:** 21 roguelike agent sessions (12 clean + 9 interrupted);
clean-rep spend ≈ **$325**; total cohort spend incl. recovered partials ≈
**$461**; v1 chain ≈ $158. Framework green: gym 129/129, evalkit 63/63.

---

*Appendix tables and all per-seed data: `experiments/cohort-v2/master_analysis.json`,
`experiments/cohort-v2/results-partial/`, `INTERIM_REPORT.md` (chronological lab
record incl. v1 errata), `DESIGN.md`, `gym/core/CONTRACT.md`.*
