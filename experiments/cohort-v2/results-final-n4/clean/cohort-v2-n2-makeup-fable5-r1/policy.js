"use strict";
/**
 * Roguelike Skies policy v5 — receding-horizon path planning.
 *
 * Every tick:
 *  1. Predict all hazards (enemies, bullets, boss) linearly over HOR ticks with
 *     growing uncertainty margins.
 *  2. Backward value iteration over a space-time grid (cell, t): cost = hazard
 *     occupancy (huge) + proximity + edge/corner penalties + step cost; terminal
 *     cost = distance to the objective. Reach = REACH cells/tick (conservative
 *     vs the 40px speed cap).
 *  3. Execute the best first move (fine continuous candidates scored by exact
 *     short-horizon collision checks + the DP value of the cell they land in).
 *
 * Objective layer (stable, hysteresis in mem):
 *  - no boss: collect items / align under a safe-to-engage enemy
 *  - boss high: align under boss at standoff distance (DPS)
 *  - boss low (diving): retreat to the opposite side, wait it out
 */

const SPEED = 40;
const CELL = 12;
const HOR = 20;
const REACH = 2;           // cells per tick in the DP (24px <= 40px cap)
const BIG = 1e9;
const HUNT_DIST = 190; // hover distance below boss (all 5 streams hit)
const EXP_CAP = 99;      // exp collection level cap (debug knob)

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------- upgrade choice ----------
const UPG = {
  exp_smart: { s: 97, early: true },
  exp_basic: { s: 94, early: true },
  exp_quantum: { s: 96 },
  mag_well: { s: 88 },     // big pickup radius = passive exp income without risky chasing
  mag_basic: { s: 85 },
  drop_basic: { s: 55 },
  mix_econ: { s: 15 },
  coin_small: { s: 5 },
  pc_pierce: { s: 95 },      // without pierce, add screens eat all boss damage
  ms_split_m: { s: 93 },
  ms_split_s: { s: 90 },
  fr_cool: { s: 92 },
  fr_basic: { s: 88 },
  mix_vulcan: { s: 91 },
  mix_fire: { s: 84 },
  mix_terminal: { s: 89 },
  mix_perfect: { s: 94 },
  boss_hunter: { s: 92 },
  dmg_m: { s: 86 },
  dmg_s: { s: 80 },
  crit_lethal: { s: 85 },
  crit_aim: { s: 82 },
  sat_orbit: { s: 84 },
  sat_orbit_2: { s: 87 },
  elite_hunter: { s: 60 },
  kill_pulse_3: { s: 62 },
  kill_pulse: { s: 65 },
  bs_size_s: { s: 58 },
  bullet_crush: { s: 90 },
  shield_basic: { s: 86 },   // shield = insurance against boss slam one-shots
  shield_extra: { s: 88 },
  shield_rapid: { s: 89 },
  regen_basic: { s: 70 },
  heal_overflow: { s: 40 },
  kill_blood: { s: 45 },
  thorn_static: { s: 25 },
  timeflow_shield: { s: 68 },
  turncoat_shield: { s: 50 },
  heal_quick: { s: 14 },
  reroll_premium: { s: 74 },
};
const RARITY_SCORE = { green: 45, blue: 58, purple: 76, orange: 90 };

const OFFENSE_FIRST = false;
const SHIELD_AGGRO = false;
const DITHER = 0;

function chooseUpgrade(options, obs) {
  const p = obs.player;
  const hpFrac = (p.hp + p.shield_hp) / Math.max(1, p.max_hp + (p.shield_max || 0));
  const early = p.level <= 6;
  let best = 0, bestScore = -1e9;
  for (const o of options) {
    const u = UPG[o.id];
    let s = u ? u.s : (RARITY_SCORE[o.rarity] || 45);
    if (u && u.early && early && !OFFENSE_FIRST) s += 6;
    if (OFFENSE_FIRST && (o.id === "exp_smart" || o.id === "exp_basic" || o.id === "exp_quantum")) s -= 14;
    if (o.id === "heal_quick") {
      if (hpFrac < 0.3) s = 100; else if (hpFrac < 0.55) s = 75;
    }
    if (o.id === "shield_basic" || o.id === "shield_extra" || o.id === "shield_rapid") {
      if (hpFrac < 0.5) s += 20;
      if (!p.shield_max) s += 6;       // first shield is the slam insurance
    }
    if (s > bestScore) { bestScore = s; best = o.index; }
  }
  return best;
}

