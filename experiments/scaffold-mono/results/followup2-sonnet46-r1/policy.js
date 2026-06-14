"use strict";
// v11: one-step-ahead bullet fix + heal_quick shield priority + tracked lifesteal/magnet boost

module.exports = {
  init() {
    return { bossX: 180, bossW: 120, hasLifesteal: false };
  },

  policy(obs, mem) {
    const { player, objects, field, pending_upgrade } = obs;
    const [px, py] = player.pos;
    const W = field.w;
    const H = field.h;
    const pHW = player.size[0] / 2;
    const pHH = player.size[1] / 2;
    const level = player.level;

    // ─── CATEGORIZE (needed early for upgrade scoring) ──────────────────────
    const bullets = objects.filter(o => o.type === 'enemy_bullet');
    const allEnemies = objects.filter(o => o.type === 'enemy' || o.type === 'enemy_elite');
    const bosses = objects.filter(o => o.type === 'boss' && !o.in_cutscene);
    const items = objects.filter(o => o.type === 'item');
    const hasBoss = bosses.length > 0;

    // ─── UPGRADE SELECTION ───────────────────────────────────────────────────
    let upgrade_choice = null;
    if (pending_upgrade && pending_upgrade.options && pending_upgrade.options.length > 0) {
      const opts = pending_upgrade.options;
      const hp_frac = player.hp / player.max_hp;
      const has_shield = player.shield_max > 0;
      const shield_pct = has_shield ? player.shield_hp / player.shield_max : 0;
      const hasMagnet = player.magnet_range > 70;

      const scoreUpgrade = (opt) => {
        const text = (opt.name + ' ' + opt.id + ' ' + opt.desc).toLowerCase();

        // Emergency heal: full HP + max_hp shield. In boss without shield: extra valuable.
        if (text.includes('回满生命') || (text.includes('应急') && text.includes('修'))) {
          if (hasBoss && !has_shield && hp_frac >= 0.8) return 155;
          return hp_frac < 0.4 ? 300 : hp_frac < 0.65 ? 210 : hp_frac < 0.8 ? 90 : 40;
        }

        // Bullet destroyer
        if (text.includes('摧毁') || text.includes('crush')) return 220;

        // EXP multiplier: CRITICAL for leveling
        if (text.includes('战术学习') || text.includes('经验倍率') ||
            (text.includes('经验') && (text.includes('%') || text.includes('×') || text.includes('x'))))
          return level <= 4 ? 220 : level <= 8 ? 145 : 90;

        // Split/3-shot: 3x projectile DPS
        if (text.includes('分裂') || text.includes('3发') || text.includes('split')) return 190;

        // Pierce: hits multiple enemies
        if (text.includes('穿透') || text.includes('pierce')) return 165;

        // Attack speed
        if (text.includes('急速射击') || text.includes('攻速') || text.includes('射速')) return 148;

        // mix_perfect: all-attribute boost (+25% dmg/rate/crit/HP, +175 magnet, +35% XP)
        // Safe threshold: below lifesteal (135/150) to not block critical survival path
        if (text.includes('mix_perfect') || text.includes('全属性'))
          return (hasBoss && !mem.hasLifesteal) ? 140 : (hasBoss ? 165 : 130);

        // Tyrant_breaker: 2x damage to boss AND elites - better than boss_hunter (1.3x)
        if (text.includes('tyrant') || (text.includes('双倍') && (text.includes('boss') || text.includes('精英'))))
          return hasBoss ? 260 : 100;

        // Boss damage: +30% boss damage is huge during boss fight, minor pre-boss
        if (text.includes('boss_hunter')) return hasBoss ? 230 : 90;

        // Lifesteal: critical for boss fight survival; in boss without it yet, beats attack speed
        if (text.includes('吸血') || text.includes('lifesteal'))
          return (hasBoss && !mem.hasLifesteal) ? 150 : 135;

        // Large bullet: bigger hit radius
        if (text.includes('大口径') || (text.includes('弹') && text.includes('大') && !text.includes('爆'))) return 132;

        // Satellites: extra auto-targeting DPS
        if (text.includes('卫星') || text.includes('satellite')) return 128;

        // Crit rate
        if (text.includes('暴击率') || text.includes('crit')) return 122;

        // High-tier damage upgrades (must check before general dmg% to distinguish tiers)
        if ((text.includes('伤害') || text.includes('dmg')) && !text.includes('暴击') && !text.includes('精英')) {
          if (text.includes('+100%')) return 132;  // dmg_xl: 2x damage
          if (text.includes('+50%'))  return 125;  // dmg_l: 1.5x damage
          if (text.includes('+20%'))  return 118;  // dmg_m: 1.2x damage
        }

        // Damage %
        if ((text.includes('伤害') || text.includes('dmg')) && text.includes('%') && !text.includes('精英')) return 115;

        // Magnet: critical for XP collection. Priority depends on lifesteal status & phase.
        if (text.includes('磁') || text.includes('拾取')) {
          if (hasMagnet) return 30;  // already have it
          if (hasBoss && mem.hasLifesteal) return 160;  // boss phase: top priority after pierce/split
          if (mem.hasLifesteal) return level <= 6 ? 130 : 80;  // pre-boss: high at early levels to get before boss
          return level <= 6 ? 108 : 62;  // no lifesteal yet: don't beat lifesteal (135)
        }

        // Shield: extra buffer
        if (text.includes('护盾') || text.includes('shield')) {
          // heal_overflow: lifesteal overflow → compounding shield. Prioritize when shield nearly gone.
          if ((opt.id.includes('overflow') || text.includes('overflow') || text.includes('溢出')) &&
              hasBoss && mem.hasLifesteal && has_shield && shield_pct < 0.10)
            return 200;
          if (has_shield) return 50;
          if (hasBoss) return 160;
          // Pre-boss with lifesteal: shield enables heal_overflow compound mechanic → higher priority
          if (mem.hasLifesteal) return 150;
          return hp_frac < 0.8 ? 110 : 95;
        }

        // Elite damage
        if (text.includes('精英') && (text.includes('伤害') || text.includes('猎'))) return 85;

        // HP
        if (text.includes('生命') && !text.includes('倍率') && !text.includes('吸血')) return 55;

        // Thorn
        if (text.includes('静电') || text.includes('thorn')) return 30;

        // Reroll: better than thorn/coins in a bad pool
        if (text.includes('reroll') || text.includes('重随')) return 35;

        // Coins / drop rate
        if (text.includes('金币') || text.includes('掉落率')) return 20;

        const r = { orange: 25, purple: 20, blue: 15, green: 10 };
        return r[opt.rarity] || 10;
      };

      let bestOpt = opts[0];
      let bestScore = scoreUpgrade(opts[0]);
      for (const opt of opts) {
        const s = scoreUpgrade(opt);
        if (s > bestScore) { bestScore = s; bestOpt = opt; }
      }
      upgrade_choice = bestOpt.index;
    }

    // ─── UPDATE MEM ──────────────────────────────────────────────────────────
    let newMem = { bossX: mem.bossX || 180, bossW: mem.bossW || 120, hasLifesteal: mem.hasLifesteal || false };
    if (hasBoss) {
      const boss = bosses[0];
      newMem.bossX = boss.pos[0];
      newMem.bossW = boss.size[0];
    }
    // Track when lifesteal upgrade is chosen (so magnet can be boosted after)
    if (upgrade_choice !== null && pending_upgrade && pending_upgrade.options) {
      const chosen = pending_upgrade.options.find(o => o.index === upgrade_choice);
      if (chosen) {
        const ct = (chosen.name + ' ' + chosen.id + ' ' + (chosen.desc || '')).toLowerCase();
        if (ct.includes('吸血') || ct.includes('lifesteal')) newMem.hasLifesteal = true;
      }
    }

    const trackedBossX = newMem.bossX;
    const enemiesAbove = allEnemies.filter(o => o.pos[1] < py - 70);

    // ─── BULLET DANGER ZONES ─────────────────────────────────────────────────
    // Same radius as v10: pHW=12, bullet_halfW≈3.5, safety margin ≈2.5.
    const HIT_RADIUS = hasBoss ? (pHW + 4 + 2) : (pHW + 4 + 5);  // 18 boss, 21 normal
    const TIME_HORIZON = 60;

    const dangerZones = [];
    for (const b of bullets) {
      if (b.vel[1] <= 0 || b.pos[1] >= py + pHH) continue;
      let landX;
      if (b.pos[1] > py) {
        // In lower hitbox: collision check is next-step. Use next-step bullet X.
        landX = b.pos[0] + b.vel[0];
      } else {
        const timeLeft = (py - b.pos[1]) / b.vel[1];
        if (timeLeft > TIME_HORIZON) continue;
        // For bullets arriving within 1 step, use next-step position for accuracy.
        landX = timeLeft <= 1 ? b.pos[0] + b.vel[0] : b.pos[0] + b.vel[0] * timeLeft;
      }
      dangerZones.push({ landX });
    }

    const isSafe = (x) => dangerZones.every(z => Math.abs(x - z.landX) >= HIT_RADIUS);
    const playerCurrentlySafe = isSafe(px);

    // Find nearest safe X (general)
    let safeX = px;
    if (!playerCurrentlySafe) {
      let bestDist = Infinity;
      for (let s = 2; s <= 200; s += 2) {
        let found = false;
        for (const dir of [-1, 1]) {
          const tx = Math.max(pHW + 5, Math.min(W - pHW - 5, px + dir * s));
          if (isSafe(tx)) {
            const d = Math.abs(tx - px);
            if (d < bestDist) { bestDist = d; safeX = tx; }
            found = true;
            break;
          }
        }
        if (found && bestDist <= s + 2) break;
      }
    }

    // Find safe X closest to boss position (for boss-mode alignment)
    let safeBossX = isSafe(trackedBossX) ? trackedBossX : safeX;
    if (hasBoss && !isSafe(trackedBossX)) {
      let bestBossDist = Math.abs(safeX - trackedBossX);
      for (let s = 2; s <= 120; s += 2) {
        for (const dir of [-1, 1]) {
          const tx = Math.max(pHW + 5, Math.min(W - pHW - 5, trackedBossX + dir * s));
          if (isSafe(tx)) {
            const d = Math.abs(tx - trackedBossX);
            if (d < bestBossDist) { bestBossDist = d; safeBossX = tx; }
          }
        }
        if (bestBossDist <= s + 2) break;
      }
    }

    // ─── CONTACT THREATS ─────────────────────────────────────────────────────
    const CONTACT_Y = 90;
    const contactThreats = allEnemies.filter(e => {
      const dx = Math.abs(e.pos[0] - px);
      const dy = Math.abs(e.pos[1] - py);
      return dy < CONTACT_Y && dx < (pHW + e.size[0] / 2 + 45);
    });

    // ─── TARGET X DECISION ───────────────────────────────────────────────────
    let targetX;
    let mode;

    if (contactThreats.length > 0) {
      mode = 'contact';
      const threat = contactThreats.reduce((a, b) =>
        Math.abs(a.pos[1] - py) < Math.abs(b.pos[1] - py) ? a : b);
      const thrX = threat.pos[0];
      targetX = thrX > px
        ? Math.max(pHW + 10, thrX - 130)
        : Math.min(W - pHW - 10, thrX + 130);

    } else if (!playerCurrentlySafe) {
      mode = 'dodge';
      targetX = safeX;

    } else if (hasBoss) {
      mode = 'boss';
      const drift = 6 * Math.sin(obs.step * 0.29);
      targetX = Math.max(pHW + 5, Math.min(W - pHW - 5, trackedBossX + drift));

    } else if (enemiesAbove.length > 0) {
      mode = 'attack';
      const candidates = enemiesAbove.filter(e => (py - e.pos[1]) > 85);
      if (candidates.length > 0) {
        const best = candidates.reduce((best, e) => {
          const dy = py - e.pos[1];
          const hp = e.hp || 1;
          const score = 6000 / (dy + 15) + 300 / hp;
          return score > (best.score || 0) ? { e, score } : best;
        }, {});
        const proposedX = best.e.pos[0];
        targetX = isSafe(proposedX) ? proposedX : safeX;
      } else {
        targetX = safeX;
      }

    } else {
      mode = 'collect';
      let bestItemX = safeX;
      let bestScore = -1;
      for (const item of items) {
        const itemX = item.pos[0];
        const idx = itemX - px;
        const idy = item.pos[1] - py;
        const dist = Math.sqrt(idx * idx + idy * idy);
        if (dist <= player.magnet_range) continue;
        const val = item.item_type === 'invincible' ? 600 :
                    item.item_type === 'heart' ? 50 :
                    (item.exp_value || 5);
        const yPenalty = item.item_type === 'invincible' ? 1.0 :
                         idy < -120 ? 0.2 : idy < -40 ? 0.7 : 1.0;
        const s = val * yPenalty / (dist + 20);
        if (s > bestScore && isSafe(itemX)) { bestScore = s; bestItemX = itemX; }
      }
      targetX = bestItemX;
    }

    // ─── COLLISION SAFETY ────────────────────────────────────────────────────
    let rawMoveX = targetX - px;
    const maxSpeedX = mode === 'contact' ? 38 : (mode === 'dodge' ? 36 : 34);
    const absMX = Math.abs(rawMoveX);
    let moveX = absMX > 0 ? (rawMoveX / absMX) * Math.min(absMX, maxSpeedX) : 0;

    // Verify landing position is safe
    if (Math.abs(moveX) > 0) {
      const landingX = Math.max(pHW, Math.min(W - pHW, px + moveX));
      if (!isSafe(landingX)) {
        const dir = Math.sign(moveX);
        let found = false;
        for (let d = Math.floor(Math.abs(moveX)) - 1; d >= 0; d--) {
          const tx = Math.max(pHW, Math.min(W - pHW, px + dir * d));
          if (isSafe(tx)) { moveX = dir * d; found = true; break; }
        }
        if (!found) {
          for (let d = 1; d <= maxSpeedX; d++) {
            const tx = Math.max(pHW, Math.min(W - pHW, px + (-dir) * d));
            if (isSafe(tx)) { moveX = (-dir) * d; break; }
          }
        }
      }
    }

    // Enemy contact collision safety
    if (Math.abs(moveX) > 0) {
      const proposedX = px + moveX;
      for (const e of allEnemies) {
        if (Math.abs(e.pos[1] - py) > CONTACT_Y) continue;
        const eHW = e.size[0] / 2;
        const safeGap = pHW + eHW + 5;
        const eX = e.pos[0];
        if (Math.abs(proposedX - eX) < safeGap) {
          moveX = moveX > 0
            ? Math.max(0, eX - safeGap - px)
            : Math.min(0, eX + safeGap - px);
        }
      }
    }

    // ─── Y ANCHOR ────────────────────────────────────────────────────────────
    const preferredY = hasBoss ? H * 0.75 : H * 0.70;
    const yGain = hasBoss ? 0.25 : 0.12;
    let moveY = (preferredY - py) * yGain;
    for (const e of contactThreats) {
      if (Math.abs(e.pos[1] - py) < 50) moveY -= 6;
    }

    // ─── CLAMP & BOUNDARY ────────────────────────────────────────────────────
    const mag = Math.sqrt(moveX * moveX + moveY * moveY);
    if (mag > 38) { moveX *= 38 / mag; moveY *= 38 / mag; }

    const newX = Math.max(pHW, Math.min(W - pHW, px + moveX));
    const newY = Math.max(pHW, Math.min(H - pHH, py + moveY));

    return { action: { move: [newX - px, newY - py], upgrade_choice }, mem: newMem };
  }
};
