"use strict";

// ── Upgrade selection ──────────────────────────────────────────────────────
// Descriptions are in Chinese; match on English IDs.
const EXACT_IDS = {
  "heal_quick":  44,   // immediate full-HP + max_hp shield; below fr_=46 so fr_cool wins
  "heal_overflow": 20, // conditional (only on overheal) → downgrade; heal_quick beats it
  "sat_orbit":   50,   // 2 orbiting satellites = top-tier DPS
  "bullet_crush": 70,  // player bullets destroy enemy bullets = near-invincibility
};

const ID_PRIO = {
  "pc_":      50,
  "ms_":      48,
  "fr_":      46,
  "sat_":     44,
  "shield_":  42,  // above dmg_ so shield_basic beats damage at same rarity
  "dmg_":     40,
  "heal_":    36,
  "hp_":      32,
  "mag_":     28,
  "sp_":      20,
  "exp_":     18,
  "bs_":      15,
  "thorn_":    8,
  "coin_":     2,
};
const RARITY = { orange: 40, purple: 30, blue: 20, green: 10 };

function optScore(o) {
  let s = RARITY[o.rarity] || 10;
  if (!o.id) return s;
  if (EXACT_IDS[o.id] !== undefined) return s + EXACT_IDS[o.id];
  for (const [p, v] of Object.entries(ID_PRIO)) { if (o.id.startsWith(p)) { s += v; break; } }
  return s;
}

function chooseUpgrade(opts, hp, mhp, wave) {
  const hpRatio = hp / mhp;
  // Emergency: HP < 25% — take any heal/shield immediately.
  if (hpRatio < 0.25) {
    const h = opts.find(o => o.id && (o.id.startsWith("heal_") || o.id.startsWith("shield_")));
    if (h) return h.index;
  }
  // Boss fight (wave 3) with HP < 50%: prefer heal_quick or shields over DPS.
  // heal_quick restores full HP + max_hp shield = ~6000 effective HP burst.
  if (wave >= 3 && hpRatio < 0.50) {
    const h = opts.find(o => o.id && (o.id === "heal_quick" || o.id.startsWith("shield_")));
    if (h) return h.index;
  }
  // Boss fight (wave 3) with HP < 80%: regen provides ~30 HP/s sustained healing.
  // regen_basic at 1% base HP/s can nearly neutralize damage intake in a long boss fight.
  // Only in wave 3 to avoid blocking mag_basic in waves 1-2.
  if (wave >= 3 && hpRatio < 0.80) {
    const h = opts.find(o => o.id && (o.id.startsWith("regen_") || o.id === "hp_plate"));
    if (h) return h.index;
  }
  let best = opts[0].index, bestS = -Infinity;
  for (const o of opts) {
    let s = optScore(o);
    // In boss fight (wave 3), timeflow_shield provides shields/time-slow that outlast early mag bonuses.
    // Only boost in wave 3 to avoid displacing mag_basic in waves 1-2 (critical for XP collection).
    if (wave >= 3 && o.id && o.id.startsWith("timeflow_")) s += 13;
    if (wave >= 3 && o.id && o.id === "tyrant_breaker") s += 20; // ×2 boss/elite; total=60 for orange
    if (s > bestS) { bestS = s; best = o.index; }
  }
  return best;
}

// ── Math ──────────────────────────────────────────────────────────────────
function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2); }

function bulletCA2(b, px, py, T) {
  const fx = b.pos[0] - px, fy = b.pos[1] - py;
  const vx = b.vel[0], vy = b.vel[1];
  const v2 = vx * vx + vy * vy;
  if (v2 < 1e-6) return fx * fx + fy * fy;
  const t = Math.max(0, Math.min(T, -(fx * vx + fy * vy) / v2));
  return (fx + t * vx) ** 2 + (fy + t * vy) ** 2;
}

