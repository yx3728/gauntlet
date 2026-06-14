"use strict";
/**
 * Roguelike Skies policy — v2
 * Strategy (discovered by observation):
 *  - DPS scales super-linearly with LEVEL; minions+XP spawn during boss fights.
 *    => LEVELING SPEED is the #1 lever. Collect XP aggressively, kill swarms, take exp/magnet early.
 *  - Autofire is straight UP => hug the boss's X-corridor to keep damage on it.
 *  - Survive the bullet hell with a lookahead dodge + early shield; shield then snowballs.
 */

const SPEED = 40;        // assumed speed_cap (eval default)
const H = 15;            // lookahead horizon (ticks)
const MARGIN = 5;        // extra safety margin around player AABB (px)

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// candidate move vectors (per-tick displacement), magnitude <= SPEED
const CANDS = (() => {
  const out = [[0, 0]];
  const dirs = 28;
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    for (const m of [SPEED, SPEED * 0.62, SPEED * 0.3]) out.push([cx * m, cy * m]);
  }
  return out;
})();

function isThreat(o) {
  return o.type === "enemy_bullet" || o.type === "enemy" || o.type === "enemy_elite" || o.type === "boss";
}

// escape directions (10) at full speed, for evaluating whether a destination is boxed in
const ESCAPE_DIRS = (() => {
  const out = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; out.push([Math.cos(a) * SPEED, Math.sin(a) * SPEED]); }
  return out;
})();

// defensive upgrades — we want ~a buffer + an engine piece, but NOT to over-invest (that yields a
// 100k+ shield while DPS lags => boss timeouts). Diminishing returns after a few.
const DEF_SET = new Set([
  "shield_basic", "timeflow_shield", "heal_overflow", "heal_overflow_2", "kill_blood",
  "turncoat_shield", "heal_quick", "regen_nano", "regen_basic", "thorn_static",
]);
function isDefensive(o) {
  if (DEF_SET.has(o.id)) return true;
  const d = (o.desc || "") + (o.name || "");
  return /减速|过量治疗|护盾|吸血|回复|修复|回满|无敌/.test(d) && !/伤害|射速/.test(d);
}

