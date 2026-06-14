# GAME_MODEL.md — factual picture (observed, not assumed)

## Field & player
- Field: 360 (w) × 640 (h). Origin top-left, +x right, +y down.
- Player start: [180, 545] (bottom-center). size [24,30]. So center can range x∈[12,348], y∈[15,625].
- Player HP: 3000 / 3000. magnet_range 40. shoot_interval_ms 420. side_bullets 0, pierce false, satellites 0.
- speed_cap 40 px/tick (move clamped to MAGNITUDE 40, direction preserved). Player is FAST (crosses 360px width in 9 ticks).

## Auto-fire
- Player fires STRAIGHT UP (vel [0,-8.5]) from player's x. First shot ~frame 26 (interval ~25 frames = 420ms).
- Player bullet dmg = 1000. Grunt hp = 1000 → ONE shot kills a grunt.
- TO HIT AN ENEMY YOU MUST HORIZONTALLY ALIGN x WITH IT. Bullets only travel vertically.
- Grunts have vel x = 0 (move straight down), so once aligned in x they STAY aligned.

## Enemies
- enemy_type ∈ grunt, swift, tank, shooter, weaver. Wave 1 = mostly grunts (hp 1000).
- Grunts spawn at top (y≈0 or negative), descend at vel ~[0, 1.4–1.8].
- Enemies pass through the bottom and despawn (holding still at bottom = 0 damage over 3000 frames).
- enemy_elite = tougher. boss = has hp/max_hp/variant/in_cutscene.

## DAMAGE MODEL (critical)
- COLLISION with an enemy: ~1000–2000 HP per hit (lethal in 2-3). Needs overlap in BOTH x and y.
  → Holding perfectly still is SAFE (enemies pass at other x). DYING comes from MOVING INTO enemies
    (sweeping horizontally through them at the bottom, or moving UP into the swarm).
- enemy_bullet dmg = 300 (≈10 hits = death). Wave 2+ shooters fire these.
- Player invincible_ms >0 gives temporary immunity.

## Items (pickups)
- item_type: exp_small(xp 1), exp_medium(xp 3), exp_large?, exp_huge?, heart, bomb(xp 0), magnet, coin, levelup, invincible.
- Items FALL DOWN at vel [0, 1.4] → they drift toward the bottom where the player sits. Collect by magnet (range 40) or overlap.
- Items spawn where enemies die (the column you aligned with), so they tend to fall near you.

## Leveling
- xp_to_next: 5, then 13, ... grows. Level timeline (align policy): L2@608, L3@1705, L4@3245. SLOW.
- Each level → level_up panel (obs.pending_upgrade.options, 2-3 options). Must return upgrade_choice.