// ---------- hazards ----------
function buildHazards(obs, halfW, halfH) {
  const hz = [];
  for (const o of obs.objects) {
    if (o.type === "enemy" || o.type === "enemy_elite") {
      hz.push({
        x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
        mx: o.size[0] / 2 + halfW + 6, my: o.size[1] / 2 + halfH + 6,
        unc: 0.5, enemy: true,
      });
    } else if (o.type === "enemy_bullet") {
      hz.push({
        x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
        mx: o.size[0] / 2 + halfW + 2, my: o.size[1] / 2 + halfH + 2,
        unc: 0.08, enemy: false,
      });
    } else if (o.type === "boss" && !o.in_cutscene) {
      hz.push({
        x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
        mx: o.size[0] / 2 + halfW + 10, my: o.size[1] / 2 + halfH + 10,
        unc: 2.0, enemy: true, boss: true,
      });
    }
  }
  return hz;
}

/**
 * Space-time value iteration. Returns value[ ] at t=1 (cost-to-go from each cell
 * if I arrive there next tick) — lower is better.
 */
function planValue(hz, W, H, gx, gy, goalW, edgePen, repulsor) {
  const nx = Math.ceil(W / CELL), ny = Math.ceil(H / CELL);
  const n = nx * ny;
  // per-tick blocked masks + arrival proximity cost
  const blocked = [];
  const prox = [];
  for (let t = 1; t <= HOR; t++) {
    const b = new Uint8Array(n);
    const s = new Float64Array(n);
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      const qx = h.x + h.vx * t, qy = h.y + h.vy * t;
      const mx = h.mx + h.unc * t, my = h.my + h.unc * t;
      // hard blocked box
      {
        const x0 = Math.max(0, Math.ceil((qx - mx) / CELL - 0.5)), x1 = Math.min(nx - 1, Math.floor((qx + mx) / CELL - 0.5));
        const y0 = Math.max(0, Math.ceil((qy - my) / CELL - 0.5)), y1 = Math.min(ny - 1, Math.floor((qy + my) / CELL - 0.5));
        for (let cy = y0; cy <= y1; cy++) {
          const base = cy * nx;
          for (let cx = x0; cx <= x1; cx++) b[base + cx] = 1;
        }
      }
      // soft proximity ring (one cell fringe ~ +14px)
      {
        const fx = mx + 14, fy = my + 14;
        const x0 = Math.max(0, Math.ceil((qx - fx) / CELL - 0.5)), x1 = Math.min(nx - 1, Math.floor((qx + fx) / CELL - 0.5));
        const y0 = Math.max(0, Math.ceil((qy - fy) / CELL - 0.5)), y1 = Math.min(ny - 1, Math.floor((qy + fy) / CELL - 0.5));
        for (let cy = y0; cy <= y1; cy++) {
          const base = cy * nx;
          for (let cx = x0; cx <= x1; cx++) s[base + cx] += 25;
        }
      }
    }
    blocked.push(b);
    prox.push(s);
  }
  // static cell costs: edges/corners + optional radial repulsor (slam reach)
  const staticCost = new Float64Array(n);
  for (let cy = 0; cy < ny; cy++) {
    const yc = (cy + 0.5) * CELL;
    for (let cx = 0; cx < nx; cx++) {
      const xc = (cx + 0.5) * CELL;
      let c = 0;
      const ex = Math.min(xc, W - xc);
      if (ex < 40) c += (40 - ex) * edgePen.side;
      const eb = H - yc;
      if (eb < 60) c += (60 - eb) * edgePen.bottom;
      if (yc < 50) c += (50 - yc) * edgePen.top;
      if (repulsor) {
        const d = Math.hypot(xc - repulsor.x, yc - repulsor.y);
        if (d < repulsor.r) c += ((repulsor.r - d) / repulsor.r) * repulsor.w;
      }
      staticCost[cy * nx + cx] = c;
    }
  }
  // terminal: goal distance
  let next = new Float64Array(n);
  for (let cy = 0; cy < ny; cy++) {
    const yc = (cy + 0.5) * CELL;
    for (let cx = 0; cx < nx; cx++) {
      const xc = (cx + 0.5) * CELL;
      next[cy * nx + cx] = Math.hypot(gx - xc, gy - yc) * goalW + staticCost[cy * nx + cx];
    }
  }
  const tmp = new Float64Array(n);
  for (let t = HOR; t >= 1; t--) {
    // min over horizontal reach
    for (let cy = 0; cy < ny; cy++) {
      const base = cy * nx;
      for (let cx = 0; cx < nx; cx++) {
        let m = Infinity;
        const lo = Math.max(0, cx - REACH), hi = Math.min(nx - 1, cx + REACH);
        for (let xx = lo; xx <= hi; xx++) { const v = next[base + xx]; if (v < m) m = v; }
        tmp[base + cx] = m;
      }
    }
    const cur = new Float64Array(n);
    const b = blocked[t - 1], s = prox[t - 1];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const idx = cy * nx + cx;
        let m = Infinity;
        const lo = Math.max(0, cy - REACH), hi = Math.min(ny - 1, cy + REACH);
        for (let yy = lo; yy <= hi; yy++) { const v = tmp[yy * nx + cx]; if (v < m) m = v; }
        let cost = staticCost[idx] * 0.15 + s[idx];
        if (b[idx]) cost += BIG / t;
        cur[idx] = cost + m;
      }
    }
    next = cur;
  }
  return { value: next, nx, ny };
}

