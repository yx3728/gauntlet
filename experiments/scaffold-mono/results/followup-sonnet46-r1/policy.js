"use strict";

const UPGRADE_SCORES = {
  pc_pierce:        95,
  crit_aim:         92,
  fr_cool:          86,
  fr_basic:         82,
  tyrant_breaker:   80,
  boss_hunter:      78,
  ms_split_m:       77,
  mix_vulcan:       75,
  mix_fire:         72,
  ms_split_s:       70,
  mix_ascend:       68,
  kill_pulse_3:     64,
  bs_size_s:        58,
  dmg_s:            54,
  shield_basic:     50,
  elite_hunter:     48,
  kill_blood:       44,
  heal_overflow:    40,
  regen_basic:      50,
  sat_orbit:        35,
  turncoat_shield:  35,
  mag_basic:        33,
  drop_basic:       30,
  heal_quick:       37,
  mix_perfect:      50,
  exp_basic:        22,
  kill_pulse:       15,
  thorn_static:     12,
  reroll_premium:   10,
  coin_small:        6,
  mix_econ:          4,
  // Undervalued upgrades corrected:
  regen_nano:       55,   // purple: +4%/sec HP regen (req regen_basic). effective 71.
  kill_butcher:     28,   // purple: lifesteal +5% (req kill_blood). effective 44.
  mix_terminal:     30,   // purple: dmg +15% + crit +25%. effective 46.
  shield_extra:     30,   // purple: shield=maxHP, 15%/sec regen. effective 46.
  ms_split_l:       40,   // purple: 9-spread bullets (req ms_split_m). effective 56.
  fr_turbo:         47,   // blue: fire rate +128%, bullet size -10%. effective 55.
};

const RARITY_BONUS = { orange: 22, purple: 16, blue: 8, green: 0 };

function chooseUpgrade(options) {
  let best = options[0].index;
  let bestScore = -Infinity;
  for (const opt of options) {
    const base = UPGRADE_SCORES[opt.id] !== undefined ? UPGRADE_SCORES[opt.id] : 25;
    const total = base + (RARITY_BONUS[opt.rarity] || 0);
    if (total > bestScore) { bestScore = total; best = opt.index; }
  }
  return best;
}

