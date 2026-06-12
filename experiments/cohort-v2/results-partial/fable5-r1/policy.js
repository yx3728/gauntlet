"use strict";
/**
 * policy.js — Roguelike Skies policy (v5).
 *
 * Movement core: GLIDE-model danger. Each candidate move is treated as a
 * sustained per-tick velocity; for every threat we compute the first AABB
 * overlap time under RELATIVE motion (threat velocity minus ours) over a
 * horizon. This values escape velocity, catches mid-move (swept) collisions,
 * and threads moving gaps. Plus wall/corner shaping, crowd-density spacing,
 * goal attraction, and hysteresis.
 *
 * Targeting: boss column when active; otherwise best shooting column
 * (elite-weighted, pierce-aware). Items by value/distance; hearts when hurt;
 * hard farming during boss cutscenes.
 *
 * Upgrades: DPS multipliers > exp early > defense when hurt.
 */

// ---------------- tunable parameters (env override for sweeps) ----------------
const P = {
  rainW: 50, rainKern: 70, rainT: 75, rainDecay: 85,
  dangerW: 170, dangerHp: 1.8, sevNow: 8, sevBase: 3.5, sevDecay: 0.22,
  bulletMargin: 2.5, bodyMargin: 8, bossMargin: 14,
  densW: 8, densRb: 90, densRe: 110,
  wallSide: 55, wallSideW: 0.03, wallBot: 70, wallBotW: 0.05, cornW: 100,
  goalW: 0.12, goalWFarm: 0.3, bossColBonus: 14, dashLen: 100, horizon: 40, bodyHorBase: 12,
  itemDistW: 0.2, itemDistBossW: 0.7, trapPen: 16,
  strafeAmp: 66, strafePeriod: 240,
  botBan: 42, sideBan: 26, edgeBanPen: 2500, yMin: 400, divePen: 420, botProgW: 0.18, escW: 0,
  weakLvl: 12,
  centerX: 0.02, centerXFree: 95, centerY: 0.035, centerYFree: 45, homeY: 470,
};
try {
  if (process.env.PARAMS_JSON) Object.assign(P, JSON.parse(process.env.PARAMS_JSON));
} catch (e) { /* ignore */ }

// ---------------- upgrade choice ----------------
function upgradeValue(o, obs) {
  const lvl = obs.player.level;
  const hpFrac = obs.player.hp / Math.max(1, obs.player.max_hp);
  const early = lvl <= 6;
  switch (o.id) {
    case "mix_ascend": return 10000;
    case "tyrant_breaker": return 9000;
    case "ms_split_m": return 8500;
    case "ms_split_s": return 8000;
    case "pc_pierce": return 7400;
    case "fr_cool": return 7000;
    case "fr_basic": return 6500;
    case "mix_terminal": return 6200;
    case "crit_master": return 6000;
    case "sat_orbit": return 5800;
    case "crit_lethal": return 5000;
    case "boss_hunter": return 4800;
    case "crit_aim": return 4500;
    case "mix_fire": return 4200;
    case "dmg_s": return 4000;
    case "exp_smart": return early ? 9600 : 3000;
    case "exp_basic": return early ? 8800 : 2200;
    case "mag_basic": return early ? 6000 : 2600;
    case "heal_quick": return hpFrac < 0.55 ? 9800 : (hpFrac < 0.8 ? 4000 : 800);
    case "shield_extra": return 6200;
    case "shield_basic": return 5600;
    case "kill_blood": return lvl >= 10 ? 5400 : 3400;
    case "timeflow_shield": return 4000;
    case "regen_basic": return 3600;
    case "heal_overflow": return 3200;
    case "thorn_static": return 1200;
    case "turncoat_shield": return 2200;
    case "kill_pulse_3": return 2600;
    case "kill_pulse": return 1800;
    case "drop_basic": return 2400;
    case "elite_hunter": return 3200;
    case "bs_size_m": return 2600;
    case "bs_size_s": return 2400;
    case "reroll_premium": return 5600; // EV: forces purple/orange next pick
    case "mix_econ": return 600;
    case "coin_small": return 400;
    default:
      return { green: 1500, blue: 2500, purple: 4500, orange: 8000 }[o.rarity] || 1500;
  }
}

