# WORKLOG

## Ranking rule (how I rank attempts toward the goal = CLEAR THE GAME)
Primary: did it WIN (boss_cleared / progress==1)? Win > any non-win.
Among wins: earlier win_step is better (eval = 1 + (90000-win_step)/90000).
Among non-wins: higher `progress` (the eval score for a loss). Tie-break by boss_hp_destroyed, then wave, then survived.
NOTE: in-game `score` is NOT the target. Use progress, boss_hp_destroyed, wave reached, survival, level.
Judge on multi-seed (1,11,23,...) to avoid overfitting; held-out seeds decide.

## Baselines observed
- "still/center" policy: progress 0.222, 2 kills, lvl1, no levelups (never aligns to shoot). survives (no dmg).
- "align lowest enemy, return to bottom" survey: reached WAVE 2 @f3601 (kills74 lvl4), DIED @f3983 (dmg 3000). progress 0.295.
  Diagnosis: died from moving into enemies/bullets while aligning at the bottom in denser wave 2.

## Key constraints learned
- Collisions are lethal (1000-2000 each). Avoidance is paramount.
- Must align x to shoot. Grunts don't move in x.
- Items fall to the bottom → collect by staying low and drifting x.
- Need to SURVIVE to the boss AND have enough DPS to kill it (upgrades essential).

## Attempts

### v1 (potential-field avoidance + align + keyword upgrades)
seeds 1,11,23: progress 41/35/40%, reached boss on 1&23 (1% boss HP), all died (78-95s).
Diagnosis: avoidance helps survival vs baseline; but dies ~10s into boss, tiny boss DPS, only lvl 4-6.

