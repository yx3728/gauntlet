/**
 * policy.js — Roguelike Skies bullet-hell policy.
 *
 * The game is a sequence of multi-layer bosses (~19.5M HP, 5 layers each). The ship
 * auto-fires STRAIGHT UP, so the only control is movement. Two facts dominate:
 *   1. Boss layers fall faster as we level (DPS compounds), so the game is gated on
 *      SURVIVAL — if we keep dealing damage and don't die, we eventually clear it.
 *   2. Touching the boss body is nearly lethal (~2500-3000 dmg) and bosses ROAM.
 *
 * Movement: candidate-sampling driven by a multi-tick trajectory ROLLOUT. Each tick we
 * score ~97 candidate per-tick moves; for each we simulate COMMITTING to that heading for
 * ~10 ticks while bullets/enemies/boss advance, and penalize the first collision and any
 * near-misses (time-weighted). This catches traps a 1-tick "hold position" model can't see
 * (cornering, being herded into a wall, getting surrounded). On top of the rollout danger
 * we add positional preferences at the next step: stay below a roaming boss, align under it
 * to land our straight-up shots (free to dodge within its 120px width), seek the field
 * CENTER when surrounded (max escape room), grab XP, and keep movement momentum.
 *
 * Upgrades: compounding DPS + a recharging-shield / max-HP eHP base + magnet XP flywheel.
 */
"use strict";

// ---- tunables ----
const SPEED = 40;
const PHW = 12, PHH = 15;    // player half-extents (size 24x30)
const HORIZON = 20;          // look further ahead -> react to threats earlier
const SAFE = 34;             // keep more clearance
const COLLIDE = 90000;
const NEAR = 1300;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

const CANDS = (function () {
  const c = [[0, 0]];
  const NDIR = 24;
  const mags = [1.0, 0.7, 0.45, 0.22];
  for (let i = 0; i < NDIR; i++) {
    const a = (i / NDIR) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    for (const mg of mags) c.push([cx * SPEED * mg, cy * SPEED * mg]);
  }
  return c;
})();

module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    mem = mem || {};
    const W = obs.field.w, H = obs.field.h;
    const p = obs.player;
    const px = p.pos[0], py = p.pos[1];

    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, obs);
    }

    // classify + precompute flat threat arrays (speed)
    const items = [];
    let boss = null;
    const bx = [], by = [], bvx = [], bvy = [], bex = [], bey = [];
    const ex = [], ey = [], evx = [], evy = [], eex = [], eey = [];
    for (const o of obs.objects) {
      const t = o.type;
      if (t === "enemy_bullet") {
        const dx = o.pos[0] - px, dy = o.pos[1] - py;
        if (dx * dx + dy * dy > 320 * 320) continue;
        bx.push(o.pos[0]); by.push(o.pos[1]); bvx.push(o.vel[0]); bvy.push(o.vel[1]);
        bex.push(PHW + (o.size ? o.size[0] / 2 : 4)); bey.push(PHH + (o.size ? o.size[1] / 2 : 6));
      } else if (t === "enemy" || t === "enemy_elite") {
        ex.push(o.pos[0]); ey.push(o.pos[1]); evx.push(o.vel[0]); evy.push(o.vel[1]);
        eex.push(PHW + (o.size ? o.size[0] / 2 : 18)); eey.push(PHH + (o.size ? o.size[1] / 2 : 18));
      } else if (t === "boss") {
        if (!o.in_cutscene) boss = o;
      } else if (t === "item") {
        items.push(o);
      }
    }

    let targetX = null, bossHalf = 0, bossLowEdge = 0, homeY = H * 0.62;
    if (boss) {
      bossHalf = boss.size[0] / 2;
      targetX = clamp(boss.pos[0], 100, W - 100);   // aim central; boss is 120px wide
      bossLowEdge = boss.pos[1] + boss.size[1] / 2;
      homeY = clamp(boss.pos[1] + 235, H * 0.6, H * 0.76);
    } else {
      let best = 1e9;
      for (let i = 0; i < ex.length; i++) {
        const d = Math.abs(ex[i] - px) + Math.max(0, ey[i] - py) * 0.3;
        if (ey[i] < py + 40 && d < best) { best = d; targetX = ex[i]; }
      }
    }

    // "Panic" = how surrounded we are right now. When high, relax alignment/home pull so
    // the ship breaks from the boss column to escape, instead of being anchored in the
    // spiral's convergence zone. When low, full alignment for DPS uptime (avoids timeouts).
    let panic = 0;
    for (let i = 0; i < bx.length; i++) {
      const dxx = bx[i] - px, dyy = by[i] - py;
      if (dxx * dxx + dyy * dyy < 95 * 95) panic++;
    }
    const alignScale = 1 / (1 + panic * 0.3);

    const ctx = {
      bx, by, bvx, bvy, bex, bey, nB: bx.length,
      ex, ey, evx, evy, eex, eey, nE: ex.length,
      boss, bossHalf, bossLowEdge, items, targetX, homeY, alignScale, px, py, W, H,
    };

    const lm = mem.lastMove || [0, 0];
    const lmag = Math.hypot(lm[0], lm[1]);
    let bestScore = -Infinity, bestMove = [0, 0];
    for (const m of CANDS) {
      const nx = clamp(px + m[0], PHW, W - PHW);
      const ny = clamp(py + m[1], PHH, H - PHH);
      // danger from committing to this heading for several ticks (catches traps the
      // 1-ply "hold" model can't see: cornering, being herded, getting surrounded)
      const danger = rolloutDanger(px, py, m[0], m[1], ctx);
      let s = scorePosition(nx, ny, ctx) - danger;
      // momentum: mild bonus for continuing the current heading (reduces jitter, helps
      // commit to an escape route)
      const mmag = Math.hypot(m[0], m[1]);
      if (lmag > 1 && mmag > 1) s += ((lm[0] * m[0] + lm[1] * m[1]) / (lmag * mmag)) * 12;
      if (s > bestScore) { bestScore = s; bestMove = [nx - px, ny - py]; }
    }
    mem.lastMove = bestMove;
    return { action: { move: bestMove, upgrade_choice }, mem };
  },
};

