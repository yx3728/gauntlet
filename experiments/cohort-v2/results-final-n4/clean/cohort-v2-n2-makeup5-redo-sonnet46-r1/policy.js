"use strict";

const FIELD_W = 360;
const FIELD_H = 640;
const SPEED = 38;
const P_HW = 12, P_HH = 15;
const B_HW = 3.5, B_HH = 6;
const HIT_W = P_HW + B_HW;  // 15.5
const HIT_H = P_HH + B_HH;  // 21

function chooseUpgrade(options, player) {
  if (!options || options.length === 0) return 0;
  const hp_frac = player.hp / player.max_hp;
  let bestIdx = options[0].index;
  let bestScore = -Infinity;
  for (const opt of options) {
    let score = 0;
    const c = ((opt.name || '') + ' ' + (opt.id || '') + ' ' + (opt.desc || '')).toLowerCase();
    const rarity = { green: 0, blue: 8, purple: 18, orange: 35 };
    score += rarity[opt.rarity] || 0;

    // DPS upgrades (boss has 19.4M HP; need massive DPS boost)
    if (c.includes('split') || c.includes('ms_split')) score += 26;
    if (c.includes('side') || c.includes('side_bullet')) score += 24;
    if (c.includes('pierce') || c.includes('穿透')) score += 28;
    if (c.includes('satellite') || c.includes('卫星')) score += 22;
    if (c.includes('rapid') || c.includes('fire rate') || c.includes('firing') ||
        c.includes('shoot_interval') || c.includes('攻速') || c.includes('interval') ||
        c.includes('cooldown') || c.includes('speed_s')) score += 30;
    if (c.includes('damage') || c.includes('dmg') || c.includes('伤害') ||
        c.includes('terminal') || c.includes('atk')) score += 22;
    if (c.includes('crit') || c.includes('暴击')) score += 18;
    if (c.includes('bullet') && !c.includes('enemy')) score += 14;
    if (c.includes('power') || c.includes('reinforce') || c.includes('enhance')) score += 12;

    // Survival
    if (c.includes('shield') || c.includes('护盾')) score += player.shield_max > 0 ? 8 : (hp_frac < 0.5 ? 26 : 14);
    if (c.includes('heal') || c.includes('regen') || c.includes('再生')) {
      score += hp_frac < 0.4 ? 26 : (hp_frac < 0.7 ? 12 : 4);
    }
    if (c.includes('max_hp') || c.includes('最大')) score += 10;
    if (c.includes('invincible') || c.includes('无敌')) score += 20;
    if (c.includes('hp') && !c.includes('max') && !c.includes('ship')) {
      score += hp_frac < 0.5 ? 16 : 6;
    }
    if (c.includes('magnet') || c.includes('磁')) score += 22;
    if (c.includes('exp') || c.includes('experience') || c.includes('经验')) score += 12;
    if (c.includes('drop') || c.includes('掉落')) score += 8;

    if (score > bestScore) { bestScore = score; bestIdx = opt.index; }
  }
  return bestIdx;
}

// Score a position x at height testY for safety and goal proximity
function scorePosX(x, testY, goalX, bullets, enemies) {
  let danger = 0;
  for (const b of bullets) {
    const [bx, by] = b.pos;
    const [vx, vy] = b.vel;
    if (vy <= 0) continue;

    // Current overlap
    if (Math.abs(bx - x) < HIT_W && Math.abs(by - testY) < HIT_H) {
      danger += 500;
      continue;
    }

    // Trajectory: when will bullet bottom reach player top?
    const gap = (testY - HIT_H) - (by + B_HH);
    const dt = gap <= 0 ? 0 : gap / vy;
    if (dt < 0 || dt > 85) continue;
    const ix = bx + vx * dt;
    const xd = Math.abs(ix - x);
    if (xd < HIT_W) {
      danger += 100 * (1 - dt / 85);
    } else if (xd < HIT_W + 45) {
      danger += 25 * (1 - (xd - HIT_W) / 45) * (1 - dt / 85);
    }
  }
  // Enemy body collision handled by repulsion forces — no enemy penalty in findSafeX.
  return -danger - Math.abs(x - goalX) * 0.12;
}

function findSafeX(goalX, testY, bullets, enemies, lo, hi) {
  let bestX = goalX, bestS = scorePosX(goalX, testY, goalX, bullets, enemies);
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const x = lo + (hi - lo) * (i / N);
    const s = scorePosX(x, testY, goalX, bullets, enemies);
    if (s > bestS) { bestS = s; bestX = x; }
  }
  return bestX;
}

