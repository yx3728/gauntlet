# INTERIM REPORT — gauntlet's first real trial: the big roguelike × frontier agents

**Engineering proof:** gauntlet (the two-library agent-eval framework built in this repo) took a
real frontier agent through a genuinely long-horizon task on the big game — the manual-trial
pipeline's roguelike — **entirely through the framework**, and produced meaningful, faithful data.
This report covers the Opus 4.8 trial in full; the chained Sonnet 4.6 and Fable 5 trials (same
conditions) are appended as they complete.

Everything here is reproducible from persisted artifacts: `runs/roguelike-<model>-max/` (trial.json,
heldout.json, training.json, baselines.json, audit.json, comparison.json, trace.jsonl) with copies
archived under `experiments/roguelike-opus48/results/`. Mapping + deltas + confounds:
`experiments/roguelike-opus48/MAPPING.md`.

---

## 1. Setup (one deliberate change, everything else carried over)

- **Substrate:** trial template **v2** (speed_cap 40 px/tick, max_steps 90 000) vendored
  **byte-identically** (sha256-verified, all 7 workspace files) into a thin gauntlet task adapter
  that pins the eval regime structurally. The subject's workspace is those 7 files + a
  `manifest.json` provenance pin — nothing else.
- **Prompt:** the manual trial's T1 bare prompt **verbatim** (sha-gated at assembly) + the ONE
  deliberate addition (Step 3): the evaluation criterion —

      eval_score = cleared ? 1 + (90000 − win_step) / 90000   // wins in (1,2]; earlier = higher
                           : progress                          // non-wins in [0,1); below every win

  stated plainly and strategy-silently (winning is the prerequisite; among wins, sooner is better;
  the in-game score is a reference only). The eval comparable is computed by gauntlet post-hoc and
  never shown during play.
- **Node:** `ClaudeCodeNode` — the hardened `claude -p` recipe (strict-mcp-config, tool allowlist,
  Web*/Task denied), **no artificial horizon** (8h wall / 2000-turn runaway backstops only).
- **Scoring:** canonical, outside the node's reach: gauntlet re-scores the final `policy.js` at
  **40/90k** on a **fresh unpredictable held-out draw** (30 seeds), plus the manual trial's fixed
  seeds 2000–2029 for direct comparability, plus the task's three baselines on the same seeds.

### Faithfulness verification (before any tokens were spent)

| check | result |
|---|---|
| vendored files vs template-v2 registry | sha256 **identical**, all 7 + prompt |
| manual verified clears on OUR substrate | **byte-exact**: 2008→win@25129, 2011→win@26827 |
| cross-runner determinism (subject runner vs canonical scorer) | byte-identical over 2000-step trajectories (test in suite, 129/129 green) |
| mock-node full pipeline on the big game | green; every artifact persists |
| mid-run SIGKILL resilience | green; on-disk policy still scored |
| manual policy scored at the new regime (the same-regime anchor) | 0/30 @40/90k, 100% death, progress 0.3425 |

## 2. Headline result — Opus 4.8 (effort max)

The node ran **171.7 minutes** (2.9 h) and terminated **on its own** (no backstop, no kill): wrote
`policy.js` + `report.json`, iterated through ~135 runner invocations and 74 edits, audit-clean
behavior (benign /tmp scratch only).

**Canonical held-out, 30 unpredictable seeds, 40/90k:**

