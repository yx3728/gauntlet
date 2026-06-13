"use strict";

const SPEED = 40;
const MARGIN = 18;
const RARITY_SCORE = { orange: 4, purple: 3, blue: 2, green: 1 };

function scoreUpgrade(opt, playerHp, playerMaxHp, playerLevel) {
  const text = ((opt.name || '') + ' ' + (opt.desc || '')).toLowerCase();
  let score = (RARITY_SCORE[opt.rarity] || 0) * 10;
  const hp_ratio = playerHp / Math.max(1, playerMaxHp);
  const lvl = playerLevel || 1;

  // Guaranteed-drop loot radar: critical for boss-fight exp from elites
  if (text.includes('战利品') || text.includes('必定掉落') || text.includes('掉落道具')) score += 20;

  // Near-zero proc penalty — useless upgrade
  if (text.includes('0.05%')) score -= 35;

  if (text.includes('回满生命') || text.includes('应急修复') || text.includes('heal_quick')) {
    score += hp_ratio < 0.8 ? 80 : 40;
  }
  if (text.includes('穿透') || text.includes('pierce')) score += 35;
  if (text.includes('卫星') || text.includes('satellite')) score += 25;
  if (text.includes('终端') || text.includes('terminal')) score += 20;
  if (text.includes('暴击') || text.includes('crit')) score += 18;
  if (text.includes('伤害') || text.includes('damage') || text.includes('dmg')) score += 15;
  if (text.includes('高能') || text.includes('弹芯')) score += 15;
  if (text.includes('射速') || text.includes('射击') || text.includes('rapid') || text.includes('fire rate')) score += 15;
  if (text.includes('side') || text.includes('spread') || text.includes('triple') || text.includes('double')) score += 12;
  if (text.includes('护盾') || text.includes('shield')) score += 12;
  if (text.includes('血量') || text.includes('生命上限')) score += 8;
  if (text.includes('磁') || text.includes('magnet') || text.includes('拾取范围') || text.includes('收集')) score += 10;
  // Exp multiplier: higher value at low level
  const expBonus = lvl <= 5 ? 24 : 8;
  if (text.includes('倍率') || text.includes('经验倍率')) score += expBonus;
  if (text.includes('经验') || text.includes('exp')) score += 8;
  if (text.includes('吸血') || text.includes('lifesteal')) score += 6;
  if (text.includes('金币') || text.includes('coin') || text.includes('经济')) score -= 5;

  return score;
}

function chooseUpgrade(options, playerHp, playerMaxHp, playerLevel) {
  let best = options[0].index;
  let bestScore = -Infinity;
  for (const opt of options) {
    const s = scoreUpgrade(opt, playerHp, playerMaxHp, playerLevel);
    if (s > bestScore) { bestScore = s; best = opt.index; }
  }
  return best;
}

