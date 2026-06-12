/**
 * smart.js — a hand-tuned heuristic baseline that USES the full interface
 * (per-tick vel for threat prediction; obs.pending_upgrade for deliberate upgrade
 * picks). Still simple and not exhaustively tuned — a reference point above greedy,
 * and a check that the documented interface is actually sufficient to play with.
 */
"use strict";

const THREAT_R = 110;        // px
const BULLET_LOOKAHEAD = 12; // ticks
const MOVE = 6.5;            // px/tick

// upgrade preference: rarity first, then a few keywords that tend to help survival/DPS.
const RARITY_RANK = { orange: 3, purple: 2, blue: 1, green: 0 };
const KEYWORD_BONUS = [
  [/pierce|穿透/i, 3], [/shield|护盾/i, 3], [/hp|armor|装甲|生命|repair|修复/i, 2],
  [/dmg|damage|弹芯|火控|伤害|crit|暴击/i, 2], [/fire ?rate|射速|急速/i, 2],
  [/satellite|卫星/i, 1], [/split|分裂|side/i, 1], [/magnet|磁吸/i, 0.5],
];

function chooseUpgrade(options) {
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (const o of options) {
    let s = (RARITY_RANK[o.rarity] || 0) * 2;
    const text = `${o.name || ""} ${o.desc || ""} ${o.id || ""}`;
    for (const [re, w] of KEYWORD_BONUS) if (re.test(text)) s += w;
    if (s > bestScore) { bestScore = s; bestIdx = o.index; }
  }
  return bestIdx;
}

module.exports = {
  init() { return {}; },
  policy(obs, mem) {
    // deliberate upgrade choice when a panel is open
    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options);
    }

    const [px, py] = obs.player.pos;
    let fx = 0;
    let fy = 0;

    for (const o of obs.objects) {
      const t = o.type;
      if (t === "enemy_bullet" || t === "enemy" || t === "enemy_elite" || t === "boss") {
        // predict position a few ticks ahead using per-tick vel
        const ex = o.pos[0] + o.vel[0] * BULLET_LOOKAHEAD;
        const ey = o.pos[1] + o.vel[1] * BULLET_LOOKAHEAD;
        const dxN = px - o.pos[0];
        const dyN = py - o.pos[1];
        const dN = Math.hypot(dxN, dyN) || 1;
        const dxF = px - ex;
        const dyF = py - ey;
        const dF = Math.hypot(dxF, dyF) || 1;
        const r = t === "enemy_bullet" ? THREAT_R : THREAT_R * 1.4; // bodies hurt more
        if (dN < r) { const w = (r - dN) / r; fx += (dxN / dN) * w * r; fy += (dyN / dN) * w * r; }
        if (dF < r) { const w = (r - dF) / r; fx += (dxF / dF) * w * r * 0.8; fy += (dyF / dF) * w * r * 0.8; }
      }
    }

    const threatened = Math.hypot(fx, fy) > 1;
    if (!threatened) {
      // safe: drift toward nearest XP orb to level up (genuine progress)
      let target = null;
      let best = Infinity;
      for (const o of obs.objects) {
        if (o.type === "item" && typeof o.item_type === "string" && o.item_type.indexOf("exp_") === 0) {
          const d = Math.hypot(px - o.pos[0], py - o.pos[1]);
          if (d < best) { best = d; target = o; }
        }
      }
      if (target) { fx += (target.pos[0] - px) * 0.25; fy += (target.pos[1] - py) * 0.25; }
    }

    // positional bias: stay in the lower third (autofire sprays upward; less contact)
    fx += (obs.field.w / 2 - px) * 0.02;
    fy += (obs.field.h * 0.8 - py) * 0.05;

    const m = Math.hypot(fx, fy);
    if (m > MOVE) { fx = (fx / m) * MOVE; fy = (fy / m) * MOVE; }
    return { action: { move: [fx, fy], upgrade_choice }, mem };
  },
};
