# GAME_MODEL.md — factual picture (observed only)

## Field & player
- Field 360×640 (w×h). Origin top-left, x→right, y→down. speed_cap=40 px/tick (player VERY agile; field is 360 wide).
- Player start [180,545] (bottom center), size [24,30].
- hp/max_hp = 3000. shield_hp/max = 0. magnet_range=40. level=1, exp=0, xp_to_next=5.
- shoot_interval_ms=420 (autofire). side_bullets=0, pierce=false, satellites=0.
- Player fires STRAIGHT UP: player_bullet vel [0,-8.5], size [6,12], dmg=1000. => must align X with target to hit it.

## Enemies / threats
- Enemies spawn from top, move down. enemy_type ∈ grunt, swift, tank, shooter, weaver. enemy_elite = tougher.
- enemy_bullet: dmg 300-450, moves downward (vel y ≈ +3.9 to +8, some angled x). Player HP 3000 => ~7-10 hits = dead.
- Boss & enemies do CONTACT damage (collision).

## Items / leveling
- item_type: exp_small(exp_value=1), exp_medium(3), exp_large(?), exp_huge(?), heart, bomb, magnet, coin, levelup, invincible.
- Collected automatically within magnet_range (40 base).
- xp_to_next curve: L1→5, L2→13, L3→18, L4→24, ... grows.
- Each level-up opens a panel (game paused, time frozen). Must return upgrade_choice = an option.index next step.
- Multiple level-ups can queue (panel reopens; consumes no game time).

## Boss
- Appears at frame ~5400 (=90s) — appears TIME-based, not progress-based (consistent across runs).
- variant depends on action sequence/RNG (seen "azure" and "crimson" on seed 1 with different policies). MUST handle multiple variants.
- hp ≈ 19.3-19.5M. size 120×120. hp_layers_left=5 (crossing layers => boss_phase events).
- Enters from top (y=-68 → hovers ~y=134-162), moves side-to-side (x ~130-230, around center 180).
- Fires bullet-hell barrages: 60 → 230+ bullets, dmg 300-450, raining downward.
- progress: 0.4 when boss reached; 1.0 = boss cleared (WIN / 通关). boss_hp_destroyed 0..1.

## DPS math
- Base DPS ≈ 1000 dmg / (420ms) ≈ 2380/s. Boss 19.3M => ~2¼ hrs at base. MUST scale DPS hugely via upgrades+levels.
- At level 9 (align policy) measured ~29k DPS (1.8% in ~12s). 19.3M/29k ≈ 665s.
- Budget after boss: 90000-5400 = 84600 frames = 1410s. So even ~15k DPS WINS if I survive ~21min of bullet hell.
- Synergy: higher DPS => shorter fight => less dodge exposure => safer AND earlier win (better eval_score).

## Upgrade pool (17 seen; more likely exist incl. orange)
DPS:
- dmg_s [green]: 伤害 +12%
- mix_fire [blue]: 伤害+8%, 射速+15%
- mix_terminal [purple]: 伤害+15%, 暴击率+25%
- fr_basic [green]: 射速+32% (interval/=1.32), 子弹-10%
- fr_cool [green]: 射速+64% (interval/=1.64), 子弹-10%   (fire-rate stacks MULTIPLICATIVELY on interval)
- crit_aim [green]: 暴击率+20%
- ms_split_s [green]: 弹道变3发 (3-way shot)
- sat_orbit [blue]: +2 satellites (homing, dmg scales w/ your dmg) -- great vs boss
- pc_pierce [green]: bullets pierce (mainly for wave clearing)
- bs_size_s [green]: 子弹尺寸+100% (bigger hitbox)
Survival:
- shield_basic [blue]: shield = maxHP, +3%/s regen
- heal_quick [green]: full heal + shield=maxHP
Econ/util:
- exp_basic [green]: 经验+100%; exp_smart [green]: 经验+200%
- mix_econ [green]: 200 coins + drop+15%; mag_basic [green]: magnet+175%; drop_basic [blue]: elite always drops

## Observed stat effects
- sat_orbit => satellites +2. pc_pierce => pierce true. fr_basic => interval 420→318. fr_cool => 318→193 (multiplicative).

## BIG PICTURE (from seed 11 full run, 90000 steps, timeout at progress 0.90)
- **MULTIPLE BOSSES**: Boss1 ~19.3M (5 layers ~3.86M each), Boss2 ~20.1M, Boss3 ~50.6M (5 layers ~10.1M each), likely a Boss4+. To CLEAR (通关) must beat them ALL.
- boss_hp_destroyed RESETS per boss (per-layer-set). boss_phase events fire each layer crossing.
- progress maps across the whole boss sequence: 0.4=boss1 appears, ~0.9 reached ~boss3-layer4 by step 90000.
- **MINIONS & XP SPAWN DURING BOSS FIGHT** — grunt swarms (300+!), shooters, elites, plus items (exp_*, heart, magnet, invincible, levelup, bomb, coin). => CAN and MUST keep leveling during boss.
- **DPS SCALES SUPER-LINEARLY WITH LEVEL.** Seed11: lvl3-8 for steps 5400-58500 dealt almost nothing (~0.14 of boss1 in 59000 frames!); then lvl15-19 melted boss1's remaining layers in ~9600 frames, boss2 in ~6600, and chunks of boss3. The early game was WASTED at low level.
- **LEVELING SPEED IS THE #1 BOTTLENECK.** Faster leveling => DPS ramps tens of thousands of frames earlier => clear all bosses within budget & EARLY.
- **SHIELD ACCUMULATES HUGELY** (→57k by step 88500), which is what kept the player alive. Source: shield_basic (shield=maxHP + 3%/s regen) + likely hearts/pickups; trends up over time when dodging well. Early-game deaths (seeds 1,23) happened ~2600 frames into boss at lvl3-4 before shield/levels built up.
- Items fall at vel [0,1.4] (slow down-drift). exp_large/huge appear late.

