"use strict";
/**
 * Roguelike Skies policy v11
 *
 * Key changes:
 * - Boss phase: very gentle movement (speed cap 15px, bullet force 2x, safe-zone scan)
 * - Boss targeting: stay directly below boss ±20px, maximize DPS on boss
 * - Pre-boss: strong x-alignment (0.08), aggressive exp item collection
 * - Upgrade priority: pc_pierce/ms_split/exp_basic all very high
 */

const UPGRADE_SCORES = {
  ms_split_s: 330, ms_split_m: 370, ms_split_l: 410,
  pc_pierce: 350,
  laser_s: 270, laser_m: 300,
  missile_s: 250, missile_m: 280,
  satellite_s: 230, satellite_m: 260,
  boss_hunter: 280, mix_terminal: 210, mix_fire: 200, mix_perfect: 275,
  dmg_m: 200, dmg_s: 130, rapid_s: 180, rapid_m: 215, fr_basic: 160,
  side_s: 200, side_m: 235, spread_s: 190,
  kill_pulse: 165, kill_blood: 140, bs_size_s: 110, bs_size_m: 140,
  heal_quick: 175, timeflow_shield: 220, shield_s: 130, shield_m: 165,
  heal_regen_s: 100, heal_regen_m: 130, heal_overflow: 90, thorn_static: 95,
  exp_basic: 300, exp_m: 240, drop_basic: 105,
  mag_basic: 95, magnet_s: 85, magnet_m: 105, reroll_premium: 90,
  coin_small: 20, mix_econ: 45,
};

module.exports = {
  init() { return { tick: 0 }; },
  policy(obs, mem) {
    try { return computeMove(obs, mem); }
    catch (e) { return { action: { move: [0, 0], upgrade_choice: 0 }, mem }; }
  },
};

