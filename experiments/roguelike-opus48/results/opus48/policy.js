"use strict";
/**
 * Roguelike Skies — policy. Goal: CLEAR THE GAME (defeat the boss / 通关).
 *
 * Strategy (all discovered by play + measurement):
 *  - Autofire shoots straight UP. Enemies & the boss descend from the top; the boss has
 *    ~19.4M HP across several layers and parks near the top (x≈180, 120px wide). Enemies
 *    KEEP SPAWNING during the boss fight, so we farm them for EXP -> levels -> upgrades
 *    -> DPS, and grind the boss down. Survival is the binding constraint: if we live, the
 *    leveling guarantees enough DPS to win within the step budget.
 *  - We move up to 40px/tick; enemy bullets only ~4-5px/tick (~8x slower). So we are never
 *    truly forced to be hit — deaths come from being TRAPPED (cornered / pinned at a wall
 *    / squeezed into the boss) or from body contact (≈instant death).
 *  - COLLISION IS AXIS-ALIGNED BOX (player 24x30), not circular. Bullets fall from above
 *    and hit at |dy| up to ~21px; box separation modeling is essential (see score()).
 *  - Special pickups are powerful & common: bomb = clears ALL bullets, invincible = 5s
 *    i-frames, levelup = a free level, heart = heal/shield. We prioritize them.
 *  - Renewable sustain (shield repair ~90hp/s, regen, lifesteal, overheal->shield) turns
 *    the long fight from a chip-death race into a guaranteed grind-out win; magnet range
 *    auto-collects falling EXP while we dodge, keeping us leveling.
 *
 * Movement: phase-aware. PRE-BOSS (calm) -> roam aggressively to vacuum EXP and level
 * fast. UNDER BOSS (dense spirals) -> hold center under the boss and dodge, letting EXP
 * come via magnet + central fall. Each tick we score ~193 candidate displacements by box
 * collision safety (a real hit dominates; near-misses give a small clearance tie-break)
 * minus wall/corner/trap penalties, plus gentle home/align/pickup attraction; pick the best.
 * Upgrades: deterministic build shaping — a renewable-sustain foundation first, EXP+magnet
 * to snowball, then boss-DPS multipliers; emergency heals when actually hurt.
 */

// ---- upgrade valuation -------------------------------------------------------
// Survival is the binding constraint: surviving the long boss grind ~guarantees a win
// (DPS from leveling is more than enough to kill it within the step budget). So value
// sustain/defense highly, take EXP early to snowball, and keep enough offense.
const UPG_BASE = {
  // defensive game-changers
  bullet_crush: 100,    // your bullets destroy enemy bullets — huge incoming-fire cut
  bullet_void: 100,
  timeflow_shield: 92,  // slow nearby bullets/enemies 50% — trivializes dodging
  // sustain (renewable HP -> survive the long grind -> snowball -> win)
  shield_basic: 80,     // shield = max_hp, auto-repairs 3%/s (~90 hp/s renewable buffer)
  kill_blood: 74,       // lifesteal — scales with our enormous DPS
  regen_basic: 68,      // 1%/s base hp
  heal_overflow: 50,    // overheal -> shield (synergy with regen/lifesteal)
  // direct boss damage (cheap win-speed; prevents timeouts)
  boss_hunter: 74, tyrant_breaker: 96, // 2x vs elite & boss (also great)
  elite_hunter: 28,
  // multishot / projectile count (DPS + add-clear -> exp + lifesteal procs)
  ms_split_s: 58, ms_split_m: 60, ms_split_l: 62,
  // fire rate / damage
  fr_turbo: 50, fr_basic: 48, fr_cool: 46,
  mix_terminal: 56, mix_fire: 52, dmg_m: 46, dmg_s: 42, dmg_l: 50,
  crit_aim: 38, mix_crit: 42,
  bs_size_s: 32, bs_size_m: 35, bs_size_l: 38,
  sat_orbit: 48, sat_extra: 48,
  pc_pierce: 46,
  kill_pulse_3: 34, kill_pulse: 28,
  // exp / leveling (value boosted while low level, below)
  exp_basic: 44, exp_smart: 44, exp_huge: 48,
  mag_basic: 30,
  thorn_static: 14,
  heal_quick: 22,       // valued adaptively when hurt
  reroll_premium: 40, drop_basic: 16,
  mix_econ: 6, coin_small: 4, coin_big: 6,
};

