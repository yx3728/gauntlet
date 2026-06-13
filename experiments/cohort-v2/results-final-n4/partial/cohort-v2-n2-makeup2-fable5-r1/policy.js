/**
 * policy.js — Roguelike Skies policy.
 *
 * Strategy:
 *  - Waves 1-2 (0-90s): farm exp safely (align under enemies from below, scoop orbs),
 *    build an exp engine early (exp/mag upgrades), then stack offense.
 *  - Boss (90s+): hold the "hug band" under the boss so bullet streams hit, weave
 *    laterally between fan spokes, grab LV+/INV/heart item rain, level off adds.
 *  - Win detail: killing the wave-3 boss while hp < max_hp ends the game immediately
 *    (full hp at the kill spawns a hidden extra boss with ~50M hp). We avoid
 *    heal-to-full / vamp upgrades, gate heart pickups, and if the boss nears death
 *    while we're at full hp we step off-line and court a chip hit first.
 *  - Movement: candidate-move search scored by safe-time τ (first tick any hazard's
 *    swept box overlaps the candidate; hazards move ballistically) + mode objective.
 *    End-position collision semantics allow hopping "through" bullets. τ≥cap means
 *    "safe for the whole horizon" — only then does the objective fully matter.
 */
"use strict";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const TAU_CAP = 18;          // ticks of lookahead for safe-time
const TAU_W = 70;            // score per tick of safety
const HUG_DIST = 105;        // hover this far below boss bottom edge
const HOME_Y_FRAC = 0.76;
const OBJ_W = 3.0;

// ---------------------------------------------------------------------------
// Upgrade knowledge
// ---------------------------------------------------------------------------
const NEVER = new Set([
  "kill_blood", "kill_butcher",
  "heal_overflow", "heal_overflow_2", "heal_overflow_3",
  "turncoat_shield",
]);

function streamsHit(sideBullets, hugDist) {
  const t = (hugDist + 50) / 7.8;
  let n = 1;
  for (let w = 1; w <= sideBullets; w++) {
    if (w * (6 + 0.9 * t) <= 62) n += 2;
  }
  return n;
}

function expectedCritMul(critRate, critMult) {
  const r = Math.min(0.95, critRate);
  return 1 + r * (critMult - 1);
}

function dpsGain(id, s, obs) {
  const interval = Math.max(1, obs.player.shoot_interval_ms || 420);
  const floor = s.ascended ? 30 : 80;
  const sb = obs.player.side_bullets || 0;
  const hits = streamsHit(sb, HUG_DIST);
  const critNow = expectedCritMul(s.critRate, s.critMult);
  const rate = (mul) => interval / Math.max(floor, Math.floor(interval / mul));
  switch (id) {
    case "dmg_s": return 1.12;
    case "dmg_m": return 1.2;
    case "dmg_l": return 1.5;
    case "dmg_xl": return 2.0;
    case "fr_basic": return rate(1.32);
    case "fr_cool": return rate(1.64);
    case "fr_turbo": return rate(2.28);
    case "mix_fire": return 1.08 * rate(1.15);
    case "mix_vulcan": return 1.16 * rate(1.3);
    case "mix_terminal": {
      const c2 = expectedCritMul(Math.min(0.95, s.critRate + 0.25), s.critMult + Math.max(0, s.critRate + 0.25 - 0.95) * 2);
      return 1.15 * (c2 / critNow);
    }
    case "mix_perfect": {
      const c2 = expectedCritMul(Math.min(0.95, s.critRate + 0.25), s.critMult + Math.max(0, s.critRate + 0.25 - 0.95) * 2);
      return 1.25 * rate(1.25) * (c2 / critNow);
    }
    case "mix_ascend": {
      const ni = Math.max(30, Math.floor(interval / 10));
      return (interval / ni) * 0.5;
    }
    case "crit_aim": return expectedCritMul(s.critRate + 0.2, s.critMult) / critNow;
    case "crit_lethal": return expectedCritMul(s.critRate + 0.25, s.critMult) / critNow;
    case "crit_master": {
      const over = Math.max(0, s.critRate + 0.3 - 0.95);
      return expectedCritMul(s.critRate + 0.3, s.critMult * 1.5 + over * 2) / critNow;
    }
    case "crit_apex": {
      const over = Math.max(0, s.critRate + 0.35 - 0.95);
      return expectedCritMul(s.critRate + 0.35, s.critMult * 2 + over * 2) / critNow;
    }
    case "ms_split_s": return streamsHit(sb + 1, HUG_DIST) / hits * 1.08; // splits also sweep adds
    case "ms_split_m": return streamsHit(sb + 1, HUG_DIST) / hits * 1.08;
    case "ms_split_l": return streamsHit(sb + 2, HUG_DIST) / hits * 1.12;
    case "bullet_void": {
      const h2 = streamsHit(sb + 6, HUG_DIST) / hits;
      const c2 = expectedCritMul(0.95, s.critMult) / critNow;
      return h2 * c2 * 0.7 / 1.3;
    }
    case "boss_hunter": return 1.3;
    case "tyrant_breaker": return 2.0;
    case "pc_pierce": return 1.12;
    default: return 1.0;
  }
}

