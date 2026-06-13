"use strict";

// === UPGRADE SCORING ===
const RARITY_BASE = { orange: 400, purple: 300, blue: 200, green: 100 };

function kw(text, keywords) {
  for (const k of keywords) { if (text.includes(k)) return true; }
  return false;
}

function scoreUpgrade(opt, player) {
  const base = RARITY_BASE[opt.rarity] || 100;
  const text = ((opt.name || '') + ' ' + (opt.desc || '')).toLowerCase();
  const hasPierce = player && player.pierce;
  const magnetRange = player ? (player.magnet_range || 50) : 50;
  let cat = 0;

  // 1. PIERCE: mandatory first priority if not obtained — without it, boss DPS is near zero
  if (!hasPierce) {
    if (kw(text, ['穿透', 'pierce', '贯穿', '穿透核心'])) cat += 1200;
  } else {
    if (kw(text, ['穿透', 'pierce', '贯穿', '穿透核心'])) cat += 50;
  }

  // 2. EMERGENCY HEAL: instant full HP + equal-max shield; also matches energy shield desc
  if (kw(text, ['应急修复', '回满生命', '等同最大生命'])) cat += 720;

  // 3. MAGNET: large pickup range → collect exp from boss-fight wave kills → level-up → more heals
  if (kw(text, ['拾取范围', '磁', 'magnet', '吸附范围', '磁吸'])) {
    cat += magnetRange < 100 ? 660 : 180;
  }

  // 4. SPLIT BULLETS: each tier multiplies bullet count → proportional boss DPS
  if (kw(text, ['分裂弹幕', '弹道变为', 'split'])) cat += 370;

  // 5. EXP RATE: faster leveling → more upgrades, more boss-fight level-ups
  if (kw(text, ['经验倍率', '经验值倍率', 'exp mult', '战术学习'])) cat += 340;

  // 6. FIRE RATE
  if (kw(text, ['射速', '攻速', '攻击间隔', '射击间隔', '急速射击'])) cat += 285;

  // 7. BOSS DAMAGE MULTIPLIERS
  if (kw(text, ['屠龙战术', '对boss', 'boss damage', '对 boss', '王座破坏者'])) cat += 270;

  // 8. SATELLITES
  if (kw(text, ['卫星', 'satellite'])) cat += 245;

  // 9. LASER
  if (kw(text, ['激光', 'laser'])) cat += 230;

  // 10. REROLL (guarantees purple/orange next upgrade)
  if (kw(text, ['高级重掷', '重掷', '必含紫', '必含橙'])) cat += 215;

  // 11. SLOW
  if (kw(text, ['减速', 'slow', '时间流'])) cat += 190;

  // 12. SHIELD
  if (kw(text, ['护盾', 'shield', '盾', 'barrier'])) cat += 160;

  // 13. CRIT DAMAGE
  if (kw(text, ['暴击伤害', 'crit damage', '暴伤'])) cat += 135;

  // 14. DAMAGE
  if (kw(text, ['伤害', 'damage', '攻击伤害', '攻击力'])) cat += 110;

  // 15. CRIT RATE
  if (kw(text, ['暴击率', '暴击', 'crit rate'])) cat += 90;

  // 16. HEAL / ELITE
  if (kw(text, ['回血', '治愈', 'heal', '击杀回', '每次击杀'])) cat += 65;
  if (kw(text, ['精英猎手', '对精英', 'elite damage'])) cat += 65;
  if (kw(text, ['护甲', 'armor', '减伤', '静电'])) cat += 40;

  // NEGATIVES
  if (kw(text, ['清除脉冲', '清屏弹幕', '概率清屏'])) cat -= 400;
  if (kw(text, ['金币', 'coin', '赏金', '立即获得'])) cat -= 110;
  if (kw(text, ['过量治疗', '超量血库', '吸血', '生命偷取'])) cat -= 130;

  return base + cat;
}