function keywordValue(s) {
  s = s.toLowerCase();
  let v = 20;
  if (/弹幕|摧毁.*弹|destroy.*bullet|无坚不摧/.test(s)) v += 70;
  if (/减速|时间流|slow/.test(s)) v += 60;
  if (/护盾|shield/.test(s)) v += 45;
  if (/回复|修复|治疗|heal|regen|吸血|lifesteal/.test(s)) v += 45;
  if (/boss|屠龙|王座/.test(s)) v += 45;
  if (/双倍|double/.test(s)) v += 35;
  if (/3发|分裂|多重|multi|split|散射/.test(s)) v += 32;
  if (/射速|攻速|急速|fire|rate/.test(s)) v += 28;
  if (/伤害|damage|dmg|弹芯|高能/.test(s)) v += 26;
  if (/卫星|satellite|orbit/.test(s)) v += 26;
  if (/穿透|pierce/.test(s)) v += 24;
  if (/暴击|crit/.test(s)) v += 20;
  if (/经验|exp/.test(s)) v += 24;
  if (/金币|coin|赏金/.test(s)) v -= 8;
  return v;
}

// Classify an upgrade for deterministic build shaping.
function categorize(idn, txt) {
  if (/bullet_crush|bullet_void|无坚不摧|摧毁.*弹|destroy.*bullet/.test(idn + txt)) return "defense";
  if (/timeflow_shield|时间流|减速|slow/.test(idn + txt)) return "defense";
  if (idn === "shield_basic" || idn === "regen_basic" || idn === "kill_blood" || idn === "heal_overflow") return "sustain";
  if (/护盾|shield|回复|修复|regen|吸血|lifesteal/.test(txt) && !/heal_quick/.test(idn)) return "sustain";
  if (idn === "heal_quick" || /立即回满|应急修复/.test(txt)) return "heal";
  if (/^exp|经验/.test(idn) || /经验倍率|经验/.test(txt)) return "exp";
  if (/^mag_|磁|拾取范围/.test(idn + txt)) return "magnet";
  if (/tyrant_breaker|boss_hunter|屠龙|王座|对\s*boss/.test(idn + txt)) return "bossdps";
  if (/coin|赏金|金币|drop_basic|战利品|thorn|静电|reroll|重掷|mix_econ|经济/.test(idn + txt)) return "util";
  return "dps";
}

function chooseUpgrade(obs, mem) {
  const opts = obs.pending_upgrade.options;
  const p = obs.player;
  const hpFrac = p.max_hp > 0 ? (p.hp + (p.shield_hp || 0)) / p.max_hp : 1;
  const level = p.level;
  const RAR = { green: 0, blue: 5, purple: 12, orange: 22 };
  const cnt = (mem && mem.picks) || {};
  const sustainN = (cnt.sustain || 0) + (cnt.defense || 0);
  const dpsN = (cnt.dps || 0) + (cnt.bossdps || 0);
  let bestIdx = 0, bestVal = -1e9, bestCat = "dps";
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    const idn = o.id || "";
    const txt = (idn + " " + (o.name || "") + " " + (o.desc || "")).toLowerCase();
    const cat = categorize(idn, txt);
    let val = UPG_BASE[idn];
    if (val == null) val = keywordValue(txt);
    val += RAR[o.rarity] || 0;

    if (cat === "defense") {
      val += 30; // rare, game-changing — grab whenever offered
    } else if (cat === "sustain") {
      // a renewable-sustain foundation makes the long fight survivable -> snowball -> win
      if (sustainN < 2) val += 50; else if (sustainN < 4) val += 22; else val += 6;
      if (idn === "kill_blood") val += Math.min(22, level * 0.9); // lifesteal grows with DPS
    } else if (cat === "exp") {
      val += level < 14 ? 46 - level * 1.4 : 6;
      val -= (cnt.exp || 0) * 6; // diminishing
    } else if (cat === "magnet") {
      // magnet auto-collects falling EXP while we dodge — the engine of boss-phase
      // leveling. Keep buying until the radius is large.
      const mr = p.magnet_range || 0;
      if (mr < 120) val += 60; else if (mr < 260) val += 30; else if (mr < 400) val += 10; else val -= 12;
    } else if (cat === "bossdps") {
      val += 26; // direct boss damage prevents timeouts; always welcome
      if (sustainN >= 3) val += 14; // once safe, push to kill the boss sooner (earlier win)
    } else if (cat === "dps") {
      if (level < 14) { if (/fr_|射速|攻速|急速/.test(txt)) val += 12; if (/ms_split|分裂|多重/.test(txt)) val += 10; }
      if (sustainN >= 3) val += 10; // safe -> stack DPS to end the fight faster
      if (/pierce|穿透/.test(txt) && p.pierce) val -= 45;            // one-time
      if (/satellite|卫星|orbit/.test(txt) && (p.satellites || 0) >= 4) val -= 12;
    } else if (cat === "heal") {
      // heal_quick = full heal + a max-hp shield. Even at full HP the +max_hp shield is a
      // big one-time buffer (doubles effective HP) — valuable entering the boss. Only the
      // heal portion is wasted at full HP, and less so if we already carry a big shield.
      if (sustainN < 2) val += 30;
      if ((p.shield_max || 0) > p.max_hp * 0.6) val -= 22; // already have a shield source
    }
    // emergency: when actually hurt, prioritize anything that restores/protects HP
    if (hpFrac < 0.55 && (cat === "heal" || cat === "sustain" || cat === "defense")) val += 150 * (0.62 - hpFrac);

    if (val > bestVal) { bestVal = val; bestIdx = i; bestCat = cat; }
  }
  if (mem) { mem.picks = mem.picks || {}; mem.picks[bestCat] = (mem.picks[bestCat] || 0) + 1; }
  return bestIdx;
}

