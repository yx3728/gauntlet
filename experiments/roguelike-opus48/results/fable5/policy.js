"use strict";
/**
 * Roguelike Skies policy (final, "v30").
 *
 * Movement: candidate trajectories scored by exact swept rect-rect collision
 * against linearly-predicted hazards over a 20-tick horizon; goal terms (target
 * column, items, boss positioning) only break ties between safe paths. Strategic
 * layers handle what the local planner can't see: future-traffic column
 * relocation, escalating wall-linger costs with committed escapes, altitude
 * discipline around bosses, a critical-HP retreat to the calmest column, and a
 * point-blank dive while invincibility lasts.
 *
 * Drafting: DPS multipliers (multishot/pierce/fire-rate/damage) and the exp
 * economy early in TIME; shields/heals/lifesteal when getting hit or low; on
 * spawn-thin runs the exp engines are devalued (nothing to amplify) in favor of
 * sustain. Emergency full-heal picks dominate when HP is critical.
 *
 * Measured (speed_cap 40, max_steps 90k): 131/139 wins (94.2%) across three
 * disjoint practice seed sets; fastest clear step 11972, median ~43.7k.
 */

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------- upgrades ----------
const UPGRADE_SCORE = {
  ms_split_l: 120, ms_split_m: 110, ms_split_s: 100,
  pc_pierce: 105,                       // pierce re-hits bosses while passing through: boss melter
  fr_turbo: 94, fr_cool: 88, fr_basic: 82,
  mix_perfect: 96, mix_ascend: 96, mix_vulcan: 88, mix_terminal: 86, mix_fire: 72,
  dmg_l: 84, dmg_m: 78, dmg_s: 70,
  crit_lethal: 76, crit_aim: 74,
  boss_hunter: 90,
  sat_orbit: 65,
  bs_size_s: 75, bs_size_m: 78,         // longer/wider bullets: more pierce overlap
  elite_hunter: 52,
  bullet_crush: 92,
  exp_quantum: 115, exp_smart: 75, exp_basic: 58,
  mag_hole: 60, mag_well: 48, mag_basic: 44,
  drop_basic: 38,
  reroll_premium: 55,
  kill_pulse: 30, kill_pulse_3: 62,
  timeflow_shield: 47,
  shield_extra: 72, shield_basic: 72,
  regen_basic: 55,
  heal_overflow: 32, kill_blood: 58, kill_butcher: 85,
  thorn_static: 8, thorn_blaze: 10,
  turncoat_shield: 18,
  heal_quick: 14,
  coin_small: 2, mix_econ: 4,
};
const RARITY_SCORE = { green: 0, blue: 2, purple: 4, orange: 6 };

function scoreUpgrade(opt, obs, m) {
  const id = String(opt.id || "");
  let s = UPGRADE_SCORE.hasOwnProperty(id) ? UPGRADE_SCORE[id] : 45 + (RARITY_SCORE[opt.rarity] || 0) * 8;
  s += (RARITY_SCORE[opt.rarity] || 0);
  const lvl = obs.player.level || 1;
  // on spawn-thin runs the exp economy has nothing to amplify: pivot to DPS/sustain
  const thin = m && m.kills60 != null && m.kills60 < 25 && obs.wave >= 3;
  const expEngine = id === "exp_basic" || id === "exp_smart" || id === "exp_quantum" ||
    id === "mag_basic" || id === "mag_well" || id === "mag_hole" || id === "drop_basic";
  if (thin && expEngine) s *= 0.5;
  // exp/magnet engines compound: value is front-loaded in TIME (level-keying
  // self-perpetuates on slow runs, which is exactly when exp is worthless)
  const tSec = (obs.time_ms || 0) / 1000;
  if (id === "exp_basic") s += tSec < 130 ? 32 : tSec < 240 ? 12 : -10;
  if (id === "exp_smart") s += tSec < 200 ? 27 : tSec < 320 ? 8 : -10;
  if (id === "mag_basic") s += tSec < 150 ? 26 : 6;
  if (id === "mag_well") s += tSec < 260 ? 20 : 4;
  if (thin) {
    if (id === "regen_basic") s += 22;
    if (id === "shield_basic" || id === "shield_extra") s += 15;
    if (id === "kill_blood" || id === "kill_butcher") s += 10;
  }
  const noShield = obs.player.shield_max <= 0;
  if ((id === "shield_basic" || id === "shield_extra") && noShield) {
    s += 25;
    if (obs.wave >= 2) s += 10;
    if (m && m.hitsTaken >= 2) s += 25; // we are demonstrably getting hit: buy EHP
  }
  const hpFrac = obs.player.hp / Math.max(1, obs.player.max_hp);
  if (hpFrac < 0.7) {
    if (id === "heal_quick") s += 40;
  }
  if (hpFrac < 0.45) {
    if (id === "heal_quick") s += 120;  // a full heal + shield must beat everything when low
    if (id === "shield_basic" || id === "shield_extra") s += 60;
    if (id === "regen_basic") s += 30;
    if (id === "kill_blood" || id === "kill_butcher") s += 20;
  }
  if (hpFrac < 0.25 && id === "heal_quick") s += 100;
  return s;
}