const SUSTAIN_IDS = new Set(["shield_basic", "shield_extra", "regen_basic", "kill_blood", "heal_overflow", "heal_overflow_2", "heal_quick", "timeflow_shield"]);

function chooseUpgrade(obs, mem) {
  const opts = obs.pending_upgrade.options;
  const lvl = obs.player.level;
  let bestIdx = opts[0].index, best = -Infinity, bestId = null;
  for (const o of opts) {
    let v = upgradeValue(o, obs);
    // ensure one sustain pick before the boss grind wears us down
    if (!mem.sustain && lvl >= 5 && lvl <= 13 && SUSTAIN_IDS.has(o.id)) v += 2200;
    if (v > best) { best = v; bestIdx = o.index; bestId = o.id; }
  }
  if (bestId && SUSTAIN_IDS.has(bestId)) mem.sustain = true;
  return bestIdx;
}

// ---------------- helpers ----------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function sq(v) { return v * v; }

const CANDS = [[0, 0]];
for (const sp of [6, 14, 26, 40]) {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    CANDS.push([Math.cos(a) * sp, Math.sin(a) * sp]);
  }
}
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  CANDS.push([Math.cos(a) * 3, Math.sin(a) * 3]);
}

// fine lattice for high pressure (boss fights, dense fans)
const CANDS_FINE = [[0, 0]];
for (const sp of [3, 7, 12, 18, 26, 33, 40]) {
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    CANDS_FINE.push([Math.cos(a) * sp, Math.sin(a) * sp]);
  }
}

const BULLET_SPEED = 8.5;

// First time t in [t_lo,t_hi] where |rx + rvx t| < hw AND |ry + rvy t| < hh.
function relHitTime(rx, ry, rvx, rvy, hw, hh, tLo, tHi) {
  let tx0, tx1;
  if (rvx > -1e-9 && rvx < 1e-9) {
    if (rx >= hw || rx <= -hw) return Infinity;
    tx0 = tLo; tx1 = tHi;
  } else {
    const a = (-hw - rx) / rvx, b = (hw - rx) / rvx;
    tx0 = a < b ? a : b; tx1 = a < b ? b : a;
  }
  let ty0, ty1;
  if (rvy > -1e-9 && rvy < 1e-9) {
    if (ry >= hh || ry <= -hh) return Infinity;
    ty0 = tLo; ty1 = tHi;
  } else {
    const a = (-hh - ry) / rvy, b = (hh - ry) / rvy;
    ty0 = a < b ? a : b; ty1 = a < b ? b : a;
  }
  const t0 = Math.max(tx0, ty0, tLo), t1 = Math.min(tx1, ty1, tHi);
  if (t0 > t1) return Infinity;
  return t0;
}

// Dash-then-hold: we move at velocity (cx,cy) for K ticks, then hold.
// Returns first hit time in [0,horizon] against a threat at relative pos
// (rx,ry) moving (vx,vy), or Infinity.
function dashHoldHitTime(rx, ry, vx, vy, cx, cy, K, hw, hh, horizon) {
  if (K > 0) {
    const t1 = relHitTime(rx, ry, vx - cx, vy - cy, hw, hh, 0, Math.min(K, horizon));
    if (t1 !== Infinity) return t1;
    if (K >= horizon) return Infinity;
  }
  // hold phase: threat relative pos advanced by K ticks of dash
  const rx2 = rx + (vx - cx) * K;
  const ry2 = ry + (vy - cy) * K;
  const t2 = relHitTime(rx2, ry2, vx, vy, hw, hh, 0, horizon - K);
  return t2 === Infinity ? Infinity : K + t2;
}

