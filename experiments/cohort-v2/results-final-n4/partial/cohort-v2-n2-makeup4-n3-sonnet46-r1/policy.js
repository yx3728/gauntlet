"use strict";

function scoreUpgrade(opt, ctx) {
  const rarity = opt.rarity;
  const name = (opt.name || '').toLowerCase();
  const desc = (opt.desc || '').toLowerCase();
  const text = name + ' ' + desc;
  const wave = (ctx && ctx.wave) || 1;
  const isLateGame = wave >= 3;
  const rarityScore = { orange: 400, purple: 300, blue: 200, green: 100 }[rarity] || 100;
  const hasShield = (ctx && ctx.shield_max) > 0;

  // When player has NO SHIELD and wave >= 2: defensive upgrades become survival-critical.
  // Wave 1 enemies are manageable without shield; wave 2 elites are not.
  const needsShield = !hasShield && wave >= 2;
  if (needsShield) {
    if ((text.includes('护盾') || text.includes('shield') || text.includes('应急')) &&
        !text.includes('对boss') && !text.includes('屠龙')) {
      return 5500 + rarityScore;
    }
  }

  // ===== TIER 0: ULTRA-RARE GAME-CHANGERS (6000+) =====
  // 神格降临: -50% damage BUT +1000% fire rate = 5.5x net DPS. Best early pickup.
  if (text.includes('神格') || (text.includes('射速') && text.includes('1000'))) return 7000;

  // Lifesteal: each 1% lets high DPS sustain indefinitely in boss fight.
  // Critical late game, weak early game (DPS too low to matter).
  if (text.includes('吸血') || text.includes('lifesteal') ||
      (text.includes('命中') && (text.includes('回复') || text.includes('恢复'))) ||
      (text.includes('伤害') && text.includes('回复') && text.includes('生命'))) {
    return isLateGame ? 8000 : 3500 + rarityScore;
  }

  // ===== TIER 1: BEST DPS MULTIPLIERS (5000-5200) =====
  // Split bullets (more streams = linear DPS multiplier)
  if (text.includes('分裂') || text.includes('split') || text.includes('spread') ||
      text.includes('side bullet') || text.includes('triple') ||
      text.includes('3发') || text.includes('5发') || text.includes('多发') ||
      text.includes('双发') || text.includes('弹道') || text.includes('多弹')) return 5200;

  // EXP multiplier: critical early to reach higher levels, less valuable mid-late
  if (text.includes('经验') && (text.includes('倍') || text.includes('×') ||
      text.includes('200%') || text.includes('100%') || text.includes('multiplier'))) {
    return isLateGame ? 2800 : (wave >= 2 ? 3800 : 4700);
  }

  // Fire rate: massive DPS multiplier, stackable.
  // 急速射击 (+32%) beats 火控协同 (+15% fire+8% dmg = 1.242x) for raw DPS.
  if (text.includes('急速')) return 5000;
  if (text.includes('射速') || text.includes('attack speed') || text.includes('fire rate') ||
      text.includes('rapid') || text.includes('射击间隔') ||
      text.includes('攻击间隔') || text.includes('间隔')) return 4800;

  // Pierce: bullets hit ALL enemies in path
  if (text.includes('穿透') || text.includes('pierce') || text.includes('穿射')) return 4600;

  // Satellites: extra tracking damage streams. Their damage benefits from all modifiers.
  if (text.includes('卫星') || text.includes('satellite') || text.includes('orbital')) return 5000;

  // ===== TIER 2: STRONG DPS (3800-4400) =====
  const isBossSpecific = text.includes('boss') || text.includes('龙') ||
                          text.includes('屠') || text.includes('对boss');
  // Elite-specific damage (精英猎手) is useless in boss fight
  const isEliteSpecific = (text.includes('精英') || text.includes('elite')) &&
                           (text.includes('伤害') || text.includes('damage'));
  if (!isBossSpecific && !isEliteSpecific) {
    if (text.includes('伤害') && (text.includes('+') || text.includes('提升') ||
        text.includes('增加') || text.includes('increase'))) return 4300;
    if (text.includes('damage') && (text.includes('+') || text.includes('boost') ||
        text.includes('increase'))) return 4300;
  }

  if (isBossSpecific && (text.includes('伤害') || text.includes('damage'))) return 3200 + rarityScore;
  // Elite damage: good in waves 1-2 (fight elites), nearly useless in boss fight
  if (isEliteSpecific) return isLateGame ? 1800 + rarityScore : 3200 + rarityScore;
  if (text.includes('暴击') || text.includes('crit')) return 2800 + rarityScore;
  // On-kill explosions: small DPS multiplier
  if (text.includes('爆炸') || text.includes('explosion') || text.includes('爆')) return 2200 + rarityScore;

  // ===== TIER 3: DEFENSIVE/UTILITY (2000-3000) =====
  // Shield with ongoing regen (能量护盾) > one-time restore (应急修复)
  if ((text.includes('护盾') || text.includes('shield')) &&
      (text.includes('修复') || text.includes('再生') || text.includes('regen') || text.includes('自动'))) {
    return 3000 + rarityScore;
  }
  if (text.includes('应急') || (text.includes('回满') && text.includes('护盾'))) return 2600 + rarityScore;
  if (text.includes('护盾') || text.includes('shield')) return 2400 + rarityScore;

  // Reflect damage (静电护甲: 受到伤害后对敌人造成等量伤害)
  if ((text.includes('受到') || text.includes('被')) &&
      (text.includes('护甲') || text.includes('反弹') || text.includes('反射') ||
       text.includes('造成等量') || text.includes('等量伤害'))) return 2200 + rarityScore;

  if (text.includes('回复') || text.includes('heal') || text.includes('regen') ||
      text.includes('自动修复')) return 2200 + rarityScore;
  if (text.includes('生命') || text.includes('blood') || text.includes('health') ||
      text.includes('血量')) return 1900 + rarityScore;
  if (text.includes('磁') || text.includes('magnet') || text.includes('拾取')) return 1900 + rarityScore;
  if (text.includes('战利品') || text.includes('精英') || text.includes('必定')) return 1700 + rarityScore;
  if (text.includes('经验') || text.includes('exp') || text.includes('xp')) return 1500 + rarityScore;
  if (text.includes('金币') || text.includes('coin') || text.includes('经济')) return 700 + rarityScore;
  // 高级重掷 guarantees purple/orange next level-up — high expected value
  if (text.includes('高级重掷') || text.includes('必含紫') || text.includes('必含橙')) return 2800 + rarityScore;
  if (text.includes('重掷') || text.includes('reroll') || text.includes('下一次')) return 500 + rarityScore;
  return rarityScore;
}

