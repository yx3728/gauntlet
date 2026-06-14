# GAME_MODEL.md — factual picture (observed, seed 1 unless noted)

## Field & player
- Field: w=360, h=640. Origin top-left, +x right, +y down.
- Player start: pos [180,545] (bottom-center), size [24,30].
- Player base: hp 3000, shield 0, level 1, xp_to_next 5, magnet_range 40,
  shoot_interval_ms 420, side_bullets 0, pierce false, satellites 0.
- speed_cap 40 px/tick (move clamped to magnitude 40; per-vector not per-axis).

## Auto-fire (no fire action; movement only)
- Bullets spawn at player's CURRENT x, fire STRAIGHT UP: vel [0,-8.5], dmg 1000, size [6,12].
- Cadence ~ shoot_interval_ms (420ms = ~25 frames). ~2.4 shots/sec base. Base DPS ~2400.
- Bullet travels y=545->0 in ~64 frames; ~2-3 bullets active at once.
- **To hit an enemy you must align player.x with enemy.x** (bullets go straight up).
  Holding at x=180 => 0 kills because enemies spawn at varied x.

## Enemies (spawn at top y~0..-40, move DOWN). hp / vel.y observed:
- grunt:  hp 1000, vel.y ~1.6-1.9   (1 bullet kills)
- swift:  hp 1000, vel.y ~4.06      (fast)
- weaver: hp 2000, vel.y ~1.66      (need to confirm x-weave)
- tank:   hp 4000, vel.y ~1.04      (slow, tanky)
- shooter: fires enemy_bullets (named type not yet captured; bullets seen @1864)
- enemy_elite (enemy_type "elite"): hp 62400 (!!) very tanky, vel.y ~1.38
- boss (variant "crimson"): hp 19,300,000, 5 hp_layers, vel.y ~1.6 entering.

## Projectiles / damage
- enemy_bullet: dmg 300, vel [0,3.9] (down). Player hp 3000 => ~10 bullet hits = death.
- Sitting still in wave1 is safe (no dmg); damage starts ~wave2 from enemy_bullets.
- Died @5550 sitting still: accumulated enemy_bullet hits during boss entry.
- player_bullet: dmg 1000 (mine).
- **ENEMY BODY CONTACT = MASSIVE DAMAGE**: moving into a grunt dealt -2000 then -1000 (lethal in 2 touches). NEVER touch enemy bodies. Primary survival constraint.
- Enemies despawn when they exit the bottom (objs count stays bounded passively) => dodging their column lets them pass harmlessly.

## Items (drop from kills, fall down vel.y ~1.4, magnet_range pickup):
- exp_small, exp_medium, exp_large, exp_huge (experience)
- heart, bomb, magnet, coin, levelup, invincible (effects TBD)

## Progression / waves
- wave 1 -> 2 around frame ~3700-4000; wave 3 + BOSS at frame 5400 (seed1, passive).
- Level up gives a panel (game paused); choose upgrade_choice = option.index.
- xp_to_next starts 5. exp items: small spawned after kills.
- Upgrade options seen (rarity green/blue/purple/orange):
  - mix_econ (green): +200 coins, +15% drop rate
  - exp_basic (green): EXP mult +100%
  - mix_terminal (purple): damage +15%, crit +25%

## reward / scoring
- score = 10000*boss_cleared + 2000*(wave-1) + 500*level + 100*kills + min(survived_s,120)
- progress: 0..1 (1.0 = cleared). Passive run reached progress 0.4 at boss death.
  progress seems ~ wave/level/boss based: ~0.044/600frames early, 0.4 at boss appearance.

## THE CRUX
- Boss HP ~19.3M. Base DPS ~2400 => ~8000s to kill — impossible without scaling.
- MUST stack damage/firerate/multishot/pierce/satellites upgrades to raise DPS by ~100x+.
- Need to: kill enemies -> collect exp -> level up -> pick DPS upgrades -> survive -> out-DPS boss.

## FULL upgrade pool (from winning seed11 run, lvl23) — rarity green<blue<purple<orange
- MULTISHOT TIERS: ms_split_s(green,3-way) -> ms_split_m(blue,II) -> ms_split_l(purple,III). side_bullets++.
- bullet_void "虚空收割者"(ORANGE): took side 2->10 (+huge projectiles) but shoot 365->474 (slower fire). Net big DPS.
- mix_fire "火控协同"(blue): +1 side bullet. side_bullets field grows with these.
- ANTI-BOSS: tyrant_breaker "王座破坏者"(orange), boss_hunter "屠龙战术"(blue): boss damage. -> win faster!
- SUSTAIN (lots available): shield_basic "能量护盾"(blue), shield_extra(purple,+maxhp too),
  heal_quick "应急修复"(full heal + shield=maxHP), heal_overflow "超量血库"(blue), heal_overflow_2(purple),
  regen_basic "自动修复"(blue, regen), regen_nano(purple), kill_blood(lifesteal), thorn_static(armor).
- DPS: dmg_s/dmg_m/dmg_l(tiers), mix_terminal(purple dmg+crit), crit_aim, pc_pierce, sat_orbit, bs_size_s, kill_pulse(_3).
- NO i-frames after hits (every contact -450, independent). maxhp grows slowly (3000->3630 by lvl23).
- Winning build = MIX: heavy sustain (shield/heal/regen) + multishot (split I/II/III + bullet_void) + pierce + dmg. Won @50533.
- **Dying seeds die lvl4-8 (early boss) BEFORE sustain accumulates** (shield@4,heal@5,regen@9). Chicken-and-egg.