const RK = 10;          // rollout horizon
const NEAR_R = 240;     // near-miss scale (accumulated over rollout ticks)
function rolloutDanger(px0, py0, dx, dy, ctx) {
  const { bx, by, bvx, bvy, bex, bey, nB, ex, ey, evx, evy, eex, eey, nE,
    boss, bossHalf, W, H } = ctx;
  let px = px0, py = py0, danger = 0;
  const bExX = boss ? PHW + bossHalf + 16 : 0, bExY = boss ? PHH + boss.size[1] / 2 + 16 : 0;
  for (let t = 1; t <= RK; t++) {
    px += dx; py += dy;
    if (px < PHW) px = PHW; else if (px > W - PHW) px = W - PHW;
    if (py < PHH) py = PHH; else if (py > H - PHH) py = H - PHH;
    const w = (RK - t + 1) / RK;
    let hit = false;
    for (let i = 0; i < nB; i++) {
      const cx = bx[i] + bvx[i] * t, cy = by[i] + bvy[i] * t;
      let gx = cx - px; if (gx < 0) gx = -gx; gx -= bex[i];
      let gy = cy - py; if (gy < 0) gy = -gy; gy -= bey[i];
      const gap = gx > gy ? gx : gy;
      if (gap < 0) { hit = true; break; }
      else if (gap < SAFE) { const k = (SAFE - gap) / SAFE; danger += k * k * NEAR_R * w; }
    }
    if (!hit) {
      for (let i = 0; i < nE; i++) {
        const cx = ex[i] + evx[i] * t, cy = ey[i] + evy[i] * t;
        let gx = cx - px; if (gx < 0) gx = -gx; gx -= eex[i];
        let gy = cy - py; if (gy < 0) gy = -gy; gy -= eey[i];
        const gap = gx > gy ? gx : gy;
        if (gap < 0) { hit = true; break; }
        else if (gap < 24) { const k = (24 - gap) / 24; danger += k * k * 200 * w; }
      }
    }
    if (!hit && boss) {
      const cx = boss.pos[0] + boss.vel[0] * t, cy = boss.pos[1] + boss.vel[1] * t;
      let gx = cx - px; if (gx < 0) gx = -gx; gx -= bExX;
      let gy = cy - py; if (gy < 0) gy = -gy; gy -= bExY;
      const gap = gx > gy ? gx : gy;
      if (gap < 0) { hit = true; }
      else if (gap < 40) { const k = (40 - gap) / 40; danger += k * k * 2200 * w; }
    }
    if (hit) { danger += COLLIDE * (0.4 + 0.6 * w); break; }
  }
  return danger;
}

