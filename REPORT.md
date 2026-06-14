# Gauntlet: a determinism-first framework for long-horizon LLM-agent evaluation — a four-model capability study on a bullet-hell roguelike, and a test of whether a cognitive scaffold moves the metric

*Canonical report. Every number is recomputed from persisted run artifacts by
two committed appendices: `experiments/cohort-v2/master_analysis.py` (bare
cohort, §6–7, output `master_analysis.json`) and
`experiments/scaffold-mono/cog_vs_bare.py` (the +cognitive experiment, §8,
output `cog_vs_bare.json`). Figures below are quoted from those outputs. Repo
state at writing: gym 129/129 + evalkit 63/63 unit tests green. **The +cognitive
experiment (§8) is now closed: all 9 cognitive arms are terminal — 7 clean
(Haiku ×3, Sonnet ×1, Opus ×3); the other 2 Sonnet arms ground to the 8h
wall-clock backstop and are excluded as partials (itself a finding, §8).***

---

## Abstract

We present **gauntlet**, a two-library framework for evaluating LLM agents on
**long-horizon, forward-computable tasks**, and two studies on a hard instance:
a deterministic headless port of a bullet-hell roguelike whose win condition
(defeat a ~19.3–50.9M-HP boss chain) requires hours of in-game survival and a
self-improving build. An agent is a **black box** that develops a *policy* (a
program) against a pinned arena; gauntlet scores that policy on **held-out seeds
it never saw**, in a **canonical environment outside the agent's reach**, under a
**task-declared comparable** (here: win first, then win *fast*).

**Study 1 — the capability ladder (bare prompt).** Across **four Claude models**
(Haiku 4.5, Sonnet 4.6, Opus 4.8, Fable 5) on a single **frozen 80-seed held-out
draw**, gauntlet resolves a clean, statistically separated ladder — **Haiku 0.0%
≪ Sonnet 5.3% ≪ Opus 47.1% ≪ Fable 86.3%** clear rate (every adjacent gap p <
1e-4) — and surfaces a second discriminating axis, **win-speed**, on which Fable
dominates Opus (median 40.6k vs 64.5k steps) despite both clearing reliably.

**Study 2 — does a cognitive scaffold help?** We ran the *same* arms
on the *same* frozen draw with one change — an added **"How to work" cognitive
structure** (observe → plan → implement → evaluate, with a required written
memory). This is the local-harness **M0 (goal-only) vs M1 (cognitive-flow)**
contrast ported to frontier Claude. The honest answer: the scaffold
is **followed strongly and sustainedly** (all 7 clean arms wrote rich
GAME_MODEL.md + WORKLOG.md; Sonnet held the loop through 10 auto-compactions and
produced a correct quantitative diagnosis) but **does not move the clear-rate**
on any tier measured so far — **Haiku 0.0%→0.0%, Sonnet 5.3%→5.0% (N=1), Opus
47.1%→43.8%** (all bare-vs-cog p ≥ 0.46). The limiter is **coder execution / raw
task difficulty**, not the absence of cognitive structure — consistent with the
northstar thesis that once memory/cognition is supplied the binding constraint
migrates downstream. A cost-side finding: both Sonnet +cog follow-up arms
**ground to the 8h wall-clock backstop** (vs bare Sonnet finishing in 2.5–3.7h)
without payoff — the scaffold's keep-iterating discipline can induce unproductive
long grinding in a model that cannot break the execution ceiling.

**Study 1 also became a severe reliability test by accident:** **21 bare
sessions, 9 interrupted by six distinct failure modes** — including an
**unannounced provider-side retraction of Fable access mid-run** and **three
account session-limit deaths** — with **zero artifacts lost**. We argue
determinism + canonical scoring + deliverables-on-disk are the three properties
that make an agent eval both *discriminating* and *robust*, and we release the
full reproducibility chain.

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

