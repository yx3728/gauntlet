"use strict";

module.exports = {
  init() {
    return {
      last_level: 1,
      health_percent: 1.0,
    };
  },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const { w: field_w, h: field_h } = obs.field;
    const max_speed = 38;

    // Update memory
    mem.health_percent = obs.player.hp / obs.player.max_hp;
    mem.last_level = obs.player.level;

    // Categorize objects
    const items = [];
    const bosses = [];
    const bullets = [];

    for (const obj of obs.objects) {
      if (obj.type === 'item') {
        items.push(obj);
      } else if (obj.type === 'boss' && !obj.in_cutscene) {
        bosses.push(obj);
      } else if (obj.type === 'enemy_bullet') {
        bullets.push(obj);
      }
    }

    let move = [0, 0];

    // Find closest threats and targets
    let closest_bullet = null;
    let closest_bullet_dist = Infinity;

    for (const bullet of bullets) {
      const dx = bullet.pos[0] - px;
      const dy = bullet.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closest_bullet_dist && dist < 120) {
        closest_bullet_dist = dist;
        closest_bullet = bullet;
      }
    }

    // Find closest item
    let closest_item = null;
    let closest_item_dist = Infinity;

    for (const item of items) {
      const dx = item.pos[0] - px;
      const dy = item.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closest_item_dist) {
        closest_item_dist = dist;
        closest_item = item;
      }
    }

    // Decision logic based on game state
    const low_health = mem.health_percent < 0.4;
    const high_level = obs.player.level >= 3;

    // Critical threat - dodge immediately when health is low
    if (closest_bullet && closest_bullet_dist < 100 && low_health) {
      const bdx = closest_bullet.vel[0];
      const bdy = closest_bullet.vel[1];

      const perp1 = [-bdy, bdx];
      const perp2 = [bdy, -bdx];

      let perp1_score = 0;
      let perp2_score = 0;

      for (const bullet of bullets) {
        const bullet_dx = bullet.pos[0] - px;
        const bullet_dy = bullet.pos[1] - py;
        const bullet_dist = Math.sqrt(bullet_dx * bullet_dx + bullet_dy * bullet_dy);

        if (bullet_dist < 150) {
          const future_dx1 = bullet_dx - perp1[0] * max_speed;
          const future_dy1 = bullet_dy - perp1[1] * max_speed;
          const future_dist1 = Math.sqrt(future_dx1 * future_dx1 + future_dy1 * future_dy1);
          perp1_score += future_dist1;

          const future_dx2 = bullet_dx - perp2[0] * max_speed;
          const future_dy2 = bullet_dy - perp2[1] * max_speed;
          const future_dist2 = Math.sqrt(future_dx2 * future_dx2 + future_dy2 * future_dy2);
          perp2_score += future_dist2;
        }
      }

      const better_perp = perp1_score > perp2_score ? perp1 : perp2;
      const perp_len = Math.sqrt(better_perp[0] ** 2 + better_perp[1] ** 2);

      if (perp_len > 0) {
        move = [better_perp[0] / perp_len * max_speed, better_perp[1] / perp_len * max_speed];
      }
    } else if (closest_item && closest_item_dist < 380 && !high_level) {
      // Collect items aggressively when low level
      const dx = closest_item.pos[0] - px;
      const dy = closest_item.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        move = [dx / dist * max_speed, dy / dist * max_speed];
      }
    } else if (closest_item && closest_item_dist < 300 && high_level) {
      // Collect critical items when high level (for boss prep)
      const dx = closest_item.pos[0] - px;
      const dy = closest_item.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        move = [dx / dist * max_speed, dy / dist * max_speed];
      }
    } else if (bosses.length > 0 && high_level) {
      // Fight boss when level is high
      const boss = bosses[0];
      const dx = boss.pos[0] - px;
      const dy = boss.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        if (dist > 150) {
          move = [dx / dist * max_speed, dy / dist * max_speed];
        } else if (dist > 80) {
          move = [dx / dist * (max_speed * 0.5), dy / dist * (max_speed * 0.5)];
        } else if (dist > 50) {
          move = [dx / dist * (max_speed * 0.2), dy / dist * (max_speed * 0.2)];
        } else {
          move = [-dx / dist * (max_speed * 0.7), -dy / dist * (max_speed * 0.7)];
        }
      }
    } else {
      // Default - stay safe
      const safe_x = field_w / 2;
      const safe_y = field_h * 0.25;

      const dx = safe_x - px;
      const dy = safe_y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 20) {
        const speed_mult = low_health ? 0.5 : 0.4;
        move = [dx / dist * (max_speed * speed_mult), dy / dist * (max_speed * speed_mult)];
      }
    }

    // Upgrade selection - balance for progression
    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      const options = obs.pending_upgrade.options;
      let best_idx = 0;
      let best_score = -Infinity;

      const rarity_val = { green: 1, blue: 2, purple: 3, orange: 4 };

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        let score = (rarity_val[opt.rarity] || 0) * 18;

        const text = (opt.name + ' ' + opt.desc).toLowerCase();

        // Prioritize health when low or at low level
        if (low_health || obs.player.level < 2) {
          if (text.includes('max hp')) score += 310;
          if (text.includes('shield')) score += 300;
          if (text.includes('invulnerable')) score += 290;
        } else {
          // Prioritize damage when healthy and higher level
          if (text.includes('projectile damage') || text.includes('bullet damage')) score += 320;
          if (text.includes('damage')) score += 270;
        }

        // Balanced additions
        if (text.includes('fire rate') || text.includes('shoot faster')) score += 210;
        if (text.includes('pierce')) score += 190;
        if (text.includes('max hp')) score += 240;
        if (text.includes('shield')) score += 230;
        if (text.includes('magnet')) score += 80;
        if (text.includes('satellite')) score += 70;

        // Avoid negatives
        if (text.includes('slow') || text.includes('freeze')) score -= 700;

        if (score > best_score) {
          best_score = score;
          best_idx = i;
        }
      }

      upgrade_choice = options[best_idx].index;
    }

    return { action: { move, upgrade_choice }, mem };
  },
};
