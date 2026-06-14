# Game Model

## Field
- 360x640 pixels. Origin top-left. Player starts at ~(180, 545).

## Player
- Shoots straight UP automatically every 420ms (~25 ticks at 60fps)
- Bullets: vel=(0, -8.5), dmg=1000 base
- Size: (24, 30) → hitbox half-widths: 12px horizontal, 15px vertical

## Wave Structure (seed 1)
- Wave 1: steps 1-3600 (~60s) — basic enemies
- Wave 2: steps 3601-5400 (~30s) — elite enemies fire spread bullets
- Wave 3: steps 5400+ — BOSS appears
- Boss variant: "crimson", HP=19,300,000, 5 HP layers

## Enemies
- `enemy`: basic grunt, HP ~1000-2000, vel ≈ (0, 1.6-2.6) — moves straight DOWN
- `enemy_elite`: tougher, HP=2000+, fires 3-spread bullets (vel=(-1.6,4.5), (0,4.5), (1.6,4.5))
- Enemy bullets: dmg=300, spread pattern

## Key Mechanics
- **Shooting**: player bullets go UP from player's x position. Must align x with enemy to hit.
- **Enemy collision**: enemies have sizeable hitboxes; colliding with enemy body causes MASSIVE damage (2000+). 
- **Items**: drop from dead enemies, fall at vel=(0, 1.4). Player collects within magnet_range (40px default).
- **XP items**: exp_small=1xp, exp_medium=3xp. Need ~5xp per level initially.
- **Waves advance by TIME** (not kills). Killing enemies gives XP for leveling up.

## Boss Fight (Crimson)
- HP: 19.3M, 5 layers
- Appears at ~step 5400 (wave 3)
- 90000-5400 = 84600 steps available to kill boss
- Needed DPS: 19.3M / 84600 ≈ 228 damage/step minimum

## DPS Calculations
- Base: 1000 dmg / 25 steps = 40 dmg/step
- With 3-bullet spread (分裂弹幕): 120 dmg/step
- With pierce + spread: hits boss once per bullet regardless
- With fire rate +32%: 40*1.32 = 52.8 dmg/step
- Need multiple upgrades to reach 228 dmg/step

## Key Upgrades Seen
- 穿透核心 (pierce): bullets pierce all enemies — HUGE vs regular enemies
- 急速射击 (rapid fire): +32% fire rate
- 高能弹芯 (damage): +12% damage
- 分裂弹幕 (split bullets): 3 bullets → 3x DPS (CRITICAL!)
- 无坚不摧 (orange): YOUR BULLETS DESTROY ENEMY BULLETS — very defensive
- 应急修复: Full heal + max HP shield
- 能量护盾: Shield + auto-repair
- 爆炸脉冲: 10% explosion on kill
- 磁吸装置: Magnet +175% range
- 卫星 (satellite): orbiting bullets

## Death Patterns
1. **Enemy collision** (MAIN CAUSE): player moves toward enemy x to shoot it, runs into enemy body. Enemy collision deals ~2000 damage!
2. **Bullet hits**: elite enemy spread bullets deal 300 each. 3000 HP = 10 hits max.
3. **Boss fire**: boss fires many bullets, very hard to dodge without active movement.

## Observations
- Template (hold still) reaches wave 3/boss with level 2 only, but dies in ~150 steps to boss
- Active policy (tracking enemies) gets level 37 but dies in 90000-step limit (76% boss HP remaining)
- Enemy body avoidance must be strong — targeting enemy X while enemy is close causes collision
