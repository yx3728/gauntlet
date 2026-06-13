/**
 * policy.js — Roguelike Skies bullet-hell policy.
 *
 * Win condition: defeat the boss (~19.5M HP). Two pillars:
 *  - DPS: pierce + multishot + fire-rate + crit + satellites scale auto-fire enormously
 *    (pierce bullets rake the tall boss for per-tick damage). Upgrade scoring prioritizes these.
 *  - Survival via STATION-KEEPING + MICRO-DODGE: stay x-aligned under the boss (or under enemy
 *    clusters) to keep auto-fire connecting — killing enemies is itself defense (fewer foes =>
 *    fewer bullets) — and only break station to sidestep a bullet that is genuinely about to hit.
 *    When safe, return to station and keep dealing damage. Surviving long enough always wins.
 */
"use strict";

const SPEED = 40;

function clampMag(vx, vy, m) {
  const d = Math.hypot(vx, vy);
  if (d <= m || d < 1e-9) return [vx, vy];
  return [vx / d * m, vy / d * m];
}

// ---------------- Upgrade scoring (additive; build-aware adjustments) ----------------
function scoreUpgrade(opt, p, preBoss) {
  const s = (opt.id + " " + opt.name + " " + opt.desc).toLowerCase();
  const has = (re) => re.test(s);
  let score = 0;
  const level = p.level || 1;
  const lowLvl = level < 7;     // early game: survival buffer is critical (thin margin)
  const isReflect = has(/受到伤害|反伤|反弹|thorn|静电/); // damage reflect, not mitigation
  // Pre-boss (waves 1-2): the waves are easy; what matters is entering the boss with a
  // survival buffer + levels. So defer pure DPS (keep pierce) and lean survival/exp.
  const dpsMul = preBoss ? 0.45 : 1;
  const survBonus = preBoss ? 40 : 0;

  // DPS — path to killing the boss (build-aware: pierce/multishot diminish once owned)
  if (has(/穿透|pierce|贯穿/)) score += p.pierce ? 30 : 130;   // pierce keystone (always)
  if (has(/分裂|侧翼|侧|多重|散射|连发|side|multi|spread|追加|额外.*弹/)) score += (70 + 70 / (1 + (p.side_bullets || 0))) * dpsMul;
  if (has(/射速|攻速|冷却|间隔|fire|rate|reload|cooldown|射击/)) score += 100 * dpsMul;
  if (has(/伤害|damage|dmg/) && !isReflect && !has(/受到|taken/)) score += 92 * dpsMul;
  if (has(/boss|屠龙/)) score += 55 * dpsMul;
  if (has(/暴击|crit/)) score += 85 * dpsMul;
  if (has(/卫星|僚机|环绕|satellite|drone|orbit/)) score += 80 * dpsMul;
  if (has(/弹|bullet|shot|projectile/)) score += 28 * dpsMul;
  if (has(/爆炸|脉冲|explos|pulse|nova|aoe|范围|连锁|chain/)) score += 42 * dpsMul;

  // Survival — boosted, especially early. Deaths are the dominant failure mode.
  if (has(/护盾|shield/)) score += (lowLvl ? 118 : 78) + survBonus;
  if (has(/最大生命|max.*hp|生命上限|hp|血量上限|生命/)) score += (lowLvl ? 110 : 70) + survBonus;
  if (!isReflect && has(/护甲|armor|减伤|damage reduc|invincib|无敌|格挡|减少.*伤害/)) score += (lowLvl ? 108 : 75) + survBonus;
  if (has(/回复|回满|恢复|修复|治疗|heal|回血|再生|regen|满血|吸血/)) score += (lowLvl ? 90 : 55) + survBonus;
  if (has(/闪避|dodge|evasion/)) score += (lowLvl ? 70 : 50);

  // Leveling / economy (snowball: exp & magnet accelerate everything early)
  if (has(/经验|exp|xp/)) score += level < 10 ? 96 : 55;
  if (has(/磁|拾取|吸|magnet|pickup/)) score += level < 8 ? 88 : 35;
  if (has(/重掷|reroll/)) score += 35;
  if (has(/金币|掉落|经济|coin|gold|drop|econ/)) score += 12;
  if (has(/移动|move|机动/) && has(/速度|speed/)) score += 24;

  const rar = { green: 0, blue: 2, purple: 5, orange: 9 }[opt.rarity] || 0;
  return score + rar;
}