// ---- movement (safety-first ballistic-rollout controller) -------------------
// The player moves up to 40 px/tick; enemy bullets only ~4-5 px/tick — ~8x faster,
// so we can always dodge unless TRAPPED (cornered / pinned against a wall / squeezed
// into the boss). For each candidate per-tick velocity we roll it forward a few ticks
// (ballistically) and accumulate predicted threat along that path: this rejects
// directions that *lead* into a trap, not just ones that are bad next tick.
const SPEED = 40;
const CANDS = (() => {
  const c = [[0, 0]];
  // dense angular + radial coverage so a hit-free escape into a narrow gap is reachable
  const N = 48, mags = [SPEED, SPEED * 0.72, SPEED * 0.48, SPEED * 0.26];
  for (let a = 0; a < N; a++) {
    const ang = (a / N) * Math.PI * 2, cx = Math.cos(ang), sy = Math.sin(ang);
    for (const m of mags) c.push([cx * m, sy * m]);
  }
  return c;
})();
const ROLL = 6; // static-hold safety horizon (ticks)

// Special pickups are powerful: bomb CLEARS ALL BULLETS, invincible = 5s i-frames,
// levelup = a free level (free upgrade), heart = heal/shield. They're common, so chasing
// them (when safe) is worth a detour. Value is a multiplier on the base exp pull.
function itemValue(it, hpFrac, NB) {
  const t = it.item_type || "";
  if (t === "levelup") return 3.6;                       // free level -> snowball
  if (t === "invincible") return 2.6;                    // 5s of safety
  if (t === "bomb") return 1.8 + Math.min(2.2, NB * 0.05); // clears all bullets — huge when dense
  if (t === "heart") return hpFrac < 0.7 ? 2.6 : 1.0;    // heal/shield, esp. when hurt
  if (t === "magnet") return 1.4;
  if (t === "exp_huge") return 1.6;
  if (t === "exp_large") return 1.3;
  if (t === "exp_medium") return 1.1;
  if (t === "exp_small") return 1.0;
  if (t === "coin") return 0.25;
  return 0.9;
}