function scorePosition(nx, ny, ctx) {
  const { bx, by, nB, boss, bossHalf, bossLowEdge, items, targetX, homeY, alignScale, W, H } = ctx;
  let score = 0;

  // (collision danger is handled by rolloutDanger; here we only score the END position)

  // --- boss positioning: stay below it, and flee out from under a downward dive ---
  if (boss) {
    const belowLine = bossLowEdge + 35;
    if (ny < belowLine) score -= (belowLine - ny) * 8;   // stay below the boss
    const vy = boss.vel[1];
    if (vy > 4) {
      const span = bossHalf + PHW + 28;
      const dxToBoss = Math.abs(boss.pos[0] - nx);
      if (dxToBoss < span) score -= (span - dxToBoss) * (vy * 5);  // flee out from under it
    }
  }

  // --- walls / edges (corners are death traps) ---
  const MARGIN = 78;
  const edges = [nx, W - nx, ny, H - ny];
  for (const d of edges) if (d < MARGIN) { const k = (MARGIN - d) / MARGIN; score -= k * k * 1500; }

  // --- comfort zone (central rectangle) ---
  const ZL = 72, ZR = W - 72, ZB = H - 150;
  if (nx < ZL) score -= (ZL - nx) * (ZL - nx) * 2.2;
  if (nx > ZR) score -= (nx - ZR) * (nx - ZR) * 2.2;
  if (ny > ZB) score -= (ny - ZB) * (ny - ZB) * 1.5;

  // --- horizontal positioning. When SAFE: align under the boss for DPS. When SURROUNDED
  //     (alignScale -> 0): seek the FIELD CENTER instead, which has the most escape room
  //     in every direction — this prevents being herded into a corner. ---
  if (boss) {
    const off = Math.abs(targetX - nx);
    const freeBand = Math.min(56, bossHalf + PHW - 14);   // still hits the boss within this band
    if (off > freeBand) score -= (off - freeBand) * 7 * alignScale;
    score -= off * 0.55 * alignScale;
  } else if (targetX !== null) {
    score -= Math.abs(targetX - nx) * 0.6 * alignScale;
  }
  // center-seeking restoring force, strongest exactly when alignment has relaxed
  score -= Math.abs(W * 0.5 - nx) * (0.06 + 0.7 * (1 - alignScale));

  // --- vertical home: keep reaction room; do NOT relax under pressure (sinking into the
  //     bottom is how we get cornered). ---
  score -= Math.abs(ny - homeY) * (0.45 + 0.15 * (1 - alignScale));

  // --- items (XP flywheel) ---
  for (const it of items) {
    const dxx = it.pos[0] - nx, dyy = it.pos[1] - ny;
    const d = Math.hypot(dxx, dyy);
    if (d >= 220) continue;
    let val = 1;
    const t = it.item_type;
    if (t === "exp_medium") val = 2;
    else if (t === "exp_large") val = 4;
    else if (t === "exp_huge") val = 8;
    else if (t === "heart") val = 6;
    else if (t === "levelup") val = 40;
    else if (t === "invincible") val = 12;
    else if (t === "magnet") val = 3;
    else if (t === "coin") val = 0.5;
    score += val * (220 - d) / 220 * 3;
  }

  // --- breathing room: avoid getting surrounded (two rings) ---
  let near1 = 0, near2 = 0;
  for (let i = 0; i < nB; i++) {
    const dxx = bx[i] - nx, dyy = by[i] - ny;
    const dd = dxx * dxx + dyy * dyy;
    if (dd < 48 * 48) near1++;
    else if (dd < 85 * 85) near2++;
  }
  score -= near1 * 55 + near2 * 18;

  // --- anti-corner: hugging ANY wall (incl. top/bottom) is a TRAP when bullets are near
  //     (no escape). Penalize wall-proximity scaled by bullet pressure, so we leave the
  //     edge EARLY (before being herded into it) yet still use full space when it's clear. ---
  let wallDist = nx < W - nx ? nx : W - nx;
  const vWall = ny < H - ny ? ny : H - ny;
  if (vWall < wallDist) wallDist = vWall;
  if (wallDist < 130) {
    const pressure = near1 * 1.0 + near2 * 0.4;
    if (pressure > 0) score -= (130 - wallDist) * pressure * 0.9;
  }

  return score;
}

