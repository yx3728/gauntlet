# Game Model

## Field
- Size: 360×640 px, origin top-left, x right, y down
- Player starts at [180, 545] (bottom center)

## Player
- Size: [24, 30]
- HP: 3000 base
- Fires straight UP automatically every 420ms (every ~25.2 steps at 60fps)
- Bullet velocity: [0, -8.5] px/tick, dmg: 1000
- Speed cap: 40 px/tick

## Enemies
- Enter from top (y<0), move downward at ~1.6-2.2 px/tick
- Enemy types: grunt, swift, tank, shooter, weaver, elite
- Body collision with player deals ~2000 damage (very high)
- Bullets deal 300 damage each

## Boss
- Appears in wave 3
- "Crimson" boss: 19.4M HP, 5 layers (~3.9M per layer)
- "Azure" boss: 19.5M HP, 5 layers
- Boss orbits left/right: x between ~80-290 (center ~180)
- Boss y stays ~130-350 during fight
- Fires spread fan patterns (4-6 bullets at 45° spread, vel ~4 px/tick)
- Bullet patterns are periodic with ~50-100 step gaps

## Key Mechanics
- Player shoots ONLY straight up; must align X with enemies to hit
- Items drop when enemies die: exp_small, exp_medium, exp_large, exp_huge, heart, bomb, magnet, levelup
- Magnet range: 40px base; mag_basic upgrade gives +175% = 110px
- Level up every N kills; upgrade options: 3 choices

## Upgrade IDs Seen
- pc_pierce: bullets pierce all enemies (HUGE for waves)
- fr_basic: +32% fire rate
- tyrant_breaker: boss damage bonus (orange rarity - very powerful)
- boss_hunter: +30% boss damage
- crit_aim: MASSIVELY reduces fire interval (31ms from 420ms?!)
- mix_ascend: unknown but powerful
- mix_fire: fire combo
- ms_split_s: gives side_bullets=1 (triple shot)
- kill_pulse_3: kill pulse damage
- bs_size_s: bullet size ×2
- shield_basic: shield = max_hp, regen 3%/sec
- dmg_s: +12% damage
- kill_blood: lifesteal on kill
- heal_overflow: overflow heal
- mag_basic: +175% pickup range
- drop_basic: elites always drop
- heal_quick: quick heal
- exp_basic: exp boost
- thorn_static: thorn damage (weak)
- reroll_premium: reroll options
- coin_small: 150 coins
- mix_econ: economy

## DPS Analysis
- Base DPS (0 upgrades): 1000 dmg/25.2 steps = 39.7 HP/step
- With pierce + side_bullets + crit_aim (31ms interval): ~3400 HP/step actual
- Boss time to kill at 3400: 19.5M / 3400 = 5735 steps ≈ 95 in-game seconds
- Need accurate X tracking of boss to hit: boss half-width = 60px

## Movement Constraints
- Player min Y: fh*0.5 = 320 (v3 approach works best)
- Player max Y: fh*0.9 = 576
- Ideal Y: fh*0.78 = 499
- Body avoidance: 85px radius from enemies

## Bullet Patterns
- Wave bullets: mostly vertical (bvy ~4, bvx ~0)
- Boss bullets: fan spread (~4 bullets at angles vel [±1.6, 4.1] range)
- Boss fires every ~20-30 steps per bullet stream
