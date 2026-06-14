"use strict";

const UPGRADE_RULES = [
  { match: ["穿透", "pierce", "penetrat"], score: 155 },
  { match: ["分裂", "split", "散射", "弹道变为", "多发"], score: 130 },
  { match: ["每秒自动修复", "auto repair per second", "shield.*per second"], score: 118 }, // energy regen shield
  { match: ["急速", "射速", "rapid fire", "fire rate", "射击速度"], score: 110 },
  { match: ["屠龙", "dragon slayer", "对首领", "boss damage", "首领伤害"], score: 115 }, // boss-specific damage: above fire-rate(110), beats satellite tie at 117
  { match: ["伤害", "弹芯", "damage", "atk", "高能", "攻击力", "大口径"], score: 95 },
  { match: ["暴击", "crit", "爆击", "终端优化", "倍率"], score: 90 },
  { match: ["卫星", "satellite", "orbit", "轨道", "环绕"], score: 85 },
  { match: ["爆炸", "explode", "explosion", "pulse", "脉冲"], score: 80 },
  { match: ["无坚不摧", "destroy bullet", "摧毁", "弹幕清除"], score: 78 },
  { match: ["应急", "emergency", "回满", "满生命", "full hp", "restore", "修复"], score: 75 },
  { match: ["护盾", "shield", "barrier", "盾", "能量护"], score: 65 },
  { match: ["生命", "hp", "health", "heal", "life", "血量", "回复", "吸血", "鲜血"], score: 55 },
  { match: ["磁吸", "magnet", "pickup", "collect", "拾取"], score: 48 },
  { match: ["经验", "exp", "xp", "学者", "学习", "经验倍"], score: 45 },
  { match: ["精英猎手", "elite hunter", "精英伤害"], score: 42 },
  { match: ["经济", "coin", "gold", "金币"], score: 28 },
  { match: ["道具", "掉落", "loot", "drop", "雷达", "战利品"], score: 25 },
];
const RARITY_BONUS = { orange: 55, purple: 38, blue: 22, green: 0 };

function scoreUpgrade(opt, hpFrac, wave) {
  const text = (opt.name + " " + opt.desc).toLowerCase();
  let base = 0;
  for (const r of UPGRADE_RULES) {
    if (r.match.some(k => text.includes(k))) base = Math.max(base, r.score);
  }
  base += RARITY_BONUS[opt.rarity] || 0;
  if (hpFrac < 0.3 && ["应急","emergency","回满","full hp","restore","修复"].some(k => text.includes(k))) base += 65;
  // Elite-only damage inflates score via "伤害" match but is useless vs boss — cap it
  if (text.includes("精英猎手") || text.includes("elite hunter") || text.includes("对精英")) {
    base = Math.min(base, 60 + (RARITY_BONUS[opt.rarity] || 0));
  }
  // Reflected/received-damage effects (静电护甲 etc.): scored too high via "伤害" — cap at ~45
  if (text.includes("受到伤害后") || text.includes("after taking damage")) {
    base = Math.min(base, 45 + (RARITY_BONUS[opt.rarity] || 0));
  }
  return base;
}