| metric | value |
|---|---|
| **clear rate (通关, primary)** | **73.3% (22/30)**, Wilson95 [0.56, 0.86] |
| **win_step among clears (NEW dimension)** | median **56 979**, mean 55 265, range 29 600–80 085 |
| eval_score | mean 1.127, median 1.331 |
| progress mean | 0.844; failures: 8 deaths (progress 0.40–0.90), 0 timeouts, 0 policy errors |
| fixed seeds 2000–2029 (manual's set) | **76.7% (23/30)**, win median 58 361 |
| baselines (same seeds) | noop 1 872 / greedy 7 193 / smart 8 076 mean score → policy at 12.8 on the noop→greedy scale |

**Comparison to the manual trial (`ladder-t1`, the baseline this reproduces against):**

| arm | dev regime | clear @40/90k (2000–2029) | clear @∞/90k | win steps |
|---|---|---|---|---|
| manual Opus 4.8 (interactive, v1, ∞) | ∞ | **0/30** (measured anchor) | 20% (6/30) | 25 129–78 336 (∞ only) |
| **gauntlet Opus 4.8 (this trial, v2, 40)** | 40 | **76.7% (23/30)** | 76.7% (23/30, diagnostic) | 40 645–88 951 @ fixed seeds |

Reading this honestly (see Confounds): the gauntlet run did not merely *reproduce* the manual
clear-rate — it transformed it. The manual ∞-developed policy collapses to 0/30 at the 40-cap
regime (and its finite-cap sweep is non-monotonic, 0–7%, with cap 40 never swept); the
gauntlet-run agent, developing **under** the eval regime with the **win-first criterion stated**,
produced a policy that clears ~3/4 of held-out seeds — and is regime-robust (identical behavior at
∞: it hardcodes its own 40 px/tick movement, i.e. the agent internalized the eval condition).
The *capability* story is consistent with the manual record (same model, same game, same
interface; the manual agent's own self-estimate at its own regime was ~51%); the *outcome* story
shows how much the eval's stated criterion + dev regime matter. At n=1 per arm, the criterion
effect and regime effect are bundled and not separable.

**The new dimension the manual trial lacked:** among the 22 canonical clears, win_step spans
29 600–80 085 (median ~57 k) — a full speed distribution per policy, automatically produced by the
eval_score criterion, at zero extra cost. The manual pipeline only ever observed win timing
incidentally (six clears, 25–78 k).

**Overfit signal:** training seeds 76.9% (10/13) vs held-out 73.3% — no gap (the manual trial's
self-report-vs-canonical gap was ~51% → 20%). The subject's self-report here (~87% on self-chosen
seeds) vs 73.3% canonical is a modest self-eval gap, now measured rather than guessed.

## 3. Integrity & engineering checklist

- **Parity gate (publish-blocker, passed):** the final policy replayed through the SUBJECT's own
  vendored runner vs gauntlet's canonical scorer — per-seed identical on all 8 fields (steps,
  score, done_reason, progress, kills, level, wave, survived_ms).
- **Audit:** verdict "review" — all findings are benign `/tmp` scratch-file reads by the agent's
  own analysis scripts; zero network/MCP/source-reach/tamper findings; workspace hash-verified
  against the manifest (the agent's 20+ exploration scripts are expected artifacts).
- **Artifacts:** every required file persisted (trial.json, heldout.json, training.json,
  baselines.json, audit.json, prompt.txt, 3.8 MB trace.jsonl, comparison.json, ANALYSIS.md).
- **Kill-resilience:** proven in the pre-run smoke (SIGKILLed node's on-disk policy scored
  end-to-end); not needed in the real run (clean self-termination).
- **Same pipeline, unchanged:** the identical `evalkit.run`/`analyze` path that runs the two small
  MVP games ran the big game; the only task-specific code is the thin adapter + this experiment's
  analysis scripts.

## 4. Confounds (must be read with the table)

1. **n = 1 session per arm**; at 30 seeds ±1 seed = 3.3 pp (Wilson CIs reported throughout).
2. **Criterion-as-treatment:** the scoring section is *meant* to change behavior; faithfulness
   claims apply to the substrate, never the behavior.
3. **Dev-regime shift bundled with the treatment** (manual = v1/∞; this = v2/40, per the brief):
   the two effects are not separable at n=1.
4. Headless `claude -p` vs interactive manual session (observed manual tool usage was inside the
   gauntlet allowlist; both 1M-context, verified).
5. Held-out seed sets differ (unpredictable draw vs fixed 2000–2029) — both reported; they agree
   (73.3% vs 76.7%).

## 5. Chained trials (same conditions, serial — per user directive)

| arm | status | clear @40/90k (canonical) | win_step median | notes |
|---|---|---|---|---|
| Opus 4.8 / max | **done** | **73.3%** (22/30) | 56 979 | above |
| Sonnet 4.6 / max | running | — | — | manual baseline: 0% at every cap incl. ∞ |
| Fable 5 / max (single `-p` node) | queued | — | — | manual fable arm was ULTRACODE multi-agent (97% @∞) — not like-for-like; the single-agent manual arm was never evaluated |

*(This section is updated as the chain completes.)*