function chooseUpgrade(options, p, preBoss) {
  let best = options[0], bestScore = -Infinity;
  for (const o of options) {
    const sc = scoreUpgrade(o, p, preBoss);
    if (sc > bestScore) { bestScore = sc; best = o; }
  }
  return best.index;
}

// ---------------- Movement: station-keeping micro-dodge ----------------
function decideMove(obs) {
  const [px, py] = obs.player.pos;
  const W = obs.field.w, H = obs.field.h;
  const phw = (obs.player.size[0] || 24) / 2;
  const php = (obs.player.size[1] || 30) / 2;

  const bullets = [];
  const enemies = [];
  const items = [];
  let boss = null;      // non-cutscene boss => valid target (used for aiming)
  let bossAny = null;   // any boss => avoid its body/charge even mid-cutscene
  for (const o of obs.objects) {
    if (o.type === "enemy_bullet") {
      const dx = o.pos[0] - px, dy = o.pos[1] - py;
      if (dx * dx + dy * dy < 280 * 280) bullets.push(o);
    } else if (o.type === "enemy" || o.type === "enemy_elite") {
      enemies.push(o);
    } else if (o.type === "boss") {
      bossAny = o;
      if (!o.in_cutscene) boss = o;
    } else if (o.type === "item") {
      items.push(o);
    }
  }
  if (bullets.length > 60) {
    bullets.sort((a, b) => ((a.pos[0]-px)**2+(a.pos[1]-py)**2) - ((b.pos[0]-px)**2+(b.pos[1]-py)**2));
    bullets.length = 60;
  }

  // Desired station: x under boss / enemy cluster; y in the lower band.
  // Clamp the aim-x away from the side walls so we never station in a corner —
  // the boss is wide, so an aim near the edge still keeps auto-fire connecting.
  const SIDE_MARGIN = 70;
  let aimX = W / 2;
  let haveAim = false;
  if (boss) { aimX = boss.pos[0]; haveAim = true; }
  else if (enemies.length) {
    let sx = 0, sw = 0;
    for (const e of enemies) {
      const w = 1 / (1 + Math.abs(e.pos[0] - px) * 0.02);
      sx += e.pos[0] * w; sw += w;
    }
    if (sw > 0) { aimX = sx / sw; haveAim = true; }
  }
  aimX = Math.max(SIDE_MARGIN, Math.min(W - SIDE_MARGIN, aimX));
  // Station Y: low (more reaction time vs fire from above) — empirically a sharp optimum.
  const stationY = H * 0.80;

  // INVINCIBLE (e.g. from the `invincible` pickup = ~5s immunity): we can't be hit, so stop
  // dodging phantom threats and lock straight under the boss for free max-DPS uptime. Resume
  // normal dodging once the window is nearly over (so we don't exit immunity surrounded).
  if ((obs.player.invincible_ms || 0) > 80) {
    const tx = boss ? boss.pos[0] : aimX;
    return [tx - px, stationY - py];
  }

  // Candidate velocities (include stay).
  const cands = [[0, 0]];
  const dirs = 24;
  const speeds = [SPEED, SPEED * 0.6, SPEED * 0.3];
  for (let k = 0; k < dirs; k++) {
    const a = (k / dirs) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    for (const sp of speeds) cands.push([cx * sp, cy * sp]);
  }

  const K = 16;                 // threat lookahead (ticks)
  const collR = phw + 4;
  const collRy = php + 4;
  const NEAR = 16;              // near-miss clearance band

  let bestCost = Infinity, bestMove = [0, 0];
  for (const mv of cands) {
    // The spot this move puts us at; we evaluate "go here and hold" — correctly
    // identifies a safe resting place reachable in one tick. Re-planned every tick.
    const nx = Math.max(phw, Math.min(W - phw, px + mv[0]));
    const ny = Math.max(php, Math.min(H - php, py + mv[1]));

    // THREAT: advance each bullet over K ticks; would it hit/graze us if we held (nx,ny)?
    let threat = 0;
    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      const vx = b.vel[0], vy = b.vel[1];
      let bx = b.pos[0], by = b.pos[1];
      for (let t = 1; t <= K; t++) {
        bx += vx; by += vy;
        const ex = Math.abs(bx - nx) - collR;
        const ey = Math.abs(by - ny) - collRy;
        if (ex < 0 && ey < 0) { threat += 5000 / (t * t); break; }
        const clear = Math.max(ex, ey);
        if (clear < NEAR) threat += (NEAR - clear) * (1.6 / (t * 0.5 + 1));
      }
    }
    for (let ei = 0; ei < enemies.length; ei++) {
      const e = enemies[ei];
      const ehw = (e.size[0] || 20) / 2, ehh = (e.size[1] || 20) / 2;
      const vx = e.vel ? e.vel[0] : 0, vy = e.vel ? e.vel[1] : 0;
      let exX = e.pos[0], eyY = e.pos[1];
      for (let t = 1; t <= K; t++) {
        exX += vx; eyY += vy;
        const ex = Math.abs(exX - nx) - (ehw + phw + 2);
        const ey = Math.abs(eyY - ny) - (ehh + php + 2);
        if (ex < 0 && ey < 0) { threat += 3000 / (t * t); break; }
      }
    }
    if (bossAny) {
      // The boss can CHARGE/dive (vel up to ~15px/tick). Predict its path and avoid the
      // whole sweep (its body contact is lethal) — even during a cutscene/phase shift.
      const boss = bossAny;
      const bhw = (boss.size[0] || 100) / 2, bhh = (boss.size[1] || 100) / 2;
      const bvx = boss.vel ? boss.vel[0] : 0, bvy = boss.vel ? boss.vel[1] : 0;
      let bxp = boss.pos[0], byp = boss.pos[1];
      for (let t = 1; t <= K; t++) {
        bxp += bvx; byp += bvy;
        const ex = Math.abs(bxp - nx) - (bhw + phw + 3);
        const ey = Math.abs(byp - ny) - (bhh + php + 3);
        if (ex < 0 && ey < 0) { threat += 6000 / (t * t); break; }
      }
    }

    // Edges: gentle push off the walls (kept light so we stay aggressive on-station).
    let edgeCost = 0;
    const edgeX = Math.min(nx - phw, W - phw - nx);
    const edgeY = Math.min(ny - php, H - php - ny);
    if (edgeX < 28) edgeCost += (28 - edgeX) * 0.9;
    if (edgeY < 22) edgeCost += (22 - edgeY) * 0.7;
    // The bottom wall is a trap: descending enemies/bullets pin us there. Discourage it.
    if (ny > H * 0.90) edgeCost += (ny - H * 0.90) * 1.2;

    // STATION cost (only matters when threat is low — keeps us dealing damage)
    let station = Math.abs(nx - aimX) * (haveAim ? 0.5 : 0.25);
    station += Math.abs(ny - stationY) * 0.18;

    // Exp/pickup attraction — collecting exp is the root leveling lever (we miss most
    // drops with the base 40px magnet). Pull toward exp clusters & especially hearts,
    // but it's added to the cost so THREAT always dominates (only collect when safe-ish).
    let itemPull = 0;
    for (const it of items) {
      const d = Math.hypot(it.pos[0] - nx, it.pos[1] - ny);
      const t = it.item_type || "";
      let w = 0, range = 200;
      if (t === "levelup") { w = 0.24; range = 280; }       // free level => snowball
      else if (t === "heart") { w = 0.20; range = 260; }     // +1000 shield
      else if (t === "invincible") { w = 0.16; range = 240; }
      else if (t === "bomb") { w = 0.12; range = 220; }
      else if (t === "magnet") { w = 0.10; }
      else if (t.startsWith("exp")) w = 0.07;
      else if (t === "coin") w = 0.02;
      if (w && d < range) itemPull -= (range - d) * w;
    }

    const cost = threat * 1.0 + edgeCost + station + itemPull;
    if (cost < bestCost) { bestCost = cost; bestMove = mv; }
  }
  return bestMove;
}

module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    // Fully defensive: must never throw and must always return a valid action.
    try {
      if (obs && obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        let upgrade_choice;
        try {
          const preBoss = !(obs.reward_info && obs.reward_info.boss_reached);
          upgrade_choice = chooseUpgrade(obs.pending_upgrade.options, obs.player || {}, preBoss);
        } catch (e) {
          upgrade_choice = obs.pending_upgrade.options[0].index;
        }
        return { action: { move: [0, 0], upgrade_choice }, mem };
      }
      let move = [0, 0];
      try { move = decideMove(obs); } catch (e) { move = [0, 0]; }
      move = clampMag(move[0], move[1], SPEED);
      if (!Number.isFinite(move[0]) || !Number.isFinite(move[1])) move = [0, 0];
      return { action: { move, upgrade_choice: null }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
