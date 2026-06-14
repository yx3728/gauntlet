# WORKLOG

## Ranking rule (toward the goal: CLEAR = beat boss)
Primary: boss_cleared (win). Among wins: earlier win_step better.
Until a win: rank by progress, then boss_hp_destroyed, then survival/level.
Eval on seeds 1,11,23 (+more later). Default regime speed_cap=40, max_steps=90000.

## Attempts
### v0 passive (hold still)
- seed1: progress 0.044, 0 kills, died f5550 (sat in bullets). Baseline.

### v0b pure-aim (align x with lowest enemy, no dodge)
- seed1: lvl6, wave2, 98 kills, DIED wave2 f5011. progress 0.371. No dodging -> dies.

### v1 sampling dodge+aim (penalty scaled by penetration depth) -- BUG
- seeds 1/11/23: progress 4/31/40%. seed1 died f487 (8s)! Corner-clip collision lethal but
  penalty scaled with penetration => tiny x-overlap underweighted, aim won, clipped grunt.

### v2 binary-overlap penalty + clearance margins + aim only above us  [CURRENT BEST]
- seeds 1/11/23: progress 41/43/40%. ALL reach boss. survive 100-150s, kills 67-97, lvl 6-7.
- boss_hp_destroyed 1/7/1%. DPS at boss ~65-97k. Dies to boss bullet density in ~19s.
- Diagnosis: stuck lvl7 at boss (no exp during boss), pinned to bottom edge, no sustain/HP build.

## KEY LEARNINGS (after many iterations)
- **WIN RECIPE PROVEN**: survive early boss -> collect exp -> snowball lvl (to 27-34) -> huge DPS
  + lifesteal/regen -> grind down MULTIPLE bosses (~19.5M,20.3M,50.9M HP) -> WIN.
  Wins observed: seed1(v6), seed11&23(v7). All won by ~frame 60k-82k.
- **THE BOTTLENECK = early-boss survival (~lvl 4-8, first 30-60s of boss).** Survivors take ~0 dmg
  & snowball to easy wins; dying seeds get CORNERED by dense aimed bullet-fans & take repeated -450.