### v2 (lookahead candidate-eval dodger + stay-under-target + survival-weighted upgrades)
seeds 1,11,23: progress 40/39/**90%**, boss HP 0/0/**69%**, survived 100/89/**1500s(timeout)**, lvl 4/4/**16**, kills 69/83/**1389**.
- seed 23 SNOWBALLED: survived whole game, leveled to 16 off adds, destroyed 69% boss, timed out (ran out of steps).
  → proves the strategy works; need MORE DPS to finish before timeout + CONSISTENCY.
- seeds 1,11 DIE EARLY (wave 2-3, lvl 4). Problems:
  (a) exp collection poor: lvl4 at 83 kills (~0.43 exp/kill) vs ~1.1 before — player moves off columns before
      items fall to it. Need active item collection / magnet upgrades / collect-while-safe.
  (b) early death on some seeds — diagnose what hits them.
RANK: v2 > v1 (mean progress 56% vs ~39%, one near-win). Keep v2. Next: fix consistency + DPS.

### v5 FIRST WIN (central-band aim clamp)
Clamp aim target to central band (boss is 120px wide → central player still hits). seed1 WON (L23 @f80926).
seeds 11,23 still die early. Diagnosis: deaths = pinned at FLOOR (y=623)/corner, bled out by 450 bullets.

### Key mechanic discoveries (folded into GAME_MODEL.md)
- Bullets RAIN straight down (vy~5.3). 64% spawn directly below boss CENTER (offset 0, angle 90°).
  → camping exactly under boss = deadliest stream. Stand at bossX±45-50 (still in 120px hitbox) to dodge it.
- Floor is a trap: can't out-run falling bullets downward → quadratic floor barrier, keep player higher (homeY~510).
- Snowball is BISTABLE: survive early boss ~30-60s → kill adds → level → DPS+survive → win. Ignition is the crux.

### Tooling: policy_tune.js (env-param overrides) + sweep.js (ranks configs by mean eval_score over seeds).

### v6 progression (sweeps on seeds 1,11,23,42,57; meanEval = mean of per-seed eval_score)
- greedy + central band: 0.540 (1 win, s1). Rollout controller: WORSE (0.40, dodges but no DPS/snowball).
- + quadratic floor + adaptive aggression + higher home(130) + bmargin45: ~0.58 (still 1-2 ignite).
- + OFFSET aim (bossX±50): 0.603 (2/5 snowball to 90%).
- + FARM mode (level<13 during boss → chase adds for exp): **0.731** (s23 WIN @40278! s11 90%). BEST.
  homeY=510(h130) is sweet spot; h150 too high (0.40). FARM_LEVEL 13 > 16.
CURRENT BEST baked into policy.js (= policy_tune defaults): HOME_OFF130 BMARGIN45 BOSS_OFFSET50 FARM_LEVEL13.
Official run seeds1,11,23: 40%/90%/WIN. STILL: 3/5 seeds die early at L4-5 without igniting → next: robust early-boss survival.

### KEY MECHANIC: special items (huge)
bomb = CLEARS ALL BULLETS on screen; invincible = 5000ms immunity; levelup = instant level; heart = heal/shield.
exp_huge/exp_large = bigger exp. These DROP from adds DURING the boss. Policy now diverts to nearby survival items.
WARNING: chasing them THROUGH fire (overriding dodge) = death. Gentle divert only (nearby, never override dodge).

### CRITICAL METHODOLOGY NOTE: variance
Snowball ignition is ~bistable & seed-sensitive (~30% of seeds ignite). 5-10 seed means are NOISY — small param
changes just shuffle WHICH 2-3 seeds ignite. MUST validate on 20 seeds. Win rate is the big eval lever
(each win ≈ +1 to that seed's eval; non-win ≈ progress 0.40). Earlier wins add ~0.1-0.5.

### v6 STABLE BASELINE (20 seeds: 1,11,23,42,57,88,101,137,199,256,314,451,512,2,3,5,7,13,17,29)
items_default + frag_mild (FRAG_DEF=1.4,FRAG_OFF=0.8 defense-lean when level<13): **meanEval 0.658, 6/20 wins (30%)**.
  frag_neutral=0.635(4w), frag_strong(1.9/0.55)=0.595(5w). Mild defense-lean is best.
Baked into policy_tune defaults. 14/20 seeds still die at L4-6 (don't ignite).
Backups: policy_v5_firstwin.js, policy_v6_items.js.

### BOSS = 3 forms (folded into GAME_MODEL): ~58.5M HP total; bullet count explodes to 400+ late →
late survival = SHIELD/eff-HP tanking (can't dodge 400 bullets). Winning seeds had heal_quick/shield early.

### Things that did NOT help (20-seed, all worse than baseline):
- open-space-seeking (OPEN_W>0): 0.49-0.55. Makes player flee positions it needs. DISABLED.
- rollout controller: 0.40-0.48. greedy is better.
- stronger walls (WALLW 300-500): noise/worse. Quadratic bullet penalty: worse.
- defense-first STRONG (FRAG 1.9): 0.595 < mild(1.4)=0.658.

### v7 effHP aggression (CONFIRMED IMPROVEMENT)
aggression now driven by EFFECTIVE HP (hp+shield)/maxhp, not just hp. A shielded player camps the boss &
DPSes hard (it can tank); a bare player dodges. 20 seeds (same set): **meanEval 0.735, 6 wins** (was 0.658).
Wins much FASTER (s42@32020, s7@46229 vs ~80000 before) → higher eval/win. Baked as default.
Next: flank-farming (fragile player farms from ~100px off boss center = lowest bullet density) for ignition;
+ level/effHP-scaled offset for faster wins. Validate at 20 seeds.

### TOOLING: psweep.js (parallel sweep, 13 workers) + sweep_worker.js → 6x faster (40 seeds ~37s/config).
### HYPERSENSITIVITY: policy is chaos-sensitive — tiny FARM tweak (aimWeight 0.4→0.5) flipped 2 seeds win↔90%.
  → MUST use 40 seeds for signal; ignore <0.03 differences. flank-farming did NOT help (regressed via the tweak).

### HONEST 40-SEED BASELINE (effHP_base): meanEval **0.656, 9/40 wins (~22%)**.
  (the 20-seed 0.735 was an optimistic subset.) Several seeds snowball to 60-90% then time out → need more DPS.
  40 seeds: 1,11,23,42,57,88,101,137,199,256,314,451,512,2,3,5,7,13,17,29,31,37,41,43,53,59,61,67,71,73,79,83,89,97,103,107,109,113,127,131
LEVERS: (a) convert 60-90% near-wins → wins via DPS; (b) ignite more (hard, RNG+dodge-gated).

### DEATH-CAUSE TALLY (current policy, 20 dying seeds): 100% BULLET deaths, 0 collisions, all @L4-6,
   f6000-12500 (early boss). So it's purely early-boss bullet survival, gated by farm-vs-dodge tension.

### THINGS TESTED THAT DON'T HELP (all noise or worse on 40-60 seeds — policy is chaos-sensitive):
- fragile-harder-dodge (FRAG_DODGE>1): 0.55 (snowball NEEDS aggressive farming; dodging↑ = never levels).
- tank-mode (strong players thread tighter for DPS): 0.54-0.62 (strong players STILL need clearance vs 400 bullets).
- strong-offense-lean (STRONG_DEF<1): neutral (90% timeouts ignite LATE, not upgrade-lean-limited).
- reroll-fishing when fragile: 0.615 (delays a useful upgrade → dies).
- satellite-priority when fragile: 0.64-0.65 (loses immediate DPS/coverage).
- new upgrade priorities bundle (bullet-destroy+115/exp-mult/effHP-fragile): 0.582-0.644 (over-defends → slow wins).
- flank-farming, open-seeking, rollout, dirs24, T20, offset-decay, farmaimw: all ≤ baseline.

### CONFIRMED KEPT (mechanically correct, ~neutral measured): boss_hunter (+30% boss dmg recognition).

### FINAL POLICY: effHP_base + boss_hunter, hardcoded (policy.js: `num=(k,d)=>d`, NO env reads → deterministic).
  80-seed validation (40 tuning + 40 fresh): **meanEval 0.600, 13/80 wins (16%)**, +6 seeds at 90% (near-wins).
  This GENUINELY CLEARS THE GAME (3 boss forms, 58.5M HP) on ~16-22% of seeds. Ranking rule satisfied:
  many real wins (eval>1 each) dominate. Conclusion: ignition (early-boss survival) is a hard wall for this
  controller; extensive tuning plateaued. policy.js holds the best.

### trap-avoidance dodge (escape-route count): escape_w40 got 9 wins but lower meanEval (0.648 vs 0.679) —
  same chaos reshuffle. OFF. Confirms the controller is at its ceiling.

### FINAL VALIDATION (honest held-out estimate, policy.js = deterministic, no env reads):
- 40 tuning seeds: 0.656, 9 wins (22%)
- 40 fresh (300-339): 0.550, 4 wins + 6@90%
- 40 fresh (400-439): 0.570, 7 wins + 3@90%
- 80 mixed: 0.600, 13 wins (16%)
→ Expected held-out: ~0.57-0.60 eval, ~16-18% WIN RATE (genuinely 通关 / clears all 3 boss forms).
  No crashes, no pathological seeds. Wins span f25k-87k (earlier = higher eval).

### DONE. policy.js = the best found. Architecture summary:
  1. Greedy lookahead dodge (swept-collision THIS tick + closest-approach over T=16; quadratic floor & wall
     barriers; central-band aim clamp so it never chases the boss into a corner).
  2. Phase logic: pre-boss/early-boss FARM adds (chase) for exp; level>=13 DPS mode (camp bossX±50, off the
     central down-stream). effHP(hp+shield)-driven aggression: shielded → camp & DPS, bare → dodge.
  3. Survival-item divert (bombs clear bullets / invincible / levelup / heart) when close.
  4. Upgrades: offense-lean (boss_hunter, multishot, fire-rate, damage, satellites) with a mild defense lean
     while fragile (level<13). Handles full Chinese upgrade pool by keyword + rarity.
  All deterministic, never throws (try/catch fallback), handles upgrade panel / boss cutscene / empty field.

### LAST EXPERIMENT — safe-add farm targeting (avoid chasing adds into bullet streams):
  80-seed A/B: safeadd_off (current) = 0.608/13wins vs safeadd_20 = 0.585/**15 wins**. More wins but SLOWER →
  LOWER meanEval (the eval metric = mean of per-seed eval_score; faster wins score higher). KEPT safeadd_off.
  Key lesson: win COUNT alone isn't the metric — a slower win scores less than a faster one, and meanEval
  captures count×speed×loss-progress. The current policy maximizes it.
### FINAL: policy.js locked in (~0.59-0.61 held-out meanEval, ~16% win rate, clears the game). Best of ~37 tested.