function chooseUpgrade(options, player) {
  let best = options[0], bestScore = scoreUpgrade(options[0], player);
  for (let i = 1; i < options.length; i++) {
    const s = scoreUpgrade(options[i], player);
    if (s > bestScore) { bestScore = s; best = options[i]; }
  }
  return best.index;
}

// Predict danger of moving in direction (dx, dy) for N steps
function sweepDanger(px, py, dx, dy, bullets, steps) {
  let danger = 0;
  for (let t = 1; t <= steps; t++) {
    const testX = px + dx * t, testY = py + dy * t;
    for (const b of bullets) {
      const bx = b.pos[0] + b.vel[0] * t;
      const by = b.pos[1] + b.vel[1] * t;
      const dist = Math.sqrt((bx - testX) ** 2 + (by - testY) ** 2);
      if (dist < 32) danger += (32 - dist) / 32;
    }
  }
  return danger;
}

// Project movement away from circular obstacles
function clampMovement(px, py, fdx, fdy, obstacles) {
  let dx = fdx, dy = fdy;
  for (let iter = 0; iter < 4; iter++) {
    let changed = false;
    for (const [ex, ey, r] of obstacles) {
      const nx = px + dx, ny = py + dy;
      if ((nx - ex) ** 2 + (ny - ey) ** 2 < r * r) {
        const toEX = ex - px, toEY = ey - py;
        const len = Math.sqrt(toEX ** 2 + toEY ** 2) || 1;
        const dot = dx * (toEX / len) + dy * (toEY / len);
        if (dot > 0) { dx -= dot * (toEX / len); dy -= dot * (toEY / len); changed = true; }
      }
    }
    if (!changed) break;
  }
  return [dx, dy];
}