// exact continuous-space check, t = 1..3
function exactDanger(px, py, hz) {
  let d = 0;
  for (let i = 0; i < hz.length; i++) {
    const h = hz[i];
    if (Math.abs(h.x - px) > 200 || Math.abs(h.y - py) > 200) continue;
    for (let t = 1; t <= 3; t++) {
      const qx = h.x + h.vx * t, qy = h.y + h.vy * t;
      if (Math.abs(qx - px) < h.mx + h.unc * t && Math.abs(qy - py) < h.my + h.unc * t) {
        d += BIG / t;
        break;
      }
    }
  }
  return d;
}

// ---------- movement candidates ----------
const CAND = (() => {
  const c = [[0, 0]];
  for (const m of [SPEED, SPEED * 0.6, SPEED * 0.3, SPEED * 0.12]) {
    for (let k = 0; k < 16; k++) {
      const a = (Math.PI * 2 * k) / 16;
      c.push([Math.cos(a) * m, Math.sin(a) * m]);
    }
  }
  return c;
})();

function policyInner(obs, mem) {
  if (!mem || typeof mem !== "object") mem = {};
  if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
    return { action: { move: [0, 0], upgrade_choice: chooseUpgrade(obs.pending_upgrade.options, obs) }, mem };
  }

  const p = obs.player;
  const px = p.pos[0], py = p.pos[1];
  const halfW = p.size[0] / 2, halfH = p.size[1] / 2;
  const W = (obs.field && obs.field.w) || 360;
  const H = (obs.field && obs.field.h) || 640;

  const hz = buildHazards(obs, halfW, halfH);
  const enemies = [];
  const items = [];
  let boss = null;
  for (const o of obs.objects) {
    if (o.type === "enemy" || o.type === "enemy_elite") enemies.push(o);
    else if (o.type === "item") items.push(o);
    else if (o.type === "boss") boss = o;
  }

  // ---------- objective ----------
  const bossFight = !!(boss && !boss.in_cutscene);
  let gx = W / 2, gy = H * 0.8, goalW = 1.0;

  // item value scan
  let targetItem = null;
  const bossIsSlammy = bossFight && (boss.variant === "void" || boss.variant === "voidCore" ||
    (mem.dashy && mem.dashy[boss.variant]));
  {
    let bestS = -1e9;
    const minY = bossIsSlammy ? 300 : bossFight ? 250 : 110;
    const expBlocked = p.level >= EXP_CAP;
    const hpFrac = p.hp / Math.max(1, p.max_hp);
    for (const it of items) {
      if (it.pos[1] < minY) continue;
      const isExp = it.item_type === "exp_small" || it.item_type === "exp_medium" ||
        it.item_type === "exp_large" || it.item_type === "exp_huge" || it.item_type === "levelup";
      if (expBlocked && isExp) continue;
      const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
      const v = it.item_type === "exp_huge" ? 40 : it.item_type === "exp_large" ? 15 :
        it.item_type === "exp_medium" ? 5 : it.item_type === "exp_small" ? 2 :
        it.item_type === "heart" ? (hpFrac < 0.45 ? 70 : hpFrac < 0.8 ? 25 : 4) :
        it.item_type === "magnet" ? 10 : it.item_type === "levelup" ? 50 :
        it.item_type === "invincible" ? 15 : it.item_type === "bomb" ? 10 : 1.5;
      const urgency = (it.pos[1] > H - 160 ? 1.8 : 1) * (bossFight ? 1.6 : 1); // boss adds rain exp: level up
      const s = (v * urgency) / (30 + d);
      if (s > bestS) { bestS = s; targetItem = it; }
    }
  }

  if (bossFight) {
    const bSpeed = Math.hypot(boss.vel[0], boss.vel[1]);
    const bx = boss.pos[0] + boss.vel[0] * 4;
    const by = boss.pos[1] + boss.vel[1] * 4;
    const bHalfW = boss.size[0] / 2, bHalfH = boss.size[1] / 2;
    // threat model: known slammers by name; unknown variants are treated
    // cautiously on first contact, then trusted if no teleport-dash shows up.
    if (!mem.dashy) mem.dashy = {};
    if (!mem.bossSeen) mem.bossSeen = {};
    mem.bossSeen[boss.variant] = (mem.bossSeen[boss.variant] || 0) + 1;
    if (bSpeed > 30) mem.dashy[boss.variant] = true;
    const knownSafe = boss.variant === "azure" || boss.variant === "crimson";
    const slammy = !!mem.dashy[boss.variant] || boss.variant === "void" || boss.variant === "voidCore" ||
      (!knownSafe && mem.bossSeen[boss.variant] < 900);
    const hpFracNow = (p.hp + p.shield_hp) / Math.max(1, p.max_hp);
    const slamProof = p.shield_hp >= 2800 && p.hp >= p.max_hp * 0.8; // a full shield eats one slam
    let dist = slammy ? (slamProof && SHIELD_AGGRO ? (bHalfW < 50 ? 215 : 290) : (bHalfW < 50 ? 250 : 340)) : HUNT_DIST;
    if (hpFracNow < 0.4) dist += 110;                          // hurt: trade DPS for survival
    else if (!p.shield_max && hpFracNow < 0.75) dist += 55;    // shieldless and chipped: care
    // evade only when there is no room to sit below the boss
    const noRoomBelow = by + bHalfH + 150 > H - 36;
    let mode = mem.bossMode || "hunt";
    if (bSpeed > 12) mode = "flee";                  // dash in progress: unalign NOW
    else if (mode === "flee") mode = noRoomBelow ? "evade" : "hunt";
    else if (mode === "hunt" && noRoomBelow) mode = "evade";
    else if (mode === "evade" && by + bHalfH + 175 < H - 36) mode = "hunt";
    mem.bossMode = mode;
    if (mode === "hunt") {
      // lane-aware alignment: among offsets across the boss width, fire down the
      // corridor with the fewest add bodies (without pierce they absorb shots).
      const baseX = boss.pos[0] + boss.vel[0] * 6;
      let bestOff = 0, bestCost = Infinity;
      const span = bHalfW * 0.62;
      for (let k = -3; k <= 3; k++) {
        const off = (k / 3) * span;
        const laneX = baseX + off;
        if (laneX < 24 || laneX > W - 24) continue;
        let cost = Math.abs(off) * 0.002; // mild centering preference
        for (const e of enemies) {
          if (e.pos[1] <= by + bHalfH || e.pos[1] >= py) continue;
          if (Math.abs(e.pos[0] - laneX) < e.size[0] / 2 + 4) cost += 1 + e.hp / 2500;
        }
        if (cost < bestCost) { bestCost = cost; bestOff = off; }
      }
      // small strafe jitter on top so we never sit perfectly still
      const period = 44 + DITHER;
      const jit = ((obs.frame % period) < period / 2 ? 1 : -1) * Math.min(14, bHalfW * 0.2);
      gx = clamp(baseX + bestOff + jit, 24, W - 24);
      gy = clamp(by + bHalfH + dist, H * 0.5, H * 0.88);
      goalW = Math.abs(boss.pos[0] - px) > 80 ? 1.6 : 1.1; // chase hard when far off-column
      const itemFloor = slammy ? Math.max(430, by + bHalfH + 170) : 60; // never climb into slam range
      if (targetItem && targetItem.pos[1] > itemFloor &&
          Math.abs(targetItem.pos[0] - px) + Math.abs(targetItem.pos[1] - py) < 210) {
        gx = targetItem.pos[0]; gy = clamp(targetItem.pos[1], 60, H - 40);
      }
    } else if (mode === "flee") {
      // perpendicular escape from the dash line, far from the boss
      gx = px < bx ? clamp(bx - 220, 24, W - 24) : clamp(bx + 220, 24, W - 24);
      gy = clamp(py + (py < by ? -120 : 120), 60, H - 40);
      goalW = 1.8;
    } else {
      gx = bx < W / 2 ? W * 0.75 : W * 0.25;
      gy = clamp(by - 280, H * 0.15, H * 0.55);
      goalW = 1.4;
      if (targetItem && Math.abs(targetItem.pos[0] - px) + Math.abs(targetItem.pos[1] - py) < 210) {
        gx = targetItem.pos[0]; gy = clamp(targetItem.pos[1], 60, H - 40);
      }
    }
  } else {
    mem.bossMode = "hunt";
    // shooting target: prefer low-HP finishable enemies above us (kills -> drops -> exp)
    let shootTarget = null, bestS = -1e9;
    for (const e of enemies) {
      if (e.pos[1] > py - 110) continue;
      if (e.pos[1] < 10) continue;
      const s = e.pos[1] - Math.abs(e.pos[0] - px) * 0.9 - e.hp * 0.004;
      if (s > bestS) { bestS = s; shootTarget = e; }
    }
    if (targetItem) {
      gx = targetItem.pos[0] + targetItem.vel[0] * 2;
      gy = clamp(targetItem.pos[1] + targetItem.vel[1] * 2, 60, H - 30);
    } else if (shootTarget) {
      gx = shootTarget.pos[0] + shootTarget.vel[0] * 4;
      gy = H * 0.8;
    }
  }

  // ---------- plan ----------
  const edgePen = { side: 1.0, bottom: 3.2, top: 1.5 };
  let repulsor = null;
  if (bossFight && bossIsSlammy) {
    // soft keep-out around slam-capable bosses (teleport-dash reach ~300px);
    // a static-bullet lattice means the trap-then-slam attack is coming: stronger.
    let staticBullets = 0;
    for (const o of obs.objects) {
      if (o.type === "enemy_bullet" && Math.abs(o.vel[0]) < 0.2 && Math.abs(o.vel[1]) < 0.2) staticBullets++;
    }
    if (staticBullets > 14) repulsor = { x: boss.pos[0], y: boss.pos[1], r: 330, w: 55 };
  }
  const { value, nx, ny } = planValue(hz, W, H, gx, gy, goalW, edgePen, repulsor);

  let best = [0, 0], bestScore = -1e18;
  for (let i = 0; i < CAND.length; i++) {
    const c = CAND[i];
    const nxp = clamp(px + c[0], halfW, W - halfW);
    const nyp = clamp(py + c[1], halfH, H - halfH);
    let score = -exactDanger(nxp, nyp, hz) * 0.001;
    const cx = Math.min(nx - 1, Math.max(0, Math.floor(nxp / CELL)));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor(nyp / CELL)));
    score -= value[cy * nx + cx];
    score -= Math.hypot(gx - nxp, gy - nyp) * 0.05; // sub-cell tiebreak
    if (score > bestScore) { bestScore = score; best = c; }
  }

  return { action: { move: best, upgrade_choice: null }, mem };
}

function policy(obs, mem) {
  try {
    return policyInner(obs, mem);
  } catch (e) {
    return { action: { move: [0, 0], upgrade_choice: 0 }, mem: mem || {} };
  }
}

module.exports = { init() { return {}; }, policy };
