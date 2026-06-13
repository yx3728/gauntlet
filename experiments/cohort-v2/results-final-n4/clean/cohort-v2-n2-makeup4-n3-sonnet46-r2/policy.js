"use strict";

// ---- Upgrade Selection ----

const KNOWN_UPGRADES = {
  // TIER S
  '完美机师': 98,       // All-attribute boost
  '应急修复': 85,       // Instant full HP + equal shield

  // TIER A: DPS core
  '穿透核心': 92,       // Pierce — bullets pass through all enemies
  '分裂弹幕II': 90,     // 5 bullets per shot
  '急速射击III': 88,    // Fire rate +128%
  '屠龙战术': 86,       // Boss damage +30%
  '分裂弹幕': 83,       // 3 bullets per shot
  '高级重掷': 82,       // Next pick guaranteed purple/orange
  '急速射击II': 78,     // Fire rate +64%
  '大口径弹': 76,       // Bullet size ×2
  '轨道卫星': 80,       // 2 tracking satellites
  '急速射击': 72,       // Fire rate +32%

  // TIER B: Survivability / utility
  '能量护盾II': 72,
  '能量护盾': 66,
  '超量血库': 63,
  '磁吸装置': 66,
  '战术学习': 62,

  // TIER C: Minor DPS
  '高能弹芯': 62,
  '火控协同': 60,       // fire rate +15% + damage +8% — weaker than 急速射击 alone
  '精英猎手': 55,
  '瞄准训练II': 52,
  '瞄准训练': 48,
  '爆炸脉冲': 44,

  // TIER D: Weak
  '清除脉冲': 52,       // Screen-clear pulse — purple; also slows wave pace = more wave XP
  '战利品雷达': 40,
  '自动修复': 34,
  '反间护盾': 18,
  '静电护甲': 16,
  '战地经济学': 22,
  '赏金协议': 20,
};

// Chinese keyword tiers for UNKNOWN upgrade names
// CRITICAL: do NOT use bare 'ii'/'iii' — they false-positive on tier-2/3 names
const CN_KEYWORD_TIERS = [
  { keywords: ['全属性'], base: 98 },
  { keywords: ['回满生命', '立即回满', '生命值回满'], base: 85 },
  { keywords: ['boss伤害', 'boss 伤害', '对boss', '对 boss', '屠龙'], base: 86 },
  { keywords: ['穿透', '贯穿'], base: 92 },
  { keywords: ['必含紫', '紫或橙', '高级重掷'], base: 82 },
  { keywords: ['轨道卫星', '追踪弹', '卫星'], base: 80 },
  { keywords: ['分裂', '弹道变为', '多发弹道'], base: 83 },
  { keywords: ['大口径', '子弹尺寸变大'], base: 76 },
  // Match specific fire-rate descriptions, NOT generic 'II'/'III' suffixes
  { keywords: ['射速 +128%', '射击速度 +128', '攻速 +128'], base: 88 },
  { keywords: ['射速 +64%', '射击速度 +64', '攻速 +64'], base: 78 },
  { keywords: ['射速', '攻速', '射击速度', '急速射击', '射击间隔'], base: 72 },
  { keywords: ['能量护盾', '护盾值', '最大护盾'], base: 66 },
  { keywords: ['拾取范围', '磁吸', '吸引范围'], base: 66 },
  { keywords: ['伤害'], base: 62 },
  { keywords: ['暴击'], base: 48 },
  { keywords: ['爆炸', '炸弹'], base: 44 },
  { keywords: ['经验倍率', '经验值', '获得经验'], base: 62 },
  { keywords: ['护盾'], base: 55 },
  { keywords: ['生命值', '最大生命'], base: 36 },
  { keywords: ['无敌', '无敌时间'], base: 33 },
  { keywords: ['每秒回复', '自动回复', '持续恢复'], base: 34 },
  { keywords: ['金币', '掉落率'], base: 22 },
  { keywords: ['静电', '等量伤害', '反伤'], base: 16 },
];