function computeMove(obs, mem) {
  const [px, py] = obs.player.pos;
  const { w: fw, h: fh } = obs.field;
  const SPEED = 40;

  mem.tick = (mem.tick || 0) + 1;
  const t = mem.tick;

  const enemyBullets = [];
  const items = [];
  const enemies = [];
  const bosses = [];

  for (const o of obs.objects) {
    switch (o.type) {
      case 'enemy_bullet': enemyBullets.push(o); break;
      case 'item': items.push(o); break;
      case 'enemy': case 'enemy_elite': enemies.push(o); break;
      case 'boss': bosses.push(o); break;
    }
  }

  const hasBoss = bosses.length > 0;

  // Detect second boss by max_hp increase: boss 1→2 transition goes 1→2→1 (array never empty).
  // Record first boss's max_hp; if current boss max_hp is >1.5× that, we're on boss 2.
  if (hasBoss && !bosses[0].in_cutscene) {
    if (!mem.firstBossMaxHp) mem.firstBossMaxHp = bosses[0].max_hp;
  }
  const onSecondBoss = hasBoss && !bosses[0].in_cutscene &&
                       !!mem.firstBossMaxHp && bosses[0].max_hp > mem.firstBossMaxHp * 1.5;

  // One-time reset of HP tracking when second boss is first detected
  if (onSecondBoss && !mem.secondBossTracked) {
    mem.secondBossTracked = true;
    mem.bossTransitionTicks = 0;
    mem.prevBossHp = undefined;
  }

  // Track boss HP to detect phase transitions (boss invulnerable + fires lethal burst)
  if (hasBoss && !bosses[0].in_cutscene) {
    const bossHpNow = bosses[0].hp;
    if (mem.prevBossHp !== undefined && bossHpNow === mem.prevBossHp) {
      mem.bossTransitionTicks = (mem.bossTransitionTicks || 0) + 1;
    } else {
      mem.bossTransitionTicks = 0;
    }
    mem.prevBossHp = bossHpNow;
  } else {
    mem.bossTransitionTicks = 0;
    if (!hasBoss) mem.prevBossHp = undefined;
  }
  // Boss 1: threshold=3. Boss 2: threshold=30 to avoid false positives from inter-shot gaps.
  const transThreshold = onSecondBoss ? 30 : 3;
  const inTransition = (mem.bossTransitionTicks || 0) >= transThreshold;

  let dx = 0;
  let dy = 0;

  // === 1. ENEMY + BOSS BODY AVOIDANCE ===
  const ENEMY_DANGER_RADIUS = 68;
  for (const e of enemies) {
    const ex = e.pos[0];
    const ey = e.pos[1];
    const dist = Math.hypot(ex - px, ey - py);
    if (dist < ENEMY_DANGER_RADIUS && dist > 1) {
      const danger = Math.max(0, 1 - dist / ENEMY_DANGER_RADIUS);
      const strength = danger * danger * 5;
      dx += (px - ex) / dist * strength * SPEED;
      dy += (py - ey) / dist * strength * SPEED;
    }
  }



  // === 2. BULLET DODGING ===
  const ZONE = 105;
  let threatLeft = 0;
  let threatRight = 0;

  for (const b of enemyBullets) {
    const bx = b.pos[0];
    const by = b.pos[1];
    const bvy = b.vel ? b.vel[1] : 4;

    if (bvy > 0.3 && by < py + 10) {
      const xDiff = bx - px;
      const absXDiff = Math.abs(xDiff);
      if (absXDiff < ZONE) {
        let urgency = 1;
        if (by < py) {
          const timeToY = (py - by) / bvy;
          if (timeToY < 60) urgency = 1 + 3 * (1 - timeToY / 60);
        } else {
          urgency = 4;
        }
        const xDanger = 1 - absXDiff / ZONE;
        const threat = xDanger * xDanger * urgency;
        if (bx < px) threatLeft += threat;
        else threatRight += threat;
      }
    }
  }

  // Boss phase: gentler dodge; pre-boss: normal
  const hpRatio = obs.player.hp / obs.player.max_hp;
  // When HP is below 50% in boss phase, dodge harder. During transitions, max dodge.
  const bossLowHp = hasBoss && hpRatio < 0.50;
  const bulletForce = hasBoss ? (inTransition ? 8 : bossLowHp ? 5 : 2) : 6;
  dx += (threatLeft - threatRight) * bulletForce;

  // === 3. VERTICAL POSITIONING ===
  let targetY;
  if (hasBoss) {
    const boss = bosses[0];
    // Low-HP boss entry: stay 100px further to gain more bullet dodge time
    const extraDist = bossLowHp ? 100 : 0;
    targetY = Math.min(fh * 0.88, Math.max(fh * 0.60, boss.pos[1] + 280 + extraDist));
  } else {
    targetY = fh * 0.80;
  }
  const yErr = targetY - py;
  dy += Math.sign(yErr) * Math.min(Math.abs(yErr) * 0.10, SPEED * 0.4);

  // === 4. X POSITIONING ===
  if (hasBoss) {
    const boss = bosses[0];
    if (!boss.in_cutscene) {
      const bossX = boss.pos[0];

      // Scan ±80px of boss for safest x — linear distance penalty lets player
      // escape to safe zones when nearby is bullet-dense
      let bestX = bossX;
      let bestScore = Infinity;

      for (let offset = -80; offset <= 80; offset += 8) {
        const tx = Math.max(30, Math.min(fw - 30, bossX + offset));
        let density = 0;
        for (const b of enemyBullets) {
          const by = b.pos[1];
          const bvy = b.vel ? b.vel[1] : 4;
          if (bvy <= 0.3 || by >= py + 10 || by < py - 280) continue;
          const xDist = Math.abs(b.pos[0] - tx);
          if (xDist < 55) {
            const d = (1 - xDist / 55);
            density += d * d;
          }
        }
        // Linear penalty: allows escape to safe zones while preferring boss proximity
        const distPenalty = Math.abs(offset) * 0.04;
        const score = density + distPenalty;
        if (score < bestScore) { bestScore = score; bestX = tx; }
      }

      // Dynamic pull: stronger when far from best position (corrects large misalignments quickly)
      const distToBest = Math.abs(bestX - px);
      const pullStrength = 0.06 + Math.max(0, (distToBest - 60) * 0.002);
      dx += (bestX - px) * pullStrength;

      // Second boss non-transition: extra pull toward boss X to stay aligned for DPS
      if (onSecondBoss && !inTransition) {
        dx += (bossX - px) * 0.03;
      }
    }
  } else {
    // Align with enemies above to maximize kills
    const safeAbove = py - 65;
    const aboveEnemies = enemies.filter(e => e.pos[1] < safeAbove);

    if (aboveEnemies.length > 0) {
      let totalW = 0, weightedX = 0;
      for (const e of aboveEnemies) {
        const w = 1 / (Math.abs(e.pos[0] - px) + 15);
        weightedX += e.pos[0] * w;
        totalW += w;
      }
      dx += (weightedX / totalW - px) * 0.08;
    } else if (enemies.length === 0) {
      dx += Math.sin(t * 0.05) * SPEED * 0.4;
      dx += (fw * 0.5 - px) * 0.03;
    }
  }

  // === 5. ITEM COLLECTION ===
  const ITEM_RADIUS = 220;
  for (const item of items) {
    const dist = Math.hypot(item.pos[0] - px, item.pos[1] - py);
    if (dist < ITEM_RADIUS && dist > 1) {
      // Skip items guarded by a live enemy (chasing them causes collisions)
      const guarded = enemies.some(e =>
        Math.hypot(e.pos[0] - item.pos[0], e.pos[1] - item.pos[1]) < 80
      );
      if (guarded) continue;

      // During boss dive (boss has descended to y>270), skip items above the player.
      if (hasBoss && bosses.length > 0 && bosses[0].pos[1] > 270 && item.pos[1] < py - 20) continue;

      // In final endgame (player HP<50% AND boss nearly dead <12%), skip items above to prevent
      // upward drift into dense bullet zones. Items fall to player level naturally.
      if (hasBoss && bossLowHp && bosses.length > 0 && !bosses[0].in_cutscene &&
          (bosses[0].hp / bosses[0].max_hp) < 0.13 && item.pos[1] < py - 20) continue;

      let pull;
      switch (item.item_type) {
        case 'heart': pull = 0.9; break;
        case 'levelup': pull = 1.0; break;
        case 'invincible': pull = 1.0; break;
        case 'bomb': pull = 0.7; break;
        case 'magnet': pull = 0.6; break;
        default: pull = 0.55; break;
      }
      const f = pull * SPEED * (1 - dist / ITEM_RADIUS);
      dx += ((item.pos[0] - px) / dist) * f;
      dy += ((item.pos[1] - py) / dist) * f;
    }
  }

  // === 5.5 BOSS PROXIMITY REPULSION ===
  // Push away from boss body when inside collision zone (dist<80) and NOT invincible.
  // Exempts approach when an invincible pickup is nearby — collecting it grants immunity,
  // making the overlap safe (as seen in the invincible-item-collection window).
  if (hasBoss && bosses.length > 0 && obs.player.invincible_ms <= 0) {
    const boss = bosses[0];
    const playerBossDist = Math.hypot(boss.pos[0] - px, boss.pos[1] - py);
    if (playerBossDist < 120 && playerBossDist > 1) {
      // Only exempt invincible items that are BELOW boss: those can be safely
      // approached from below without crossing the boss body. Invincible items
      // above the boss require crossing through boss to collect — still blocked.
      const invincibleNearby = items.some(i =>
        i.item_type === 'invincible' &&
        Math.hypot(i.pos[0] - px, i.pos[1] - py) < ITEM_RADIUS &&
        i.pos[1] > boss.pos[1]
      );
      if (!invincibleNearby) {
        dx += (px - boss.pos[0]) / playerBossDist * 150;
        dy += (py - boss.pos[1]) / playerBossDist * 150;
      }
    }
  }

  // === 6. WALL REPULSION ===
  const wallRepel = 45;
  if (px < wallRepel) dx += (wallRepel - px) * 0.5;
  if (px > fw - wallRepel) dx -= (px - (fw - wallRepel)) * 0.5;
  if (py < 60) dy += 5;
  if (py > fh - 25) dy -= 5;

  // === 7. CLAMP — tighter speed cap during dense boss bullets ===
  const speedCap = hasBoss ? 15 : SPEED;
  const mag = Math.hypot(dx, dy);
  if (mag > speedCap) { dx = dx / mag * speedCap; dy = dy / mag * speedCap; }

  const margin = 15;
  if (px + dx < margin) dx = margin - px;
  if (px + dx > fw - margin) dx = fw - margin - px;
  if (py + dy < margin) dy = margin - py;
  if (py + dy > fh - margin) dy = fh - margin - py;

  // --- UPGRADE ---
  let upgrade_choice = null;
  if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
    upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, obs, hasBoss);
  }

  return { action: { move: [dx, dy], upgrade_choice }, mem };
}

