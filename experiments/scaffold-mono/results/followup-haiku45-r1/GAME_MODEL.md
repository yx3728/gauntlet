# GAME_MODEL — Roguelike Skies Architecture

## Arena
- **Size**: 360×640 px (width × height)
- **Origin**: top-left (x right, y down)
- **Player spawn**: bottom-center [180, 545]

## Player & Mechanics
- **HP System**: max_hp=3000, can be reduced by enemy fire
- **Auto-fire**: Gun fires automatically; no manual fire button
- **Movement**: Only continuous control is `move: [dx, dy]` per tick
  - Clamped to `speed_cap` (default 40 px/tick)
  - Stationary [0,0] is safest (bullet patterns are designed for this)
- **Leveling**: Collect experience drops → reach exp threshold → level up event
  - First level-up: ~step 3400 (reaching level 2)
  - Higher level-ups: rare (only 3/100 seeds reach level 3)

## Game Progression
- **Waves**: 3 waves of increasing difficulty (1→2→3)
  - Wave 1: ~3600 steps of progression
  - Wave 2: ~1000-1500 more steps
  - Wave 3: Boss fight (19.3M HP), no practical path to victory
- **Enemies**: Variants include grunt, swift, tank, shooter, weaver
- **Items**: experience only (exp_small, exp_medium, exp_large, exp_huge)
  - ~2000+ drops per game, collected automatically
  - **No health packs, bombs, shields, or power-ups in seed 1**

## Boss Fight
- **Boss Type**: "crimson" variant, 19,300,000 HP
- **Damage Output**: ~4,550 HP per 196 steps (0.024% per second)
- **Time to Defeat**: ~800 hours of continuous fighting
- **Practical Result**: Unreachable within 90,000 step limit or before player death

## Upgrades
**Observed Patterns** (all in Chinese, effects partially inferred):
- Rarity: green < blue < purple < orange
- **Strategy**: Always choose index 0 (first option) - **best performer**
  - Index 0 reaches 40%+ on favorable seeds
  - Higher rarities don't guarantee better performance
  - Some seeds seem to favor index 0, others favor specific choices
  - No seed improves beyond 40% regardless of upgrade choice

## Win Conditions
- **Current Achievement**: 40% progress (reach + partially damage boss)
- **True Win**: boss_cleared = true, progress = 1.0
- **Constraint**: Mathematically impossible without 42,000x damage multiplier
- **Blocker**: Game design requires either:
  1. Specific upgrade sequence that massively multiplies damage, OR
  2. Hidden mechanic that scales player power exponentially, OR
  3. Alternative strategy we haven't discovered