## Upgrades seen (wave1-2, low levels — mostly green/blue utility)
- [green] bs_size_s 大口径弹: bullet size +100% (coverage)
- [green] pc_pierce 穿透核心: bullets pierce enemies until off-screen (column clear) — STRONG
- [blue] kill_pulse_3 爆炸脉冲: 10% chance explosion on kill (AoE)
- [green] mag_basic 磁吸装置: pickup range +175%
- [green] thorn_static 静电护甲: thorns (deal dmg back when hit)
- [green] mix_econ 战地经济学: +200 coins, +15% drop rate
- [green] coin_small 赏金协议: +150 coins
- [blue] reroll_premium 高级重掷: next 3-choice guaranteed purple/orange
- (Haven't yet seen multishot/firerate/damage/satellite/shield/hp — likely higher rarity or deeper.)

## Waves / boss
- wave ∈ {1,2,3}. Wave 1→2 at ~frame 3601 (kills 74, lvl 4) with align policy.
- Boss not yet reached. progress: 0.222 (still) / 0.295 (align, died wave 2). Boss is deeper.
- Score = 10000·boss_cleared + 2000·(wave−1) + 500·level + 100·kills + min(survived_s,120). (reference only)

## BOSS FIGHT (crimson) — observed
- Boss appears at ~f5400 (TIME-based, ~90s; slightly seed-dependent). max_hp = 19,500,000 (5 hp_layers).
- Trajectory: enters top y=-68, descends to y~140-160, then STAYS at top (y~150) and sweeps side-to-side
  (vel x up to ±3.8). Does NOT come down to the player → no boss-body collision risk at the bottom.
- Boss size 120×120 (huge). To DPS it, keep player x within boss_x ± ~60 (bullets travel straight up).
- Attacks: bullet cloud ACCUMULATES over time (11→24→41→56→59...). Bullet speeds 3.9–5.3 px/tick (SLOW vs player 40).
  bullet dmg 300 / 450. Corner is a DEATH TRAP (bullets converge, player gets walled-in).
- Adds (small enemies) keep spawning during boss (~2-5 present) → exp to keep leveling DURING the fight (snowball).
- Pure-flee dodge policy survived only ~600 frames into boss. Need much better dodging.

## BOSS = 3 FORMS, each 5 layers (~58.5M HP total to WIN)
- The boss hp% goes 100→80→60→40→20→0 (5 layers @ 19.5M), THEN RESETS to 100% — there are
  THREE boss forms in sequence. WIN = destroy all 3 (~58.5M HP). That's why it's a long endurance race.
- Bullet count EXPLODES over the fight: ~50 early → 130 → 187 → 400+ near the end. You CANNOT dodge 400
  bullets perfectly → late survival relies on a big EFFECTIVE-HP pool (SHIELDS). Winning seed had shield
  up to 3000 (refreshed from heal/heart/overheal items+upgrades) on top of 3000 HP.
- IGNITION DIFFERENTIATOR: winning seeds get an effective-HP upgrade EARLY (heal_quick = full heal +
  shield=maxHP = +3000 eff HP; or shield/maxHP) → ~6000 eff HP at boss start → survive early boss → snowball.
  Seeds that only get offense stay at 3000 HP → die in the early boss. (Partly upgrade RNG.)
- Winning DPS scaling: shoot_interval 420→365→280→212→129→100ms, +satellites(2→4), +side bullets, +pierce.
  ~10-20x DPS by endgame. Need BOTH big DPS (kill 58.5M) AND big eff-HP (survive 400 bullets).

## DPS MATH (the central problem)
- Base DPS ~2381/s (1000 dmg / 420ms). At lvl6 (fire+32%, 3-way split, crit) ~10k/s.
- 19.5M HP / 10k = 1950s > the ~1410s available after boss → base-ish DPS CANNOT win.
- Must SNOWBALL: survive boss fight long, kill adds → level up → DPS grows → kill boss faster.
- XP curve (xp_to_next): L1→2:5, →3:13, →4:18, →5:24, →6:32, →7:50 (growing). ~1 exp/kill.
  Only ~50-62 enemies spawn pre-boss → max ~level 6-8 before boss. Need to level a lot DURING boss.

## Upgrade pool (more, seed1 levels ~2-6)
- OFFENSE: fr_basic 急速射击 (fire rate +32%, size -10%); ms_split_s 分裂弹幕 (3-way shots); crit_aim (crit +20%);
  bs_size_s (size +100%); pc_pierce (pierce); elite_hunter (+40% vs elite).
- DEFENSE: heal_quick 应急修复 (full heal + shield=maxhp); timeflow_shield 时间流护盾 PURPLE (slow nearby enemies+bullets 50%);
  heal_overflow (overheal→shield); kill_blood (lifesteal+1%).
- UTILITY: mag_basic (pickup +175%); mix_econ/coin (coins); reroll_premium (next 3-pick has purple/orange).

## OPEN QUESTIONS
- Boss HP, phases, attack patterns, location (top? moving?).
- Full upgrade pool incl. offense scaling (multishot/firerate/damage/satellites).
- Other enemy types' behavior (swift/tank/shooter/weaver), elite behavior.
- exp_large/exp_huge values; heart/magnet/invincible/levelup effects.
- What does collision damage exactly scale with? Per-frame while overlapping?