// ---------- upgrade preference ----------
// Strategy: secure a shield/sustain source EARLY (heal_quick is the common one; shield_basic is
// rare but best), then stack DPS to spin the lifesteal/overheal -> shield snowball that wins games.
function upgradeScore(o, ctx) {
  const id = o.id || "";
  const rar = { green: 0, blue: 1, purple: 2, orange: 3 }[o.rarity] || 0;
  const noShield = ctx.noShield;
  let s = 0;
  switch (id) {
    // ---- shield / sustain engine ----
    case "shield_basic": s = 120; break;                      // shield=maxHP + 3%/s overstacking regen (best)
    case "timeflow_shield": s = 122; break;                   // slow nearby bullets 50% (huge dodging aid)
    case "heal_overflow_2": s = 116; break;                   // overheal->shield (purple engine)
    case "heal_overflow": s = 108; break;                     // overheal->shield (engine)
    case "kill_blood": s = 104; break;                        // lifesteal -> feeds overflow shield
    case "turncoat_shield": s = 110; break;                   // shield (purple)
    case "heal_quick": s = ctx.shieldLow ? (noShield ? 118 : 86) : 30; break; // buffer (don't overwrite big shield)
    case "regen_nano": s = 100; break;                        // strong regen (engine)
    case "regen_basic": s = 90; break;                        // regen -> feeds overflow (engine)
    case "thorn_static": s = 36; break;
    // ---- DPS / kill-throughput (kills swarms => XP => snowball; kills bosses => win) ----
    case "mix_perfect": s = 134; break;                       // ALL stats (orange)
    case "mix_ascend": s = 126; break;                        // combo (orange)
    case "mix_vulcan": s = 116; break;                        // combo (purple)
    case "mix_terminal": s = 112; break;                      // +15% dmg +25% crit (purple)
    case "fr_turbo": s = 120; break;                          // big fire rate
    case "fr_cool": s = 110; break;                           // +64% rate
    case "fr_basic": s = 100; break;                          // +32% rate
    case "ms_split_l": s = 122; break;                        // many-way
    case "ms_split_m": s = 114; break;                        // 5-way
    case "ms_split_s": s = 104; break;                        // 3-way
    case "boss_hunter": s = 112; break;                       // anti-boss dmg (serves the goal)
    case "sat_orbit": s = 116; break;                         // +2 HOMING satellites (boss DPS while dodging)
    case "pc_pierce": s = 98; break;                          // pierce (swarm clear => XP)
    case "kill_pulse": s = 100; break;                        // explosion on kill (purple, swarm clear)
    case "kill_pulse_3": s = 90; break;                       // explosion on kill (blue)
    case "dmg_m": s = 94; break;                              // +20% dmg
    case "dmg_s": s = 80; break;                              // +12% dmg
    case "mix_fire": s = 92; break;                           // +8% dmg +15% rate
    case "crit_lethal": s = 90; break;                        // crit damage
    case "crit_aim": s = 68; break;                           // +20% crit
    case "bullet_void": s = 84; break;
    case "bs_size_s": s = 60; break;                          // +100% bullet size
    case "elite_hunter": s = 70; break;
    // ---- xp / utility ----
    case "reroll_premium": s = 98; break;                     // next panel guaranteed purple/orange
    case "exp_smart": s = ctx.early ? 94 : 40; break;         // +200% exp
    case "exp_basic": s = ctx.early ? 84 : 34; break;         // +100% exp
    case "mag_hole": s = ctx.early ? 86 : 64; break;
    case "mag_well": s = ctx.early ? 84 : 62; break;
    case "mag_basic": s = ctx.early ? 82 : 60; break;         // +175% magnet
    case "drop_basic": s = 48; break;
    case "coin_small": s = 18; break;
    case "mix_econ": s = 22; break;
    default: {
      const d = (o.desc || "") + (o.name || "");
      if (/减速/.test(d)) s = 112;                             // slow (timeflow-like)
      else if (/过量治疗/.test(d)) s = 108;                    // overheal->shield (engine)
      else if (/护盾/.test(d)) s = noShield ? 112 : 96;        // shield
      else if (/吸血/.test(d)) s = 104;                        // lifesteal (engine)
      else if (/回复|修复|回满|生命|无敌/.test(d)) s = noShield ? 96 : 74; // heal/regen
      else if (/Boss|首领/.test(d)) s = 104;                   // anti-boss
      else if (/精英/.test(d)) s = 72;
      else if (/射速|连射/.test(d)) s = 100;
      else if (/分裂|弹道|多重/.test(d)) s = 100;
      else if (/经验/.test(d)) s = ctx.early ? 90 : 38;
      else if (/拾取|磁/.test(d)) s = ctx.early ? 82 : 60;
      else if (/卫星/.test(d)) s = 110;                        // homing satellites (position-independent DPS)
      else if (/伤害|暴击|倍率|穿透|火力|爆炸|脉冲/.test(d)) s = 86;
      else if (/重掷/.test(d)) s = 92;
      else if (/金币/.test(d)) s = 20;
      else s = 44;
    }
  }
  // Diminishing returns on defensive upgrades — but ONLY once the shield engine is clearly working
  // (big shield). If shield is still low (we're getting overwhelmed), keep stacking survival.
  // This fixes both: low-shield deaths (no cap => more survival) AND high-shield timeouts (cap => DPS).
  if (isDefensive(o) && !noShield && ctx.shieldHigh) {
    const over = Math.max(0, ctx.defTaken - 3);
    s -= over * 34;
  }
  return s + rar * 3;
}

function pickUpgrade(options, obs, mem) {
  const p = obs.player;
  const ctx = {
    hpFrac: p.hp / Math.max(1, p.max_hp),
    early: p.level < 12,
    noShield: (p.shield_max || 0) <= 0 && (p.shield_hp || 0) < 200,
    shieldLow: (p.shield_hp || 0) < (p.max_hp || 3000) * 0.9,
    shieldHigh: (p.shield_hp || 0) > (p.max_hp || 3000) * 2.5,  // engine clearly working
    defTaken: (mem && mem.defTaken) || 0,
  };
  let best = options[0].index, bestS = -1e9;
  for (const o of options) {
    const s = upgradeScore(o, ctx);
    if (s > bestS) { bestS = s; best = o.index; }
  }
  return best;
}

// item value weighting for collection priority
function itemValue(o) {
  switch (o.item_type) {
    case "exp_huge": return 30;
    case "exp_large": return 14;
    case "exp_medium": return 6;
    case "exp_small": return 3;
    case "levelup": return 40;
    case "heart": return 12;
    case "invincible": return 10;
    case "magnet": return 8;
    case "bomb": return 6;
    case "coin": return 2;
    default: return 3;
  }
}