// 8 escape directions for the second ply
const ESC = [];
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  ESC.push([Math.cos(a) * 40, Math.sin(a) * 40]);
}

// Depth-2: after moving c for K1 ticks, what is the best achievable earliest
// hit time over second moves? Returns min-hit-time of the best 2-segment path.
function escapeQuality(threats, cx, cy, K1, px, py, W, H, phw, phh, horizon) {
  let bestT = -Infinity;
  for (const e of ESC) {
    // wall-clamp the second segment start
    const sx = clamp(px + cx * K1, phw, W - phw);
    const sy = clamp(py + cy * K1, phh, H - phh);
    // skip second moves that pin us at edges
    const ex = sx + e[0] * 4, ey = sy + e[1] * 4;
    if (ex < phw + 10 || ex > W - phw - 10 || ey > H - 50 || ey < 120) continue;
    let minT = Infinity;
    for (const t of threats) {
      // advance threat to K1, relative to segment-2 start
      const rx2 = t.rx + t.vx * K1 - (sx - px);
      const ry2 = t.ry + t.vy * K1 - (sy - py);
      const h = dashHoldHitTime(rx2, ry2, t.vx, t.vy, e[0], e[1], 3, t.hw, t.hh, horizon - K1);
      if (h < minT) minT = h;
      if (minT <= 0) break;
    }
    if (minT > bestT) bestT = minT;
    if (bestT === Infinity) break;
  }
  return bestT === -Infinity ? 0 : bestT;
}