function chooseUpgrade(obs, m) {
  const pu = obs.pending_upgrade;
  if (!pu || !pu.options || !pu.options.length) return null;
  let best = pu.options[0].index, bestScore = -Infinity;
  for (const o of pu.options) {
    const s = scoreUpgrade(o, obs, m);
    if (s > bestScore) { bestScore = s; best = o.index; }
  }
  return best;
}

// ---------- movement ----------
const HORIZON = 20;

function buildHazards(obs, px, py, R) {
  const hz = [];
  // while invincible for longer than the planning horizon, bullets cannot hurt us
  const ghostBullets = (obs.player.invincible_ms || 0) > 900;
  for (const o of obs.objects) {
    let mx, body; // extra margin
    if (o.type === "enemy_bullet") { if (ghostBullets) continue; mx = 2; body = false; }
    else if (o.type === "enemy" || o.type === "enemy_elite") { mx = ghostBullets ? 2 : 5; body = true; }
    else if (o.type === "boss") {
      const sp = Math.hypot(o.vel[0], o.vel[1]);
      mx = ghostBullets ? 6 : 14 + Math.min(sp * 2.5, 26);
      body = true;
    }
    else continue;
    const dx = o.pos[0] - px, dy = o.pos[1] - py;
    if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
    hz.push({
      x0: o.pos[0], y0: o.pos[1], vx: o.vel[0], vy: o.vel[1],
      hx: o.size[0] / 2 + mx, hy: o.size[1] / 2 + mx,
      r: Math.max(o.size[0], o.size[1]) / 2 + mx, // for columnRisk
      body,
    });
  }
  return hz;
}

// Long-range "arrival risk" of standing near (x, y) over the next T ticks:
// how much bullet traffic will pass through this neighborhood?
function columnRisk(x, y, hazardsAll, T) {
  let d = 0;
  for (let i = 0; i < hazardsAll.length; i++) {
    const h = hazardsAll[i];
    // closest approach of the hazard's path to (x, y) within [0, T]
    const rx = h.x0 - x, ry = h.y0 - y;
    const vv = h.vx * h.vx + h.vy * h.vy;
    let s = vv > 1e-9 ? -(rx * h.vx + ry * h.vy) / vv : 0;
    if (s < 0) s = 0; else if (s > T) s = T;
    const cx = rx + h.vx * s, cy = ry + h.vy * s;
    const dist = Math.sqrt(cx * cx + cy * cy);
    const reach = h.r + 34;
    if (dist < reach) {
      d += (h.body ? 1.6 : 1.0) * (1 - dist / reach) / (1 + s * 0.04);
    }
  }
  return d;
}