const EN_KEYWORD_TIERS = [
  { keywords: ['all attribute', 'all stats'], base: 98 },
  { keywords: ['pierce', 'penetrat'], base: 92 },
  { keywords: ['satellite', 'orbit', 'tracking'], base: 80 },
  { keywords: ['full heal', 'restore hp', 'recover hp', 'full hp'], base: 85 },
  { keywords: ['boss damage', 'boss dmg'], base: 86 },
  { keywords: ['5 bullet', '5 shot', '5 projectile'], base: 90 },
  { keywords: ['3 bullet', '3 shot', '3 projectile', 'split'], base: 83 },
  { keywords: ['fire rate +128', 'interval -57%'], base: 88 },
  { keywords: ['fire rate +64', 'interval -39%'], base: 78 },
  { keywords: ['fire rate', 'attack speed', 'rapid fire', 'interval'], base: 72 },
  { keywords: ['bullet size', 'large bullet', 'big bullet', 'caliber'], base: 76 },
  { keywords: ['shield', 'barrier'], base: 66 },
  { keywords: ['damage', 'power'], base: 62 },
  { keywords: ['pickup', 'magnet', 'attract'], base: 66 },
  { keywords: ['crit', 'critical'], base: 48 },
  { keywords: ['bomb', 'explosion', 'blast'], base: 44 },
  { keywords: ['exp', 'experience'], base: 62 },
];

const RARITY_BONUS = { orange: 100, purple: 70, blue: 20, green: 10 };

function scoreUpgrade(opt, lowHP, isBoss) {
  let score = RARITY_BONUS[opt.rarity] || 0;
  const name = opt.name || '';

  if (KNOWN_UPGRADES[name] !== undefined) {
    score += KNOWN_UPGRADES[name];
    if (lowHP && (name === '应急修复' || name === '自动修复')) score += 50;
    if (isBoss && name === '屠龙战术') score += 25;
    return score;
  }

  const text = (name + ' ' + (opt.desc || '')).toLowerCase();

  for (const { keywords, base } of CN_KEYWORD_TIERS) {
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      score += base;
      if (lowHP && base >= 80) score += 50;
      if (isBoss && (text.includes('boss') || text.includes('屠龙'))) score += 25;
      return score;
    }
  }

  for (const { keywords, base } of EN_KEYWORD_TIERS) {
    if (keywords.some(k => text.includes(k))) {
      score += base;
      if (lowHP && base >= 80) score += 50;
      return score;
    }
  }

  return score;
}

function chooseBestUpgrade(options, obs) {
  const p = obs && obs.player;
  const lowHP = p && (p.hp / p.max_hp < 0.5) ? 1 : 0;
  const isBoss = obs && obs.wave >= 3 ? 1 : 0;

  let bestIndex = options[0].index;
  let bestScore = -Infinity;
  for (const opt of options) {
    const s = scoreUpgrade(opt, lowHP, isBoss);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = opt.index;
    }
  }
  return bestIndex;
}

// ---- Movement ----

function closestApproach(px, py, adx, ady, bx, by, bvx, bvy, lookAhead) {
  const rx = px - bx, ry = py - by;
  const rvx = adx - bvx, rvy = ady - bvy;
  const rvMag2 = rvx * rvx + rvy * rvy;
  if (rvMag2 < 0.01) return Math.sqrt(rx * rx + ry * ry);
  const t = Math.max(0, Math.min(lookAhead, -(rx * rvx + ry * rvy) / rvMag2));
  const fx = rx + rvx * t, fy = ry + rvy * t;
  return Math.sqrt(fx * fx + fy * fy);
}

const SPEED = 38;
const CANDIDATE_MOVES = (() => {
  const dirs = [[0, 0]];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    dirs.push([Math.cos(a) * SPEED, Math.sin(a) * SPEED]);
  }
  return dirs;
})();

