"use strict";

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const fw = obs.field.w;
    const fh = obs.field.h;

    let move = [0, 0];
    let upgrade_choice = 0;

    // Handle level-up panel
    if (obs.pending_upgrade && obs.pending_upgrade.options.length) {
      const options = obs.pending_upgrade.options;
      let best_idx = 0;
      let best_score = -Infinity;

      // Rarity-weighted selection with damage preference
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        let score = 0;

        // Weight rarity heavily
        if (opt.rarity === "orange") score += 1000;
        else if (opt.rarity === "purple") score += 100;
        else if (opt.rarity === "blue") score += 10;
        else score += 1;

        // Preference for useful upgrades
        const name = opt.name.toLowerCase();

        // Survival first in early game
        if (obs.player.level < 3) {
          if (name.includes("health") || name.includes("shield") || name.includes("armor")) score += 70;
          if (name.includes("damage") || name.includes("power")) score += 50;
          if (name.includes("pierce")) score += 40;
        } else {
          // Damage focus in later game
          if (name.includes("damage") || name.includes("power")) score += 70;
          if (name.includes("pierce")) score += 60;
          if (name.includes("health") || name.includes("shield")) score += 40;
        }

        if (name.includes("range") || name.includes("magnet")) score += 40;
        if (name.includes("speed") || name.includes("agile")) score += 20;
        if (name.includes("satellite")) score += 15;

        if (score > best_score) {
          best_score = score;
          best_idx = i;
        }
      }
      upgrade_choice = best_idx;
    }

    // Separate objects
    const items = [];
    const enemies = [];
    const bullets = [];
    let boss = null;

    for (const obj of obs.objects) {
      if (obj.type === "item") {
        items.push(obj);
      } else if (obj.type === "boss") {
        boss = obj;
      } else if (obj.type === "enemy" || obj.type === "enemy_elite") {
        enemies.push(obj);
      } else if (obj.type === "enemy_bullet") {
        bullets.push(obj);
      }
    }

    // Find nearest bullet
    let nearest_bullet = null;
    let nearest_bullet_dist = Infinity;
    for (const bullet of bullets) {
      const dist = Math.hypot(bullet.pos[0] - px, bullet.pos[1] - py);
      if (dist < nearest_bullet_dist) {
        nearest_bullet = bullet;
        nearest_bullet_dist = dist;
      }
    }

    // --- Movement logic ---
    // Priority 0: Dodge bullets more aggressively when boss is present
    if (nearest_bullet && nearest_bullet_dist < (boss ? 150 : 200)) {
      const dx = px - nearest_bullet.pos[0];
      const dy = py - nearest_bullet.pos[1];
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        move[0] = (dx / dist) * 40;
        move[1] = (dy / dist) * 40;
      }
    }
    // Priority 2: Collect items
    else if (items.length > 0) {
      let best_item = null;
      let best_dist = Infinity;

      for (const item of items) {
        const dist = Math.hypot(item.pos[0] - px, item.pos[1] - py);
        if (dist < best_dist) {
          best_item = item;
          best_dist = dist;
        }
      }

      if (best_item) {
        const dx = best_item.pos[0] - px;
        const dy = best_item.pos[1] - py;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          move[0] = (dx / dist) * 40;
          move[1] = (dy / dist) * 40;
        }
      }
    }
    // Priority 3: Fight boss - aggressive approach
    else if (boss && boss.hp > 0) {
      const dist_to_boss = Math.hypot(boss.pos[0] - px, boss.pos[1] - py);

      // Stay in combat range (110-170px), biased toward staying closer
      if (dist_to_boss > 170) {
        const dx = boss.pos[0] - px;
        const dy = boss.pos[1] - py;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          move[0] = (dx / dist) * 40;
          move[1] = (dy / dist) * 40;
        }
      } else if (dist_to_boss < 110) {
        const dx = boss.pos[0] - px;
        const dy = boss.pos[1] - py;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          // Gentle retreat
          move[0] = -(dx / dist) * 15;
          move[1] = -(dy / dist) * 15;
        }
      }
    }
    // Priority 4: Fight regular enemies
    else if (enemies.length > 0) {
      let safest_pos = [px, py];
      let safest_score = -Infinity;

      // Sample positions to find best location
      for (let dx = -60; dx <= 60; dx += 30) {
        for (let dy = -60; dy <= 60; dy += 30) {
          const test_pos = [px + dx, py + dy];

          // Skip out of bounds
          if (test_pos[0] < 20 || test_pos[0] > fw - 20) continue;
          if (test_pos[1] < 20 || test_pos[1] > fh - 20) continue;

          // Find min distance to any enemy
          let min_dist = Infinity;
          for (const enemy of enemies) {
            const dist = Math.hypot(enemy.pos[0] - test_pos[0], enemy.pos[1] - test_pos[1]);
            min_dist = Math.min(min_dist, dist);
          }

          // Score positions
          let score = 0;
          if (min_dist > 250) score = 200;
          else if (min_dist > 160) score = min_dist * 1.5;
          else if (min_dist > 120) score = min_dist * 1.3;
          else if (min_dist > 80) score = min_dist * 0.9;
          else score = min_dist - 100;

          if (score > safest_score) {
            safest_score = score;
            safest_pos = test_pos;
          }
        }
      }

      // Move toward best position
      const dx = safest_pos[0] - px;
      const dy = safest_pos[1] - py;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        move[0] = (dx / dist) * 40;
        move[1] = (dy / dist) * 40;
      }
    }
    // Priority 5: Stay centered
    else {
      const cx = fw / 2;
      const cy = fh / 2;
      const dx = cx - px;
      const dy = cy - py;
      const dist = Math.hypot(dx, dy);
      if (dist > 50) {
        move[0] = (dx / dist) * 15;
        move[1] = (dy / dist) * 15;
      }
    }

    // Clamp to field bounds
    const margin = 20;
    const new_x = px + move[0];
    const new_y = py + move[1];
    if (new_x < margin || new_x > fw - margin) move[0] = 0;
    if (new_y < margin || new_y > fh - margin) move[1] = 0;

    // Clamp to speed cap
    const mag = Math.hypot(move[0], move[1]);
    if (mag > 40) {
      move[0] = (move[0] / mag) * 40;
      move[1] = (move[1] / mag) * 40;
    }

    return { action: { move, upgrade_choice }, mem };
  },
};