function chooseUpgrade(options, hpFrac, wave) {
  if (!options || options.length === 0) return 0;
  let best = options[0], bestScore = scoreUpgrade(options[0], hpFrac, wave);
  for (const opt of options) {
    const s = scoreUpgrade(opt, hpFrac, wave);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  return best.index;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function closestApproach(bx, by, vx, vy, px, py, maxT) {
  const rx = bx - px, ry = by - py;
  const v2 = vx * vx + vy * vy;
  if (v2 < 0.001) return { dist: Math.sqrt(rx * rx + ry * ry), t: 0 };
  const t = clamp(-(rx * vx + ry * vy) / v2, 0, maxT);
  const cx = rx + vx * t, cy = ry + vy * t;
  return { dist: Math.sqrt(cx * cx + cy * cy), t };
}

module.exports = {
  init() { return { tick: 0 }; },

  policy(obs, mem) {
    const player = obs.player;
    const [px, py] = player.pos;
    const { w, h } = obs.field;
    const objects = obs.objects;
    const hpFrac = player.hp / player.max_hp;

    const P_HX = 12, P_HY = 15;

    const enemies = objects.filter(o => o.type === "enemy" || o.type === "enemy_elite");
    const bossObjs = objects.filter(o => o.type === "boss");
    const bullets = objects.filter(o => o.type === "enemy_bullet");
    const items = objects.filter(o => o.type === "item");
    const boss = bossObjs.length > 0 ? bossObjs[0] : null;
    const inBossFight = boss !== null && !boss.in_cutscene;

    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, hpFrac, obs.wave);
    }

    mem.tick = (mem.tick || 0) + 1;
    const SPEED = 40;
    const MARGIN = 22;

    // ===== BOSS SAFE Y =====
    let bossSafeY = h * 0.72;
    if (boss !== null) {
      const bHY = boss.size[1] / 2;
      const bvy = boss.vel ? boss.vel[1] : 0;
      const bYAhead = boss.pos[1] + Math.max(0, bvy) * 8;
      bossSafeY = bYAhead + bHY + P_HY + 65;
      // Clamp minimum to h*0.72 so player stays near bottom (far from boss) like v3.
      // Boss bullets take 60+ steps to reach player there, vs 30 at the old h*0.38 min.
      bossSafeY = clamp(bossSafeY, h * 0.75, h * 0.92);
      mem.smoothBossX = (mem.smoothBossX === undefined)
        ? boss.pos[0]
        : mem.smoothBossX * 0.95 + boss.pos[0] * 0.05;
    }

    // ===== 1. BULLET AVOIDANCE =====
    const BULLET_R = 82;
    const LOOKAHEAD = 18;
    let bfx = 0, bfy = 0;
    let maxBulletDanger = 0;

    // Pre-score all threats; in boss fight keep only top 10 to avoid force cancellation
    // (87 symmetric bullets cancel → player stuck; top-10 point away from real threat cluster)
    const bulletThreats = [];
    for (const b of bullets) {
      const [bx, by] = b.pos;
      const [vx, vy] = b.vel;
      const { dist, t } = closestApproach(bx, by, vx, vy, px, py, LOOKAHEAD);
      if (dist < BULLET_R) {
        const urgency = Math.pow((BULLET_R - dist) / BULLET_R, 1.5);
        const timeW = t < 5 ? 3.5 : t < 10 ? 2.2 : 1.0;
        bulletThreats.push({ bx, by, vx, vy, dist, t, urgency, timeW });
      }
    }
    if (inBossFight && bulletThreats.length > 10) {
      bulletThreats.sort((a, b) => b.urgency * b.timeW - a.urgency * a.timeW);
      bulletThreats.length = 10;
    }

    for (const { bx, by, vx, vy, dist, t, urgency, timeW } of bulletThreats) {
      const wt = urgency * timeW * 5.5;

      const bSpeed = Math.sqrt(vx * vx + vy * vy) + 0.01;
      const perpX = -vy / bSpeed, perpY = vx / bSpeed;
      const cx = bx + vx * t, cy = by + vy * t;
      const rX = px - cx, rY = py - cy;
      const side = (rX * perpX + rY * perpY) >= 0 ? 1 : -1;

      const perpFY = side * perpY * wt;
      bfx += side * perpX * wt;
      bfy += perpFY;

      const ddx = px - bx, ddy = py - by;
      const dMag = Math.sqrt(ddx * ddx + ddy * ddy) + 0.01;
      const directFY = (ddy / dMag) * urgency * timeW * 1.5;
      bfx += (ddx / dMag) * urgency * timeW * 1.5;
      bfy += directFY;

      maxBulletDanger = Math.max(maxBulletDanger, urgency);
    }

    const bfMag = Math.sqrt(bfx * bfx + bfy * bfy);
    const bfCap = inBossFight ? 28 : 22;
    if (bfMag > bfCap) { bfx = bfx / bfMag * bfCap; bfy = bfy / bfMag * bfCap; }

    // ===== 2. ENEMY BODY AVOIDANCE (AABB soft zone + emergency boost for elites) =====
    const SAFE_X = 55, SAFE_Y = 58;
    let efx = 0, efy = 0;
    let closeEnemyDist = Infinity;

    for (const e of enemies) {
      const [ex, ey] = e.pos;
      const dx = px - ex, dy = py - ey;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      const overX = SAFE_X - absDx;
      const overY = SAFE_Y - absDy;

      if (overX > 0 && overY > 0) {
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        closeEnemyDist = Math.min(closeEnemyDist, d);
        const pen = Math.min(overX / SAFE_X, overY / SAFE_Y);
        let wt = Math.pow(pen, 0.8) * 22;

        // Emergency boost for approaching enemy_elite (handles falling-onto-player and boundary traps)
        if (e.type === "enemy_elite") {
          const eHX = e.size[0] / 2, eHY = e.size[1] / 2;
          const collX = P_HX + eHX, collY = P_HY + eHY;
          const emergX = collX + 18, emergY = collY + 18;
          const eVy = e.vel ? e.vel[1] : 0;
          const approaching = (ey < py && eVy >= 0) || (ey > py && eVy <= 0) || absDy < 20;
          if (absDx < emergX && absDy < emergY && approaching) {
            const innerPen = Math.min((emergX - absDx) / emergX, (emergY - absDy) / emergY);
            wt += Math.pow(innerPen, 0.5) * 55;
            closeEnemyDist = 0;
          }
        }

        efx += (dx / d) * wt;
        efy += (dy / d) * wt;
      }
    }

    // Dodge elite straight-down bullets when player is nearly directly below an elite
    for (const e of enemies) {
      if (e.type !== "enemy_elite") continue;
      const [ex, ey] = e.pos;
      if (ey >= py) continue;
      const absDx = Math.abs(px - ex);
      if (absDx < 20 && py - ey < 130) {
        const dir = px <= ex ? -1 : 1;
        efx += dir * (20 - absDx) / 20 * 14;
      }
    }

    // ===== 3. BOSS BODY AVOIDANCE =====
    let bossBodyFX = 0, bossBodyFY = 0;

    if (inBossFight) {
      const [bx, by] = boss.pos;
      const bHX = boss.size[0] / 2, bHY = boss.size[1] / 2;
      const dx = px - bx, dy = py - by;
      const safeX = P_HX + bHX + 32;
      const safeY = P_HY + bHY + 38;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);

      if (absDx < safeX && absDy < safeY) {
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        closeEnemyDist = Math.min(closeEnemyDist, d);
        const pen = Math.min((safeX - absDx) / safeX, (safeY - absDy) / safeY);
        const wt = Math.pow(pen, 0.5) * 50;
        bossBodyFX += (dx / d) * wt;
        bossBodyFY += (dy / d) * wt;
      }
    }

    const tooClose = closeEnemyDist < 55;

    // ===== 4. TARGET SELECTION =====
    let targetX = w / 2;
    let targetY = h * 0.72;

    // Track pre-boss shield status every wave step (not in boss fight).
    if (!inBossFight) mem.shieldBeforeBoss = (player.shield_max || 0) > 0;

    if (boss !== null && !inBossFight) {
      // Cutscene: approach boss x, descend toward safe Y
      targetX = boss.pos[0];
      targetY = bossSafeY;
    } else if (!tooClose) {
      if (inBossFight && boss) {
        // Always track boss x in boss fight — pierce/split hits boss + any enemies in column.
        // Avoids free-roam into dense enemy clusters that spawn alongside boss.
        targetX = boss.pos[0];
        targetY = clamp(py, h * 0.55, h * 0.80);
      } else {
        let bestDX = Infinity;
        for (const e of enemies) {
          const [ex, ey] = e.pos;
          if (ey < py - 20 && ey > -400 && ey < h) {
            const dxx = Math.abs(ex - px);
            if (dxx < bestDX) { bestDX = dxx; targetX = ex; }
          }
        }
        targetY = clamp(py, h * 0.55, h * 0.80);
      }
    }


    // ===== 5. ITEM PULL (weak, above-player only) =====
    if (maxBulletDanger < 0.35 && !tooClose && items.length > 0) {
      let closestD = Infinity, closestItem = null;
      for (const it of items) {
        const [ix, iy] = it.pos;
        if (iy < py + 20) {
          const d = Math.sqrt((ix - px) ** 2 + (iy - py) ** 2);
          if (d < closestD) { closestD = d; closestItem = it; }
        }
      }
      if (closestItem && closestD < player.magnet_range * 3) {
        targetX = targetX * 0.87 + closestItem.pos[0] * 0.13;
      }
    }

    // ===== 6. TARGET FORCE =====
    const txD = targetX - px, tyD = targetY - py;
    const tDist = Math.sqrt(txD * txD + tyD * tyD) + 0.01;
    const tStrength = tooClose ? 0.6 : 2.4;
    let tfx = (txD / tDist) * tStrength;
    const tfy = (tyD / tDist) * 1.6;

    // Prevent target x force from walking player into elite collision x zone
    if (!inBossFight) {
      for (const e of enemies) {
        if (e.type !== "enemy_elite") continue;
        const [ex, ey] = e.pos;
        const eHX = e.size[0] / 2, eHY = e.size[1] / 2;
        const collX = P_HX + eHX, collY = P_HY + eHY;
        const absDx = Math.abs(px - ex), absDy = Math.abs(py - ey);
        const movingToward = (px < ex && tfx > 0) || (px > ex && tfx < 0);
        if (movingToward && absDy < collY + 25 && absDx < collX + 20) {
          const safeGap = Math.max(0, absDx - collX - 3);
          if (safeGap < 15) {
            tfx = (px - ex) / absDx * 8;
          } else {
            tfx *= safeGap / 15;
          }
        }
      }
    }

    // ===== 7. COMBINE =====
    let fx = bfx + efx + bossBodyFX + tfx;
    let fy = bfy + efy + bossBodyFY + tfy;

    // Gentle restore toward y=0.72h throughout (wave + boss fight).
    // In boss fight, player moves freely chasing enemies rather than locking to bossSafeY.
    fy += (h * 0.72 - py) * 0.06;


    // ===== 8. BOUNDARY =====
    if (px < MARGIN) fx += (MARGIN - px) * 1.2;
    if (px > w - MARGIN) fx -= (px - (w - MARGIN)) * 1.2;
    if (py < MARGIN) fy += (MARGIN - py) * 1.2;
    if (py > h - MARGIN) fy -= (py - (h - MARGIN)) * 1.2;

    const fMag = Math.sqrt(fx * fx + fy * fy);
    let dx, dy;
    if (fMag < 0.01) { dx = 0; dy = 0; }
    else if (fMag > SPEED) { dx = fx / fMag * SPEED; dy = fy / fMag * SPEED; }
    else { dx = fx; dy = fy; }

    // ===== 9. HARD-BOUNDARY ELITE X-ZONE TRANSIT =====
    // When stuck at a hard field boundary with an elite in the x-collision zone and
    // the y-gap closing (< collY+20), force a sideways transit to escape.
    // Only triggers when no heavy bullet threat (dy=0 during transit can't dodge).
    if (!inBossFight && boss === null && maxBulletDanger < 0.55) {
      const atHardRight = px >= w - P_HX - 1;
      const atHardLeft  = px <= P_HX + 1;
      if (atHardRight || atHardLeft) {
        for (const e of enemies) {
          if (e.type !== "enemy_elite") continue;
          const [ex] = e.pos;
          const ey = e.pos[1];
          const collX = P_HX + e.size[0] / 2;  // 42
          const collY = P_HY + e.size[1] / 2;  // 45
          const absDx = Math.abs(px - ex);
          const absDy = Math.abs(py - ey);
          const eVyT = e.vel ? e.vel[1] : 0;
          const isApproachingT = (ey < py && eVyT >= 0) || (ey > py && eVyT <= 0) || absDy < 20;
          if (absDx < collX && absDy > collY && absDy < collY + 20 && isApproachingT) {
            dx = (atHardRight ? -1 : 1) * SPEED * 0.9;
            dy = 0;
            break;
          }
        }
      }
    }

    return { action: { move: [dx, dy], upgrade_choice }, mem };
  },
};