module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    try {
      // ---- upgrade panel ----
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        const m = mem || {};
        const choice = pickUpgrade(obs.pending_upgrade.options, obs, m);
        const chosen = obs.pending_upgrade.options.find(o => o.index === choice);
        if (chosen && isDefensive(chosen)) m.defTaken = (m.defTaken || 0) + 1;
        return { action: { move: [0, 0], upgrade_choice: choice }, mem: m };
      }

      const p = obs.player;
      const px = p.pos[0], py = p.pos[1];
      const w = obs.field.w, h = obs.field.h;
      const phx = p.size[0] / 2 + MARGIN;
      const phy = p.size[1] / 2 + MARGIN;
      const magnet = p.magnet_range || 40;

      const boss = obs.objects.find(o => o.type === "boss" && !o.in_cutscene);
      const bossMode = !!boss;

      const EDGE = 60; // keep aim & position this far from L/R walls (open-space band)

      // ---- aim corridor (stay aligned for DPS), clamped away from walls ----
      let corridorC, corridorHalf, targetY;
      if (bossMode) {
        corridorC = clamp(boss.pos[0] + boss.vel[0] * 18, EDGE, w - EDGE);
        corridorHalf = 50;     // boss ~120 wide & hittable to ~±63 => weave horizontally w/o losing DPS
        targetY = h * 0.64;    // mid-low: room BELOW to retreat into (avoid floor-trap)
      } else {
        // align with an enemy above, but only ones in the central band (don't chase to walls)
        let bestE = null, bestS = -1e9;
        for (const o of obs.objects) {
          if (o.type !== "enemy" && o.type !== "enemy_elite") continue;
          if (o.pos[1] > py - 10) continue;
          if (o.pos[0] < EDGE || o.pos[0] > w - EDGE) continue;
          const s = -Math.abs(o.pos[0] - px) - (py - o.pos[1]) * 0.1 + (o.type === "enemy_elite" ? 25 : 0);
          if (s > bestS) { bestS = s; bestE = o; }
        }
        corridorC = bestE ? clamp(bestE.pos[0], EDGE, w - EDGE) : w / 2;
        corridorHalf = 14;
        targetY = h * 0.72;
      }

      // ---- best item to pursue (leveling fuel) ----
      let bestItem = null, bestItemScore = -1e9;
      for (const o of obs.objects) {
        if (o.type !== "item") continue;
        const up = py - o.pos[1];
        if (bossMode && up > 160) continue;
        const d = Math.hypot(o.pos[0] - px, o.pos[1] - py);
        const sc = itemValue(o) * 8 - d - (up > 0 ? up * 0.35 : 0);
        if (sc > bestItemScore) { bestItemScore = sc; bestItem = o; }
      }

      // ---- gather nearby threats ---- (tag bullets: escape-room is measured vs BULLETS only,
      // so we don't bail on descending enemies we're trying to kill; enemy contact is still
      // handled by collision avoidance below)
      const threats = [];
      for (const o of obs.objects) {
        if (!isThreat(o)) continue;
        const dx = o.pos[0] - px, dy = o.pos[1] - py;
        if (dx * dx + dy * dy > 210 * 210) continue;
        threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], hx: o.size[0] / 2, hy: o.size[1] / 2, bullet: o.type === "enemy_bullet" });
      }

      // bullets-only list (for escape-route eval)
      const bullets = threats.filter(t => t.bullet);

      // weights
      const W_open = 1.3;    // reward escape room from BULLETS along the path (anti-corner / sparse regions)
      // Boss-aim scales with our power: when weak, low-DPS boss chipping is pointless — focus on
      // surviving + collecting XP (leveling). When strong, hammer the boss. When we have a big shield
      // (safe), aim HARDER to finish (convert timeouts) — but we still dodge every hit (no tanking).
      const shieldAim = bossMode ? clamp((p.shield_hp - 20000) / 120000, 0, 0.9) : 0;
      const W_aim = bossMode ? clamp(0.5 + p.level * 0.16, 0.5, 2.4) * (1 + shieldAim) : 3.4;
      const W_low = 0.55;
      const W_item = bossMode ? 2.1 : 1.7;  // XP from swarms = leveling fuel (the snowball)
      const W_wall = 2.5;    // stay away from L/R walls
      const W_bot = 3.2;     // keep room below (avoid floor-trap)
      const FLOORZONE = 150; // keep at least this far from the bottom edge
      const W_ceil = 1.4;    // mild: don't drift up into the bullet origin
      const CEILZONE = 120;
      const COLL = 30000;    // collision penalty (per collision tick, /t) — dominates everything
      const W_density = 9;   // avoid dense bullet regions (where we get boxed in => overwhelm deaths)
      const DENS_R2 = 60 * 60;

      // first pass: primary score for each candidate
      const N = CANDS.length;
      const sc = new Float64Array(N);
      const FX = new Float64Array(N), FY = new Float64Array(N);
      for (let ci = 0; ci < N; ci++) {
        const dx = CANDS[ci][0], dy = CANDS[ci][1];
        let collPen = 0, nColl = 0, minClear = 1e9;
        for (let t = 1; t <= H; t++) {
          const nx = clamp(px + dx * t, phx, w - phx);
          const ny = clamp(py + dy * t, phy, h - phy);
          for (let k = 0; k < threats.length; k++) {
            const th = threats[k];
            const ex = Math.abs(nx - (th.x + th.vx * t)) - (phx + th.hx);
            const ey = Math.abs(ny - (th.y + th.vy * t)) - (phy + th.hy);
            const clear = ex > ey ? ex : ey;
            if (clear < 0) { collPen += COLL / t; nColl++; }
            else if (th.bullet && clear < minClear) minClear = clear;
          }
        }
        const fx = clamp(px + dx * H, phx, w - phx);
        const fy = clamp(py + dy * H, phy, h - phy);
        FX[ci] = fx; FY[ci] = fy;

        // local bullet density at the destination (avoid camping in the thick of fire)
        let dens = 0;
        for (let k = 0; k < bullets.length; k++) {
          const th = bullets[k];
          const ddx = fx - (th.x + th.vx * H), ddy = fy - (th.y + th.vy * H);
          if (ddx * ddx + ddy * ddy < DENS_R2) dens++;
        }

        let score = -collPen - dens * W_density;
        if (minClear < 1e9) score += Math.min(minClear, 40) * W_open;
        const aimErr = Math.max(0, Math.abs(fx - corridorC) - corridorHalf);
        score -= aimErr * W_aim;
        score -= Math.abs(fy - targetY) * W_low;
        const roomX = Math.min(fx - phx, (w - phx) - fx);
        if (roomX < EDGE) { const r = (EDGE - roomX); score -= (r * r / EDGE) * W_wall; }
        const roomBot = (h - phy) - fy;
        if (roomBot < FLOORZONE) { const r = (FLOORZONE - roomBot); score -= (r * r / FLOORZONE) * W_bot; }
        const roomTop = fy - phy;
        if (roomTop < CEILZONE) { const r = (CEILZONE - roomTop); score -= (r * r / CEILZONE) * W_ceil; }
        if (bestItem && nColl === 0) {
          const ix = bestItem.pos[0], iy = bestItem.pos[1];
          const before = Math.hypot(px - ix, py - iy);
          const after = Math.hypot(fx - ix, fy - iy);
          score += (before - after) * W_item + (after < magnet ? 10 : 0);
        }
        sc[ci] = score;
      }

      // second pass: among the top candidates, prefer destinations with more ESCAPE ROUTES
      // (so we never walk into a position that's about to be boxed in => the overwhelm deaths).
      const K = 18;
      const idx = Array.from({ length: N }, (_, i) => i).sort((a, b) => sc[b] - sc[a]);
      const top = idx.slice(0, K);
      const ED = ESCAPE_DIRS, E = 11;
      let best = [0, 0], bestScore = -1e18;
      for (const ci of top) {
        const fx = FX[ci], fy = FY[ci];
        let routes = 0;
        for (let d = 0; d < ED.length; d++) {
          const ex0 = ED[d][0], ey0 = ED[d][1];
          let ok = true;
          for (let t2 = 1; t2 <= E && ok; t2++) {
            const nx = clamp(fx + ex0 * t2, phx, w - phx);
            const ny = clamp(fy + ey0 * t2, phy, h - phy);
            const tt = H + t2;
            for (let k = 0; k < bullets.length; k++) {
              const th = bullets[k];
              const gx = Math.abs(nx - (th.x + th.vx * tt)) - (phx + th.hx);
              const gy = Math.abs(ny - (th.y + th.vy * tt)) - (phy + th.hy);
              if ((gx > gy ? gx : gy) < 0) { ok = false; break; }
            }
          }
          if (ok) routes++;
        }
        // strong preference for escape routes; HEAVY penalty if nearly boxed in (overwhelm deaths)
        let escScore = Math.min(routes, 6) * 26;
        if (routes === 0) escScore -= 9000;
        else if (routes === 1) escScore -= 3500;
        else if (routes === 2) escScore -= 900;
        const total = sc[ci] + escScore;
        if (total > bestScore) { bestScore = total; best = CANDS[ci]; }
      }
      return { action: { move: best, upgrade_choice: 0 }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
