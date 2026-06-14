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
