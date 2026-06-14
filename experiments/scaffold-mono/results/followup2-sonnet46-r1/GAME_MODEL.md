# GAME MODEL

## Field
- Width: 360px, Height: 640px
- Origin: top-left (x right, y down)

## Player
- Starts at y=541 (near bottom)
- Size: 24x30px
- Base HP: 3000
- Base magnet_range: 40px
- shoot_interval_ms: 420ms (≈25.2 ticks between shots)
- Fires upward: bullet vel=(0, -8.5)
- Damage: 1000 per bullet (base)

## Enemies
- Spawn at the TOP (y≈0 or y<0) and move DOWN (vel[1] > 0, typically 1.4-2.0 px/tick)
- grunt: 1000 HP (1 shot to kill)
- tank: 4000 HP
- enemy_elite: 62400 HP (hard to kill without upgrades)
- boss: 19,300,000+ HP

## Player Shooting Direction
- Bullets go UP (vel[1] = -8.5)
- Can only hit enemies ABOVE the player (y < player.y)
- CRITICAL: Enemies BELOW the player (y > player.y) cannot be hit!

## Enemy Bullets
- Typically move DOWN (vel[1] > 0, usually 3.9-4.5 px/tick)
- Damage: 300 per hit
- Can be dodged horizontally (left/right)

## Critical Positioning Insight
- Player should be near the BOTTOM (y ≈ 570-590) to maximize enemies above
- At y=448 (default mid): enemies at y=450-640 pass through unshot
- At y=580: 90%+ of field above is in shooting range

## Kill Rate Analysis
- Grunt (1000 HP): killed in 1 shot. Every grunt that passes above player is killed
- Elite (62400 HP): needs ~26 damage upgrades total to kill in 1 pass
- Boss: needs heavy upgrades to kill

## Items
- Drop from killed enemies
- Types: exp_small, exp_medium, exp_large, exp_huge, heart, bomb, magnet, coin, levelup, invincible
- Items fall slowly (positive y vel) - they can pass below the player!
- Magnet upgrade dramatically increases auto-collect range

## Level-Up Upgrades Observed
- 高能弹芯 (dmg_s): +12% damage - PRIORITY
- 磁吸装置 (mag_basic): +175% pickup range - VERY USEFUL early
- 鲜血学者 (kill_blood): +1% lifesteal - ok for sustain
- Others: need to discover

## Wave/Boss Progression
- Wave 1 → 2 → 3
- Boss (variant "crimson") appears during wave 3 with 19.3M HP
- Boss starts at y≈8 (top of field), moves toward center
- Boss fires multi-directional bullet patterns

## Key Issues from v1 Policy
1. Player wandered to y=192 chasing top items → lost half the field
2. Bullet avoidance pushed player into corners  
3. Upgrade choice not implemented properly
4. Only 5 kills in full game (grunts passing below unshot)