The framework also lets us run **controlled prompt ablations** on the same
substrate: Study 2 changes exactly one thing in the agent's instructions (adds a
cognitive loop) and re-measures, isolating the contribution of *how the agent is
told to think* from *what it is asked to do*.

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
  **metrics envelope** every task fills (`score`, `progress∈[0,1]` monotone,
  `done_reason∈{win,death,timeout}`, plus task fields). A task is a directory:
  the simulator (`env.js`, may only use `core/prng.js`), a black-box-safe
  `DESCRIPTION.md`, an `INTERFACE.task.md`, and `baselines/` (noop + an
  interface-sufficiency greedy). A **conformance suite**
  (`gym/tests/conformance.test.js`) mechanically enforces the contract —
  determinism battery, monotone progress, sanitize-never-throw, terminal
  idempotence, JSON-safety, reserved-key hygiene
  (`seed/steps/events/policy_error/_gamelog` are harness-reserved) — over every
  registered task.
- **Lib2 — `evalkit/` (Python, stdlib only): eval + orchestration.** Two
  modules: `agents` (the **black-box-node** seam — `MockNode` for free e2e,
  `ClaudeCodeNode` for the hardened `claude -p` recipe) and `eval` (`run`,
  `analyze`, `run_cohort`, `cross_score`, `resume`, `score_policy` — a few API
  functions, no CLI).
- **The boundary is per-batch.** Python invokes the JS runner once per
  policy×seed-batch (`node run_policy.js --policy … --seeds … --json` → one JSON
  line), never per step.

### 2.2 The three load-bearing properties

