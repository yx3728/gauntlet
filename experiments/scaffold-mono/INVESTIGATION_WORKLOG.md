# scaffold-mono investigation worklog

Autonomous investigation of whether the **+cognitive (M1-analog) prompt** helps weak/mid Claude
models on the roguelike, vs the bare cohort prompt, on the **same frozen n=80 held-out draw**.

---

## 2026-06-14 01:13 EDT — investigation opened; test run in flight

**Goal:** does `experiments/scaffold-mono/PROMPT.md` (cohort prompt + cognitive structure, win_speed
kept, everything else identical) improve Haiku/Sonnet vs the bare cohort arms?

**In flight (do NOT touch until it finishes):** `cohort-v2-cog-test` — 1 Haiku + 1 Sonnet, concurrency
2, frozen draw n=80 (= cohort-v2-n2 draw), effort max, no horizon. Background task `bj0hhwme2`.

**Baselines to compare against (bare cohort, same frozen draw):**
- Haiku 4.5 bare: per-rep clears /80 = 0,0,0,0 → pooled **0/320 (0.0%)**, criterion ~0.20.
- Sonnet 4.6 bare: per-rep clears /80 = 9,5,3,0 → pooled **17/320 (5.3%)**, criterion ~0.44,
  win_step med ~54k.
- (Opus bare, for later: per-rep 21,45,47 → pooled 113/240 ≈ 47.1%.)

### Plan (execute ONLY after `bj0hhwme2` completes)

**1. Metric (careful — N=1 per model):** from each cog arm's `analysis.json` + `heldout.json`, read
clear rate /80, criterion mean, win_step. Compare the single cog rep against the bare per-rep
*distribution* (not just the pooled mean): Haiku bare reps were all 0/80, so any cog clear is a
signal; Sonnet bare reps ranged 0–9/80, so judge the cog rep against that spread. Report as "sign of
improvement," not significance.

**2. Compliance with the cognitive structure (trace forensics):** in each arm's `trace.jsonl` +
workspace —
   - did it write `GAME_MODEL.md` and `WORKLOG.md`? (workspace files + content quality)
   - did it OBSERVE first (before optimizing), and re-observe only on new regions?
   - did its iterations show PLAN (single main reason + ordered 2–4 changes) → IMPLEMENT(build-on-best)
     → EVALUATE(ranking rule + diagnosis)?
   - **throughout** or only early then drift? (compare early vs late turns; note compaction count —
     does compliance survive auto-compaction? the written memory is meant to make it survive.)
   - quantify lightly: count plan/observe/evaluate markers; note whether WORKLOG was maintained to the
     end.

**3. Cognitive improvement (was the thinking load-bearing?):** did best-so-far climb in a
goal-directed way traceable to the diagnoses (not random churn)? Did it build-on-best vs rewrite? Did
it recover from regressions? Compare the trajectory shape to the bare arms (bare = the cohort traces).

### Decision rule (pick ONE; total trials this investigation ≤ 7, i.e. ≤5 more after the running 2)
- **PROMISING** (clear positive: cog clear-rate/criterion above the bare per-rep spread, OR strong
  compliance + goal-directed cognitive climb) → launch **1 Haiku + 1 Sonnet + 1 Opus** (3 concurrent,
  same frozen draw, same prompt). Adds Opus to test whether the structure helps a strong model too.
- **JUST CONFIRM** (ambiguous/neutral: compliance present but metric flat, or mixed) → launch
  **2 Haiku + 2 Sonnet** (4 concurrent) to raise N where the effect would show.
- After the follow-up completes: final analysis + verdict here; commit.

Note: never delete runs; partials archived; results staged after each wave.

## 2026-06-14 ~01:35 EDT — test run analyzed (cohort-v2-cog-test, N=1 each)

Both arms node=ok, served models verified (haiku-4-5, sonnet-4-6), on the frozen n=80 draw.

| arm | clear /80 | criterion | win_med | turns | compactions | cost | vs bare |
|---|---|---|---|---|---|---|---|
| Haiku +cog | **0/80** | 0.198 | — | 86 | 0 | $1.02 | bare reps 0,0,0,0 → **flat** |
| Sonnet +cog | **4/80** | 0.515 | 71.9k | 442 | 10 | $40.70 | bare reps 9,5,3,0 (crit ~0.44) → **within noise** (crit edges up) |

**1. Metric (N=1): no clear improvement.** Haiku flat at 0; Sonnet 4/80 sits mid of its bare 0–9
spread (criterion 0.515 vs bare ~0.44 — a faint edge, within noise).

**2. Compliance: STRONG and SUSTAINED.** Both wrote rich, factual `GAME_MODEL.md` + `WORKLOG.md`.
Sonnet stated a ranking rule (win > progress → boss_hp_destroyed → survived_ms), ran observe→plan→
implement→evaluate, and its WORKLOG stayed structured through **10 compactions** to the end — the
written-memory mechanism did its job. Haiku complied too (5 WORKLOG touches) but shallower.

**3. Cognition: high for Sonnet, defeatist for Haiku.** Sonnet derived the binding constraint
itself — computed it needs ~228 dmg/step to kill the 19.3M-HP boss in budget, found its build reaches
~173 → timeout, and diagnosed exactly why seeds 11/23 die (enemy body-collision at specific
x-clusters). That is the M1 loop working as designed. Haiku reasoned itself into a WRONG, defeatist
conclusion ("boss defeat impossible … baseline achieves maximum feasible progress") and converged to
hold-position = bare.

**Verdict:** the prompt is clearly *engaged* (compliance + real goal-directed cognition) but does
**not move the weak/mid metric** — the limiter migrated to coder execution / raw difficulty, exactly
the northstar prediction. By the pre-registered rule (strong compliance + cognitive climb = PROMISING)
the informative next test is a model whose execution is NOT the bottleneck.

**Decision → PROMISING: launch 1 Haiku + 1 Sonnet + 1 Opus** (3 concurrent, frozen draw, same prompt).
Opus tests whether structure pays off where the agent can actually execute the diagnosed changes; the
extra H+S add a little N on weak/mid. Total trials this investigation = 2 + 3 = 5 (≤ 7).

## 2026-06-14 — user-directed 2nd follow-up (beyond the autonomous 7-cap)

User added **2 Opus + 1 Haiku + 1 Sonnet** (concurrency 4), same frozen draw + scaffold-mono prompt,
alongside the running follow-up. This brings the +cognitive arms toward **N=3 each** (Haiku/Sonnet/
Opus) for a tighter weak/mid estimate and N=3 on the key Opus arm. Trials now 5 + 4 = 9 (the earlier
≤7 autonomous cap is superseded by this direct instruction).