// Compute emergency repulsion forces from bullets and enemies
function computeRepulsion(px, py, bullets, enemies) {
  let fx = 0, fy = 0;

  for (const b of bullets) {
    const [bx, by] = b.pos;
    const [vx, vy] = b.vel;
    if (vy <= 0) continue;

    // Current overlap: emergency push
    if (Math.abs(bx - px) < HIT_W && Math.abs(by - py) < HIT_H) {
      fx += Math.sign(px - bx || 1) * 100;
      continue;
    }

    // Proximity repulsion: push sideways when bullet close
    const dx = px - bx;
    const dist = Math.hypot(dx, by - py);
    if (dist < 60) {
      const gap = (py - HIT_H) - (by + B_HH);
      const dt = gap <= 0 ? 0 : gap / vy;
      if (dt >= 0 && dt < 40) {
        const urgency = 1 - dt / 40;
        const ix = bx + vx * dt;
        const xd = Math.abs(ix - px);
        if (xd < HIT_W + 20) {
          fx += Math.sign(px - ix || 1) * urgency * urgency * 70;
        }
      }
    }
  }

  // Enemy body avoidance
  for (const e of enemies) {
    const [ex, ey] = e.pos;
    const evx = e.vel ? e.vel[0] : 0;
    const evy = e.vel ? e.vel[1] : 0;
    const dx = px - ex;
    const dy = py - ey;
    const dist = Math.hypot(dx, dy);
    const safeR = 75;

    if (dist < safeR) {
      const rep = (safeR - dist) / safeR;
      fx += (dx / (dist + 0.01)) * rep * 160;
      fy += (dy / (dist + 0.01)) * rep * 160;
    }

    // AABB emergency escape: when center-to-center inside collision zone + buffer
    const ehw = e.size ? e.size[0] / 2 : 25;
    const ehh = e.size ? e.size[1] / 2 : 25;
    const aabbX = P_HW + ehw + 8;
    const aabbY = P_HH + ehh + 8;
    if (Math.abs(dx) < aabbX && Math.abs(dy) < aabbY) {
      fx += Math.sign(dx || 1) * 130;
      // No fy: linear main repulsion handles vertical; AABB fy risks boundary-trapping
    }

    // Extra horizontal push: early warning for enemies in player's vertical lane
    if (Math.abs(ey - py) < safeR) {
      const hd = Math.abs(dx);
      if (hd < 65) {
        const pred = (safeR - hd) / safeR;
        if (pred > 0) fx += Math.sign(dx || 1) * pred * 120;
      }
    }
  }

  return { fx, fy };
}