// ---------------- decision ----------------
function decide(obs, mem) {
  if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
    return { move: [0, 0], upgrade_choice: chooseUpgrade(obs, mem) };
  }

  const p = obs.player;
  const [px, py] = p.pos;
  const W = obs.field.w, H = obs.field.h;
  const fs = obs.frame_skip || 1;
  const phw = p.size[0] / 2, phh = p.size[1] / 2;
  const hpFrac = p.hp / Math.max(1, p.max_hp);
  const iframes = p.invincible_ms || 0;

  const enemies = [];
  const bullets = [];
  const items = [];
  let boss = null;
  for (const o of obs.objects) {
    if (o.type === "enemy" || o.type === "enemy_elite") enemies.push(o);
    else if (o.type === "boss") { boss = o; enemies.push(o); }
    else if (o.type === "enemy_bullet") bullets.push(o);
    else if (o.type === "item") items.push(o);
  }

  // ----- threats (relative coords) -----
  const threats = [];
  const rain = []; // falling bullets anywhere above: long-range anticipation
  for (const b of bullets) {
    const rx = b.pos[0] - px, ry = b.pos[1] - py;
    if (b.vel[1] > 0.5 && ry < -8 && ry > -420 && Math.abs(rx) < 330) {
      rain.push({ x: b.pos[0], y: b.pos[1], vx: b.vel[0], vy: b.vel[1] });
    }
    if (rx > 280 || rx < -280 || ry > 80 || ry < -340) continue;
    threats.push({
      rx, ry, vx: b.vel[0], vy: b.vel[1],
      hw: phw + b.size[0] / 2 + P.bulletMargin, hh: phh + b.size[1] / 2 + P.bulletMargin,
      w: 1.0, body: false,
    });
  }
  for (const e of enemies) {
    const rx = e.pos[0] - px, ry = e.pos[1] - py;
    if (rx > 360 || rx < -360 || ry > 200 || ry < -400) continue;
    const big = e.type === "boss";
    const m = big ? P.bossMargin : P.bodyMargin;
    // slow bodies far away are a farming non-issue: short horizon scaled by speed
    const spd = Math.hypot(e.vel[0], e.vel[1]);
    const hor = big ? P.horizon : Math.min(P.horizon, P.bodyHorBase + spd * 6);
    threats.push({
      rx, ry, vx: e.vel[0], vy: e.vel[1],
      hw: phw + e.size[0] / 2 + m, hh: phh + e.size[1] / 2 + m,
      w: 3.0, body: true, hor,
    });
  }

  const goal = pickGoal(obs, enemies, items, boss, px, py, W, H, p, mem);
  const bossActive = !!(boss && !boss.in_cutscene);
  const bossHalfW = boss ? boss.size[0] / 2 : 0;
  const weakMode = bossActive && !mem.sustain && p.level < P.weakLvl && p.shield_max === 0;

  const bulletScale = iframes > 120 ? 0.12 : 1.0;
  const bodyScale = iframes > 120 ? 0.5 : 1.0;
  const dangerWeight = P.dangerW * (1 + P.dangerHp * (1 - hpFrac));

  const HORIZON = P.horizon;
  const lastMove = mem.lm || [0, 0];
  // pressure: nearby threats → use the fine lattice
  let nearCount = 0;
  for (const t of threats) if (Math.abs(t.rx) < 150 && Math.abs(t.ry) < 150) nearCount++;
  const useFine = bossActive || nearCount >= 5;
  const candSet = useFine ? CANDS_FINE : CANDS;
  let best = candSet[0], bestScore = -Infinity;
  const entries = [];
  for (const c of candSet) {
    const cx = c[0], cy = c[1];
    const sp = Math.hypot(cx, cy);
    // dash length then hold (re-decided every tick anyway)
    const K = sp < 1e-6 ? 0 : clamp(P.dashLen / sp, 2, 24);
    const nx = clamp(px + cx * fs, phw, W - phw);
    const ny = clamp(py + cy * fs, phh, H - phh);

    let danger = 0;
    let density = 0;
    let minHit = Infinity;
    for (const t of threats) {
      const scale = t.body ? bodyScale : bulletScale;
      const th = dashHoldHitTime(t.rx, t.ry, t.vx, t.vy, cx, cy, K, t.hw, t.hh, t.hor || HORIZON);
      if (th !== Infinity) {
        danger += scale * t.w * (th <= fs + 0.001 ? P.sevNow : P.sevBase / (1 + (th - fs) * P.sevDecay));
        if (th < minHit) minHit = th;
      }
      const d = Math.hypot(t.rx - cx * fs, t.ry - cy * fs);
      const R = t.body ? P.densRe : P.densRb;
      if (d < R && t.ry - cy * fs < 50) density += (t.body ? 1.6 : 1.0) * sq(1 - d / R);
    }

    // rain pressure: where will falling bullets cross our altitude?
    let rainP = 0;
    for (const rb of rain) {
      const tArr = (ny - rb.y) / rb.vy;
      if (tArr > 0 && tArr < P.rainT) {
        const xAt = rb.x + rb.vx * tArr;
        const d = Math.abs(xAt - nx);
        if (d < P.rainKern) rainP += (1 - d / P.rainKern) * (1 - tArr / P.rainDecay);
      }
    }

    let pen = 0;
    const dxl = nx, dxr = W - nx, dyb = H - ny;
    // edge zones effectively banned (off-screen looks "safe" to the threat
    // model since bullets despawn there — it is a trap)
    if (dyb < P.botBan) pen += P.edgeBanPen;
    if (dxl < P.sideBan || dxr < P.sideBan) pen += P.edgeBanPen;
    // progressive lower-zone cost: one bullet hit is cheaper than being pocketed
    if (ny > H - 120) pen += sq(ny - (H - 120)) * P.botProgW;
    if (dxl < P.wallSide) pen += sq(P.wallSide - dxl) * P.wallSideW;
    if (dxr < P.wallSide) pen += sq(P.wallSide - dxr) * P.wallSideW;
    if (dyb < P.wallBot) pen += sq(P.wallBot - dyb) * P.wallBotW;
    if (ny < 130) pen += sq(130 - ny) * 0.012;
    const cornX = Math.max(0, 1 - Math.min(dxl, dxr) / 90);
    const cornB = Math.max(0, 1 - dyb / 110);
    pen += cornX * cornB * P.cornW;
    if (ny < P.yMin) pen += (P.yMin - ny) * 1.2;
    // central living band: smooth pull away from walls/bottom camping
    pen += sq(Math.max(0, Math.abs(nx - W / 2) - P.centerXFree)) * P.centerX;
    pen += sq(Math.max(0, Math.abs(ny - P.homeY) - P.centerYFree)) * P.centerY;

    // boss dive: get OUT of its column when it descends
    if (boss && !boss.in_cutscene && boss.vel[1] > 1.2 && boss.pos[1] > 60) {
      if (Math.abs(nx - (boss.pos[0] + boss.vel[0] * 6)) < bossHalfW + 55) pen += P.divePen;
    }

    // wall-pin: gliding into a wall soon
    const fx = px + cx * fs * 5, fy = py + cy * fs * 5;
    if (fx < 20 || fx > W - 20) pen += 6;
    if (fy > H - 36) pen += 8;

    if (ny > H - 130) {
      for (const t of threats) {
        if (t.body && t.ry - cy * fs < 0 && Math.abs(t.rx - cx * fs) < t.hw + 30 && (cy * fs - t.ry) < 280) pen += P.trapPen;
      }
    }

    const gd = Math.hypot(goal[0] - nx, goal[1] - ny);
    const goalW = bossActive ? P.goalW : P.goalWFarm;
    let score = -danger * dangerWeight - density * P.densW - rainP * P.rainW - pen - gd * goalW;
    if (bossActive && !weakMode && Math.abs(nx - boss.pos[0]) < bossHalfW * 0.9) score += P.bossColBonus;
    // hysteresis: keep direction (reduces dithering)
    score += (cx * lastMove[0] + cy * lastMove[1]) * 0.01;

    if (mem._dbg) mem._dbgOut.push({ c, danger: +danger.toFixed(2), density: +density.toFixed(2), pen: +pen.toFixed(1), gd: +gd.toFixed(0), score: +score.toFixed(1) });
    entries.push({ c, score, minHit, cx, cy });
    if (score > bestScore) { bestScore = score; best = c; }
  }

  // depth-2 escape search when the pocket is closing: re-rank top candidates
  // by whether a SECOND move can keep us clear.
  let bestEntry = null;
  for (const e of entries) if (!bestEntry || e.score > bestEntry.score) bestEntry = e;
  if (P.escW > 0 && bestEntry && bestEntry.minHit < 14 && threats.length > 0) {
    entries.sort((a, b) => b.score - a.score);
    const topK = entries.slice(0, 16);
    let reBest = null, reBestScore = -Infinity;
    for (const e of topK) {
      const K1 = 4;
      const eq = escapeQuality(threats, e.cx, e.cy, K1, px, py, W, H, phw, phh, HORIZON);
      const s = e.score + Math.min(eq, 30) * P.escW;
      if (s > reBestScore) { reBestScore = s; reBest = e; }
    }
    if (reBest) best = reBest.c;
  }

  mem.lm = [best[0], best[1]];
  mem.g = goal; // for diagnostics; harmless in production
  return { move: [best[0], best[1]], upgrade_choice: null };
}