module.exports = {
  init() { return { lastDodgeDir: 1, dodgeStep: 0, bossPhase: 0, lastBossHp: 0 }; },

  policy(obs, mem) {
    const [px, py] = obs.player.pos;
    const { w: fw, h: fh } = obs.field;

    let upgrade_choice = null;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length > 0)
      upgrade_choice = chooseUpgrade(obs.pending_upgrade.options);

    const enemyBullets = [], enemies = [], items = [];
    let boss = null;
    for (const obj of obs.objects) {
      if (obj.type === "enemy_bullet") enemyBullets.push(obj);
      else if (obj.type === "boss") { boss = obj; enemies.push(obj); }
      else if (obj.type === "enemy" || obj.type === "enemy_elite") enemies.push(obj);
      else if (obj.type === "item") items.push(obj);
    }

    const SPEED = 40;
    const BOSS_FIGHT = boss && !boss.in_cutscene;

    // Track boss phase transitions (HP resetting to full = new phase)
    let bossPhase = mem.bossPhase || 0;
    let lastBossHp = mem.lastBossHp || 0;
    if (BOSS_FIGHT) {
      if (boss.hp > lastBossHp * 2 && lastBossHp > 0) bossPhase++;
      lastBossHp = boss.hp;
    }

    // === BULLET AVOIDANCE (v3 filter: skip approaching bullets) ===
    const dangerRadius = 150;
    let bulletForceX = 0, bulletForceY = 0, maxDanger = 0;
    for (const b of enemyBullets) {
      const [bx, by] = b.pos, [bvx, bvy] = b.vel;
      const toX = px - bx, toY = py - by;
      const dist = Math.sqrt(toX * toX + toY * toY);
      if (dist > dangerRadius) continue;
      if (toX * bvx + toY * bvy > 0) continue; // skip approaching bullets
      const danger = (dangerRadius - dist) / dangerRadius;
      if (dist > 0) {
        bulletForceX += (toX / dist) * danger * 3;
        bulletForceY += (toY / dist) * danger * 2;
      }
      maxDanger = Math.max(maxDanger, danger);
    }

    // === BODY AVOIDANCE ===
    const BODY_SAFE = 85;
    let bodyForceX = 0, bodyForceY = 0, maxBodyDanger = 0;
    for (const e of enemies) {
      if (e.type === "boss") continue;
      const dX = px - e.pos[0], dY = py - e.pos[1];
      const dist = Math.sqrt(dX * dX + dY * dY);
      if (dist > BODY_SAFE) continue;
      const danger = (BODY_SAFE - dist) / BODY_SAFE;
      if (dist > 0) { bodyForceX += (dX / dist) * danger * 3; bodyForceY += (dY / dist) * danger * 3; }
      maxBodyDanger = Math.max(maxBodyDanger, danger);
    }

    // === PRIMARY TARGET X ===
    let targetX = fw / 2, targetIsBoss = false;
    if (BOSS_FIGHT) {
      const bossX = boss.pos[0];
      const ds = mem.dodgeStep || 0;
      const bossWeave = Math.sin(ds * 0.07) * 50; // period ~90 steps, desynced from boss fire (~25)
      targetX = Math.max(20, Math.min(fw - 20, bossX + bossWeave));
      targetIsBoss = true;
    } else {
      let bestScore = -Infinity;
      for (const e of enemies) {
        if (e.type === "boss") continue;
        const [ex, ey] = e.pos;
        if (ey >= py - BODY_SAFE) continue;
        const score = -Math.abs(px - ex) * 0.4 + (1 - (e.hp || 0) / (e.max_hp || 1)) * 80;
        if (score > bestScore) { bestScore = score; targetX = ex; }
      }
    }

    // === ITEMS ===
    let nearestItemDist = Infinity, itemDx = 0, itemDy = 0;
    const ITEM_CHASE = BOSS_FIGHT ? 120 : 200;
    for (const item of items) {
      const [ix, iy] = item.pos;
      if (iy < py - 160) continue;
      const dist = Math.sqrt((px - ix) ** 2 + (py - iy) ** 2);
      if (dist < nearestItemDist) { nearestItemDist = dist; itemDx = ix - px; itemDy = iy - py; }
    }

    // === MOVEMENT DECISION ===
    let dx = 0, dy = 0;
    const toTargetX = targetX - px;

    if (maxDanger > 0.5) {
      dx = bulletForceX * SPEED;
      dy = bulletForceY * SPEED * 0.3;
    } else if (maxDanger > 0.15 || maxBodyDanger > 0.2) {
      dx = bulletForceX * SPEED * 0.7;
      dy = bulletForceY * SPEED * 0.2;
      if (nearestItemDist < 100) {
        const len = Math.sqrt(itemDx * itemDx + itemDy * itemDy) || 1;
        dx += (itemDx / len) * SPEED * 0.3;
      } else {
        dx += Math.sign(toTargetX) * SPEED * 0.3;
      }
    } else {
      if (nearestItemDist < ITEM_CHASE && (!targetIsBoss || nearestItemDist < 80)) {
        const len = Math.sqrt(itemDx * itemDx + itemDy * itemDy) || 1;
        dx = (itemDx / len) * SPEED * 0.85;
        if (itemDy < 0 && (py + itemDy) < fh * 0.55) dy = 0;
        else dy = (itemDy / len) * SPEED * 0.5;
      } else {
        const distToTarget = Math.abs(toTargetX);
        if (distToTarget > 5) dx = Math.sign(toTargetX) * Math.min(SPEED, distToTarget * 0.55);
      }
    }

    if (maxBodyDanger > 0) {
      dx += bodyForceX * SPEED * 0.5;
      dy += bodyForceY * SPEED * 0.5;
    }

    // Wall-drift clamp: only fires when player has already drifted far from boss (>200px).
    // This avoids interfering with normal dodge movement for non-wall-drift seeds.
    if (BOSS_FIGHT && maxDanger > 0.5 && bossPhase >= 1 && Math.abs(px - boss.pos[0]) > 60) {
      const bossX = boss.pos[0];
      const projX = px + dx;
      if (projX > bossX + 55) dx = bossX + 55 - px;
      if (projX < bossX - 55) dx = bossX - 55 - px;
    }

    // Emergency X-only lateral dodge for nearly-overhead bullets (bypasses v3 filter)
    if (maxDanger < 0.3) {
      for (const b of enemyBullets) {
        const [bx, by] = b.pos, [, bvy] = b.vel;
        if (bvy <= 0) continue;
        const toY_e = py - by;
        if (toY_e < 0 || toY_e > 55) continue;
        const toX_e = px - bx;
        if (Math.abs(toX_e) > 18) continue;
        const urgency = (55 - toY_e) / 55;
        const dodgeDir = toX_e !== 0 ? Math.sign(toX_e) : (mem.lastDodgeDir || 1);
        dx += dodgeDir * urgency * SPEED * 0.8;
      }
    }


    // === Y MANAGEMENT ===
    const minY = fh * 0.5, maxY = fh * 0.9;
    const idealY = BOSS_FIGHT ? fh * 0.76 : fh * 0.78;
    if (py + dy < minY) dy = Math.max(dy, minY - py);
    if (py + dy > maxY) dy = Math.min(dy, maxY - py);
    const yDiff = idealY - py;
    if (Math.abs(yDiff) > 30 && Math.abs(dy) < SPEED * 0.2)
      dy += Math.sign(yDiff) * SPEED * 0.15;

    const margin = 15;
    const newPx = Math.max(margin, Math.min(fw - margin, px + dx));
    const newPy = Math.max(10, Math.min(fh - 10, py + dy));
    dx = newPx - px; dy = newPy - py;

    const moveMag = Math.sqrt(dx * dx + dy * dy);
    if (moveMag > SPEED) { dx = (dx / moveMag) * SPEED; dy = (dy / moveMag) * SPEED; }

    return {
      action: { move: [dx, dy], upgrade_choice },
      mem: {
        lastDodgeDir: dx !== 0 ? Math.sign(dx) : (mem.lastDodgeDir || 1),
        dodgeStep: (mem.dodgeStep || 0) + 1,
        bossPhase,
        lastBossHp,
      }
    };
  }
};