// ── Policy ─────────────────────────────────────────────────────────────────
module.exports = {
  init() { return { frame: 0 }; },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const { w: fw, h: fh } = obs.field;
    const SPEED = 40;
    const M = 25;
    const frame = (mem.frame || 0) + 1;
    mem = { ...mem, frame };

    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(
        obs.pending_upgrade.options, obs.player.hp, obs.player.max_hp, obs.wave
      );
    }

    const bullets = [], items = [], enemies = [];
    let bossObj = null;
    for (const o of obs.objects) {
      if (o.type === "enemy_bullet") bullets.push(o);
      else if (o.type === "item") items.push(o);
      else if (o.type === "enemy" || o.type === "enemy_elite") enemies.push(o);
      else if (o.type === "boss" && !o.in_cutscene) bossObj = o;
    }

    const inBoss = bossObj !== null;
    const hpRatio = obs.player.hp / obs.player.max_hp;
    const baseY = inBoss ? fh * 0.70 : fh * 0.75;

    // ── A. BULLET AVOIDANCE ───────────────────────────────────────────────
    let repX = 0, repY = 0;
    const BDANGER = 110;
    const BLOOK = 30;

    for (const b of bullets) {
      const ca2 = bulletCA2(b, px, py, BLOOK);
      if (ca2 < BDANGER * BDANGER) {
        const dx = px - b.pos[0], dy = py - b.pos[1];
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        const w = (BDANGER - Math.sqrt(ca2)) / BDANGER;
        repX += (dx / d) * w * 4;
        repY += (dy / d) * w * 4;
      }
    }

    // ── B. ENEMY CONTACT AVOIDANCE ────────────────────────────────────────
    const EDANGER = 70;
    for (const e of enemies) {
      const d = dist(px, py, e.pos[0], e.pos[1]);
      if (d < EDANGER) {
        const dx = px - e.pos[0], dy = py - e.pos[1];
        const w = (EDANGER - d) / EDANGER;
        repX += (dx / (d + 1)) * w * 3;
        repY += (dy / (d + 1)) * w * 3;
      }
    }

    if (bossObj) {
      const d = dist(px, py, bossObj.pos[0], bossObj.pos[1]);
      if (d < 140) {
        const dx = px - bossObj.pos[0], dy = py - bossObj.pos[1];
        const w = (140 - d) / 140;
        repX += (dx / (d + 1)) * w * 2;
        repY += (dy / (d + 1)) * w * 2;
      }
    }

    // Track boss phase transitions in memory so we can detect phase 2.
    // Phase 2 = new boss spawns after first boss was killed (HP resets to 100%).
    if (bossObj) {
      const bossHpPct = bossObj.hp / bossObj.max_hp;
      if (bossHpPct < 0.05) mem.bossNearDead = true;
      if (mem.bossNearDead && bossHpPct > 0.90) {
        mem.bossPhase2 = true;
        mem.bossNearDead = false;
      }
    }
    const isBossPhase2 = !!(mem.bossPhase2);

    // ── C. X ALIGNMENT ───────────────────────────────────────────────────
    let alignX = 0;
    if (bossObj) {
      alignX = (bossObj.pos[0] - px) * 0.4;
    } else if (enemies.length > 0) {
      let bestE = null, bestS = -Infinity;
      for (const e of enemies) {
        if (e.pos[1] >= py) continue;
        const hpPct = (e.hp || 1) / (e.max_hp || 1);
        const xd = Math.abs(e.pos[0] - px);
        const s = (1 - hpPct) * 60 - xd * 0.1;
        if (s > bestS) { bestS = s; bestE = e; }
      }
      if (bestE) alignX = (bestE.pos[0] - px) * 0.35;
    }

    // ── D. ITEM COLLECTION ────────────────────────────────────────────────

    let bestItem = null, bestItemEff = -1;
    for (const item of items) {
      const d = dist(px, py, item.pos[0], item.pos[1]);
      let prio;
      if ((item.item_type === "heart" || item.item_type === "invincible") && hpRatio < 0.5) prio = 1000;
      else if (item.item_type === "exp_huge") prio = 8;
      else if (item.item_type === "exp_large") prio = 6;
      else if (item.item_type === "exp_medium") prio = 4;
      else if (item.item_type === "exp_small") prio = 2;
      else if (item.item_type === "magnet") prio = 5;
      else if (item.item_type === "heart") prio = 3;
      else prio = 1;
      const eff = prio / (d + 50);
      if (eff > bestItemEff) { bestItemEff = eff; bestItem = item; }
    }

    let itemX = 0, itemY = 0;
    if (bestItem) {
      const dx = bestItem.pos[0] - px;
      const dy = bestItem.pos[1] - py;
      const d = dist(px, py, bestItem.pos[0], bestItem.pos[1]) + 1;
      const str = bestItemEff >= 20 ? 2.5 : 1.5;
      itemX = (dx / d) * str;
      if (dy > 0) itemY = (dy / d) * str;
    }

    // ── E. BASE POSITIONING ───────────────────────────────────────────────
    const bpY = (baseY - py) * 0.015;
    const bpX = (fw / 2 - px) * 0.004;

    // ── F. COMBINE ────────────────────────────────────────────────────────
    const dangerMag = Math.sqrt(repX * repX + repY * repY);
    const dangerLvl = Math.min(1, dangerMag / 5);
    const safeW = 1 - dangerLvl * 0.65;

    // Phase 2: pull strongly toward the bottom area (not scaled by safeW).
    // The second boss oscillates at y≈130-230 and rams to y≈303.
    // Staying near y=615 keeps distance > 300px from the ram terminus (safe).
    const phase2Y = (inBoss && isBossPhase2) ? (fh - M - py) * 0.08 : 0;

    let moveX = repX + (alignX + itemX + bpX) * safeW;
    let moveY = repY + (itemY + bpY) * safeW + phase2Y;

    // Idle wander
    if (!inBoss && moveX * moveX + moveY * moveY < 0.5 && !obs.pending_upgrade) {
      if (bestItem) {
        const dx = bestItem.pos[0] - px;
        const dy = bestItem.pos[1] - py;
        const d = dist(px, py, bestItem.pos[0], bestItem.pos[1]) + 1;
        moveX = (dx / d) * 12;
        if (dy > 0) moveY = (dy / d) * 12;
      } else {
        moveX = Math.cos(frame * 0.04) * 12;
      }
    }

    const mag = Math.sqrt(moveX * moveX + moveY * moveY);
    if (mag > SPEED) { moveX = (moveX / mag) * SPEED; moveY = (moveY / mag) * SPEED; }

    if (px + moveX < M) moveX = M - px;
    if (px + moveX > fw - M) moveX = fw - M - px;
    if (py + moveY < M) moveY = M - py;
    if (py + moveY > fh - M) moveY = fh - M - py;

    return { action: { move: [moveX, moveY], upgrade_choice }, mem };
  },
};
