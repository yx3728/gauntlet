"use strict";

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    try {
      const [px, py] = obs.player.pos;
      const fw = obs.field.w;
      const fh = obs.field.h;

      const objects = obs.objects || [];
      const bullets = objects.filter(o => o.type === "enemy_bullet");
      const items = objects.filter(o => o.type === "item");
      const bosses = objects.filter(o => o.type === "boss" && !o.in_cutscene);

      let move = [0, 0];

      // Boss fight - special strategy
      if (bosses.length > 0) {
        const [bx, by] = bosses[0].pos;
        const nearby = bullets.filter(b => Math.hypot(b.pos[0] - px, b.pos[1] - py) < 130);

        if (nearby.length >= 3) {
          // Dodge
          let avoid_x = 0;
          let avoid_y = 0;

          for (const bullet of nearby) {
            const [bx2, by2] = bullet.pos;
            const [bvx, bvy] = bullet.vel || [0, 0];
            const fx = bx2 + bvx * 3;
            const fy = by2 + bvy * 3;

            const dx = px - fx;
            const dy = py - fy;
            const len = Math.hypot(dx, dy);
            if (len > 0.1) {
              avoid_x += dx / len;
              avoid_y += dy / len;
            }
          }

          const len = Math.hypot(avoid_x, avoid_y);
          if (len > 0.1) {
            move = [avoid_x / len * 37, avoid_y / len * 37];
          }
        } else if (items.length > 0) {
          // Get items
          let closest = items[0];
          let min_dist = Math.hypot(items[0].pos[0] - px, items[0].pos[1] - py);

          for (const item of items) {
            const dist = Math.hypot(item.pos[0] - px, item.pos[1] - py);
            if (dist < min_dist) {
              closest = item;
              min_dist = dist;
            }
          }

          if (min_dist > 5) {
            const [ix, iy] = closest.pos;
            const dx = ix - px;
            const dy = iy - py;
            move = [dx / min_dist * 28, dy / min_dist * 28];
          }
        } else {
          // Safe position
          const target_x = fw / 2;
          const target_y = Math.min(by + 110, fh - 40);
          const dx = target_x - px;
          const dy = target_y - py;
          const dist = Math.hypot(dx, dy);

          if (dist > 8) {
            move = [dx / dist * 18, dy / dist * 18];
          }
        }
      } else {
        // Regular waves
        const nearby = bullets.filter(b => Math.hypot(b.pos[0] - px, b.pos[1] - py) < 140);

        if (nearby.length >= 4) {
          // Strong dodge
          let avoid_x = 0;
          let avoid_y = 0;

          for (const bullet of nearby) {
            const [bx, by] = bullet.pos;
            const [bvx, bvy] = bullet.vel || [0, 0];
            const fx = bx + bvx * 3;
            const fy = by + bvy * 3;

            const dx = px - fx;
            const dy = py - fy;
            const len = Math.hypot(dx, dy);
            if (len > 0.1) {
              avoid_x += dx / len;
              avoid_y += dy / len;
            }
          }

          const len = Math.hypot(avoid_x, avoid_y);
          if (len > 0.1) {
            move = [avoid_x / len * 37, avoid_y / len * 37];
          }
        } else if (items.length > 0 && nearby.length <= 2) {
          // Chase items
          let closest = items[0];
          let min_dist = Math.hypot(items[0].pos[0] - px, items[0].pos[1] - py);

          for (const item of items) {
            const dist = Math.hypot(item.pos[0] - px, item.pos[1] - py);
            if (dist < min_dist) {
              closest = item;
              min_dist = dist;
            }
          }

          if (min_dist > 5) {
            const [ix, iy] = closest.pos;
            const dx = ix - px;
            const dy = iy - py;
            move = [dx / min_dist * 35, dy / min_dist * 35];
          }
        } else if (items.length > 0) {
          // Careful approach
          let closest = items[0];
          let min_dist = Math.hypot(items[0].pos[0] - px, items[0].pos[1] - py);

          for (const item of items) {
            const dist = Math.hypot(item.pos[0] - px, item.pos[1] - py);
            if (dist < min_dist) {
              closest = item;
              min_dist = dist;
            }
          }

          if (min_dist > 5) {
            const [ix, iy] = closest.pos;
            const dx = ix - px;
            const dy = iy - py;
            move = [dx / min_dist * 23, dy / min_dist * 23];
          }
        } else {
          // Center
          const target_x = fw / 2;
          const target_y = fh * 0.5;
          const dx = target_x - px;
          const dy = target_y - py;
          const dist = Math.hypot(dx, dy);

          if (dist > 15) {
            move = [dx / dist * 19, dy / dist * 19];
          }
        }
      }

      // Speed cap
      const mag = Math.hypot(move[0], move[1]);
      if (mag > 40) {
        move[0] = move[0] / mag * 40;
        move[1] = move[1] / mag * 40;
      }

      // Upgrades
      let upgrade_choice = 0;
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length > 0) {
        const opts = obs.pending_upgrade.options;
        let best = 0;
        let best_score = -1;

        const survival = ["shield", "armor", "heal", "health", "hp", "invincib", "reflect", "regen"];

        for (let i = 0; i < opts.length; i++) {
          const text = (opts[i].name + " " + opts[i].desc).toLowerCase();

          let score = 10;
          if (survival.some(w => text.includes(w))) {
            score = 100;
          } else if (["magnet", "attract", "speed", "move"].some(w => text.includes(w))) {
            score = 70;
          } else if (["damage", "attack", "power", "pierce"].some(w => text.includes(w))) {
            score = 50;
          }

          score *= { green: 1, blue: 1.2, purple: 1.5, orange: 2 }[opts[i].rarity] || 1;

          if (score > best_score) {
            best_score = score;
            best = i;
          }
        }

        upgrade_choice = best;
      }

      return { action: { move, upgrade_choice }, mem };
    } catch (err) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