module.exports = {
  init() { return { bossPhase: 0, prevHp: null, stepsSinceDmg: 9999 }; },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const [pw, ph] = obs.player.size;
    const { w, h } = obs.field;
    const player = obs.player;

    let bossPhase = mem.bossPhase || 0;

    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, player.hp, player.max_hp, player.level);
    }

    const bullets = [];
    const expItems = [];
    const healItems = [];
    const enemies = [];
    let bossObj = null;

    for (const obj of obs.objects) {
      if (obj.type === 'enemy_bullet') {
        bullets.push(obj);
      } else if (obj.type === 'item') {
        if (obj.item_type === 'heart' || obj.item_type === 'invincible') healItems.push(obj);
        else expItems.push(obj);
      } else if (obj.type === 'boss') {
        if (!obj.in_cutscene) bossObj = obj;
      } else if (obj.type === 'enemy' || obj.type === 'enemy_elite') {
        if (!obj.in_cutscene) enemies.push(obj);
      }
    }

    const allEnemies = bossObj ? [bossObj, ...enemies] : enemies;
    const lowHp = player.hp < player.max_hp * 0.5;
    const veryLowHp = player.hp < player.max_hp * 0.25;

    // Adaptive t_min cutoff: 70 (safe corner found) or 90 (still seeking safe zone)
    const stepsSinceDmg = mem.stepsSinceDmg !== undefined ? mem.stepsSinceDmg : 9999;
    const tCutoff = bossObj && stepsSinceDmg < 2000 ? 90 : 70;
    // Sqrt time factor: stronger penalty for mid-to-far bullets in unsafe mode
    const useSqrt = bossObj && stepsSinceDmg < 2000;

    // Primary target for x-alignment
    let targetX = w / 2;
    let targetObj = null;
    if (bossObj) {
      targetObj = bossObj;
      targetX = bossObj.pos[0];
    } else if (enemies.length > 0) {
      const safeEnemies = enemies.filter(e => {
        const ey = e.pos[1];
        const [ew, eh] = Array.isArray(e.size) ? e.size : [e.size, e.size];
        return ey < py - (eh + ph) / 2 - 30;
      });
      if (safeEnemies.length > 0) {
        targetObj = safeEnemies.sort((a, b) => Math.abs(a.pos[0] - px) - Math.abs(b.pos[0] - px))[0];
        targetX = targetObj.pos[0];
      }
    }

    // Direction sampling
    const NUM_DIRS = 32;
    let bestScore = -Infinity;
    let bestDx = 0, bestDy = 0;
    const candidates = [{ dx: 0, dy: 0 }];
    for (let i = 0; i < NUM_DIRS; i++) {
      const angle = (i / NUM_DIRS) * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      candidates.push({ dx: c * SPEED, dy: s * SPEED });
      candidates.push({ dx: c * SPEED * 0.5, dy: s * SPEED * 0.5 });
    }

    for (const { dx, dy } of candidates) {
      const cx = px + dx;
      const cy = py + dy;

      if (cx < MARGIN || cx > w - MARGIN || cy < MARGIN || cy > h - MARGIN) continue;

      let score = 0;

      // Enemy body avoidance
      for (const e of allEnemies) {
        if (e.in_cutscene) continue;
        const [ew, eh] = Array.isArray(e.size) ? e.size : [e.size, e.size];
        const evx = e.vel ? e.vel[0] : 0;
        const evy = e.vel ? e.vel[1] : 0;
        for (let t = 0; t <= 8; t++) {
          const ex = e.pos[0] + evx * t;
          const ey = e.pos[1] + evy * t;
          const xOver = (ew + pw) / 2 - Math.abs(cx - ex);
          const yOver = (eh + ph) / 2 - Math.abs(cy - ey);
          if (xOver > 0 && yOver > 0) {
            score -= 8000 / (t + 1);
          } else {
            const nearX = xOver + 45;
            const nearY = yOver + 45;
            if (nearX > 0 && nearY > 0) {
              score -= Math.min(nearX, nearY) / 45 * 200 / (t + 1);
            }
          }
        }
      }

      // Bullet avoidance
      for (const b of bullets) {
        const bvx = b.vel ? b.vel[0] : 0;
        const bvy = b.vel ? b.vel[1] : 0;
        const dbx = b.pos[0] - cx;
        const dby = b.pos[1] - cy;
        const dv2 = bvx * bvx + bvy * bvy;
        let t_min;
        if (dv2 < 0.01) {
          t_min = 0;
        } else {
          t_min = Math.max(0, -(dbx * bvx + dby * bvy) / dv2);
        }
        if (t_min > tCutoff) continue;
        const bxc = b.pos[0] + bvx * t_min;
        const byc = b.pos[1] + bvy * t_min;
        const dist = Math.sqrt((bxc - cx) ** 2 + (byc - cy) ** 2);
        const DANGER = 23;
        const tFactor = useSqrt ? Math.sqrt(t_min + 1) : (t_min + 1);
        if (dist < DANGER) {
          score -= (DANGER - dist) / DANGER * 500 / tFactor;
        } else if (dist < DANGER * 3) {
          score -= (DANGER * 3 - dist) / (DANGER * 3) * 60 / tFactor;
        }
      }

      // X-alignment
      if (targetObj) {
        const xDiff = Math.abs(cx - targetX);
        score += Math.max(0, 80 - xDiff) * 0.15;
      }

      // Healing items
      for (const item of healItems) {
        const d = Math.sqrt((item.pos[0] - cx) ** 2 + (item.pos[1] - cy) ** 2);
        const pri = veryLowHp ? 8 : lowHp ? 4 : 0.5;
        if (d < 300) score += (300 - d) / 300 * pri;
      }

      // Exp items
      for (const item of expItems) {
        const d = Math.sqrt((item.pos[0] - cx) ** 2 + (item.pos[1] - cy) ** 2);
        if (d < 250) score += (250 - d) / 250 * 1.5;
      }

      // Preferred Y: during boss fight stay near bottom where boss bullets take >70 ticks
      let prefY;
      if (bossObj) {
        prefY = h * 0.88;
      } else {
        prefY = h * 0.82;
      }
      score += (1 - Math.abs(cy - prefY) / h) * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }

    const dmgTaken = Math.max(0, (mem.prevHp !== null ? mem.prevHp : player.hp) - player.hp);
    const newStepsSinceDmg = bossObj
      ? (dmgTaken > 0 ? 0 : (stepsSinceDmg || 0) + 1)
      : 9999;
    mem = { bossPhase, prevHp: player.hp, stepsSinceDmg: newStepsSinceDmg };
    return { action: { move: [bestDx, bestDy], upgrade_choice }, mem };
  },
};
