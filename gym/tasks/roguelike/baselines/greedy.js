/**
 * greedy.js — a simple, transparent heuristic baseline (NOT a tuned strategy).
 *
 * It does three obvious things and nothing clever:
 *   1. Sum a short-range repulsion from nearby threats (enemy bullets, enemies,
 *      elites, boss), weighted by closeness.
 *   2. Add a weak pull toward horizontal center and toward the lower screen
 *      (where this game's player normally sits and autofire sprays upward).
 *   3. Clamp the move to a fixed per-tick magnitude.
 * Upgrade choice is always option 0. This exists to prove the pipeline end-to-end
 * and to give a non-trivial reference point — it is deliberately un-optimized.
 */
"use strict";

const THREAT_RADIUS = 95;
const MOVE_PER_TICK = 6;

module.exports = {
  init() {
    return {};
  },
  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    let fx = 0;
    let fy = 0;
    for (const o of obs.objects) {
      if (
        o.type === "enemy_bullet" ||
        o.type === "enemy" ||
        o.type === "enemy_elite" ||
        o.type === "boss"
      ) {
        const dx = px - o.pos[0];
        const dy = py - o.pos[1];
        const d = Math.hypot(dx, dy) || 1;
        if (d < THREAT_RADIUS) {
          const w = (THREAT_RADIUS - d) / THREAT_RADIUS;
          fx += (dx / d) * w * THREAT_RADIUS;
          fy += (dy / d) * w * THREAT_RADIUS;
        }
      }
    }
    // weak positional bias: horizontal center + lower third
    fx += (obs.field.w / 2 - px) * 0.03;
    fy += (obs.field.h * 0.78 - py) * 0.03;

    const m = Math.hypot(fx, fy);
    if (m > MOVE_PER_TICK) {
      fx = (fx / m) * MOVE_PER_TICK;
      fy = (fy / m) * MOVE_PER_TICK;
    }
    return { action: { move: [fx, fy], upgrade_choice: 0 }, mem };
  },
};