// Swept rect-rect risk for the player moving (pvx,pvy) during tick t -> t+1.
// Exact axis-overlap windows on relative motion; near-miss is only a tiebreaker.
function riskSwept(x, y, pvx, pvy, t, hazards, phx, phy) {
  let d = 0;
  const decay = 1 / (1 + t * 0.18);
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const rx = (h.x0 + h.vx * t) - x, ry = (h.y0 + h.vy * t) - y;
    const rvx = h.vx - pvx, rvy = h.vy - pvy;
    const ax = h.hx + phx, ay = h.hy + phy;
    // quick reject
    const reachX = Math.abs(rvx) + ax + 14, reachY = Math.abs(rvy) + ay + 14;
    if (rx > reachX || rx < -reachX || ry > reachY || ry < -reachY) continue;
    // axis overlap windows for s in [0,1]: |rx + rvx*s| <= ax
    let sx0, sx1;
    if (Math.abs(rvx) < 1e-9) { if (Math.abs(rx) <= ax) { sx0 = 0; sx1 = 1; } else { sx0 = 2; sx1 = -1; } }
    else { const a = (-ax - rx) / rvx, b = (ax - rx) / rvx; sx0 = Math.min(a, b); sx1 = Math.max(a, b); }
    let sy0, sy1;
    if (Math.abs(rvy) < 1e-9) { if (Math.abs(ry) <= ay) { sy0 = 0; sy1 = 1; } else { sy0 = 2; sy1 = -1; } }
    else { const a = (-ay - ry) / rvy, b = (ay - ry) / rvy; sy0 = Math.min(a, b); sy1 = Math.max(a, b); }
    const s0 = Math.max(sx0, sy0, 0), s1 = Math.min(sx1, sy1, 1);
    if (s0 <= s1) {
      d += (h.body ? 30000 : 9000) * decay;
      continue;
    }
    // near miss: Chebyshev clearance at endpoints and closest L2 approach
    const vv = rvx * rvx + rvy * rvy;
    let s = vv > 1e-9 ? -(rx * rvx + ry * rvy) / vv : 0;
    if (s < 0) s = 0; else if (s > 1) s = 1;
    let minC = Infinity;
    for (const ss of [0, s, 1]) {
      const cx = Math.abs(rx + rvx * ss) - ax, cy = Math.abs(ry + rvy * ss) - ay;
      const c = Math.max(cx, cy, 0);
      if (c < minC) minC = c;
    }
    if (minC < 12) {
      const frac = 1 - minC / 12;
      d += (h.body ? 260 : 130) * decay * frac * frac;
    }
  }
  return d;
}

// ---------- targeting ----------
function getBoss(obs) {
  for (const o of obs.objects) if (o.type === "boss") return o;
  return null;
}

function pickEnemyTarget(obs, bossX) {
  const px = obs.player.pos[0], py = obs.player.pos[1];
  let best = null, bestScore = -Infinity;
  for (const o of obs.objects) {
    if (o.type !== "enemy" && o.type !== "enemy_elite") continue;
    if (o.pos[1] >= py - 15) continue;
    let alignCost;
    if (bossX != null) {
      // during a boss: prefer adds near the boss column so the pierced stream hits both
      alignCost = Math.abs(o.pos[0] - bossX) * 0.6 + Math.abs(o.pos[0] - px) * 0.35;
    } else {
      alignCost = Math.abs(o.pos[0] - px) * 0.8;
    }
    const s = o.pos[1] - alignCost - (o.hp / 1000) * 6 + (o.type === "enemy_elite" ? 40 : 0);
    if (s > bestScore) { bestScore = s; best = o; }
  }
  if (!best) return null;
  const flight = Math.max(0, (py - best.pos[1]) / 8.5);
  return { x: best.pos[0] + best.vel[0] * Math.min(flight, 40) * 0.6 };
}

const ITEM_VALUE = {
  exp_small: 1, exp_medium: 3, exp_large: 8, exp_huge: 20,
  heart: 6, bomb: 8, magnet: 9, coin: 0.5, levelup: 40, invincible: 8,
};

function pickItem(obs, bulletCount) {
  const px = obs.player.pos[0], py = obs.player.pos[1];
  let best = null, bestScore = -Infinity, bestV = 0;
  for (const o of obs.objects) {
    if (o.type !== "item") continue;
    let v = ITEM_VALUE.hasOwnProperty(o.item_type) ? ITEM_VALUE[o.item_type] : (o.exp_value || 1);
    if (o.item_type === "heart" && obs.player.hp < obs.player.max_hp * 0.6) v = 18;
    // a bomb wipes every enemy bullet on screen: the hotter the field, the more it's worth
    if (o.item_type === "bomb") v = 8 + Math.min((bulletCount || 0) * 0.3, 24);
    const d = Math.hypot(o.pos[0] - px, o.pos[1] - py);
    const s = v * 28 - d;
    if (s > bestScore) { bestScore = s; best = o; bestV = v; }
  }
  return best ? { item: best, value: bestV } : null;
}