## Upgrade pool (seed1, observed ids; rarity green<blue<purple<orange)
- ms_split_s (green) "分裂弹幕": bullets become 3-way  <-- MULTISHOT, big DPS
- dmg_s (green) "高能弹芯": damage +12%
- mix_terminal (purple): damage +15%, crit +25%
- crit_aim (green): crit rate +20%
- pc_pierce (green): bullets pierce enemies until off-screen (-> player.pierce=true)
- bs_size_s (green): bullet size +100%
- kill_pulse_3 (blue): 10% chance explosion on kill
- kill_blood (blue): lifesteal +1%
- heal_quick (green): full heal + shield = max HP (one-time burst heal)
- elite_hunter (blue): +40% dmg to elites
- drop_basic (blue): elites always drop items
- mix_econ (green): +200 coins, +15% drop rate ; coin_small (green): +150 coins
- Player fields change: side_bullets, pierce, satellites, shoot_interval_ms, max_hp, magnet_range reflect upgrades.
- DPS-greedy pick run: reached lvl6/wave2/98kills but DIED wave2 (no dodging). progress 0.371.

## BOSS FIGHT (crimson, observed seed11)
- Appears f5400 (~90s) in wave 3, hp ~19.5M, 5 hp_layers. Enters from top to y~200-300, roams.
- My DPS at boss entry (lvl7, side=1,pierce,sat=2): 65k-97k! => boss needs ~244s @80k DPS.
- I survived only ~19s of boss fight. DEATH CAUSE = bullet density: boss sprays up to 74 bullets,
  near80 = 6-8 bullets within 80px. Boss bullets do -450 (trash -300). HP 3000 => ~7 hits = dead.
- **Very few trash enemies spawn during boss (0-2)** => almost NO leveling during boss.
  => boss-entry power ~= final power. Enter as strong as possible.
- I get PINNED to bottom edge (y 615-625, floor=640, half=15 so max ~623) and corners (x 38,69,299)
  => no escape room => die. Must hold a higher band with escape room on all sides.

## *** MULTIPLE BOSSES *** (seed23, survived to timeout)
- The game has SEVERAL escalating bosses. Beat one => next appears with MORE hp.
  Boss1 ~19.5M (5 layers), Boss2 ~20.3M, Boss3 ~50.9M. Total to CLEAR ~90M+ HP.
- boss_hp_destroyed RESETS each boss (shows that boss's %). progress is overall (~0.9 at boss3).
- hp_layers: each boss has 5 layers; layer transitions are quick (cut=true only ~1% of frames).
- To CLEAR (通关) = defeat ALL bosses. Seed23 reached boss3 layer2 at timeout (90000 steps).
- DPS ramps massively with level: lvl4-12 ~4-7k DPS (SLOW), lvl16 ~11k, lvl20 ~19k, lvl22 ~41k,
  lvl24 ~85k. shoot_interval 420->129 via firerate. side_bullets 2->4->10. pierce late.
- **First boss layer took 604s (40% of budget!)** because entered boss at lvl4 (low DPS).
  Most leveling happens DURING boss fight (trash still spawns). Snowball: survive->lvl->DPS.
- Aligned with boss x only 67% of time => ~33% boss DPS wasted while dodging off-column.
- On seed23 HP never dropped (3000/3000 whole fight) => dodging perfect there; limiter = DPS/time.
  => Need: faster DPS ramp + better boss alignment + enter boss higher level, to win before timeout.

## STRATEGY IMPLICATIONS
- War of attrition vs boss. Need BIG effective HP + sustain. LIFESTEAL scales with DPS:
  1% of 80k DPS = 800 HP/s. Stack lifesteal + maxHP + heal + defense.
- Collect exp items (currently ignored!) to enter boss at higher level/DPS. magnet_range=40 small.
- Dodge dense patterns: stay in a central band (~y 500-540), keep clearance from ALL edges.
- Out-DPS faster also shortens the fight (less time to die).

## SOLUTION SUMMARY (clears the game on ~60% of held-out seeds; default seed1 wins ~45-50k)
- WIN PATH: survive early boss -> kill trash + collect exp -> snowball levels -> stack DPS+sustain
  upgrades -> grind down 3 escalating bosses (~90M HP total) with lifesteal/regen sustaining.
- Movement = candidate scoring (immediate danger + bullet openness + central/low positioning +
  aim + exp pull) + greedy-rollout trap detection (avoid cornering). Aim HARD at boss when safe.
- Upgrades: multishot/firerate/dmg/lifesteal/satellites high; eHP adaptive (rush early, taper once
  buffered -> pivot to DPS); exp pre-boss; heal when hurt. Keep aiming at boss always (chips layers).
- Confirmed wins on seeds 1,11,23 (BOSS-CLEARED) via run_policy.js. Held-out ~55-65% win, eval ~1.0.

## OPEN QUESTIONS
- Full upgrade pool & how multipliers stack (explore by leveling a lot).
- Boss attack patterns / phases / how boss_hp_destroyed advances / can it be out-DPSed?
- Pickup effects (heart heal? invincible? bomb clear? magnet?).
- Enemy body collision damage.
- exp values per item tier; level curve.
