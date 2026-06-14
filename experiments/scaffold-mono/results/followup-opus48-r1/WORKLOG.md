# WORKLOG

## Ranking rule (how I judge attempts)
Goal = CLEAR (beat boss). eval_score = cleared ? 1+(90000-win_step)/90000 : progress.
Rank attempts by, in order:
1. boss_cleared_rate (wins) — paramount.
2. among wins: earlier win_step.
3. among non-wins: progress (then boss_hp_destroyed, then survived_ms/level).
Always judge on multi-seed (1,11,23,...) not one seed, to avoid overfit. Eval regime: speed_cap=40, max_steps=90000.

## Baselines observed
- Naive (hold bottom center): progress 0.40, dies ~198 steps into boss (frame ~5598). lvl 2.
- Align+collect (no real dodge): reaches lvl 9, ~29k DPS, boss 1.8% destroyed, dies ~frame 6137.
- Pure dodge (no aim): survives to frame ~7849 (41s into boss) but stays lvl 2, boss 0.1%.
=> Tension: leveling needs aligning under enemies; survival needs dodging. Need BOTH.

## Key facts
- Boss at frame 5400 (90s). HP ~19.3M. Budget to 90000 => 1410s to kill. ~15k DPS wins IF survive.
- Player bullet straight up, dmg 1000. speed_cap 40 (very agile vs ~4-8px bullets).
- Boss bullet hell up to 230 bullets, dmg 300-450, HP only 3000.

## Attempts
- v2 (corridor aim + XP + basic dodge): 2/3 wins (s1,s23) but s11 died. Discovered DPS-during-boss low when dodging pulls off boss.
- v3 (adaptive caution when low HP): REGRESSED (0-1 wins). Caution killed leveling -> death spiral. REVERTED.
- v4-v6 (better collision model, openness, central): chaotic, ~2/8 wins. Discovered deaths = CORNERING (no safe move).
- v7 (column-hold + kill-throughput picker): 1/12. Pre-boss leveling capped by steep XP curve; high pre-boss level unrealistic.
- v8 (escape-route re-ranking): survival improved (deaths ~7k->~11k). Still ~1-2/12. Found shield is THE gate; shield_basic RARE (1/59).
- v9 (upgrade picker overhaul: heal_quick/timeflow/kill_blood/heal_overflow/regen/boss_hunter + keyword fallback): **4/12 wins** (s1@74244,s23@44073,s137@73890,s199@68128). Shield snowballs to 100k-881k on winners.
  - Losses: (a) no shield -> die early; (b) buffer but leveling STALLS mid-boss (lvl2-9) -> die. Core diff still = leveling snowball during boss.
  - Probe KPI: winners reach lvlF 17-26; losers stall lvl2-9.

- v10 (boss-aim scales with power; focus survive+XP when weak; more XP collection): 6/12 wins. Shield snowballs to 5.9M.
- v11 (DPS pivot once shielded; heal_quick gating): 5/12 (s1 -> timeout). Mixed.
- v12 (HIGHER ALTITUDE targetY 0.64 boss / anti-floor FLOORZONE 150, W_bot 3.2, ceiling): **8/12 wins** (1,42,57,88,101,199,256,451). Fixed floor-trap deaths. SAVED policy.v12.js.
- v13 (BERSERK: facetank under boss when shield huge): REGRESSED to 6/12. Cut XP collection -> lower level (s1 29->24) -> slower -> timeouts. Lesson: NEVER sacrifice XP/leveling. REVERTED to v12.
- v14 (SWARM-FARMING during boss: when level<13 aim at grunt swarms for XP, not the unkillable boss; hold column W_aim 3.0): addresses "stuck at low level" seeds (e.g. 314 stuck lvl3 despite shield because it only weakly aimed at boss, never farmed grunts). TESTING.