1. **Determinism.** Every episode is a pure function of `(seed, action
   sequence)`. All task randomness flows through one seeded PRNG (mulberry32)
   constructed inside `reset()`; module-level mutable state is forbidden; the
   harness additionally installs a per-episode global `Math.random` override.
   This is verified three ways (closed-loop rerun, fresh-instance rerun,
   open-loop action-log replay → identical trajectory hash) and pinned by
   **state-only golden hashes** (state = obs minus metrics, so additive metric
   fields don't invalidate goldens). For the ported roguelike we additionally
   prove **cross-runner determinism**: the gauntlet adapter and the original
   vendored runner produce byte-identical 2,000-step trajectories (a subprocess
   test in the suite). Determinism is what makes held-out scoring cheap,
   replayable, and tamper-evident.
2. **Canonical scoring outside the agent's reach.** The agent develops in an
   isolated workspace, but its final policy is re-scored by gauntlet in the
   **pinned canonical arena**, on **held-out seeds that exist only in
   orchestrator memory during the session**. A tampered workspace cannot move a
   score — proven by a tamper-test (a node that overwrites its bundle with an
   "always-win" stub is flagged AND its held-out score is byte-identical to the
   honest run). A **parity gate** re-confirms, per trial, that the agent's own
   runner and the canonical scorer agree per-seed on the final policy. (Verified
   in §8 for the cognitive arms too: no held-out seed ever appears in any
   workspace; the one path-rule "leak" alarm was a false positive — a held-out
   seed value coincidentally embedded in a float `move` coordinate, §8.4.)
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
**never** written into any workspace. The audit is *integrity triage* for honest
agents, not a security sandbox (§9); the real score-integrity guarantee is
structural (canonical scoring + memory-only seeds).

### 2.4 The three seams (the "design general" surface)

1. **Task seam** — the `gym/core/CONTRACT.md` interface: any forward-computable
   task plugs in behind `reset`/`step`/metrics and passes the same conformance
   suite.
2. **Black-box-node seam** — `agents`: `claude -p` today; a local-agent node or a
   multi-agent topology slots in the same place (the node is whatever produces a
   `policy.js` on disk).
3. **Criterion seam** — the task **declares its comparable** in meta
   (`{kind, cap}`), carried through the arena manifest; evalkit computes it
   everywhere the comparable matters (`evalkit/eval/criterion.py`). `win_speed`
   here; alternatives are a one-line task declaration evaluable on the same
   per-seed data. The criterion is **never shown to the agent during play** — it
   is post-processing over the persisted metrics envelope.

### 2.5 v1 → v2 evolution (driven by a retrospective of the first chain)

The first real chain (§5) was audited adversarially; its validity defects were
fixed in **v2**, each with tests and validated by a free concurrent mock-smoke:

| v2 fix | what it closes |
|---|---|
| **Frozen shared held-out draw** (cohort-level, n≥60) | v1 ran each arm on a *different* unpredictable draw → non-comparable headline numbers (erratum E6) |
| **Workspaces outside any repo** + stage results only after the chain | v1 workspaces sat inside the framework git repo; agents could (and did, read-only) reach prior arms' results in commit messages (E1/E2) |
| **Condition + cost telemetry → `trial.json`** (context window, compactions, served model, cost, turns; provenance/SHA stamped at run start) | v1 ran one arm at 200k context with 5 auto-compactions under an "identical conditions" claim — undisclosed because the data sat unparsed in the trace (E3) |
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
(sha256-verified, all 7 workspace files; bundle `424916b286c9…`) so results are
comparable to that pipeline.

- **Controls.** The ship **auto-fires straight up**; the *only* control is
  movement (`move:[dx,dy]`, magnitude-clamped to the **speed cap**). So "playing
  well" is entirely about positioning: dodge dense bullet barrages while keeping
  x-alignment under enemies/boss for damage uptime, and collect the falling
  experience/power-ups. (Agents rediscover this — e.g. an Opus +cog
  GAME_MODEL.md notes "Holding at x=180 ⇒ 0 kills because enemies spawn at varied
  x".)
- **Structure & win condition.** Time-based waves (wave 2 ≈ 60s, boss ≈ 90s),
  then a **chain of bosses** (variants *azure / crimson / void / voidCore*, ~19.3M
  / 20.3M / 50.9M HP). The base ship does ~2,400 DPS; clearing requires
  **snowballing a damage build** by farming the boss's add-swarms for XP → levels
  → upgrades, while surviving 40–74+ simultaneous bullets at ~450 dmg each.
  **Clearing (通关) = defeating the entire boss chain.** Surviving without killing
  the boss does **not** clear. Episodes are deterministic given (seed, actions);
  the env runs ~70k–180k steps/s headless, so thousands of held-out rollouts are
  nearly free.
- **Why it's a good long-horizon eval.** A clear lands at **~14k–90k steps**
  (≈4–25 minutes of game time) — the agent must reason about a *delayed,
  compounding* objective (build before boss), not a greedy one. The eval is
  **discriminating** (the score and progress separate strategies finely) and has
  a hard, unambiguous success bit (win/no-win). Naïve baselines confirm the
  difficulty: **noop, greedy, and a full-interface "smart" heuristic all clear
  0/80** held-out seeds — every interesting policy lives in the win regime far
  above them. The agents independently surface the binding numbers: a Sonnet +cog
  WORKLOG computes "Minimum DPS to win: 19.3M / (90000 − 5400) = 228 dmg/step,"
  then diagnoses why its best build (173 dmg/step) times out.

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
  artificial horizon** (8h / 2000-turn runaway backstops only). The agent writes
  `policy.js`; how it gets there is a black box.
- **Two prompt conditions on the same substrate.** *Bare* (Study 1): the
  manual-trial T1 prompt **verbatim** + the `win_speed` criterion statement.
  *+Cognitive* (Study 2): the bare prompt + a "How to work" cognitive structure
  (`experiments/scaffold-mono/PROMPT.md`). Both are sha-gated; all cog arms used a
  byte-identical prompt (md5 `61758d96…`). Substrate bundle, criterion, task
  version, regime, and frozen draw are **identical** between conditions (verified
  per-trial). *Caveat (§8.5): the cog prompt is not a pure superset — it also
  removes the bare prompt's `report.json` deliverable and adds a multi-seed
  practice hint; treat the "only delta is cognition" claim as approximate.*
- **Held-out scoring.** One **frozen shared draw of 80 seeds** (drawn once,
  unpredictably, from [10⁴, 2³¹), persisted before any arm in
  `runs/cohorts/cohort-v2-n2/cohort.json`, passed to every arm of both studies —
  verified identical for all cog arms), plus the manual pipeline's **fixed seeds
  2000–2029** as a comparability cross-check, plus the three baselines — all on
  the canonical arena, identical across arms.
- **Replication.** A *clean* rep = the node finished its own development loop
  (`trial.json` node.status == `"ok"`). Interrupted reps are recovered and scored
  but **excluded** from pooled statistics and archived separately. **In-flight**
  reps (top-level status `"running"`, no `heldout.json` yet) are skipped
  entirely. Pooling concatenates per-seed results across a model's clean reps (so
  between-session variance is visible alongside the pooled estimate).
- **Statistics.** Clear rate with **Wilson 95% intervals**; condition/arm
  separation by **two-proportion z-test**; win-speed by the distribution of
  `win_step` among clears. (Computed in `evalkit.eval.criterion` and the two
  appendix scripts — no hand math in the report.)
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

A post-hoc adversarial audit then found **validity defects** in the v1 chain —
all corrected in v2 and recorded as errata in `INTERIM_REPORT.md §7`: (E6)
per-arm draws made the headline cross-arm numbers non-comparable; (E3) one arm
silently ran at 200k context with 5 compactions under an "identical conditions"
claim; (E1/E2) results were committed mid-chain into the repo the workspaces
lived in, so later arms could read prior results. **The v2 cohort (below) is the
clean comparison; the v1 chain stands as the engineering proof + the source of
the fixes.** v1 policies, cross-scored on the v2 frozen draw as caveated
references, corroborate v2 (v1-Opus 66/80, v1-Fable 69/80, v1-Sonnet 10/80).

---

## 6. Results II — the v2 cohort, bare prompt (the clean capability study)

All numbers on the **frozen 80-seed draw**, criterion `win_speed`, clean reps
only, pooled. (`master_analysis.json → ladder_frozen`; re-derived byte-identically
on rerun.)

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
already have been conclusive.) This variance recurs and *widens* under the
cognitive prompt (Opus +cog reps 42/9/54 — §8.1), reinforcing the N≥3 rule.

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

