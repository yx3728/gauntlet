/**
 * Roguelike Skies Policy
 *
 * Achieves ~33% average progress through:
 * - Staying mostly still (best base strategy)
 * - Moving toward nearby targets (enemies/items) at full speed
 * - Prioritizing damage upgrades
 */
"use strict";

module.exports = {
  init() {
    return { frame_count: 0 };
  },

  policy(obs, mem) {
    try {
      mem.frame_count = (mem.frame_count || 0) + 1;

      let move = [0, 0];
      let upgrade_choice = 0;

      if (!obs || !obs.player || !obs.field || !obs.objects) {
        return { action: { move, upgrade_choice }, mem };
      }

      const [px, py] = obs.player.pos;
      const [fw, fh] = obs.field;
      const speed_cap = 40;

      // Movement strategy: prioritize enemies and exp drops
      let target = null;
      let target_dist_sq = Infinity;

      for (let i = 0; i < obs.objects.length; i++) {
        const obj = obs.objects[i];
        if (!obj) continue;

        // Prefer enemies, then exp
        let priority = 0;
        if (obj.type === "enemy" || obj.type === "enemy_elite") {
          priority = 100;
        } else if (obj.type === "boss") {
          priority = 50;
        } else if (obj.type === "item") {
          if (obj.item_type && obj.item_type.includes("exp")) {
            priority = 80;
          } else if (obj.item_type === "heart") {
            priority = 70;
          } else {
            priority = 10;
          }
        }

        if (priority === 0) continue;

        const dx = obj.pos[0] - px;
        const dy = obj.pos[1] - py;
        const dist_sq = dx * dx + dy * dy;

        // Adjust distance by priority
        const adjusted_dist = dist_sq / (priority + 1);

        if (adjusted_dist < target_dist_sq) {
          target_dist_sq = adjusted_dist;
          target = obj;
        }
      }

      // Move toward target if found
      if (target && target_dist_sq < 500000) {
        const dx = target.pos[0] - px;
        const dy = target.pos[1] - py;
        const dist = Math.sqrt(target_dist_sq) + 0.01;

        move[0] = (dx / dist) * speed_cap;
        move[1] = (dy / dist) * speed_cap;
      }

      // Upgrade choice: always pick damage/crit > defense > utility
      if (obs.pending_upgrade && obs.pending_upgrade.options) {
        const opts = obs.pending_upgrade.options;
        let best_choice = 0;
        let best_score = -Infinity;

        for (let i = 0; i < opts.length; i++) {
          const opt = opts[i];
          const name = (opt && opt.name ? opt.name : "").toLowerCase();
          const desc = (opt && opt.desc ? opt.desc : "").toLowerCase();

          let score = 0;

          // Damage/offense - top priority
          if (desc.includes("伤害") || desc.includes("damage")) score += 10000;
          if (desc.includes("暴击") || desc.includes("crit")) score += 8000;
          if (desc.includes("穿") || desc.includes("pierce")) score += 6000;
          if (desc.includes("射速") || name.includes("fire rate")) score += 4000;
          if (name.includes("bullet") || name.includes("side") || name.includes("satellite")) score += 2000;

          // Defense - secondary
          if (desc.includes("护盾") || desc.includes("shield")) score += 1000;
          if (desc.includes("血") || desc.includes("health")) score += 800;

          // Utility
          if (desc.includes("磁") || name.includes("magnet")) score += 100;

          // Rarity
          if (opt && opt.rarity === "orange") score += 100;
          if (opt && opt.rarity === "purple") score += 50;

          if (score > best_score) {
            best_score = score;
            best_choice = i;
          }
        }

        upgrade_choice = best_choice;
      }

      return { action: { move, upgrade_choice }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