function chooseUpgrade(options, ctx) {
  let bestIdx = options[0].index;
  let bestScore = -Infinity;
  for (const opt of options) {
    const s = scoreUpgrade(opt, ctx);
    const rarityTie = { orange: 0.04, purple: 0.03, blue: 0.02, green: 0.01 }[opt.rarity] || 0.01;
    const total = s + rarityTie;
    if (total > bestScore) { bestScore = total; bestIdx = opt.index; }
  }
  return bestIdx;
}

function vecLen(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Simulate boss x after N ticks with wall bounces
function predictBossX(bx, bvx, ticks, fw, bossHalfW) {
  const left = bossHalfW;
  const right = fw - bossHalfW;
  let x = bx, vx = bvx;
  for (let t = 0; t < ticks; t++) {
    x += vx;
    if (x <= left) { x = 2 * left - x; vx = -vx; }
    if (x >= right) { x = 2 * right - x; vx = -vx; }
  }
  return x;
}

const BULLET_SPEED_Y = 8.5;

module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const { w: fw, h: fh } = obs.field;
    const SPEED = 40;

    // Handle upgrade panel — pass player state for context-aware scoring
    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, {
        wave: obs.wave,
        step: obs.step,
        shield_max: obs.player.shield_max || 0,
        shield_hp: obs.player.shield_hp || 0,
        level: obs.player.level || 1,
      });
    }

    // Classify all objects
    const bullets = [], items = [], normalEnemies = [], elites = [], bosses = [];
    for (const obj of obs.objects) {
      if (obj.type === 'enemy_bullet') bullets.push(obj);
      else if (obj.type === 'item') items.push(obj);
      else if (obj.type === 'enemy') normalEnemies.push(obj);
      else if (obj.type === 'enemy_elite') elites.push(obj);
      else if (obj.type === 'boss' && !obj.in_cutscene) bosses.push(obj);
    }

    const allEnemyBodies = [...normalEnemies, ...elites, ...bosses];
    const isBoss = bosses.length > 0;
    const boss = isBoss ? bosses[0] : null;

    // High-fire-rate indicator: shoot_interval < 120ms means player likely has 神格降临
    const hasHighFireRate = obs.player.shoot_interval_ms < 120;
    // Has shield: don't recklessly hunt elites without absorbing damage
    const hasShield = (obs.player.shield_max || 0) > 0;

    // ================================================================
    // BOSS FIGHT
    // ================================================================
    if (isBoss && boss) {
      const [bx, by] = boss.pos;
      const [bvx] = boss.vel || [0, 0];
      const bossEntered = by > 50;

      // Priority: grab invincible/levelup items — only if in safe zone (not near boss body)
      const specialItems = items.filter(i =>
        (i.item_type === 'invincible' || i.item_type === 'levelup') && i.pos[1] > fh * 0.45);
      if (specialItems.length > 0) {
        const si = specialItems[0];
        const [ix, iy] = si.pos;
        const id = vecLen(ix - px, iy - py);
        if (id > 3) {
          let idx = clamp((ix - px) / id * SPEED * 0.9, -SPEED, SPEED);
          let idy = clamp((iy - py) / id * SPEED * 0.9, -SPEED, SPEED);
          // Boundary: don't go too high or into boss body
          if (py < fh * 0.4 && idy < 0) idy = Math.max(idy, SPEED * 0.5);
          return { action: { move: [idx, idy], upgrade_choice }, mem };
        }
      }

      // Boss entry: hold at bottom-center and dodge
      if (!bossEntered) {
        const holdX = fw * 0.5;
        const holdY = fh * 0.85;
        let fdx = (holdX - px) * 0.5;
        let fdy = (holdY - py) * 0.5;
        for (const b of bullets) {
          const [bxb, byb] = b.pos;
          const [bvxb, bvyb] = b.vel || [0, 0];
          let minDist = Infinity, minTx = bxb, minTy = byb;
          for (let t = 1; t <= 20; t++) {
            const fx = bxb + bvxb * t, fy = byb + bvyb * t;
            const d = vecLen(fx - px, fy - py);
            if (d < minDist) { minDist = d; minTx = fx; minTy = fy; }
          }
          if (minDist > 160) continue;
          const prox = Math.max(0, 1 - minDist / 80) ** 2;
          const len = vecLen(px - minTx, py - minTy);
          if (len > 0.01) { fdx += (px - minTx) / len * prox * 10; fdy += (py - minTy) / len * prox * 10; }
        }
        const margin = 20;
        if (px < margin) fdx += (margin - px) * 0.8;
        if (px > fw - margin) fdx -= (px - (fw - margin)) * 0.8;
        if (py < 40) fdy += (40 - py) * 0.8;
        if (py > fh - 15) fdy -= (py - (fh - 15)) * 0.8;
        const fLen = vecLen(fdx, fdy);
        const dx = fLen > 0.001 ? (fdx / fLen) * SPEED : 0;
        const dy = fLen > 0.001 ? (fdy / fLen) * SPEED : 0;
        return { action: { move: [dx, dy], upgrade_choice }, mem };
      }

      // Boss engaged: bounce-aware aim prediction
      const bossHalfW = 60;
      const travelTicks = Math.max(5, (py - by) / BULLET_SPEED_Y);
      const clampedBossX = predictBossX(bx, bvx, Math.round(travelTicks), fw, bossHalfW);

      // Analyze incoming bullets: danger level + lateral dodge direction
      let dodgeBulletDanger = 0;
      let dodgeXBias = 0;  // positive = bias right, negative = bias left
      const BULLET_LA = 40;

      for (const b of bullets) {
        const [bxb, byb] = b.pos;
        const [bvxb, bvyb] = b.vel || [0, 0];
        if (bvyb <= 0) continue;

        const dyUp = py - byb;   // how far above player the bullet is
        if (dyUp <= 0 || dyUp > bvyb * BULLET_LA) continue;

        const timeToArrival = dyUp / bvyb;
        const bxAtArrival = bxb + bvxb * timeToArrival;
        const xGapAtArrival = Math.abs(bxAtArrival - px);

        if (xGapAtArrival >= 80) continue;

        const urgency = (1 - timeToArrival / BULLET_LA) * (1 - xGapAtArrival / 80);
        dodgeBulletDanger += urgency;

        // Lateral bias: move AWAY from where bullet will arrive
        const lateralDir = px > bxAtArrival ? 1 : -1;
        dodgeXBias += lateralDir * urgency;
      }

      // Preferred Y: stay 350px below boss for good dodge reaction time.
      const baseTargetY = clamp(by + 350, fh * 0.68, fh * 0.88);
      let targetY = baseTargetY;
      if (dodgeBulletDanger > 0.25) {
        targetY = Math.max(baseTargetY, py + 80);
        targetY = Math.min(targetY, fh * 0.92);
      }

      // Boss body avoidance (vertical)
      let bossAvoidY = 0;
      for (const e of allEnemyBodies) {
        const [ex, ey] = e.pos;
        const d = vecLen(px - ex, py - ey);
        if (d > 200) continue;
        const ratio = Math.max(0, 1 - d / 200) ** 3;
        if (d > 0.1) bossAvoidY += (py - ey) / d * ratio * 30;
      }

      // Weave ±30px around boss center (within boss 60px halfwidth, so bullets still hit boss).
      const weaveDir = ((obs.frame >> 6) & 1) ? 1 : -1;
      const weaveTarget = clamp(clampedBossX + weaveDir * 30, 30, fw - 30);

      const xError = weaveTarget - px;
      const yError = targetY - py;
      const dodgeForce = dodgeBulletDanger * 90;

      let dx = clamp(xError * 2.0 + dodgeXBias * 55, -SPEED, SPEED);
      let dy = clamp(yError * 1.5 + dodgeForce + bossAvoidY, -SPEED, SPEED);

      // Boundary enforcement
      const margin = 20;
      if (px < margin) dx = Math.max(dx, (margin - px) * 2);
      if (px > fw - margin) dx = Math.min(dx, -(px - (fw - margin)) * 2);
      if (py < 50) dy = Math.max(dy, (50 - py) * 2);
      if (py > fh - 20) dy = Math.min(dy, -(py - (fh - 20)) * 2);

      const moveLen = vecLen(dx, dy);
      if (moveLen > SPEED) { dx = dx / moveLen * SPEED; dy = dy / moveLen * SPEED; }

      return { action: { move: [dx, dy], upgrade_choice }, mem };
    }

    // ================================================================
    // NORMAL WAVE (waves 1 & 2)
    // ================================================================
    const forces = [0, 0];

    // Bullet avoidance: look ahead to detect approaching bullets.
    // Lookahead=45 covers bullets up to 45*vy≈200px above player.
    const BULLET_LOOK_AHEAD = 45, BULLET_SAFE = 100;
    for (const b of bullets) {
      const [bxb, byb] = b.pos;
      const [bvxb, bvyb] = b.vel || [0, 0];
      let minDist = Infinity, minTx = bxb, minTy = byb;
      for (let t = 1; t <= BULLET_LOOK_AHEAD; t++) {
        const fx = bxb + bvxb * t, fy = byb + bvyb * t;
        const d = vecLen(fx - px, fy - py);
        if (d < minDist) { minDist = d; minTx = fx; minTy = fy; }
      }
      if (minDist > BULLET_SAFE * 2.5) continue;
      const awDx = px - minTx, awDy = py - minTy;
      const proximity = Math.max(0, 1 - minDist / BULLET_SAFE) ** 2;
      const len = vecLen(awDx, awDy);
      if (len > 0.01) { forces[0] += (awDx / len) * proximity * 10; forces[1] += (awDy / len) * proximity * 10; }
    }

    // Enemy avoidance (general collision avoidance)
    const ENEMY_AVOID = 250;
    for (const e of allEnemyBodies) {
      const [ex, ey] = e.pos;
      const d = vecLen(px - ex, py - ey);
      if (d > ENEMY_AVOID) continue;
      const ratio = Math.max(0, 1 - d / ENEMY_AVOID) ** 3;
      if (d > 0.1) { forces[0] += (px - ex) / d * ratio * 25; forces[1] += (py - ey) / d * ratio * 25; }
    }

    // Safe Y: stay below most enemies but not too deep (y>510 puts player far from elites
    // at y=280-380, causing bullet lookahead to miss 50+ tick threats).
    let safeY = fh * 0.76;  // ~486px — good balance of DPS angle and bullet warning time
    for (const e of elites) {
      const [, ey] = e.pos;
      if (ey < py) safeY = Math.max(safeY, ey + 140);
    }
    safeY = Math.min(safeY, fh * 0.82);  // never below 524px

    // Target X: aim at enemies. With high DPS (神格降临), target elites actively.
    let targetX = fw * 0.5;
    let bestScore = -Infinity;

    if (hasHighFireRate && hasShield && elites.length > 0) {
      // 神格降临 mode: hunt elites for their huge EXP reward (only safe with shield)
      for (const e of elites) {
        const [ex, ey] = e.pos;
        const yGap = py - ey;
        if (yGap < 80 || yGap > 500) continue;
        const score = -Math.abs(px - ex) * 0.5;
        if (score > bestScore) { bestScore = score; targetX = ex; }
      }
    }

    if (bestScore === -Infinity) {
      for (const e of normalEnemies) {
        const [ex, ey] = e.pos;
        const yGap = py - ey;
        if (yGap < 150) continue;
        if (!hasHighFireRate || !hasShield) {
          let eliteConflict = false;
          for (const el of elites) {
            const [elx, ely] = el.pos;
            if (Math.abs(ex - elx) < 80 && Math.abs(py - ely) < 300) { eliteConflict = true; break; }
          }
          if (eliteConflict) continue;
        }
        const score = -Math.abs(px - ex) * 0.8;
        if (score > bestScore) { bestScore = score; targetX = ex; }
      }
    }

    const toDist = vecLen(targetX - px, safeY - py);
    if (toDist > 3) {
      forces[0] += (targetX - px) / toDist * 1.5;
      forces[1] += (safeY - py) / toDist * 1.5;
    }

    // Item collection: gravitate toward EXP and special items
    if (items.length > 0) {
      let bestItem = null, bestItemScore = -Infinity;
      for (const item of items) {
        const [ix, iy] = item.pos;
        const d = vecLen(px - ix, py - iy);
        const bonus = (item.item_type === 'invincible' || item.item_type === 'levelup') ? 500 : 0;
        const score = (item.exp_value || 5) * 12 + bonus - d * 0.2;
        if (score > bestItemScore) { bestItemScore = score; bestItem = item; }
      }
      if (bestItem) {
        const [ix, iy] = bestItem.pos;
        const d = vecLen(px - ix, py - iy);
        if (d > 5) { forces[0] += (ix - px) / d * 0.7; forces[1] += (iy - py) / d * 0.7; }
      }
    }

    // Boundary enforcement
    const margin = 25;
    if (px < margin) forces[0] += (margin - px) * 0.8;
    if (px > fw - margin) forces[0] -= (px - (fw - margin)) * 0.8;
    if (py < 40) forces[1] += (40 - py) * 0.8;
    if (py > fh - 15) forces[1] -= (py - (fh - 15)) * 0.8;

    const fLen = vecLen(forces[0], forces[1]);
    let dx2, dy2;
    if (fLen > 0.001) {
      dx2 = (forces[0] / fLen) * SPEED;
      dy2 = (forces[1] / fLen) * SPEED;
    } else {
      dx2 = Math.sin(obs.frame * 0.1) * 15;
      dy2 = 0;
    }
    return { action: { move: [dx2, dy2], upgrade_choice }, mem };
  },
};