function applyPick(id, s) {
  switch (id) {
    case "crit_aim": s.critRate += 0.2; break;
    case "crit_lethal": s.critRate += 0.25; break;
    case "crit_master": s.critMult *= 1.5; s.critRate += 0.3; break;
    case "crit_apex": s.critMult *= 2; s.critRate += 0.35; break;
    case "mix_terminal": s.critRate += 0.25; break;
    case "mix_perfect": s.critRate += 0.25; s.expMul += 0.35; break;
    case "bullet_void": s.critRate = 0.95; break;
    case "mix_ascend": s.ascended = true; break;
    case "exp_basic": s.expMul += 1; break;
    case "exp_smart": s.expMul += 2; break;
    case "boss_hunter": s.bossMul *= 1.3; break;
    case "tyrant_breaker": s.bossMul *= 2; s.eliteMul *= 2; break;
  }
  if (s.critRate > 0.95) { s.critMult += (s.critRate - 0.95) * 2; s.critRate = 0.95; }
  s.picked[id] = true;
}

function chooseUpgrade(options, mem, obs) {
  const s = mem.stats;
  const ri = obs.reward_info || {};
  const preBoss = !ri.boss_reached;
  const bossLow = ri.boss_active && ri.boss_hp_frac != null && ri.boss_hp_frac < 0.12;
  const hpFrac = obs.player.max_hp > 0 ? obs.player.hp / obs.player.max_hp : 1;
  const timeMs = obs.time_ms || 0;
  // projected fight length: long fight -> tank up (we'll out-scale the boss later)
  let longFight = false;
  if (ri.boss_active && ri.boss_hp_frac != null) {
    const rate = mem.bossDmgRate || 0; // frac per step
    longFight = rate < 1e-9 ? (ri.level || 0) < 12 : ri.boss_hp_frac / rate > 5400;
  }

  let bestIdx = 0, bestScore = -Infinity;
  for (const opt of options) {
    if (!opt) continue;
    const id = opt.id || "";
    let score;
    const gain = dpsGain(id, s, obs);
    score = (gain - 1) * 100;

    if (id === "exp_basic") score = preBoss ? 200 - timeMs / 1000 : 40;
    else if (id === "exp_smart") score = preBoss ? 195 - timeMs / 1000 : 38;
    else if (id === "exp_quantum") score = 95; // 5% LV+ drop per kill — level engine
    else if (id === "mag_basic") score = preBoss ? 120 - timeMs / 1500 : 24;
    else if (id === "mag_well") score = preBoss ? 80 - timeMs / 1500 : 20;
    else if (id === "mag_hole") score = 55;
    else if (id === "pc_pierce") score = Math.max(score, 22);
    else if (id === "bullet_crush") score = longFight ? 85 : 65;
    else if (id === "drop_basic") score = 14;
    else if (id === "elite_hunter") score = 12;
    else if (id === "bs_size_s" || id === "bs_size_m") score = 10;
    else if (id === "reroll_premium") score = 9;
    else if (id === "mix_econ" || id === "coin_small" || id === "coin_big") score = 3;
    else if (id === "kill_pulse") score = 8;
    else if (id === "kill_pulse_3") score = 7;
    else if (id === "thorn_static" || id === "thorn_blaze") score = 2;
    else if (id === "timeflow_shield") score = longFight ? 62 : 30;
    else if (id === "shield_basic") score = longFight ? 72 : ri.boss_reached || hpFrac < 0.7 ? 42 : 15;
    else if (id === "shield_extra") score = longFight ? 60 : ri.boss_reached || hpFrac < 0.7 ? 34 : 12;
    else if (id === "shield_rapid") score = longFight ? 55 : ri.boss_reached || hpFrac < 0.7 ? 28 : 10;
    else if (id === "regen_basic" || id === "regen_nano") score = longFight ? 26 : 4;
    else if (id === "heal_quick") score = (hpFrac < 0.3 && !bossLow) ? 90 : 1;
    else if (id === "hp_plate" || id === "hp_heavy" || id === "hp_unbroken") score = (hpFrac < 0.4 && !bossLow) ? 50 : 5;
    else if (id === "shield_absolute") score = 30;
    if (NEVER.has(id)) score = -50;

    if (score > bestScore) { bestScore = score; bestIdx = opt.index != null ? opt.index : 0; }
  }
  const chosen = options.find((o) => o && o.index === bestIdx) || options[0];
  if (chosen && chosen.id) applyPick(chosen.id, s);
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
const DIRS = [];
for (let i = 0; i < 16; i++) {
  const a = (Math.PI * 2 * i) / 16;
  DIRS.push([Math.cos(a), Math.sin(a)]);
}
const RADII = [6, 14, 24, 32, 40];

function clampPos(x, y, W, H, pw, ph) {
  return [
    Math.max(pw / 2, Math.min(W - pw / 2, x)),
    Math.max(ph / 2, Math.min(H - ph / 2, y)),
  ];
}

// first tick (0..TAU_CAP) at which any hazard overlaps candidate; TAU_CAP = safe.
// hazards arriving before invTicks are ignored (invincibility window).
function safeTime(cx, cy, hazards, pw, ph, invTicks) {
  let tau = TAU_CAP;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.minT >= tau) continue; // can't beat current worst
    const hw = (h.size[0] + pw) / 2;
    const hh = (h.size[1] + ph) / 2;
    let hx = h.pos[0], hy = h.pos[1];
    const vx = h.vel[0], vy = h.vel[1];
    const tEnd = Math.min(tau, TAU_CAP);
    for (let t = 0; t < tEnd; t++) {
      const m = h.margin + t * 0.5;
      if (Math.abs(hx - cx) < hw + m && Math.abs(hy - cy) < hh + m) {
        if (t >= invTicks) { tau = t; }
        break;
      }
      hx += vx; hy += vy;
    }
    if (tau === 0) return 0;
  }
  return tau;
}