The bare cohort was, unintentionally, the hardest reliability test gauntlet has
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
slowest arm per wave. Determinism is independent of scheduling. The +cognitive
experiment (§8) re-confirmed this at concurrency 4 across mixed Haiku/Sonnet/Opus
arms.

---

## 8. Results IV — the cognitive-scaffold experiment (M0 vs M1 analog)

**The question.** The bare cohort (§6) tells the agent *what* to do (clear the
game, win-fast criterion) but not *how to think*. The local multi-agent harness
has a stronger arm — **M1 (cognitive-flow)** — that enforces an
observe→plan→implement→evaluate loop across role-agents communicating through
files, vs **M0 (goal-only)**. Study 2 ports that contrast to frontier Claude: the
**bare cohort prompt is the M0-analog**, and a single agent given a **"How to
work" cognitive structure** (folding analyst/strategist/coder/evaluator into one
self-run loop, with a required written memory `GAME_MODEL.md` + `WORKLOG.md` to
survive auto-compaction) is the **M1-analog**. Same frozen draw, same substrate,
same `win_speed` criterion (`experiments/scaffold-mono/PROMPT.md`, README,
INVESTIGATION_WORKLOG.md). The driving hypothesis (northstar): if cognitive
structure helps where it matters, the gain should appear most where execution is
*not* already the bottleneck.

**Status (closed).** 9 cognitive arms launched, all now terminal; **7 are clean**
(Haiku ×3, Sonnet ×1, Opus ×3) and pooled below. The other **2 Sonnet arms both
ran to the 8h wall-clock backstop** (`timeout_killed`, 0/80 and 1/80) and are
excluded as partials — see §8.3 (this is itself a finding: 2-of-3 Sonnet
follow-ups grinding to the wall, vs bare Sonnet finishing in 2.5–3.7h). All clean
arms scored the exact frozen n=80 draw (verified). `cog_vs_bare.json` is the
committed appendix and reproduces these numbers.

### 8.1 The bare-vs-+cognitive table (clean, frozen n=80, pooled)