module.exports = {
  init() {
    return { dmgSeen: 1000, streamSeen: 1, lastVx: 0, lastVy: 0, hitsTaken: 0, lastEhp: null, strafeDir: 1, strafeT: 0 };
  },

  policy(obs, mem) {
    try {
      const m = mem && typeof mem === "object" ? mem : { dmgSeen: 1000, streamSeen: 1, lastVx: 0, lastVy: 0, hitsTaken: 0, lastEhp: null, strafeDir: 1, strafeT: 0 };
      const ehp = obs.player.hp + (obs.player.shield_hp || 0);
      if (m.lastEhp != null && ehp < m.lastEhp - 1) m.hitsTaken = (m.hitsTaken || 0) + 1;
      m.lastEhp = ehp;
      // rolling kill rate (per 60s) to detect spawn-thin runs (sampled every 30 ticks)
      if (!m.killLog) m.killLog = [];
      const curKills = (obs.reward_info && obs.reward_info.kills) || 0;
      if (m.killLog.length === 0 || obs.frame - m.killLog[m.killLog.length - 1][0] >= 30) {
        m.killLog.push([obs.frame, curKills]);
        while (m.killLog.length > 2 && m.killLog[0][0] < obs.frame - 3600) m.killLog.shift();
      }
      m.kills60 = curKills - m.killLog[0][1];
      const upgrade_choice = chooseUpgrade(obs, m);
      const p = obs.player;
      const px = p.pos[0], py = p.pos[1];
      const W = (obs.field && obs.field.w) || 360;
      const H = (obs.field && obs.field.h) || 640;
      const playerR = Math.max(p.size[0], p.size[1]) / 2;
      const phx = p.size[0] / 2, phy = p.size[1] / 2;
      const cap = 40;

      // wall-linger memory: walls are local minima that become traps
      const nearWallNow = Math.min(px, W - px) < 55 || py > H - 50 || py < 70;
      m.wallTicks = nearWallNow ? (m.wallTicks || 0) + 1 : Math.max(0, (m.wallTicks || 0) - 2);
      // escape mode: if pinned at a wall too long, force a committed run to mid-field
      if (m.escapeT > 0) {
        m.escapeT--;
        if (!nearWallNow && Math.abs(px - W / 2) < 80) m.escapeT = 0;
      } else if (m.wallTicks > 90) {
        m.escapeT = 50;
        m.wallTicks = 0;
      }

      // --- DPS proxy ---
      const spawnedSet = new Set(obs.spawned || []);
      let streams = 0;
      for (const o of obs.objects) {
        if (o.type === "player_bullet") {
          if (o.dmg > m.dmgSeen) m.dmgSeen = o.dmg;
          if (spawnedSet.has(o.id)) streams++;
        }
      }
      if (streams > m.streamSeen) m.streamSeen = streams;
      const shotsPerSec = 1000 / Math.max(60, p.shoot_interval_ms || 420);
      const dpsProxy = shotsPerSec * m.dmgSeen * Math.min(m.streamSeen, 3) * (p.pierce ? 5 : 1);

      const hazards = buildHazards(obs, px, py, 380);
      const hazardsAll = buildHazards(obs, px, py, 1e9);
      const boss = getBoss(obs);
      let bulletCount = 0;
      for (const o of obs.objects) if (o.type === "enemy_bullet") bulletCount++;
      const itemPick = pickItem(obs, bulletCount);

      // ----- desired position -----
      let desX, desY;
      const bossLive = boss && !boss.in_cutscene;
      // commit to the boss only when we can plausibly kill it within ~90s;
      // otherwise keep farming adds (levels are DPS) while chipping opportunistically
      const focusBoss = bossLive && (dpsProxy > boss.hp / 150 || (boss.hp / boss.max_hp) < 0.15);
      // strafe sweep across the boss hit window so aimed shots trail behind us
      m.strafeT = (m.strafeT || 0) + 1;
      if (m.strafeT > 140) { m.strafeT = 0; m.strafeDir = -(m.strafeDir || 1); }
      if (boss && boss.in_cutscene) {
        desX = W / 2; desY = H - 170;
      } else if (bossLive && focusBoss) {
        const bw = boss.size[0];
        const overlapDist = clamp(bw * 3.2, 200, 330);
        const sweep = (m.strafeDir || 1) * (bw / 2 + 20);
        desX = boss.pos[0] + boss.vel[0] * 6 + sweep;
        desY = clamp(boss.pos[1] + boss.size[1] / 2 + overlapDist, 360, H - 170);
      } else {
        const t = pickEnemyTarget(obs, bossLive ? boss.pos[0] : null);
        if (t) { desX = t.x; desY = H - 190; }
        else if (bossLive) {
          const bw = boss.size[0];
          const sweep = (m.strafeDir || 1) * (bw / 2 + 20);
          desX = boss.pos[0] + boss.vel[0] * 6 + sweep;
          desY = clamp(boss.pos[1] + boss.size[1] / 2 + clamp(bw * 3.2, 200, 330), 360, H - 170);
        } else { desX = W / 2; desY = H - 190; }
      }
      // items adjust the goal
      if (itemPick && !(boss && boss.in_cutscene)) {
        const it = itemPick.item, v = itemPick.value;
        const di = Math.hypot(it.pos[0] - px, it.pos[1] - py);
        const tooHigh = boss ? (it.pos[1] < 250) : (it.pos[1] < 140);
        const chase = (focusBoss ? (v >= 9 || di < 120) : (v >= 9 || di < 260)) && !tooHigh;
        if (chase) {
          desX = it.pos[0] + it.vel[0] * 4;
          desY = clamp(it.pos[1] + it.vel[1] * 4, 200, H - 120);
        }
      }
      // altitude discipline only when the boss rides high
      let bossBottom = null;
      if (boss) {
        bossBottom = boss.pos[1] + boss.size[1] / 2;
        if (boss.pos[1] < H * 0.45) {
          desY = Math.max(desY, Math.min(bossBottom + 60, H - 170));
        }
        if (py < bossBottom + 30 && boss.pos[1] < H * 0.55) {
          const side = px >= boss.pos[0] ? 1 : -1;
          desX = clamp(boss.pos[0] + side * (boss.size[0] / 2 + 120), 30, W - 30);
          desY = clamp(py + 90, 90, H - 90);
        }
      }
      // invincibility window: park point-blank under the boss, full fan on target
      if (bossLive && (p.invincible_ms || 0) > 900) {
        desX = boss.pos[0] + boss.vel[0] * 4;
        desY = clamp(bossBottom + 60, 90, H - 60);
      }
      desX = clamp(desX, 70, W - 70);
      desY = clamp(desY, 90, H - 60);

      // committed wall escape overrides other goals
      let goalWeight = 1;
      if (m.escapeT > 0) {
        desX = W / 2;
        desY = Math.min(desY, H - 150);
        goalWeight = 4;
      }
      // critical HP: abandon objectives, drift to the calmest column and recover
      if (ehp < 900 && (p.invincible_ms || 0) <= 900) {
        let bestCol = W / 2, bestColScore = Infinity;
        for (let cx = 70; cx <= W - 70; cx += 20) {
          const cost = columnRisk(cx, H - 210, hazardsAll, 90) * 80 + Math.abs(cx - px) * 0.35;
          if (cost < bestColScore) { bestColScore = cost; bestCol = cx; }
        }
        desX = bestCol;
        desY = H - 210;
        goalWeight = Math.max(goalWeight, 1.5);
      }

      // ----- strategic relocation: only when our neighborhood is about to saturate -----
      // If future bullet traffic where we are (and where we're headed) is heavy,
      // divert to the nearest calm column; otherwise leave the goal alone.
      if (m.escapeT <= 0) {
        const T = 70;
        const crHere = columnRisk(px, py, hazardsAll, T);
        const crDes = columnRisk(desX, desY, hazardsAll, T);
        // commit to an escape column for a stretch once chosen
        if (m.colHold > 0 && m.lastCol != null) {
          m.colHold--;
          const crCommitted = columnRisk(m.lastCol, desY, hazardsAll, T);
          if (crCommitted < Math.max(crHere, 1.0)) {
            desX = m.lastCol;
          } else { m.colHold = 0; m.lastCol = null; }
        }
        if (!(m.colHold > 0) && Math.max(crHere, crDes) > 1.8) {
          let bestCol = desX, bestColScore = Infinity;
          for (let cx = 40; cx <= W - 40; cx += 20) {
            const cr = columnRisk(cx, desY, hazardsAll, T);
            let cost = cr * 90 + Math.abs(cx - desX) * 0.5 + Math.abs(cx - px) * 0.6;
            if (cx < 80) cost += (80 - cx) * 1.2;
            if (cx > W - 80) cost += (cx - (W - 80)) * 1.2;
            if (cost < bestColScore) { bestColScore = cost; bestCol = cx; }
          }
          desX = bestCol;
          m.lastCol = bestCol;
          m.colHold = 18;
        }
      }

      // ----- candidate trajectories -----
      const cands = [{ vx: 0, vy: 0, dur: 1 }];
      const gx = desX - px, gy = desY - py;
      const gd = Math.hypot(gx, gy);
      if (gd > 1) {
        const s = Math.min(cap, gd);
        cands.push({ vx: (gx / gd) * s, vy: (gy / gd) * s, dur: Math.min(3, Math.ceil(gd / s)) });
        const s2 = Math.min(14, gd);
        cands.push({ vx: (gx / gd) * s2, vy: (gy / gd) * s2, dur: 2 });
      }
      const DIRS = 16;
      for (let i = 0; i < DIRS; i++) {
        const a = (2 * Math.PI * i) / DIRS;
        const ca = Math.cos(a), sa = Math.sin(a);
        cands.push({ vx: ca * 14, vy: sa * 14, dur: 2 });
        cands.push({ vx: ca * 40, vy: sa * 40, dur: 1 });
        cands.push({ vx: ca * 40, vy: sa * 40, dur: 3 });
        cands.push({ vx: ca * 40, vy: sa * 40, dur: 5 });
      }

      // two passes: first find the minimum achievable risk, then trade off goals
      const evals = [];
      let minRisk = Infinity;
      for (const c of cands) {
        let x = px, y = py, risk = 0;
        for (let t = 0; t < HORIZON; t++) {
          let vx = 0, vy = 0;
          if (t < c.dur) {
            vx = c.vx; vy = c.vy;
            const nx = clamp(x + vx, playerR, W - playerR);
            const ny = clamp(y + vy, playerR, H - playerR);
            vx = nx - x; vy = ny - y;
          }
          risk += riskSwept(x, y, vx, vy, t, hazards, phx, phy);
          x += vx; y += vy;
          if (risk > 5e7) break;
        }
        evals.push({ c, x, y, risk });
        if (risk < minRisk) minRisk = risk;
      }
      const goalW = goalWeight;

      let bestMove = [0, 0], bestScore = -Infinity;
      const wallEscalation = Math.min(m.wallTicks || 0, 60) * 5; // lingering at walls grows intolerable
      for (const e of evals) {
        const { c, x, y, risk } = e;
        let s = -risk;
        s -= Math.abs(x - desX) * 1.15 * goalW;
        s -= Math.abs(y - desY) * 0.7 * goalW;
        const wallX = Math.min(x, W - x), wallY = Math.min(y, H - y);
        if (wallX < 60) s -= (60 - wallX) * 2.0;
        if (wallY < 55) s -= (55 - wallY) * 2.5;
        if (y < 90) s -= (90 - y) * 3;
        if (y > H - 150) s -= (y - (H - 150)) * 2.2; // floor band: downward dodges dead-end
        if (wallX + wallY < 130) s -= (130 - wallX - wallY) * 2.5;
        // escalating cost for staying in the wall band once we've lingered
        if (wallX < 55 || wallY < 50) s -= wallEscalation;
        // mid-band preference
        if (x < 80) s -= (80 - x) * 1.0;
        if (x > W - 80) s -= (x - (W - 80)) * 1.0;
        if (boss && boss.pos[1] < H * 0.55 && bossBottom != null && y < bossBottom + 30) {
          s -= (bossBottom + 30 - y) * 2.2;
        }
        // penalize requesting movement that the walls nullify
        const eff = Math.hypot(x - px, y - py);
        const req = Math.hypot(c.vx, c.vy) * Math.min(c.dur, HORIZON);
        if (req > 1 && eff < req * 0.3) s -= 25;
        // hysteresis: keep moving the same way (reduce dithering)
        s += (c.vx * m.lastVx + c.vy * m.lastVy) * 0.004;
        if (s > bestScore) { bestScore = s; bestMove = [c.vx, c.vy]; }
      }

      m.lastVx = bestMove[0]; m.lastVy = bestMove[1];
      return { action: { move: bestMove, upgrade_choice }, mem: m };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem: mem };
    }
  },
};