## STRATEGY IMPLICATIONS
1. LEVEL AS FAST AS POSSIBLE (collect ALL XP, kill swarms, exp+magnet upgrades early). This drives DPS which drives everything.
2. Survive early boss via shield_basic ASAP + good dodge; shield then snowballs.
3. Stay in boss x-corridor for DPS; vacuum XP; mow grunt swarms (pierce/wide/fast = XP + survival).
4. Win = clear ALL bosses. Need huge sustained DPS => need very high level => leveling speed paramount.

## DEATH MECHANISM (debugged v4)
- EVERY fatal hit happened when NO collision-free move existed = player got CORNERED.
- Concrete death: player flew into BOTTOM-LEFT CORNER (pos [12,625], pinned to left+bottom walls); a 60×60 elite descended from the open side → no escape → dead. Held move [0,0] for 5 ticks (all moves collided).
- enemy_elite size 60×60 (half 30) — big, contact is very dangerous when cornered. grunt size ~33.
- Deaths happen at LOW level (4) with NO shield (shield_basic not offered/picked in first 3 panels).
- => ROOT CAUSE: poor POSITIONING. Dodge is purely reactive (avoids imminent collisions) but lets itself get pinned to walls/corners with no escape routes. Need PROACTIVE open-space positioning: stay in horizontal center, away from walls/corners, keep escape room in all directions.
- Aim corridor chasing an enemy to the wall is what dragged it into the corner => clamp aim target away from edges; pre-boss stay central.

## UPGRADE CATALOG (richer than first thought; ~40+ upgrades)
SHIELD/SURVIVAL (the key to winning — winners snowball shield to 50k-500k!):
- shield_basic [blue] RARE (~1-3/59): shield=maxHP + 3%/s regen. The 3%/s OVERSTACKS unbounded => shield snowballs to 100k+ alone. Best single survival, but rare.
- heal_quick [green] COMMON (~11/59): instantly full heal + shield=maxHP (one-time 3000 buffer, no regen). MAIN early shield source — grab when no shield even at full HP.
- regen_basic [blue]: regen 1%/s baseHP (30/s). regen_nano: stronger.
- heal_overflow [blue] / heal_overflow_2 [purple]: OVERHEAL converts to shield. + regen/lifesteal => unbounded shield engine.
- kill_blood [blue]: lifesteal +1% of damage dealt. High DPS => big healing => feeds overflow->shield. ENGINE.
- timeflow_shield [purple]: enemies & bullets within magnet range SLOWED 50%. Huge dodging aid (bubble). Grab always.
- turncoat_shield [purple]: shield mechanic (desc TBD).
- thorn_static [green]: reflect damage taken (minor).
DPS:
- fr_basic +32% rate, fr_cool +64% rate, fr_turbo (bigger). (rate stacks multiplicatively on interval)
- ms_split_s 3-way, ms_split_m (5?), ms_split_l (7?) — coverage => kills+boss dmg.
- dmg_s +12%, dmg_m +20%. mix_fire (+8%dmg+15%rate), mix_terminal[p](+15%dmg+25%crit), mix_vulcan[p], mix_ascend[o], mix_perfect[o](ALL stats).
- sat_orbit +2 homing satellites. pc_pierce pierce. bs_size_s +100% size.
- crit_aim +20% crit, crit_lethal (crit dmg?). bullet_void (?).
- boss_hunter [blue]: anti-BOSS damage (directly serves goal!). elite_hunter: anti-elite.
- kill_pulse [p]/kill_pulse_3 [blue]: explosion on kill (10% chance) => AoE swarm clear => XP.
UTILITY:
- mag_basic +175% magnet, mag_well, mag_hole (magnet => XP + timeflow range).
- exp_basic +100%, exp_smart +200% (compounding leveling).
- reroll_premium [blue]: next panel guaranteed purple/orange.
- drop_basic: elites always drop. coin_small/mix_econ: coins (no observed use => low).

## SHIELD SNOWBALL = THE WIN CONDITION
- Probe proved: every winner had a shield by frame 5400; every loser had smax=0 and died in early boss.
- shield_basic regen (3%/s) OR (regen + heal_overflow) OR (kill_blood + heal_overflow) snowballs shield unbounded while you out-DPS incoming damage.
- heal_quick = the common immediate buffer to survive until the engine spins up.
- => Picker MUST reliably secure a shield/sustain source early, then stack DPS to spin the engine.

## OPEN QUESTIONS (to observe later)
- exp_large / exp_huge values. heart/invincible/bomb/coin precise effects. Confirm shield source.
- Does crit = 2x dmg? crit damage upgrades exist? Orange-tier upgrades?
- Best aim lead for moving boss (bullet travel ~43 ticks from low position).
- How many bosses total? (saw 3, maybe 4+).