function chooseUpgrade(options, obs, hasBoss) {
  const rarityScore = { orange: 500, purple: 350, blue: 200, green: 100 };
  const hpRatio = obs.player.hp / obs.player.max_hp;

  const scored = options.map(opt => {
    const rarity = rarityScore[opt.rarity] || 0;
    const id = (opt.id || '').toLowerCase();

    let idScore = UPGRADE_SCORES[id];
    if (idScore === undefined) {
      if (id.includes('split')) idScore = 270;
      else if (id.includes('pierce') || id.startsWith('pc_')) idScore = 260;
      else if (id.includes('dmg') || id.includes('damage')) idScore = 145;
      else if (id.includes('laser')) idScore = 250;
      else if (id.includes('missile')) idScore = 235;
      else if (id.includes('satellite') || id.includes('sat_')) idScore = 215;
      else if (id.includes('rapid') || id.includes('fr_')) idScore = 185;
      else if (id.includes('fire') && id.length > 5) idScore = 165;
      else if (id.includes('side')) idScore = 195;
      else if (id.includes('heal') || id.includes('regen')) idScore = 115;
      else if (id.includes('shield')) idScore = 125;
      else if (id.includes('exp')) idScore = 180;
      else if (id.includes('perfect')) idScore = 260;
      else if (id.includes('boss') || id.includes('hunter')) idScore = 215;
      else if (id.includes('coin') || id.includes('econ')) idScore = 38;
      else if (id.includes('mix_')) idScore = 135;
      else if (id.includes('kill_')) idScore = 132;
      else idScore = 68;
    }

    // Heal boost — emergency priority when HP critically low
    if (hpRatio < 0.5) {
      const boost = Math.round((0.5 - hpRatio) * 1500);
      if (id === 'heal_quick') idScore += boost;
      else if (id.includes('heal') || id.includes('regen')) idScore += Math.round(boost * 0.45);
      else if (id === 'shield_m' || id === 'shield_s') idScore += Math.round(boost * 0.3);
    }
    // Emergency boss-phase survival: at critical HP, heal beats damage upgrades
    if (hasBoss && hpRatio < 0.15) {
      const emergencyBoost = Math.round((0.15 - hpRatio) * 6000);
      if (id === 'heal_quick') idScore += emergencyBoost;
      else if (id.includes('shield')) idScore += Math.round(emergencyBoost * 0.7);
      else if (id.includes('heal')) idScore += Math.round(emergencyBoost * 0.5);
    }

    // Pre-boss: boss_hunter is a future investment; not worth sacrificing survival for
    if (!hasBoss && (id === 'boss_hunter')) idScore = Math.min(idScore, 120);

    // Boss phase: strongly prefer damage upgrades
    if (hasBoss) {
      if (id === 'boss_hunter') idScore += 300;
      if (id === 'ms_split_s' || id === 'ms_split_m' || id === 'ms_split_l') idScore += 200;
      if (id === 'pc_pierce') idScore += 150;
      if (id.includes('dmg') || id.includes('damage')) idScore += 80;
      if (id.includes('rapid') || id.includes('fr_') || id.includes('fire')) idScore += 60;
      if (id.includes('laser') || id.includes('missile')) idScore += 50;
    }

    return { opt, score: rarity + idScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].opt.index;
}
