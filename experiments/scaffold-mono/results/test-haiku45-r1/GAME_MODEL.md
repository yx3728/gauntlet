# Game Model - Observations

## Initial Observations (Baseline seed 1)

### Baseline Metrics
- Survived: 92.5 seconds (5550 frames at frame_skip=1)
- Progress: 0.4
- Wave reached: 3
- Boss reached: Yes, but died immediately with boss at 100% HP
- Kills: 6 enemies, level 2
- Policy: hold position, pick upgrade 0

### Key Observations Needed
- [ ] How does movement work? (speed_cap = 40 px/tick max)
- [ ] What do different enemy types do?
- [ ] What are effective upgrade choices?
- [ ] How to avoid boss attacks?
- [ ] Wave progression and difficulty ramp
- [ ] Object types and their velocities

## Movement System
- Action.move: [dx, dy] per tick
- Clamped to speed_cap (40) as a magnitude vector
- Screen clamping applies afterward
- Player size: [w, h]
- Field size: visible as obs.field {w, h}

## Enemies
From INTERFACE:
- `grunt, swift, tank, shooter, weaver` (normal)
- `enemy_elite` (tougher)
- `boss` (fight last)

## Upgrades
- Rarity: green, blue, purple, orange (increasing rarity)
- Available at level-up
- Can reappear or be one-time

## Boss Encounter Observations
- Boss appears at wave 3 (progress ~0.4)
- Never in cutscene when encountered
- Auto-fire does 0% damage (may be rounding to 0, but no visible damage)
- Boss kills player within ~150 steps regardless of evasion strategy
- Damage output seems insufficient with only 1-2 upgrades

## Available Upgrades (seed 1, level-up #1)
1. [green] 战地经济学: coins +200, drop rate +15%
2. [green] 战术学习: exp +100%
3. [purple] 终端优化: damage +15%, crit +25%

All choices lead to same wave 1-2 performance, but choice 2 (damage) hurts wave progression.

## Key Insight
- We need to reach HIGHER levels and get MORE upgrades to defeat boss
- Current path: 1 level-up before boss = too weak
- Need to find seeds/strategies that allow more level-ups or later boss encounters