function decideMove(obs) {
  const [px, py] = obs.player.pos;
  const W = obs.field.w, H = obs.field.h;
  const homeX = W / 2; // horizontal home: center (also sits under the boss at x=180)

  // Collision is AXIS-ALIGNED BOX overlap, not circular. Player box 24x30 -> half (12,15);
  // bullets ~7x12 -> half (3.5,6). Bullets fall from above (dy-dominant) and hit at |dy|
  // up to ph+bh=21px, which a circular radius badly under-models. Store per-object half
  // extents and test box separation. (+1px player margin for safety.)
  const PW = (obs.player.size ? obs.player.size[0] / 2 : 12) + 1;
  const PH = (obs.player.size ? obs.player.size[1] / 2 : 15) + 1;
  // flat arrays for speed
  const bx = [], by = [], bvx = [], bvy = [], bhw = [], bhh = [];
  const ex = [], ey = [], evx = [], evy = [], ehw = [], ehh = [];
  const items = [];
  let boss = null;
  for (const o of obs.objects) {
    const ty = o.type;
    if (ty === "enemy_bullet") { bx.push(o.pos[0]); by.push(o.pos[1]); bvx.push(o.vel[0]); bvy.push(o.vel[1]); bhw.push((o.size ? o.size[0] / 2 : 4)); bhh.push((o.size ? o.size[1] / 2 : 6)); }
    else if (ty === "enemy" || ty === "enemy_elite") { ex.push(o.pos[0]); ey.push(o.pos[1]); evx.push(o.vel[0]); evy.push(o.vel[1]); ehw.push(o.size[0] / 2); ehh.push(o.size[1] / 2); }
    else if (ty === "boss") { if (!o.in_cutscene) { ex.push(o.pos[0]); ey.push(o.pos[1]); evx.push(o.vel[0]); evy.push(o.vel[1]); ehw.push(o.size[0] / 2); ehh.push(o.size[1] / 2); boss = o; } }
    else if (ty === "item") items.push(o);
  }
  const NB = bx.length, NE = ex.length;

  // DPS alignment target: boss if present (sits at center), else nearest add above.
  let aimX = null;
  if (boss) aimX = boss.pos[0];
  else {
    let best = 1e9;
    for (let i = 0; i < NE; i++) {
      const d = Math.abs(ex[i] - px) + Math.max(0, ey[i] - py) * 0.1;
      if (d < best) { best = d; aimX = ex[i]; }
    }
  }
  // never climb into the descending boss; stay below its body with margin
  const safeTopY = boss ? boss.pos[1] + boss.size[1] / 2 + 55 : H * 0.30;

  // Phase awareness: when there is no boss and the field is calm (pre-boss waves),
  // play AGGRESSIVELY to level up fast (align under enemies to kill them, sweep EXP) so
  // we arrive at the boss strong. Under the boss we still MUST keep leveling (collect
  // falling EXP while dodging) — going fully passive starves us of sustain/DPS and we
  // chip out. So even in boss mode keep meaningful EXP pull; threats still dominate.
  const safe = !boss && NB < 14;
  // PRE-BOSS (calm): roam aggressively to vacuum EXP -> level fast (walls aren't deadly
  // with few bullets). UNDER BOSS (dense spirals): stay CENTRAL under the boss and dodge;
  // let exp come via magnet + central fall, don't chase it to the walls (that's how we
  // get pinned & cornered).
  const homeW = safe ? 0.04 : 0.34;
  const alignW = safe ? 0.45 : 0.40, alignRange = safe ? 70 : 55;
  const expW = safe ? 1.35 : 0.42, expRange = safe ? 240 : 175, expBelow = safe ? 300 : 60;
  const useHomeY = safe ? H * 0.6 : H * 0.70;
  const vHomeW = safe ? 0.04 : 0.12;
  const hpFrac = obs.player.max_hp > 0 ? (obs.player.hp + (obs.player.shield_hp || 0)) / obs.player.max_hp : 1;
  const clearBuf = 24; // bullet clearance buffer (tuned; wider -> over-fleeing/herding, narrower -> chip)
  const nearW = 3.2;   // near-miss weight (dodging also keeps us collecting EXP, which drives win speed)
  // value each item by type (specials are worth a detour); pick the best value/near item
  // to commit to. High-value specials (bomb/levelup/invincible/heart) are worth diving for.
  let nearItem = null, niScore = -1e9;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it._v = itemValue(it, hpFrac, NB);
    const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
    const s = it._v * 200 - d; // prefer valuable + near
    if (s > niScore) { niScore = s; nearItem = it; }
  }

  function score(mv) {
    // Static-position safety: we move to P this tick; assess whether HOLDING at P is
    // safe over the next K ticks (we re-plan every tick, so "hold" is the right model
    // for a position's safety — and it matches where hit-free moves actually exist).
    let nx = px + mv[0], ny = py + mv[1];
    if (nx < PW) nx = PW; else if (nx > W - PW) nx = W - PW;
    if (ny < PH) ny = PH; else if (ny > H - PH) ny = H - PH;
    let threat = 0;

    // bullets: BOX separation = max(|dx|-(PW+bw), |dy|-(PH+bh)); <=0 means overlap (hit).
    // A real hit dominates (never take an avoidable hit); near-misses give a small,
    // capped tie-break toward roomier spots. Count each bullet's first hit only.
    for (let i = 0; i < NB; i++) {
      const bx0 = bx[i], by0 = by[i], vx = bvx[i], vy = bvy[i], rw = PW + bhw[i], rh = PH + bhh[i];
      let near = 0;
      for (let t = 1; t <= ROLL; t++) {
        let dx = bx0 + vx * t - nx; if (dx < 0) dx = -dx;
        let dy = by0 + vy * t - ny; if (dy < 0) dy = -dy;
        const sx = dx - rw, sy = dy - rh;
        const clear = sx > sy ? sx : sy;
        if (clear <= 2) { threat += 9000 / (1 + (t - 1) * 0.45); near = 0; break; }
        if (clear < clearBuf) { const p = (clearBuf - clear) * nearW / (1 + (t - 1) * 0.5); if (p > near) near = p; } // buffer
      }
      threat += near;
    }
    // bodies — contact is instant death; box separation with a generous margin
    for (let i = 0; i < NE; i++) {
      const ex0 = ex[i], ey0 = ey[i], vx = evx[i], vy = evy[i], rw = PW + ehw[i], rh = PH + ehh[i];
      for (let t = 0; t <= ROLL; t++) {
        let dx = ex0 + vx * t - nx; if (dx < 0) dx = -dx;
        let dy = ey0 + vy * t - ny; if (dy < 0) dy = -dy;
        const sx = dx - rw, sy = dy - rh;
        const clear = sx > sy ? sx : sy;
        if (clear <= 6) { threat += 1e6 / (1 + t * 0.3); break; }
        if (clear < 26) threat += (26 - clear) * (26 - clear) * 6.0 / (1 + t * 0.4);
      }
    }
    // stay below boss
    if (ny < safeTopY) threat += (safeTopY - ny) * (safeTopY - ny) * 0.7;
    // walls + corners (the trap geometry)
    const mL = nx - PW, mR = W - PW - nx, mT = ny - PH, mB = H - PH - ny;
    const EDGE = 50;
    if (mL < EDGE) threat += (EDGE - mL) * (EDGE - mL) * 0.22;
    if (mR < EDGE) threat += (EDGE - mR) * (EDGE - mR) * 0.22;
    if (mT < EDGE) threat += (EDGE - mT) * (EDGE - mT) * 0.22;
    if (mB < EDGE) threat += (EDGE - mB) * (EDGE - mB) * 0.30;
    if (ny > H * 0.78) threat += (ny - H * 0.78) * (ny - H * 0.78) * 0.6; // bottom-wall trap
    const mH = mL < mR ? mL : mR, mV = mT < mB ? mT : mB;
    if (mH < 70 && mV < 110) threat += (70 - mH) * (110 - mV) * 0.5; // corner zone

    const ax = nx, ay = ny;
    let attract = 0;
    attract -= Math.abs(ax - homeX) * homeW;
    attract -= Math.abs(ay - useHomeY) * vHomeW;
    if (aimX != null) attract += Math.max(0, alignRange - Math.abs(aimX - ax)) * alignW;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const v = it._v || 1;
      // high-value specials are worth diving below for; plain exp is not (bottom trap)
      const below = v >= 1.6 ? 260 : expBelow;
      if (it.pos[1] > ay + below) continue;
      const dx = it.pos[0] - ax, dy = it.pos[1] - ay;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < expRange) attract += (expRange - d) * expW * v;
    }
    // commit to the best item (vacuum it up rather than hovering between items)
    if (nearItem) {
      const v = nearItem._v || 1;
      const below = v >= 1.6 ? 260 : expBelow;
      if (nearItem.pos[1] <= ay + below) {
        const dx = nearItem.pos[0] - ax, dy = nearItem.pos[1] - ay;
        attract += Math.max(0, 130 - Math.sqrt(dx * dx + dy * dy)) * (safe ? 2.2 : 0.5) * v;
      }
    }
    return attract - threat;
  }

  let best = [0, 0], bs = -1e18;
  for (let i = 0; i < CANDS.length; i++) { const s = score(CANDS[i]); if (s > bs) { bs = s; best = CANDS[i]; } }
  return best;
}

module.exports = {
  init() { return { picks: {} }; },
  policy(obs, mem) {
    if (!mem || typeof mem !== "object") mem = { picks: {} };
    try {
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        return { action: { move: [0, 0], upgrade_choice: chooseUpgrade(obs, mem) }, mem };
      }
      return { action: { move: decideMove(obs), upgrade_choice: null }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