module.exports = {
  init() { return { tick: 0, sweepDir: 1 }; },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const { w, h } = obs.field;
    const player = obs.player;
    const tick = (mem.tick || 0) + 1;
    let sweepDir = mem.sweepDir || 1;

    // === UPGRADE CHOICE ===
    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, player);
    }

    // === CATEGORIZE OBJECTS ===
    const bullets = [], items = [], nonBossEnemies = [];
    let boss = null;
    for (const o of obs.objects) {
      if (o.type === 'enemy_bullet') bullets.push(o);
      else if (o.type === 'item') items.push(o);
      else if (o.type === 'boss') boss = o;
      else if (o.type === 'enemy' || o.type === 'enemy_elite') nonBossEnemies.push(o);
    }

    const hasBoss = boss && !boss.in_cutscene;
    const P_HALF_X = player.size ? player.size[0] / 2 : 12;
    const P_HALF_Y = player.size ? player.size[1] / 2 : 15;
    const P_HALF = (P_HALF_X + P_HALF_Y) / 2;

    let fx = 0, fy = 0;

    // === BULLET AVOIDANCE ===
    // For head-on bullets (especially fan bullets going straight down), perpendicular
    // dodge (sideways) is critical. For angled bullets, raw avoidance works fine.
    const LOOKAHEAD = 22, DANGER = 50;
    for (const b of bullets) {
      const bx = b.pos[0], by = b.pos[1];
      const [vx, vy] = b.vel;
      const velSq = vx * vx + vy * vy || 0.001;
      const velLen = Math.sqrt(velSq);
      const relX = bx - px, relY = by - py;
      const t = Math.max(0, Math.min(LOOKAHEAD, -(relX * vx + relY * vy) / velSq));
      const cx = bx + vx * t, cy = by + vy * t;
      const cdist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      const hitboxDist = Math.max(0, cdist - P_HALF);

      if (hitboxDist < DANGER) {
        const urgency = ((DANGER - hitboxDist) / DANGER) ** 1.8;
        const strength = urgency * (hasBoss ? 220 : 90);

        // Compute raw avoidance direction (away from closest approach)
        const awLen = cdist || 1;
        const rawFX = (px - cx) / awLen;
        const rawFY = (py - cy) / awLen;

        // For bullets heading nearly straight at player, raw avoidance is along bullet
        // direction (counterproductive). Use perpendicular (sideways) dodge instead.
        const nvx = vx / velLen, nvy = vy / velLen;
        const dot = rawFX * nvx + rawFY * nvy;
        const perpFX = rawFX - dot * nvx;
        const perpFY = rawFY - dot * nvy;
        const perpLen = Math.sqrt(perpFX ** 2 + perpFY ** 2);

        let bfx, bfy;
        if (perpLen > 0.2) {
          // Perpendicular component is significant — use it (more efficient dodge)
          bfx = (perpFX / perpLen) * strength;
          bfy = (perpFY / perpLen) * strength;
        } else {
          // Bullet heading almost straight at player → sideways via sweep direction
          bfx = sweepDir * strength;
          bfy = 0;
        }

        // Wall-aware
        const WZ = 42;
        if (px < WZ && bfx < 0) bfx = 0;
        if (px > w - WZ && bfx > 0) bfx = 0;
        if (py < WZ && bfy < 0) bfy = 0;
        if (py > h - WZ && bfy > 0) bfy = 0;

        fx += bfx; fy += bfy;
      }
    }

    // === ENEMY AVOIDANCE (non-boss) ===
    const ENEMY_DIST = 110;
    for (const e of nonBossEnemies) {
      const edist = Math.sqrt((e.pos[0] - px) ** 2 + (e.pos[1] - py) ** 2);
      if (edist < ENEMY_DIST) {
        const u = ((ENEMY_DIST - edist) / ENEMY_DIST) ** 1.5;
        fx += (px - e.pos[0]) / (edist || 1) * u * 85;
        fy += (py - e.pos[1]) / (edist || 1) * u * 85;
      }
    }

    // === BOSS BODY AVOIDANCE ===
    if (hasBoss) {
      const bossHalf = (boss.size ? boss.size[0] : 120) / 2;
      const SAFE_DIST = bossHalf + P_HALF + 35;
      const edistX = px - boss.pos[0], edistY = py - boss.pos[1];
      const edist = Math.sqrt(edistX ** 2 + edistY ** 2);
      if (edist < SAFE_DIST + 48) {
        const overlap = Math.max(0, SAFE_DIST + 48 - edist);
        const nX = edistX / (edist || 1), nY = edistY / (edist || 1);
        fx += nX * overlap * 3.0;
        fy += nY * overlap * 3.0;
      }
    }

    // === ITEM COLLECTION ===
    let bestItem = null, bestVal = -1;
    const hpRatio = player.hp / player.max_hp;
    for (const item of items) {
      const dist = Math.sqrt((item.pos[0] - px) ** 2 + (item.pos[1] - py) ** 2) || 1;
      let val = 0;
      switch (item.item_type) {
        case 'levelup':    val = 800; break;
        case 'invincible': val = 650; break;
        case 'heart':      val = (1 - hpRatio) * 520 + 30; break;
        case 'exp_huge':   val = 210; break;
        case 'exp_large':  val = 115; break;
        case 'exp_medium': val = 58; break;
        case 'exp_small':  val = 23; break;
        case 'bomb':       val = 140; break;
        case 'magnet':     val = 110; break;
        case 'coin':       val = 10; break;
        default:           val = 20; break;
      }
      const eff = val / (1 + dist * 0.004);
      if (eff > bestVal) { bestVal = eff; bestItem = item; }
    }
    if (bestItem) {
      const dx = bestItem.pos[0] - px, dy = bestItem.pos[1] - py;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = Math.min(32, dist * 0.45);
      fx += (dx / dist) * pull;
      fy += (dy / dist) * pull;
    }

    // === STRATEGIC POSITIONING ===
    if (hasBoss) {
      const bossHalf = (boss.size ? boss.size[0] : 120) / 2;
      const bossX = boss.pos[0];
      const bossY = boss.pos[1];
      const SAFE_Y_GAP = bossHalf + P_HALF_Y + 55;
      const minSafeY = bossY + SAFE_Y_GAP;
      const BOSS_FIGHT_MAX_Y = Math.min(h * 0.80, h - 50);

      // === HORIZONTAL: sweep + danger-aware direction flipping ===
      const SWEEP_SPEED = 35;
      const WALL_TURN = 65;
      if (px < WALL_TURN && sweepDir < 0) sweepDir = 1;
      if (px > w - WALL_TURN && sweepDir > 0) sweepDir = -1;

      // Check if sweeping forward is more dangerous than reverse
      const dangerForward = sweepDanger(px, py, sweepDir * 5, 0, bullets, 8);
      const dangerReverse = sweepDanger(px, py, -sweepDir * 5, 0, bullets, 8);
      if (dangerForward > dangerReverse + 1.5 && dangerForward > 0.5) {
        sweepDir = -sweepDir;
      }

      // Sweep + weak drift toward boss x for pierce alignment
      fx += sweepDir * SWEEP_SPEED + (bossX - px) * 0.03;

      // === VERTICAL: maintain safe zone below boss ===
      const targetY = Math.max(minSafeY, Math.min(BOSS_FIGHT_MAX_Y - 40, bossY + 185));
      if (py < minSafeY) {
        fy += (minSafeY - py) * 0.55 + 28;
      } else if (py > BOSS_FIGHT_MAX_Y) {
        fy = -45; // hard upward override
      } else {
        fy += (targetY - py) * 0.12;
        if (py > BOSS_FIGHT_MAX_Y - 60 && fy > 5) fy = Math.min(fy, 5);
      }

    } else {
      // Normal waves: center field with gentle sinusoidal movement
      const targetY = h * 0.50;
      fy += (targetY - py) * 0.04;
      fx += (w * 0.5 - px) * 0.025;
      fx += Math.sin(tick * 0.05) * 4 + Math.sin(tick * 0.17) * 2;
      fy += Math.cos(tick * 0.08) * 2.5 + Math.cos(tick * 0.23) * 1.2;
    }

    // === WALL REPULSION ===
    const MARGIN = 52, HARD = 25;
    if (px < MARGIN) fx += (MARGIN - px) * 1.2;
    if (px > w - MARGIN) fx -= (px - (w - MARGIN)) * 1.2;
    if (py < MARGIN) fy += (MARGIN - py) * 1.2;
    if (py > h - MARGIN) fy -= (py - (h - MARGIN)) * 1.2;
    if (px < HARD) fx += 55;
    if (px > w - HARD) fx -= 55;
    if (py < HARD) fy += 55;
    if (py > h - HARD) fy -= 55;

    const WC = 38;
    if (px < WC && fx < 0) fx = 0;
    if (px > w - WC && fx > 0) fx = 0;
    if (py < WC && fy < 0) fy = 0;
    if (py > h - WC && fy > 0) fy = 0;

    // Speed clamp
    const SPEED = 39;
    const mag = Math.sqrt(fx * fx + fy * fy);
    if (mag > SPEED) { fx = fx / mag * SPEED; fy = fy / mag * SPEED; }

    // Obstacle projection (boss + non-boss enemies)
    const obstacles = nonBossEnemies.map(e => {
      const eH = e.size ? e.size[0] / 2 : 12;
      return [e.pos[0], e.pos[1], eH + P_HALF_X + 18];
    });
    if (hasBoss) {
      const bH = (boss.size ? boss.size[0] : 120) / 2;
      obstacles.push([boss.pos[0], boss.pos[1], bH + P_HALF_X + 30]);
    }
    [fx, fy] = clampMovement(px, py, fx, fy, obstacles);

    const mag2 = Math.sqrt(fx * fx + fy * fy);
    if (mag2 > SPEED) { fx = fx / mag2 * SPEED; fy = fy / mag2 * SPEED; }

    return {
      action: { move: [fx, fy], upgrade_choice },
      mem: { tick, sweepDir }
    };
  }
};