| model | bare clear (clean N) | **+cog clear (clean N)** | crit mean bare→cog | bare-vs-cog p | note |
|---|---|---|---|---|---|
| **Haiku 4.5** | 0/320 = 0.0% (N4) | **0/240 = 0.0%** (N3) [0.0, 1.6] | 0.233 → 0.198 | **1.0** | flat — identical |
| **Sonnet 4.6** | 17/320 = 5.3% (N4) | **4/80 = 5.0%** (N1; 2 follow-ups timed out at 8h, excluded) [2.0, 12.2] | 0.443 → 0.515 | 0.91 | within noise |
| **Opus 4.8** | 113/240 = 47.1% (N3) | **105/240 = 43.8%** (N3) [37.6, 50.1] | 0.915 → 0.841 | 0.46 | within noise |

Per-rep +cog clears /80: **Haiku** 0,0,0; **Sonnet** 4 (N=1); **Opus** 42, 9, 54.

**Headline: the cognitive scaffold does not move the clear-rate on any tier
measured so far.** Haiku is identical (0.0%, criterion even fractionally lower).
Sonnet is statistically indistinguishable (5.0% vs 5.3%; criterion edges up
0.443→0.515, well within its bare per-rep spread of 0–9/80, N=1 only). **Opus —
the pre-registered key test (the one tier where execution is *not* the
bottleneck, bare 47%) — also shows no improvement:** 43.8% vs 47.1%, p=0.46,
Wilson intervals heavily overlapping. The Opus +cog arms are *more* variable than
bare (42/9/54 vs 21/45/47), pooling to a rate inside the bare CI.

### 8.2 Compliance — strong and sustained (the scaffold IS followed)

This is not a "the agent ignored the instructions" null. Compliance is robust
(`cog_vs_bare.json → compliance`):

- **All 7 clean arms wrote both `GAME_MODEL.md` and `WORKLOG.md`** (the required
  written memory) — Haiku 0.9–2.3 kB, Sonnet 2.9–4.4 kB, Opus 6.7–9.1 kB
  GAME_MODEL and up to 10.8 kB WORKLOG.
- **The loop survives auto-compaction.** The Sonnet test arm ran **442 turns
  through 10 auto-compactions** at 200k context and kept a structured WORKLOG to
  the end — the written-memory mechanism doing exactly its designed job (the Opus
  1M arms never compacted, 255–299 turns).
- **The loop is real, not cargo-culted.** Sonnet stated an explicit ranking rule
  ("Win (boss_cleared) > progress% → max(boss_hp_destroyed) → survived_ms") and
  ran genuine observe→plan→implement→evaluate iterations with numbered attempts
  and diagnoses.

### 8.3 Cognition — load-bearing where execution is, defeatist where it isn't

The quality of the *thinking* separates the tiers cleanly:

