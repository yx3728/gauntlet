# Worklog

## Ranking Rule
Primary: boss_cleared (win = 1.0+ progress). Secondary: boss_hp_destroyed. Tertiary: progress%.

## Best Result So Far
v3 (ID-based upgrades + boss tracking): 44% mean (seeds 1,11,23)
- seed 1: 41%, 2% boss HP, wave 3
- seed 11: 52%, 25% boss HP, wave 3 ← BEST
- seed 23: 40%, 0% boss HP, wave 3

## Attempt Log

### v1 (initial movement): 7% mean
- Killed 15 enemies, died from BODY COLLISION (ran into grunt, 2000 damage!)
- Problem: moved toward enemies without body avoidance

### v2 (body avoidance + better bullet dodge): 33% mean
- 33-35% progress, wave 2, levels 5-6
- Reaching wave 2 but dying there
- Problem: still dying from wave bullets

### v3 (boss tracking + ID upgrades): 44% mean ← BEST
- All 3 seeds reaching wave 3 boss
- Seed 11: 25% boss HP destroyed!
- Key: boss tracking targetX = boss.pos[0]
- Upgrades taken (seed 11): tyrant_breaker, ms_split_s, pc_pierce, ms_split_s, ms_split_s, crit_aim, fr_basic
- Player stats at death: pierce=true, side_bullets=1, shoot_interval=31ms → 3400 HP/step DPS

### v4-v8 (various bullet dodge improvements): ~30% mean
- All attempts WORSE than v3
- Problems: 
  - Wrong direction of force calculation (inverted sign)
  - Aggressive normalization causes full-speed erratic movement
  - Higher trigger thresholds cause more jitter
  - The v3 "dot-product filter" naturally prevents over-reaction to bullets

## Key Insights
1. Player fires straight up → must align X with enemies/boss
2. Enemy body collision = ~2000 damage (devastating)
3. "dot > 0 skip" in bullet avoidance is GOOD - prevents over-reaction to distant bullets
4. Raw force × SPEED (not normalized) gives proportional response
5. Threshold 0.5 for strong dodge, 0.15 for moderate works best
6. Keep player at y=0.5-0.9*fh range (minY=320 not 385)
7. During boss fight: track boss X position
8. Boss fires symmetric fan patterns → forces cancel → need safer-side tiebreaker

## Next Steps
1. Restore exact v3 code that achieved 44%
2. Add safer-side tiebreaker for symmetric bullet cancel
3. Test on more seeds
4. If still not winning: increase DPS by prioritizing crit_aim and ms_split_s more