module.exports = {
  init() {
    return { oscPhase: 0 };
  },

  policy(obs, mem) {
    const player = obs.player;
    const [px, py] = player.pos;
    const w = obs.field.w || FIELD_W;
    const h = obs.field.h || FIELD_H;
    const hp_frac = player.hp / player.max_hp;
    const frame = obs.frame || 0;

    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0) {
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, player);
    }

    // Categorize objects
    const bullets = [];
    const items = [];
    const enemies = [];
    let boss = null;
    for (const o of obs.objects) {
      switch (o.type) {
        case 'enemy_bullet': bullets.push(o); break;
        case 'item': items.push(o); break;
        case 'boss': if (!o.in_cutscene) boss = o; break;
        case 'enemy': case 'enemy_elite': enemies.push(o); break;
      }
    }

    const isBoss = boss !== null || (obs.reward_info && obs.reward_info.boss_active);
    const edge = 22;

    // Compute repulsion forces
    const { fx: repX, fy: repY } = computeRepulsion(px, py, bullets, enemies);

    let targetX, targetY;
    let newOscPhase = (mem.oscPhase || 0) + 1;

    if (isBoss) {
      targetY = h * 0.76;

      // Drift oscillation around field center — proven to clear seed 4
      const driftX = w / 2 + Math.sin(newOscPhase / 150) * 80;
      const safePosX = findSafeX(driftX, targetY, bullets, enemies, edge, w - edge);
      targetX = safePosX * 0.7 + driftX * 0.3;

      // Chase health items when critically low
      if (hp_frac < 0.25) {
        for (const item of items) {
          if (item.item_type === 'heart' || item.item_type === 'invincible') {
            targetX = item.pos[0];
            targetY = item.pos[1];
            break;
          }
        }
      }
    } else {
      // Farming phase: stay near bottom, collect items, shoot enemies
      const safeY = h - 90;
      targetY = safeY;

      // Priority: valuable items in lower half
      let bestItem = null, bestItemScore = -1;
      for (const item of items) {
        const [ix, iy] = item.pos;
        if (iy < h * 0.38) continue; // skip items too high

        let base = 0;
        if (item.item_type === 'heart') base = hp_frac < 0.4 ? 170 : (hp_frac < 0.7 ? 70 : 25);
        else if (item.item_type === 'levelup') base = 150;
        else if (item.item_type === 'invincible') base = 110;
        else if (item.item_type === 'bomb') base = 75;
        else if (item.item_type === 'magnet') base = 70;
        else base = (item.exp_value || 0) * 8 + 15;

        // Penalize items where an enemy is STRICTLY between player and item
        // (in the horizontal range, and close to the player's y level)
        let pathBlocked = false;
        const minX = Math.min(px, ix), maxX = Math.max(px, ix);
        if (maxX - minX > 5) { // skip when item is right next to player
          for (const e of enemies) {
            const [ex, ey] = e.pos;
            if (ex > minX && ex < maxX && Math.abs(ey - safeY) < 62) {
              pathBlocked = true; break;
            }
          }
        }
        if (pathBlocked) base *= 0.1;

        const sc = base * 250 / (Math.abs(ix - px) + Math.abs(iy - safeY) * 0.25 + 60);
        if (sc > bestItemScore) { bestItemScore = sc; bestItem = item; }
      }

      if (bestItem && bestItemScore > 6) {
        targetX = bestItem.pos[0];
        if (Math.abs(bestItem.pos[1] - safeY) < 70) targetY = bestItem.pos[1];
      } else {
        // Target the closest enemy above to align shots (fire goes straight up)
        // No hpFrac bonus — avoids oscillating to chase dying enemies far away
        let bestEn = null, bestEnScore = -Infinity;
        for (const e of enemies) {
          const [ex, ey] = e.pos;
          if (ey >= safeY - 10) continue; // must be above player
          const xDist = Math.abs(ex - px);
          const vy = e.vel ? e.vel[1] : 1.5;
          const timeToEscape = Math.max(1, (safeY - ey) / vy);
          if (xDist / SPEED > timeToEscape * 0.75) continue; // can't align in time
          const hpFrac = (e.hp && e.max_hp) ? e.hp / e.max_hp : 1;
          const score = 1000 / (xDist + 25) + (1 - hpFrac) * 200;
          if (score > bestEnScore) { bestEnScore = score; bestEn = e; }
        }
        if (bestEn) {
          targetX = bestEn.pos[0];
        } else {
          // Cluster center fallback: average x of all enemies above
          let cx = 0, cnt = 0;
          for (const e of enemies) {
            if (e.pos[1] < safeY - 10) { cx += e.pos[0]; cnt++; }
          }
          targetX = cnt > 0 ? cx / cnt : (w / 2 + Math.sin(frame / 90) * 80);
        }
      }

      // Always route through bullet-safe position
      targetX = findSafeX(targetX, safeY, bullets, enemies, edge, w - edge);
    }

    // Clamp target
    targetX = Math.max(edge, Math.min(w - edge, targetX));
    targetY = Math.max(edge, Math.min(h - edge, targetY));

    // Attraction toward target
    const tdx = targetX - px, tdy = targetY - py;
    const tdist = Math.hypot(tdx, tdy) + 0.01;
    const attrMag = 18;
    const attrX = (tdx / tdist) * attrMag;
    const attrY = (tdy / tdist) * attrMag;

    let dx = repX + attrX;
    let dy = repY + attrY;

    // Clamp to speed
    const mag = Math.hypot(dx, dy);
    if (mag > SPEED) {
      dx = (dx / mag) * SPEED;
      dy = (dy / mag) * SPEED;
    }

    // Boundary enforcement
    const nx = px + dx, ny = py + dy;
    if (nx < edge) dx = edge - px;
    if (nx > w - edge) dx = (w - edge) - px;
    if (ny < edge) dy = edge - py;
    if (ny > h - edge) dy = (h - edge) - py;

    return {
      action: { move: [dx, dy], upgrade_choice },
      mem: { oscPhase: newOscPhase }
    };
  }
};