function enemyValue(e) {
  if (e.type === "enemy_elite") return 14;
  switch (e.enemy_type) {
    case "tank": return 4;
    case "shooter": return 5;
    case "weaver": return 3;
    case "swift": return 2;
    case "mirror": return 0.5;
    default: return 1;
  }
}

function pickGoal(obs, enemies, items, boss, px, py, W, H, p, mem) {
  const cruiseY = H - 150;
  const hurt = p.hp < p.max_hp * 0.999;
  const bossActive = !!(boss && !boss.in_cutscene);
  const bossCutscene = !!(boss && boss.in_cutscene);

  // ---- item scoring (used as override) ----
  let bestItem = null, bestItemScore = 0;
  for (const it of items) {
    const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
    let v;
    switch (it.item_type) {
      case "heart": v = p.hp < p.max_hp * 0.7 ? 420 : (hurt ? 140 : 6); break;
      case "levelup": v = 340; break;
      case "invincible": v = 170; break;
      case "magnet": v = 280; break;
      case "bomb": v = 210; break;
      case "exp_huge": v = 210; break;
      case "exp_large": v = 115; break;
      case "exp_medium": v = 52; break;
      case "exp_small": v = 26; break;
      case "coin": v = 6; break;
      default: v = 12;
    }
    if (bossCutscene) v *= 2.0;
    if (it.pos[1] < 120) v *= 0.25;
    if (it.exp_value > 0 && p.xp_to_next - p.exp <= 2 * it.exp_value) v *= 1.8;
    const s = v - d * (bossActive ? P.itemDistBossW : P.itemDistW);
    if (s > bestItemScore) { bestItemScore = s; bestItem = it; }
  }
  const itemGoal = bestItem ? (() => {
    const iy = bestItem.pos[1], ivy = (bestItem.vel && bestItem.vel[1]) || 0;
    const targetY = ivy > 0.2 ? Math.max(iy + 40, cruiseY - 40) : iy;
    return [clamp(bestItem.pos[0], 24, W - 24), clamp(targetY, 150, H - 50)];
  })() : null;

  // weak mode: early boss fight without sustain — farm adds & items for fast
  // levels instead of holding the boss column under fire
  const weak = bossActive && !mem.sustain && p.level < P.weakLvl && p.shield_max === 0;

  if (bossActive && !weak) {
    if (itemGoal) return itemGoal;
    // strafe under the boss: in-column for DPS, moving so aimed volleys trail
    const phase = Math.sin((obs.frame % P.strafePeriod) / P.strafePeriod * Math.PI * 2);
    let aimX = boss.pos[0] + boss.vel[0] * 8 + phase * P.strafeAmp;
    aimX = clamp(aimX, 60, W - 60);
    return [aimX, cruiseY];
  }

  // ---- farm: sticky target ----
  let target = null, bestS = -Infinity;
  for (const e of enemies) {
    if (e.type === "boss") continue;
    const ey = e.pos[1];
    const giveUp = e.type === "enemy_elite" ? H - 115 : (e.enemy_type === "tank" ? H - 120 : H - 170);
    if (ey > giveUp || ey < -40) continue;
    let s = enemyValue(e) * 8;
    s -= Math.abs(e.pos[0] - px) * 0.06;          // travel
    s -= Math.max(0, 300 - ey) * 0.06;            // too high = wait
    s += ey > 350 ? (ey - 350) * 0.08 : 0;        // escaping soon = urgent
    if (e.id === mem.tid) s += 38;                // strong commitment
    if (s > bestS) { bestS = s; target = e; }
  }

  if (target) {
    mem.tid = target.id;
    // priority item detour only if clearly worth it (high value or en route)
    if (itemGoal && (bestItemScore > 80 || Math.abs(itemGoal[0] - px) < 70)) return itemGoal;
    const ty = target.pos[1];
    const dy = Math.max(20, py - ty);
    const eta = dy / (BULLET_SPEED + Math.max(0.2, target.vel[1]));
    let aimX = target.pos[0] + target.vel[0] * Math.min(eta, 28);
    aimX = clamp(aimX, 20, W - 20);
    const standY = clamp(Math.max(ty + 100, cruiseY - 20), 300, H - 70);
    return [aimX, standY];
  }

  mem.tid = null;
  if (itemGoal) return itemGoal;
  return [W / 2, cruiseY];
}

function policy(obs, mem) {
  if (!mem || typeof mem !== "object") mem = {};
  let action;
  try {
    action = decide(obs, mem);
  } catch (e) {
    action = { move: [0, 0], upgrade_choice: 0 };
  }
  return { action, mem };
}

module.exports = {
  init() { return {}; },
  policy,
};