function calculateMove(obs) {
  const [px, py] = obs.player.pos;
  const { w, h } = obs.field;
  const player = obs.player;
  const pSize = Math.max(player.size[0], player.size[1]);
  const MARGIN = pSize / 2 + 5;
  const isInvincible = player.invincible_ms > 0;
  const hpFrac = player.hp / player.max_hp;
  const lowHP = hpFrac < 0.4;
  const critHP = hpFrac < 0.2;

  const allBullets = obs.objects.filter(o => o.type === 'enemy_bullet');
  const items = obs.objects.filter(o => o.type === 'item');
  const boss = obs.objects.find(o => o.type === 'boss' && !o.in_cutscene);
  const enemies = obs.objects.filter(
    o => (o.type === 'enemy' || o.type === 'enemy_elite') && o.pos[1] < h && o.pos[1] > -80
  );

  const isBossMode = !!boss;
  const bossRage = boss && (boss.hp / boss.max_hp) < 0.25;
  const LOOK_AHEAD = bossRage ? 25 : 20;

  // Boss mode: use smaller detection radius (don't flee from distant bullets)
  const detectR = isBossMode ? 250 : 450;
  const detectR2 = detectR * detectR;
  const nearBullets = isInvincible ? [] : allBullets.filter(b => {
    const dx = b.pos[0] - px, dy = b.pos[1] - py;
    return dx * dx + dy * dy < detectR2;
  });

  // Position targets
  let targetX, targetY, THREAT_A, THREAT_B, posMult;

  if (isBossMode) {
    // During rage keep away from corners while still tracking boss for DPS
    targetX = bossRage ? Math.max(60, Math.min(300, boss.pos[0])) : boss.pos[0];
    targetY = h * 0.72;
    THREAT_A = 700;
    THREAT_B = bossRage ? 50 : 35;
    posMult = 8;
  } else if (critHP) {
    targetX = w / 2;
    targetY = h * 0.85;
    THREAT_A = 1500;
    THREAT_B = 35;
    posMult = 1.0;
  } else {
    targetY = h * 0.68;
    targetX = w / 2;
    THREAT_A = 1500;
    THREAT_B = 35;
    posMult = 1.0;

    // Align with nearest enemy above player (auto-fire straight up)
    if (enemies.length > 0) {
      let bestE = null, bestEScore = -Infinity;
      for (const e of enemies) {
        const [ex, ey] = e.pos;
        if (ey < 0 || ey >= py) continue;
        const xDist = Math.abs(ex - px);
        if (-xDist > bestEScore) {
          bestEScore = -xDist;
          bestE = e;
        }
      }
      if (bestE) targetX = bestE.pos[0];
    }
  }

  let bestScore = -Infinity;
  let bestMove = [0, 0];

  for (const [dx, dy] of CANDIDATE_MOVES) {
    const nx = Math.max(MARGIN, Math.min(w - MARGIN, px + dx));
    const ny = Math.max(MARGIN, Math.min(h - MARGIN, py + dy));
    const adx = nx - px, ady = ny - py;

    // 1. Threat: exponential decay
    let threat = 0;
    for (const b of nearBullets) {
      const [bx, by] = b.pos;
      const [bvx, bvy] = b.vel;
      const d = closestApproach(px, py, adx, ady, bx, by, bvx, bvy, LOOK_AHEAD);
      threat += THREAT_A * Math.exp(-d / THREAT_B);
    }

    // 2. Item attraction
    let itemScore = 0;
    const heartBonus = critHP ? 45 : (lowHP ? 22 : 10);
    for (const item of items) {
      const [ix, iy] = item.pos;
      const dd = Math.sqrt((ix - nx) * (ix - nx) + (iy - ny) * (iy - ny));
      if (dd > 300) continue;
      let val;
      switch (item.item_type) {
        case 'levelup': val = 30; break;
        case 'invincible': val = 20; break;
        case 'heart': val = heartBonus; break;
        case 'exp_huge': val = 8; break;
        case 'exp_large': val = 5; break;
        case 'exp_medium': val = 3; break;
        case 'bomb': val = boss ? 18 : 6; break;
        case 'magnet': val = 4; break;
        case 'coin': val = 2; break;
        default: val = 1.5; break;
      }
      itemScore += val / (dd + 8);
    }

    // 3. Enemy alignment (wave only)
    let alignScore = 0;
    if (!isBossMode && !critHP) {
      for (const e of enemies) {
        const [ex, ey] = e.pos;
        if (ey < 0 || ey >= ny) continue;
        const xd = Math.abs(ex - nx);
        alignScore += 5 / (xd + 10);
      }
    }

    // 4. Position: pull toward target
    const xDist = Math.abs(nx - targetX);
    const yDist = Math.abs(ny - targetY);
    const posScore = -(xDist * 0.08 + yDist * 0.04) * posMult;

    const score = -threat + itemScore * 50 + alignScore * 30 + posScore;
    if (score > bestScore) {
      bestScore = score;
      bestMove = [adx, ady];
    }
  }

  return bestMove;
}

// ---- Policy ----

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseBestUpgrade(obs.pending_upgrade.options, obs);
    }

    const move = calculateMove(obs);

    return { action: { move, upgrade_choice }, mem };
  },
};