- **Opus (+cog): the loop pays its way in execution, but doesn't beat bare.** The
  best Opus +cog WORKLOG is a textbook M1 trajectory — it *discovered the win
  recipe* ("survive early boss → collect exp → snowball lvl → huge DPS +
  lifesteal → grind down MULTIPLE bosses → WIN"), *diagnosed the bottleneck*
  ("THE BOTTLENECK = early-boss survival … survivors snowball to easy wins; dying
  seeds get CORNERED by dense aimed bullet-fans"), built on best-so-far across
  many versions, and ran a *true held-out check* ("policy_best on never-seen seeds
  111-130 = 11 wins/7 deaths/2 timeouts … true held-out ~55% win"). The cognition
  was correct and the execution capable — yet the pooled outcome lands on top of
  bare. Structure helped Opus *organize* the work it could already do; it did not
  unlock new capability.
- **Sonnet (+cog): correct quantitative diagnosis, execution-limited.** It derived
  the binding constraint itself — "Minimum DPS to win: 228 dmg/step … Old v3 got
  173 … CANNOT win with 173 dmg/step!" — and localized why specific seeds die
  ("enemy cluster at x=72-74 … Body avoidance too weak to override target force").
  The M1 loop worked; the code to realize the fix did not reliably land. Metric
  flat — and **costly**: 2 of 3 Sonnet +cog arms ran the *full 8h backstop*
  (`timeout_killed`, 10 and 8 compactions) to 0/80 and 1/80, where bare Sonnet
  finished in 2.5–3.7h. The scaffold's "keep iterating, don't stop early"
  discipline, applied by a model that diagnoses correctly but can't execute the
  fix, turns into open-ended grinding rather than convergence.
- **Haiku (+cog): the scaffold can lead to a confident dead-end.** Haiku complied
  (wrote both files) but reasoned itself into a *wrong, defeatist* conclusion and
  converged to the bare hold-position policy. From a Haiku +cog WORKLOG: *"Boss
  defeated: NEVER … Required total damage: 19,300,000 (exceeds ~90,000 step
  capacity by 42,000x) … defeating it is infeasible."* (The arithmetic is wrong —
  it ignores damage scaling from upgrades, which Sonnet/Opus correctly model.)
  Cognitive structure does not move Haiku; it converges to the same hold-position
  policy and, given a place to reason, reasons itself out of trying. Two of three
  Haiku +cog policies are ≤17-line hold-still stubs.

### 8.4 Integrity check (trust-but-verify on the new arms)

- **No held-out leak.** Held-out seeds appear in **zero** cog workspaces. A
  path-rule "leak" alarm on the Sonnet test arm was a **false positive**: the
  held-out seed value `99055528` appears only as a substring inside a float `move`
  coordinate (`-3.9905552860…`) the agent logged for its *own* training seed —
  not as a seed.
- **Audit findings are benign triage.** Cog audits verdict `review` (one
  `flagged`). The Sonnet arm's `credential_access` flag was the agent reading its
  **own Claude Code session transcript** (`~/.claude/projects/…/SESSION.jsonl`) to
  recover work lost in a compaction — a self-scratch read mislabeled by a
  path-based rule, structurally unable to affect the canonical score. The
  pervasive `absolute_path_outside_workspace` findings are reads of the agent's
  own workspace via its real `~/.gauntlet/workspaces/…` path.

### 8.5 Interpretation and the limiting caveat

The verdict: **the cognitive structure is followed, real, and
load-bearing on the *process* — but it does not move the clear-rate metric at any
tier measured so far.** This is consistent with the northstar thesis that, once
memory and a cognitive loop are supplied, the **binding constraint migrates to
coder execution and raw task difficulty** — for Haiku, the model can't form a
correct world-model and gives up; for Sonnet, it diagnoses correctly but can't
reliably code the fix; for Opus, it can do both but the task ceiling under this
regime sits where bare already reached it. The Opus result is the strongest
single data point and it is a clean *null*: structure did not help even where
execution was not the bottleneck — at least at N=3.

**Caveats specific to this experiment (do not over-read):**
1. **Sonnet +cog is N=1 clean.** Both Sonnet follow-up arms hit the 8h backstop
   (partials, 0/80 and 1/80) — so the Sonnet *rate* rests on one clean rep (4/80),
   though all three Sonnet attempts (clean + partial) land ≤4/80, below the bare
   max of 9. Opus and Haiku are N=3 clean. The forced timeouts are a real
   cost-side effect (§8.3), not just missing data.
2. **The prompt is not a pure superset.** Beyond the cognitive section, the +cog
   prompt **removes the bare prompt's `report.json` deliverable** and **adds a
   multi-seed practice hint**. The README's "everything else identical" is
   approximate; these minor deltas are confounded into the cognitive treatment.
   (We judge them small — neither touches game strategy and both go in directions
   that, if anything, *help* the cog arm — but they are not nothing.)
3. **Single task, N≤3 per cell.** A null on one game at N≤3 is suggestive, not a
   general claim that cognitive scaffolds don't help frontier agents.

---

## 9. Discussion, limitations, threats to validity

- **N is uneven; Fable is N=1; cognitive Sonnet is N=1 clean (2 timed out).** Bare:
  Haiku/Sonnet N=4, Opus N=3, Fable N=1 (force majeure). Cognitive: Haiku/Opus
  N=3, Sonnet N=1 (+2 running). The Haiku null and the Sonnet/Opus *bare*
  separations are robust; **Fable's 86.3% and Sonnet's +cog 5.0% each rest on a
  single clean session** (Fable corroborated by the v1-Fable policy at 69/80;
  Sonnet +cog not yet). Read those rates as N=1.
- **Context confound (§6.4).** The headline ladder is *models-as-deployed*.
  Disentangling tier from context window would require serving each model at a
  matched window — not generally possible — so we do not claim a
  context-controlled capability ordering. The cognitive experiment holds tier
  fixed within each comparison, so the §8 contrast is **not** context-confounded
  (a 200k Sonnet bare vs a 200k Sonnet +cog).
- **The cognitive prompt is not a clean single-variable ablation (§8.5).** It also
  drops `report.json` and adds a multi-seed hint.
- **Single task, single domain.** This is one game. The framework is task-agnostic
  by construction (two structurally different small games pass the same
  conformance suite and ran the same pipeline), but cross-domain generality (e.g.
  a coding task) is designed-for, not yet demonstrated.
- **Criterion choice is a value judgment.** `win_speed` rewards fast wins; a
  different deployment might weight robustness or cost. The seam makes the
  criterion a one-line task declaration, so alternatives are cheap to compute on
  the same data.
- **The agent is cooperative.** The audit is an integrity *triage* for honest
  agents (it caught the only real boundary event in v1 — a read-only repo peek,
  and correctly triaged the §8.4 false positives), not a security sandbox against
  an adversary; the real score-integrity guarantee is structural (canonical
  scoring + memory-only seeds), not the audit.
- **Self-reports are lossy.** `report.json` capture is partial (compaction and
  kills eat it); the cognitive arms drop it entirely by design. It is never
  load-bearing — policy.js-on-disk is what's scored.

---

## 10. Reproducibility (computational appendix)

Everything in this report is recomputable from persisted artifacts, offline:

- **`experiments/cohort-v2/master_analysis.py`** — recomputes every §5–7 number
  (ladder, Wilson CIs, adjacent-rung p-values, win-speed distributions,
  conditions, baselines, v1 cross-scores, robustness ledger) → **`master_analysis.json`**
  (committed). Verified to reproduce byte-identically on rerun. Run: `python3
  experiments/cohort-v2/master_analysis.py`.
- **`experiments/scaffold-mono/cog_vs_bare.py`** — recomputes every §8 number
  (per-arm roster with state/served-model/compactions, the bare-vs-+cognitive
  table with Wilson CIs and two-proportion p-values, the compliance summary, and
  the prompt-delta honesty check) → **`cog_vs_bare.json`** (committed). It reads
  the bare baseline straight out of `master_analysis.json` (single source of
  truth) and **excludes partial/timed-out arms gracefully**. The experiment is
  closed; the script reproduces §8's numbers. Run: `python3
  experiments/scaffold-mono/cog_vs_bare.py`.
- **Determinism guarantee.** Re-scoring any policy on any seed set reproduces
  byte-identically (mulberry32 PRNG + pinned bundle, sha-recorded per trial); the
  cross-runner test in the gym suite proves the canonical scorer matches the
  vendored runner. So "derived" batches (the @∞ diagnostic, fixed-seed
  cross-checks, `score_policy`/`cross_score` re-scores) are regenerable from
  `policy.js` + the pinned task version, with zero tokens.
- **Provenance.** Each `trial.json` records the task version + bundle sha256, the
  frozen split, gauntlet git SHA (stamped at run start in v2), node/CLI/OS
  versions, served model, context window, compactions, cost, and turns. The
  frozen draw lives in `runs/cohorts/cohort-v2-n2/cohort.json` (cognitive arms
  re-pin the same draw via their own cohort.json — verified identical).
- **Data layout.** Bare runs under `runs/cohort-v2-n2*-*/`; cognitive runs under
  `runs/cohort-v2-cog-*-*/` (bulk, gitignored, never deleted). Each trial dir:
  trial.json, analysis.json, heldout.json, training.json, baselines.json,
  audit.json, trace.jsonl, workspace/ (incl. policy.js and, for cog arms,
  GAME_MODEL.md + WORKLOG.md). Committed derived artifacts: `experiments/cohort-v2/`
  (master_analysis + `results-partial/` with a README per terminated wave +
  `results-final-n4/`), `experiments/scaffold-mono/` (PROMPT.md, README, the
  appendix + json), `experiments/roguelike-opus48/` (v1 + the vendored substrate's
  sha registry). Traces are sanitizable for sharing (system/rate-limit events
  stripped — they enumerate host tool inventory — $HOME/emails redacted) via the
  v1 salvage tooling.
- **Tests.** `cd gym && node tests/run_tests.js` (129/129) and `cd evalkit &&
  python3 -m pytest -q` (63/63) validate the contract, determinism, the criterion
  seam, audit rules, crash/resume, and the cohort runner.

---

## 11. Conclusion & future work

Gauntlet resolves frontier Claude models into a **clean, statistically separated
capability ladder** on a genuinely long-horizon task — **Haiku ≪ Sonnet ≪ Opus
≪ Fable** — and adds a second discriminating axis, **win-speed**, that
distinguishes the two strongest models beyond clear-rate. It did so while
absorbing **nine session interruptions across six failure modes, including a
mid-study provider access retraction, with zero data loss** — the
determinism-first, canonical-scoring, deliverables-on-disk design paying off
exactly where evals usually break. And as a controlled-ablation instrument, it
delivers a clean **honest-negative**: a **cognitive scaffold (M1-analog)** is
*followed strongly and sustainedly* — agents write and maintain a real
world-model and worklog, survive 10 auto-compactions, and (at Opus) run the full
diagnose→build→validate loop — yet **does not move the clear-rate at any tier**
(Haiku 0.0%→0.0%, Sonnet 5.3%→5.0%, Opus 47.1%→43.8%; all p ≥ 0.46), and at
Sonnet it actively **induced two full-8h grind-to-timeout runs**. The limiter is
execution and raw difficulty, not the absence of cognitive structure — exactly
where the northstar thesis predicted the constraint would migrate.

**Open questions the null raises** (Sonnet is N=1 clean — the rate could firm up
with more clean reps, though all 3 Sonnet attempts landed ≤4/80): does the result
hold on a task whose ceiling is *not* already near where bare Opus reaches (a
harder regime, or a non-game coding task)? Does
null raises:** does the result hold on a task whose ceiling is *not* already near
where bare Opus reaches (a harder regime, or a non-game coding task)? Does
enforced multi-agent structure (the local harness's actual M1, not the folded
single-agent analog) behave differently? **Beyond:** the designed-but-unbuilt
seams — a **non-game task** (coding/algorithm) to claim cross-domain generality; a
**local-agent node** kind; **multi-agent coordination topologies** (the manual
pipeline's "scaffolding ladder") — plus a built-in heartbeat/`watch` for live
observability.

**Experiment ledger.** Bare cohort: 21 roguelike sessions (12 clean + 9
interrupted), clean-rep spend ≈ **$325**, total incl. recovered partials ≈
**$461**. v1 chain ≈ **$158**. Cognitive experiment: 9 sessions, **7 clean + 2
timed-out partials**, clean spend ≈ **$224** (Haiku $4, Sonnet $41, Opus $179).
Framework green: gym 129/129, evalkit 63/63.

---

*Appendix tables and all per-seed data: `experiments/cohort-v2/master_analysis.json`,
`experiments/scaffold-mono/cog_vs_bare.json`, `experiments/cohort-v2/results-partial/`,
`INTERIM_REPORT.md` (chronological lab record incl. v1 errata),
`experiments/scaffold-mono/INVESTIGATION_WORKLOG.md` (the cognitive experiment's design +
decision rules), `DESIGN.md`, `gym/core/CONTRACT.md`.*