## Eval harness: node eval.js  (seeds 1-24, real eval_score = win?1+(90000-step)/90000 : progress). RANK BY mean_eval (= held-out metric). 0.90 timeout >> 0.40 death.
- v15 (late-berserk, kept XP, threshold 35k): 7 wins, 0.781. Bullet-tanking causes damage/thrashing -> timeouts. Berserk keeps failing.
- v16 (CAP DEFENSIVE picks, diminishing returns after 3): **11 wins, 0.819**. Converted over-tank timeouts (6,8,23) to wins. SAVED policy.v16.js.
- v17 (stronger anti-overwhelm dodge: W_open 1.3, escape E=11/K=18, harsh boxed penalty, 28 dirs, 10 esc-dirs): 9 wins but **mean 0.887** (deaths->0.90 timeouts; metric loves it). SAVED policy.v17.js = CURRENT BEST.
  - v17 bottleneck: 0.90 TIMEOUTS (survive but dodge too much -> low boss-aim uptime -> don't finish). Deaths down to ~7.
- LESSON: berserk/facetank with bullet-tanking always regresses (thrashing). Position-independent DPS (homing satellites + wide multishot) is the safe way to raise boss DPS while dodging.

- v18 (boost satellites — position-independent boss DPS): 1-24 11 wins, 0.918. Helped.
- v19 (DENSITY-AVOIDANCE term: avoid camping in thick of fire => fewer overwhelm/boxed deaths): 1-24 13 wins 0.946; holdout 25-48 0.900. GENERALIZES.
- v20 (shield-scaled aim boost): NEUTRAL (1-24 0.945, 25-48 0.903). combined 0.924.
- v21 (broad DPS/anti-boss picker bumps): REGRESSED (25-48 0.862). Reverted. Picker is at a plateau; broad changes shift the delicate survival/DPS balance.
- v22 (surgical: tyrant_breaker/sat_orbit_2/shield_extra): ~neutral (combined 0.919). Reverted.
- v23 (WIDEN BOSS CORRIDOR 42->52: weave horizontally while still hitting boss => more aim UPTIME): 1-24 1.027, 25-48 0.916. BIG jump.
- corridor sweep: 58 -> combined 0.925; 48 -> 0.958; 52 -> 0.972; **50 -> 1.011 (1-24 0.977, 25-48 1.044, 14 & 17 wins)**. 50 is the robust sweet spot.

- targetY sweep (corr50): 0.58->0.974, 0.64->1.011, 0.70->0.966. 0.64 = sweet spot.
- H sweep: H=18 lopsided (1-24 1.053 / 25-48 0.925 => 0.989). H=15 better/balanced.
- v30 (CONDITIONAL defensive cap: only cap once shield already HIGH >2.5*maxhp; struggling players keep stacking survival): 1-24 0.952, 25-48 1.051, 49-72 0.919. 72-seed avg 0.974, more balanced. ADOPTED.
- Edge cases verified: never throws, valid finite moves, deterministic, no random/Date, picks heal_quick when unshielded.

- MARGIN sweep: 7 -> avg 0.841 (BAD: too cautious + slower snowball). 5 is right.
- W_item boss 2.8 -> avg 0.951 (worse: aggressive XP-chase -> worse positions). 2.1 is right.
- BOSS-TRACKING LEAD sweep (corridorC = boss.x + boss.vx*L): L=10 ->0.974, **L=18 ->1.006 (better on ALL 3 sets!)**, L=26 ->0.968. Boss moves ~3px/tick, bullets take ~31 ticks; L=18 tracks well w/o over-leading past reversals.

## CURRENT BEST = v31 (policy.v31.js = policy.js): corr 50, targetY 0.64, H 15, LEAD 18, density-avoid, escape-routes, conditional cap, satellites, shieldAim.
- Validation: 1-24 0.971, 25-48 1.061, 49-72 0.986, 73-96 0.942(FRESH), 97-120 0.942(FRESH). 120-seed avg ~0.98; honest held-out estimate ~0.94, win rate ~50%.
- Edge cases re-verified on v31: never throws, valid finite moves, deterministic, no random/Date.

## FAILED experiments (=> v31 is a robust optimum; don't repeat):
- invuln-facetank (v32): crashed 25-48 (caught when invuln ends). momentum/streaming (v33): crashed 1-24 (over-commits in dense barrages).
- MARGIN 7 (0.841), W_item 2.8 (0.951), H 18 (lopsided), targetY 0.58/0.70 (worse), corridor 48/52/58 (50 best), lead 26 (0.968), berserk (all variants), broad picker bumps (v21), swarm-farming (v14), adaptive caution (v3). All regressed/lopsided.

## FINAL: policy.js = v31. Clears the boss sequence on ~half of unseen seeds; avg eval ~0.94-0.98. Goal (通关) achieved on a majority across practice seeds.
## KEY LEVERS: 1) WIDE boss corridor (~50) = aim uptime while dodging, 2) density-avoid + escape-route dodge (survival), 3) conditional defensive cap (deaths<->timeouts balance), 4) satellites/multishot (position-independent DPS), 5) shield/heal engine.
## Eval: node eval.js [seeds] [policy]. RANK BY mean_eval averaged over 3 sets (1-24,25-48,49-72) for robustness.
## Remaining failures: early deaths (low-lvl overwhelm + upgrade luck) and some 0.90 timeouts. Near plateau; most param tweaks now lopsided/neutral.
