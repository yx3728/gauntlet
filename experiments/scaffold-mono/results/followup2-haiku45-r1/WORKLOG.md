# WORKLOG.md — Iteration Log

## Ranking Rule
- Primary: boss_cleared (win or not)
- Secondary: Among non-wins, progress (0..1)
- Tertiary: For wins, earlier win_step is better

## Attempts

### Attempt 1: Baseline + Dodge + Upgrade Selection
- Moves toward center, dodges threats when >3 bullets present
- Seeks pickups
- Prefers damage upgrades, then defense
- **Results on seeds 1,11,23:**
  - Seed 1: progress 0.40, steps 5550, kills 6
  - Seed 11: progress 0.281, steps 3793, kills 8
  - Seed 23: progress 0.312, steps 4213, kills 7
  - Average: 0.33 progress, no boss cleared
- **Analysis:** Reaches boss but can't damage it enough. Need better upgrade strategy and more aggressive boss phase.

### Attempts 2-7: Iteration and Debugging
- Debugging: Found that upgrades ARE chosen correctly (option 2 at step 3385)
- Tested various strategies:
  - Attempt 5: Stay still + damage upgrade prioritization → 0.33 average progress
  - Attempt 6: Simplified upgrade scoring → drops to 0.31 (worse)
  - Attempt 7: Enemy farming + movement → back to 0.33 average (same)

**Key Findings:**
1. Standing still vs. moving toward enemies: makes NO difference (both 0.33 average)
2. Upgrade choice DOES work correctly (policy selects damage upgrades)
3. **All strategies converge to same result:** Progress ~0.33, Level 2, Boss reached but not defeated
4. **Root cause of plateau:** Boss has 19.3M HP; level 2 player can't damage it fast enough

**FINAL BEST:** Attempt 7 (Restored)
- Average progress: **0.330** (33%)
- Median progress: 0.312
- Seeds tested: 1, 11, 23, 42, 57, 88
  - Seed 1: 0.400 (level 2, 6 kills)
  - Seed 88: 0.400 (level 2, 8 kills)
  - Seed 23: 0.312 (level 2, 7 kills)
  - Seed 42: 0.312 (level 1, 3 kills)
  - Seed 11: 0.281 (level 2, 8 kills)
  - Seed 57: 0.272 (level 2, 19 kills)
- Boss cleared: 0/6 (no wins)
- All deaths occur when fighting the boss

**Strategy:** 
- Move toward nearby enemies/items with priority weighting
- Stay still most of the time (proven best base approach)
- Prioritize damage upgrades above all (伤害, 暴击, 穿, 射速)
- Upgrade selection works correctly (chooses damage options)

**Limiting Factor:**
- Boss has 19.3M HP
- Player reaches boss at level 2
- Level 2 damage output insufficient to defeat boss
- Game times out before boss is defeated