- Boss = 120x120 (half 60) => hit it within ~60px of its x (wide window; don't hug exact x->walls).
- Boss sweeps x (vel +-3.8) firing dense 5-bullet fans (vel ~5.3) + 3-aimed + straight. 40-74 bullets.
- HP regen/lifesteal ticks ~+7/frame when built; occasional +1000 (heart/heal). -450 per boss bullet.
- **Tooling**: benchmark = `run_policy.js --seeds 1,11,23,42,57,88,101,137,199 --max_steps 18000 --json`
  then `node show.js <file>`. Cap 18000 catches early-boss deaths AND shows snowball. ~survival rate.
- **Eval proxy**: win=1+(90000-step)/90000 (~1.1-2.0); else progress. 1 win >> several non-wins.

## REGRESSION HISTORY (9-seed bench, death rate)
- v9/q3 config (summed-worst dangerAt, edge-item-chasing OK, band545, 2-ply trap): death 0.56 (4/9 survive) = BEST/BASELINE (policy_baseline.js)
- v10 skip-edge-items + margin6 + center0.07: WORSE
- v11 restore itemW: still 0.89 death
- v12 hit-domination dangerAt + band562: 1.0 death (WORST) -- hit-domination & low band both hurt
- => reverted to baseline. Lesson: summed-proximity gradient helps thread gaps; don't over-weight hits.
- FOUND BUG: exp regex matched flavor name "学者" (kill_blood) -> bogus +64 -> bad picks. Fixing.

## CURRENT BASELINE: policy_baseline.js (death 0.58 on 12-seed bench, 5/12 survive)
- Survivors (full 90k): 4/5 WIN (11@50k,199@53k,88@70k,451@88k-barely), seed23 DIED@99% of last boss.
  => snowball->win confirmed. seed451 barely won (DPS-limited). win-speed matters too.

## SUSTAIN-TILT experiment (boost shield/regen/maxhp/heal/armor to 40-46, add anti-boss match)
- 12-seed cap bench: death 0.33 (8/12 survive) vs baseline 0.58 (5/12). BIG survival gain!
- BUT lowered boss DPS (seed23 boss 46%->28%). Q: do new survivors WIN by 90k or timeout? (testing)
- Insight: more eHP = survive early gauntlet (lvl4-8) + late 99% deaths. Tradeoff vs win-speed.

## *** SUSTAIN-TILT IS A BIG WIN -> NEW BASELINE: policy_sustain.js ***
- Full 90k on 8 seeds (1,11,23,88,137,199,256,451): ALL 8 WIN (eval 1.314)! vs baseline 4 win/4 die.
- Converted deaths->wins: seed1@63518, seed23@57940 (was death@99%!), seed137@53940, seed256@66827.
- SYNERGY: more eHP -> less time fleeing -> MORE boss uptime -> some wins FASTER (451: 88k->68k).
- So sustain helps BOTH survival AND win-speed. No timeouts (wins 50k-69k, well under 90k).
- Change = boost shield46/regen46/maxhp42/armor40/lifesteal56 + anti-boss40 in scoreUpgrade.

## Backup ideas / next
- Remaining early-boss deaths on hard seeds (42,57,101,314 in cap-bench). Try: more eHP, or rollout dodge.
- Greedy-rollout dodge (sim K steps fleeing, score by survival time) — robust vs cornering, but risky.
- Win-speed: wins at 50-69k; could push earlier for higher score (boss alignment, anti-boss upgrades).

## *** ROLLOUT DODGE = ANOTHER BIG WIN -> NEW BASELINE: policy_rollout.js ***
- Reality check: sustain-only on FRESH seeds = only 3/12 win (eval 0.706). Practice set was lucky/overfit.
- Added greedy-repulsion ROLLOUT trap detection (rolloutSurvival): for each top candidate, sim K=16 steps
  of committed wall-aware fleeing; penalize first-moves that die early (quadratic in K-surv). Replaces 2-ply trap.
- Mixed-16 (fresh+hard) bench: 11 wins/5 deaths, eval 1.003. Fresh seeds 3->8 wins! Practice deaths 42,57,314 -> WINS.
- GENERALIZES (improvement is on fresh seeds, not practice). Some deaths now happen LATER (seed17: 782 kills).
- rolloutSurvival flee = repulsion from threats(<120px) + wall repulsion (slip along walls, not into them).

## DPS-REBALANCE (now that rollout handles survival) -> policy_rollout2.js  [CURRENT BEST]
- Shifted upgrade weights back toward DPS: dmg52,crit40,pierce42,anti-boss50; sustain shield42/regen42/maxhp38/armor36.
- 19-seed hard set: 13 wins/5 deaths, eval 1.038 (up from rollout-only 0.963). Faster wins (512: 77k->62k).
- Lesson: rollout dodge + moderate sustain + DPS = best of both. Validating on fresh seeds next.

## *** ADAPTIVE SUSTAIN + ALIGNMENT -> policy_best.js  [CURRENT BEST] ***
- Found via timeout seed30: it reached 33000 HP (over-sustained!) but timed out at 90% because first boss
  took 573s (slow early DPS ramp) + only 68% boss alignment. Over-sustain wasted picks that should be DPS.
- FIX 1: adaptive sustain — sustainFactor = clamp(1-(eHP-3000)/11000, 0.3, 1); multiply shield/regen/maxhp/armor
  scores by it. So we grab sustain when we lack a buffer, then PIVOT to DPS once buffered (rollout keeps us alive).
- FIX 2: boss aim weight 0.07->0.11 (stay under boss more -> +sustained boss DPS -> faster wins).
- Fresh-12 result: 10 WINS/2 deaths, eval 1.187 (was 0.852, 4W/3timeout/5D)! All 3 timeouts -> wins; several deaths->wins.
- Validating on 19-hard-set next.

## *** CLEAN BASELINE: policy_best.js on 30-seed set (19-hard + 11 fresh) = 24 wins/5 deaths/1 timeout, eval 1.150 ***
- This 30-set is my standard A/B benchmark now. ~80% win. Strong & generalizes (improves both hard & fresh).
- TRASH-FARM (aim at trash when lvl<13 to ramp faster): 22 wins, eval 1.074 = REGRESSION (delays boss dmg -> timeouts). REVERTED.
- NOTE: policy_best keeps the "学者" exp quirk (boosts lifesteal early = helpful) and aim 0.11; don't "fix" without testing.
- Testing: magnet valued during boss (passive exp -> faster leveling, no downside).

## *** TRUE HELD-OUT estimate: policy_best on never-seen seeds 111-130 = 11 wins/7 deaths/2 timeouts, eval 0.932 (~55% win) ***
- Practice-overlap inflated earlier numbers; true held-out ~55% win. Failure modes: ~5 early-boss deaths(lvl4-6),
  2 mid-fight deaths, 2 timeouts, several SLOW wins (75-85k near limit). seed120: 1859 kills but lvl12 (slow leveling!).
## *** EARLY-eHP-RUSH: earlyBoost 1.45 on shield/regen/maxhp when lvl<8 & no buffer yet ***
- Hypothesis: early boss (lvl4-8, 3000hp) is survival-bound; rush eHP buffer to live long enough to ramp.
- Held-out 111-130: 13 wins/5 deaths, eval 1.028 (up from 0.932)! PRINCIPLED + generalizes. Validating on 30-set + 131-150.

## Tweaks tried & REVERTED (all regressed/washed vs policy_best; STRONG local optimum, stop tinkering):
- trash-farm 1.074, magnet-during-boss 1.114, rollout K=20 1.089, exp-throughout (111-130: 0.908),
  early-eHP-rush (30set 1.049 down; net wash), finer-candidates 0.980, low-lvl-no-boss-aim (111-130: 0.878).
- LESSONS: decisive moves > timid (finer cands hurt). Don't delay boss dmg (trash-farm timeouts). Aiming at boss
  even when weak is fine (incidental DPS chips layers). Survival<->DPS upgrade shifts just trade which seeds win.
- => policy_best.js is FINAL. K=16 rollout, adaptive sustain, boss-aim 0.11, exp pre-boss only.

## *** AIM-HARD-WHEN-SAFE = REAL WIN -> updated policy_best.js ***
- When no bullet near current pos (nearestNow>150 Manhattan), raise boss-aim weight 0.11->0.30 (max DPS in calm
  windows). Pure non-tradeoff: when bullets near, danger term dominates (still dodge). SURPRISE: also cuts deaths
  (faster boss kills -> shorter fights -> less exposure; offense=defense again).
- Validated across 80 seeds: avg eval 1.037 (policy_best) -> 1.094 (aim-safe). Improves BOTH fresh sets
  (held-out 111-130: 0.932->1.066; final 1-10+131-150: 0.995->1.102); slight dip on practice-overlap 30-mix (1.150->1.105).
- ADOPTED (fresh-set gains matter most for held-out). Testing a graded version next.

## graded safe-aim: REGRESSED (held-out 0.973, final 1.016) -> kept simple threshold (nearestNow>150 -> 0.30).
## FINAL confidence check fresh 151-170: 12 wins/7 deaths/1 timeout, eval 0.951. aim-safe fresh avg ~1.04, ~60% win.
## ===> FINAL ANSWER = policy.js (== policy_best.js), aim-safe threshold version. DONE refining (exhaustively explored).

## FINAL POLICY (policy_best.js) SUMMARY
- Aim: boss (priority) else lowest trash safely above us; hit window = +-target_halfwidth (boss 120 wide => wide).
- Dodge: 49 candidate moves scored by dImm(summed-worst overlap+proximity, enemies w130/bullets w75) + bullet-openness
  + positioning(center pull, low band y545, steep walls@66/bottom@558) + aim + exp-item pull(0.10). Then ROLLOUT
  trap-check on top-10: K=16 greedy wall-aware flee, penalize first-moves that die early (quadratic). Decisive moves.
- Upgrades: multishot90>side70>firerate60>lifesteal56>sat55>dmg52>anti-boss50>shield/regen44*adaptiveFactor>pierce42
  >crit40>... exp64 early(pre-boss). adaptiveFactor=clamp(1-(eHP-3000)/11000,.3,1) pivots eHP->DPS once buffered. Heal by HP%.
- RESULTS: held-out 111-130 (never tuned on): 11/20 win, eval 0.932 (~55%). 30-mix set: 24/30, 1.150. fresh-12: 10/12, 1.187.
  Estimated held-out eval ~0.93-1.05. Started from 0% functional -> robust multi-boss clears.

## Tooling: bench_par.js <policy> <maxsteps> <seeds> <workers> — PARALLEL. Compare on the 30-set vs eval 1.150.
## Saved: policy_baseline.js(q3), policy_sustain.js, policy_rollout.js, policy_rollout2.js, policy_best.js(BEST=1.150 on 30-set).

## Next plan
1. Survivability upgrade weights: lifesteal (scales w/ DPS), maxHP/shield/heal/defense up.
2. Boss positioning: target higher band (~520), penalize bottom (<580) & all edges -> escape room.
3. Collect exp items when safe -> enter boss stronger (higher lvl/DPS).