// ---- upgrade chooser (explicit id-keyed values; far more reliable than text matching) ----
// Static base value for each upgrade id. Tuned for: clear bosses fast (compounding DPS +
// boss damage), keep the XP flywheel spinning (exp/magnet), and survive long enough to
// snowball (recharging shield + defensive specials).
const UPG = {
  // --- multishot / coverage (multiplies DPS) ---
  ms_split_l: 132, ms_split_m: 116, ms_split_s: 100,
  // --- fire rate (big DPS multiplier) ---
  fr_turbo: 108, fr_cool: 92, fr_basic: 80,
  // --- satellites (extra damage sources) ---
  sat_orbit_2: 104, sat_orbit: 86,
  // --- raw damage ---
  dmg_l: 102, dmg_m: 72, dmg_s: 58,
  // --- pierce / bullet size (more hits, esp. on the big boss) ---
  pc_pierce: 82, bs_size_m: 70, bs_size_s: 54,
  // --- crit ---
  crit_lethal: 50, crit_aim: 44,
  // --- combo stat upgrades ---
  mix_terminal: 96, mix_vulcan: 96, mix_fire: 72,
  // --- boss / elite damage (boss is the goal) ---
  tyrant_breaker: 138, boss_hunter: 86, elite_hunter: 28,
  // --- orange specials ---
  mix_perfect: 130, mix_ascend: 100, bullet_void: 104, bullet_crush: 120,
  // --- survivability ---
  shield_extra: 96, shield_basic: 90, regen_nano: 66, regen_basic: 46,
  heal_overflow_2: 60, heal_overflow: 46, heal_overflow_3: 40,
  kill_butcher: 58, kill_blood: 32, thorn_static: 16,
  // --- defensive control (clear/slow bullets) ---
  timeflow_shield: 100, turncoat_shield: 74, kill_pulse: 56, kill_pulse_3: 42,
  // --- magnet (XP collection) ---
  mag_hole: 92, mag_well: 70, mag_basic: 58,
  // --- utility ---
  drop_basic: 26, reroll_premium: 58,
  mix_econ: 8, coin_big: 6, coin_small: 4,
  // exp_basic, heal_quick handled specially (phase / hp dependent)
};

function chooseUpgrade(options, obs) {
  const p = obs.player;
  const hpFrac = (p.hp + p.shield_hp) / Math.max(1, p.max_hp);
  const tanky = (p.shield_max > 0 ? 1 : 0) + (p.max_hp > 3000 ? 1 : 0);
  // earlyFactor: 1 when low level (XP investments pay off long), ~0 once high level.
  const earlyFactor = clamp((14 - p.level) / 12, 0, 1);
  let hasBoss = false;
  for (const o of obs.objects) if (o.type === "boss") { hasBoss = true; break; }

  let bestIdx = options[0].index, bestScore = -Infinity;
  for (const o of options) {
    let s = UPG[o.id];
    if (s === undefined) s = textScore(o);                 // fallback for unknown ids
    // experience multiplier: accelerates the whole flywheel — huge early, less late
    if (o.id === "exp_basic" || /经验倍率/.test(o.desc || "")) s = 52 + 64 * earlyFactor;
    // emergency full heal: only when actually hurt
    else if (o.id === "heal_quick" || /立即回满/.test(o.desc || "")) s = hpFrac < 0.55 ? 96 : 14;
    // value a survivability foundation more while we still lack one
    else if (tanky < 2 && /shield|regen|heal_overflow|kill_butcher|kill_blood|timeflow/.test(o.id)) s += 18;
    // boss-damage perks are only useful with a boss on field; still good (most of the game is bosses)
    if ((o.id === "boss_hunter" || o.id === "tyrant_breaker") && !hasBoss) s -= 10;
    const rb = { green: 0, blue: 1.5, purple: 3, orange: 6 }[o.rarity] || 0;
    s += rb;
    if (s > bestScore) { bestScore = s; bestIdx = o.index; }
  }
  return bestIdx;
}

// Fallback text scorer for any id not in the table.
function textScore(o) {
  const d = (o.desc || "") + " " + (o.name || "");
  let s = 20;
  if (/分裂|弹道/.test(d)) s += 90;
  if (/射速/.test(d)) s += 70;
  if (/卫星/.test(d)) s += 80;
  if (/穿透/.test(d)) s += 70;
  if (/Boss|双倍/.test(d)) s += 80;
  if (/伤害/.test(d)) s += 55;
  if (/护盾|回复|修复|吸血|生命/.test(d)) s += 55;
  if (/暴击/.test(d)) s += 40;
  if (/经验/.test(d)) s += 70;
  if (/拾取|磁/.test(d)) s += 55;
  return s;
}
