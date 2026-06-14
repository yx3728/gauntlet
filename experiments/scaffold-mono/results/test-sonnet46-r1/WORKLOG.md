# WORKLOG

## Ranking Rule
Win (boss_cleared) > progress% → max(boss_hp_destroyed) → survived_ms

## Current Best Policy
Wave-aware v5 (current policy.js):
- Seeds 1,11,23,42,57: ALL reach wave 3 boss (progress=40%)
- No kills of boss: 0-1% boss HP
- Survive ~100-120s total
- Level 3-5 when boss arrives

## Key Findings

### Game Structure
- Wave 1: 0-3600 steps (60s) 
- Wave 2: 3600-5400 steps (30s)
- Wave 3: 5400+ steps (boss appears)
- Boss HP: 19.3M, 5 layers (variant varies: crimson/azure)

### DPS Problem
- Base DPS: 40 dmg/step (1000 dmg/25 steps)
- Level 3-5 at boss: maybe 80-120 dmg/step (with 2-4 upgrades)
- Need to kill boss in 84600 steps: need 228 dmg/step
- CRITICAL: Old v3 got level 37 with 173 dmg/step → 76% boss killed (timeout)

### Best Strategy (from v3 testing on seed 1)
Policy that did closestApproach bullet dodge + direct repulsion:
- Seed 1: 49% progress, 17% boss HP, level 12, 30000 steps (30k timeout)  
- Then full run: 90% progress, 76% boss HP, level 37, 90000 steps (90k timeout)
- Seeds 11/23: died at step 942/1681 (enemy body collision)

### Why Seeds 11/23 Die (v3 policy)
- Enemy cluster at x=72-74 appears
- Player targets enemy at x=74.6 (just outside SAFE_TARGET_DIST=70 at dist=77)
- Moving LEFT toward target puts player inside enemy cluster at x=72
- Body avoidance (BODY_R=65, wt=12) too weak to override target force (-2.0)

### Key Fix Needed
When enemies are nearby (within BODY_R), use centerX (w/2) as target instead of an enemy.

### Why v3 Worked on Seed 1
- Enemy positions in seed 1 happened not to cluster near player
- Player successfully kills many enemies (1102 in 90000 steps)
- Gets to level 37 with many DPS upgrades
- 173 dmg/step → 76% boss HP in 84600 steps

### Path to Win
Need 228 dmg/step. Old v3 got 173. Need 32% more DPS.
Options:
1. One more split-bullet/fire-rate upgrade 
2. Or stay alive longer during boss (173 * (90000/84600 more time))

Actually: 19.3M / 173 = 111,560 steps to kill boss. Boss starts at 5400. Need step 116960. But max is 90000. CANNOT win with 173 dmg/step!

Minimum DPS to win: 19.3M / (90000-5400) = 228 dmg/step.

At level 37 with multiple DPS upgrades, 173 dmg/step suggests the upgrade mix included too many non-DPS upgrades (shield, magnet, etc.)

## Attempts

### Attempt 1: Template (hold still)
- Seed 1: 40% progress, level 2, wave 3 boss reached, died
- Strategy: stationary, first upgrade choice
- Analysis: reaches boss but too weak

### Attempt 2: Basic movement (v1)
- Seed 1: 37% in 5000 steps (timeout), level 2, wave 2
- Moving toward enemy x - better kills but risky

### Attempt 3: Simple movement (v2)
- Seeds 1/11/23 (15000 steps): 12-35%, dying in waves 1-2
- Enemy collision deaths

### Attempt 4: Force-based (v3 - BEST SO FAR)
- Seed 1 full run: 90% progress, 76% boss HP, level 37, 1102 kills!
- Seeds 11/23: died at ~16s (enemy body collision)
- **This is the closest to winning.**

### Attempt 5: Various fixes that broke seed 1
- Various policies that fixed 11/23 but broke seed 1
- All showed progress 30-41%

### Attempt 6: Wave-aware v5 (current)
- Seeds 1,11,23,42,57: ALL reach wave 3 boss (progress=40%)  
- Boss HP barely dented (0-1%)
- Die quickly in boss fight due to low level (3-5)

## Next Plan
1. Go back to v3 (force-based closestApproach) - the BEST for seed 1
2. Fix seeds 11/23 death: when any enemy within BODY_R, use centerX as target
3. Keep all other v3 parameters identical
4. Also improve upgrade priority for DPS (prioritize split bullets, fire rate)
5. Add "retreat" behavior: if enemy within 75px, target=center, reduce horizontal force

## Key Upgrade Observations
- 分裂弹幕 (split bullets): 3 bullets → 3x DPS (CRITICAL to pick!)
- 穿透核心 (pierce): pierces enemies → better vs waves
- 急速射击 (rapid fire): +32% fire rate
- 高能弹芯 (damage): +12%
- 无坚不摧 (orange): bullets destroy enemy bullets (defensive, great for boss)
- 应急修复: full heal + max HP shield (take when low HP)

## DPS Calculation (with right upgrades)
- Base: 40 dmg/step
- After split bullets (3x): 120 dmg/step
- After 3x rapid fire (+32% each): 120 * 1.32^3 = 276 dmg/step → ENOUGH!
- After 2x damage (+12% each): 276 * 1.12^2 = 346 dmg/step → easily enough!

So if I pick: split bullets + 2-3 rapid fires + damage upgrades = WIN is possible!
This requires level 5-7 minimum to get these specific upgrades.