// shell discomfort: standing flush against enemy bodies / boss
function shellPenalty(cx, cy, bodies, pw, ph) {
  let pen = 0;
  for (let i = 0; i < bodies.length; i++) {
    const h = bodies[i];
    const hw = (h.size[0] + pw) / 2 + 4;
    const hh = (h.size[1] + ph) / 2 + 4;
    const gx = Math.abs(h.pos[0] - cx) - hw;
    const gy = Math.abs(h.pos[1] - cy) - hh;
    const gap = Math.max(gx, gy);
    if (gap < 26) pen += ((26 - gap) / 26) * h.shellW;
  }
  return pen;
}

function pinPenalty(cx, cy, hazards, W, H) {
  const wallGap = Math.min(cx, W - cx, cy, H - cy);
  if (wallGap >= 70) return 0;
  let pressure = 0;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const d = Math.hypot(h.pos[0] - cx, h.pos[1] - cy);
    if (d < 190) pressure += (h.pressW / 1000) * (1 - d / 190);
  }
  return pressure * ((70 - wallGap) / 70) * 240;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function freshStats() {
  return {
    critRate: 0, critMult: 1.5, bossMul: 1, eliteMul: 1, expMul: 1,
    ascended: false, picked: {},
  };
}

function policyInner(obs, mem) {
  if (!mem || typeof mem !== "object") mem = {};
  if (!mem.stats) mem.stats = freshStats();
  const W = (obs.field && obs.field.w) || 360;
  const H = (obs.field && obs.field.h) || 640;
  const p = obs.player || { pos: [W / 2, H * 0.85], size: [24, 30], hp: 1, max_hp: 1 };
  const [px, py] = p.pos;
  const pw = p.size[0], ph = p.size[1];

  if (obs.pending_upgrade && Array.isArray(obs.pending_upgrade.options) && obs.pending_upgrade.options.length) {
    const choice = chooseUpgrade(obs.pending_upgrade.options, mem, obs);
    return { action: { move: [0, 0], upgrade_choice: choice }, mem };
  }

  // --- world model ---
  const hazards = [];   // for safe-time (pre-filtered to reachable relevance)
  const bodies = [];    // enemy/boss bodies for shell discomfort
  const items = [];
  const enemies = [];
  let boss = null;
  let bulletCount = 0;
  const objs = obs.objects || [];
  const REACH = 280; // candidates lie within 40px; hazards farther than this can't touch us within the horizon
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!o || !o.pos || !o.size) continue;
    const t = o.type;
    if (t === "enemy" || t === "enemy_elite" || t === "boss" || t === "enemy_bullet") {
      if (t === "boss") boss = o;
      if (t === "enemy_bullet") bulletCount++;
      else if (t !== "boss") enemies.push(o);
      const dx = Math.abs(o.pos[0] - px), dy = Math.abs(o.pos[1] - py);
      const speed = Math.abs(o.vel ? o.vel[0] : 0) + Math.abs(o.vel ? o.vel[1] : 0);
      const reach = REACH + speed * TAU_CAP;
      if (dx < reach && dy < reach) {
        const isBullet = t === "enemy_bullet";
        hazards.push({
          pos: o.pos, vel: o.vel || [0, 0], size: o.size,
          margin: isBullet ? 3 : t === "boss" ? 10 : 7,
          isBullet,
          minT: 0,
          pressW: isBullet ? 1000 : t === "boss" ? 5200 : 2800,
        });
        if (!isBullet) bodies.push({ pos: o.pos, size: o.size, shellW: t === "boss" ? 260 : 130 });
      }
    } else if (t === "item") {
      items.push(o);
    }
  }

  const ri = obs.reward_info || {};
  const hpDeficit = (p.max_hp || 0) - (p.hp || 0);
  const hpFrac = p.max_hp > 0 ? p.hp / p.max_hp : 1;
  const bossActive = !!(boss && !boss.in_cutscene);
  const bossFrac = boss && boss.max_hp > 0 ? boss.hp / boss.max_hp : null;
  const homeY = H * HOME_Y_FRAC;
  const invMsEarly = p.invincible_ms || 0;
  // invincible window: hug point-blank — every stream connects, nothing can hurt us
  const hugDistNow = invMsEarly > 600 ? 26 : HUG_DIST;
  const hugY = boss
    ? Math.max(invMsEarly > 600 ? 190 : 250, Math.min(430, boss.pos[1] + boss.size[1] / 2 + hugDistNow))
    : H * 0.47;

  // --- DPS estimate vs boss (to anticipate the killing blow) ---
  if (bossFrac != null) {
    if (mem.bossFracPrev != null) {
      const d = Math.max(0, mem.bossFracPrev - bossFrac);
      mem.bossDmgRate = (mem.bossDmgRate || 0) * 0.97 + d * 0.03;
    }
    mem.bossFracPrev = bossFrac;
  } else {
    mem.bossFracPrev = null;
    mem.bossDmgRate = 0;
  }

  // --- stall: never deliver the killing blow at full hp ---
  let stallMode = false;
  const stallThresh = Math.min(0.3, Math.max(0.05, (mem.bossDmgRate || 0) * 120));
  if (bossActive && bossFrac != null && bossFrac < stallThresh && p.hp >= p.max_hp) {
    mem.stall = (mem.stall || 0) + 1;
    if (mem.stall < 2000) stallMode = true;
  } else {
    mem.stall = 0;
  }

  // --- item selection ---
  const magnetR = p.magnet_range || 40;
  let bestItem = null, bestItemScore = bossActive ? 2.2 : 1.1;
  const passItems = [];
  for (const it of items) {
    const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
    let v = 0;
    const t = it.item_type;
    if (t === "levelup") v = 6000;
    else if (t === "invincible") v = bossActive ? 3000 : 1000;
    else if (t === "heart") {
      if (bossFrac != null && bossFrac < 0.3) v = hpFrac < 0.5 ? Math.min(2200, hpDeficit) : -300;
      else v = hpDeficit > 1000 ? Math.min(3000, hpDeficit) : 0;
    } else if (t === "bomb") v = bossActive ? (bulletCount > 26 ? 1400 : 180) : 100 + Math.min(1200, 25 * bulletCount);
    else if (t === "magnet") {
      let totExp = 0;
      for (const o of items) if (o.item_type && o.item_type.indexOf("exp_") === 0) totExp += o.exp_value || 1;
      v = 80 + Math.min(2500, totExp * 12);
    } else if (t === "coin") v = 6;
    else if (t && t.indexOf("exp_") === 0) {
      v = (it.exp_value || 1) * (bossActive ? 30 : 90);
      if (!bossActive) {
        const tFall = (H - 15 - it.pos[1]) / 1.4;
        if (tFall < 150) v *= 1.6;
      }
    }
    if (v <= 0) continue;
    if (d <= magnetR * 0.9) continue;
    if (bossActive) {
      passItems.push({ pos: it.pos, vel: it.vel || [0, 1.4], v });
      const deep = it.pos[1] > hugY + 170;
      const special = t === "levelup" || t === "invincible" || (t === "heart" && v > 0) || (t === "bomb" && v >= 1400);
      if (!special) continue;
      if (deep && v < 2000) continue;
    }
    const eta = d / 32;
    const fy = it.pos[1] + (it.vel ? it.vel[1] : 1.4) * eta;
    if (fy > H - 6) continue;
    const score = v / (d + 50);
    if (score > bestItemScore) { bestItemScore = score; bestItem = it; }
  }

  // --- objective ---
  let target = null;
  let bossAlign = false;
  let bossPredX = 0;

  if (bestItem) {
    const d = Math.hypot(bestItem.pos[0] - px, bestItem.pos[1] - py);
    const lead = Math.min(12, d / 30);
    target = [
      bestItem.pos[0] + (bestItem.vel ? bestItem.vel[0] : 0) * lead,
      bestItem.pos[1] + (bestItem.vel ? bestItem.vel[1] : 1.4) * lead,
    ];
  } else if (bossActive) {
    bossAlign = true;
    bossPredX = Math.max(40, Math.min(W - 40, boss.pos[0] + (boss.vel ? boss.vel[0] * 4 : 0)));
    // add-hunting: adds that drift below the boss are exp/LV+ income AND contact
    // threats — align the main stream onto them while the boss isn't near death.
    if (bossFrac != null && bossFrac > 0.12) {
      let bestA = null, bestAs = -Infinity;
      for (const e of enemies) {
        if (e.pos[1] < 255 || e.pos[1] > H - 130) continue;
        const adx = Math.abs(e.pos[0] - px);
        if (adx > 150) continue;
        const sc = e.pos[1] - adx * 0.8 + (e.type === "enemy_elite" ? 120 : 0);
        if (sc > bestAs) { bestAs = sc; bestA = e; }
      }
      if (bestA) bossPredX = Math.max(20, Math.min(W - 20, bestA.pos[0] + (bestA.vel ? bestA.vel[0] * 5 : 0)));
    }
  } else {
    let bestE = null, bestS = -Infinity;
    for (const e of enemies) {
      if (e.pos[1] > H - 200) continue;
      const adx = Math.abs(e.pos[0] - px);
      const value = e.type === "enemy_elite" ? 2.5 : 1;
      const s = value * 300 - adx - Math.max(0, 300 - e.pos[1]) * 0.25;
      if (s > bestS) { bestS = s; bestE = e; }
    }
    const preBossEntry = !ri.boss_reached && (obs.time_ms || 0) > 86500;
    if (preBossEntry) {
      // boss spawns at 90s top-center: be waiting at the band, not at the bottom
      target = [W / 2, 320];
    } else if (bestE) {
      target = [bestE.pos[0] + (bestE.vel ? bestE.vel[0] * 6 : 0), Math.min(Math.max(homeY, bestE.pos[1] + 200), H - 80)];
    } else if (boss && boss.in_cutscene) {
      target = [boss.pos[0], hugY + 40];
    } else {
      target = [W / 2, homeY];
    }
  }

  // --- invincibility / chip-courting windows ---
  const invMs = p.invincible_ms || 0;
  const invTicks = invMs > 100 ? Math.max(0, (invMs - 120) / 16.7) : 0;
  // courting a chip hit while stalling at full hp: ignore bullets (let one hit us),
  // still respect bodies/boss (2000 contact dmg is too much courting)
  const courtChip = stallMode && hpFrac >= 1;

  // --- candidate search ---
  let bestMove = [0, 0];
  let bestScore = -Infinity;
  let bestTau = -1, maxTau = -1;
  const bulletHazards = courtChip ? hazards.filter((h) => !h.isBullet) : hazards;
  for (let r = 0; r <= RADII.length; r++) {
    const radius = r === 0 ? 0 : RADII[r - 1];
    const dirs = r === 0 ? [[0, 0]] : DIRS;
    for (let di = 0; di < dirs.length; di++) {
      const dx = dirs[di][0] * radius, dy = dirs[di][1] * radius;
      const [cx, cy] = clampPos(px + dx, py + dy, W, H, pw, ph);

      const tau = safeTime(cx, cy, bulletHazards, pw, ph, invTicks);
      let score = tau * TAU_W;
      if (tau <= 3) score -= 4000;
      score -= shellPenalty(cx, cy, bodies, pw, ph);
      score -= pinPenalty(cx, cy, hazards, W, H);

      if (bossAlign) {
        const adx = Math.abs(cx - bossPredX);
        if (stallMode) {
          score -= Math.max(0, 90 - adx) * 3.0;
          score -= Math.abs(cy - (hugY + 50)) * 1.8;
        } else {
          score += Math.max(0, 36 - adx) * 2.4;
          score -= Math.max(0, adx - 36) * 1.1;
          const dyBand = cy - hugY;
          score -= Math.abs(dyBand) * (dyBand > 30 ? 3.2 : 2.2);
          if (passItems.length) {
            let ib = 0;
            for (let k = 0; k < passItems.length; k++) {
              const di2 = Math.hypot(passItems[k].pos[0] - cx, passItems[k].pos[1] - cy);
              ib += passItems[k].v / (di2 + 60);
            }
            score += Math.min(110, ib * 5);
          }
        }
      } else {
        const td = Math.hypot(target[0] - cx, target[1] - cy);
        score -= td * OBJ_W;
      }

      if (cy > H - 60) score -= (cy - (H - 60)) * 14;
      if (bossActive && cy > H - 160) score -= (cy - (H - 160)) * 5;
      const wallGap = Math.min(cx, W - cx, cy, H - cy);
      if (wallGap < 26) score -= (26 - wallGap) * 4;
      const cdx = Math.min(cx, W - cx), cdy = Math.min(cy, H - cy);
      if (cdx < 60 && cdy < 60) score -= (60 - cdx) * (60 - cdy) * 0.5;

      if (score > bestScore) { bestScore = score; bestMove = [dx, dy]; }
    }
  }

  return { action: { move: bestMove, upgrade_choice: null }, mem };
}

module.exports = {
  init() {
    return { stats: freshStats(), stall: 0 };
  },
  policy(obs, mem) {
    try {
      return policyInner(obs, mem);
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
