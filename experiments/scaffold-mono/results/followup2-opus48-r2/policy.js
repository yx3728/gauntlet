"use strict";

/**
 * Roguelike Skies policy.
 *
 * Core model (observed):
 *  - Ship fires straight UP from its current x; to damage an enemy, align x with it.
 *  - Enemy bodies = lethal contact dmg; enemy_bullets = 300 dmg; we have 3000 hp base.
 *  - Enemies/bullets descend; enemies despawn off the bottom -> dodge their column to survive.
 *  - Boss has huge HP (~19M) -> must stack DPS upgrades (multishot/dmg/firerate) AND survive.
 *
 * Movement: sample candidate moves, score each by SAFETY (avoid predicted collisions with
 * enemies & bullets) + AIM (align x with a target enemy) + POSITION (stay in a good band).
 */

const SPEED = 40;          // matches default speed_cap; clamp magnitude
const FIELD_W = 360;
const FIELD_H = 640;

// ---------- helpers ----------
function clampMag(dx, dy, cap) {
  const m = Math.hypot(dx, dy);
  if (m > cap && m > 0) return [dx / m * cap, dy / m * cap];
  return [dx, dy];
}

function half(o) { return [o.size[0] / 2, o.size[1] / 2]; }

// Collision/proximity danger of the whole threat list for a player sitting at (nx,ny),
// taking the WORST over integer ticks t in [tlo,thi] (threats advance at their vel, player
// assumed static). Overlap = full threat weight (any contact is big dmg, depth-independent);
// proximity within a per-threat margin is penalized smoothly. Returns summed danger.
function dangerAt(nx, ny, phw, phh, threats, tlo, thi) {
  let total = 0;
  for (let k = 0; k < threats.length; k++) {
    const o = threats[k];
    let worst = 0;
    for (let t = tlo; t <= thi; t++) {
      const ex = o.x + o.vx * t, ey = o.y + o.vy * t;
      const gx = Math.abs(ex - nx) - (phw + o.hw);
      const gy = Math.abs(ey - ny) - (phh + o.hh);
      if (gx < 0 && gy < 0) { worst = o.w; break; }       // overlap => lethal-class
      const gap = Math.hypot(Math.max(gx, 0), Math.max(gy, 0));
      if (gap < o.margin) {
        const r = (o.margin - gap) / o.margin;
        const pen = o.w * 0.55 * r * r;
        if (pen > worst) worst = pen;
      }
    }
    total += worst;
  }
  return total;
}

// Greedy rollout: from (sx,sy), simulate up to K steps of committed wall-aware fleeing
// (threats advance at their velocity). Returns the number of steps survived before a
// predicted contact (K if it survives all). Detects traps (corner death) a few frames early.
function rolloutSurvival(sx, sy, phw, phh, threats, K, cap, clampX, clampY) {
  let x = sx, y = sy;
  for (let t = 1; t <= K; t++) {
    // collision at current pos vs threats advanced to time t
    for (let k = 0; k < threats.length; k++) {
      const o = threats[k];
      const ex = o.x + o.vx * t, ey = o.y + o.vy * t;
      if (Math.abs(ex - x) < phw + o.hw && Math.abs(ey - y) < phh + o.hh) return t - 1;
    }
    // compute flee vector: repulsion from near threats + walls (so it slips along walls, not into them)
    let fx = 0, fy = 0;
    for (let k = 0; k < threats.length; k++) {
      const o = threats[k];
      const ex = o.x + o.vx * t, ey = o.y + o.vy * t;
      const dx = x - ex, dy = y - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 < 14400) { const d = Math.sqrt(d2) + 2; const w = o.w / d2; fx += (dx / d) * w * 2000; fy += (dy / d) * w * 2000; }
    }
    fx += Math.max(0, 80 - x) * 1.5; fx -= Math.max(0, x - (FIELD_W - 80)) * 1.5;
    fy += Math.max(0, 120 - y) * 1.0; fy -= Math.max(0, y - (FIELD_H - 70)) * 1.5;
    const fm = Math.hypot(fx, fy);
    if (fm > 0.001) { x = clampX(x + (fx / fm) * cap); y = clampY(y + (fy / fm) * cap); }
  }
  return K;
}

// pick the enemy to aim at: the lowest enemy that is still safely ABOVE us (so sitting
// under it to shoot doesn't mean eating a body-contact). Boss takes priority.
function pickTarget(obs) {
  const px = obs.player.pos[0], py = obs.player.pos[1];
  let best = null, bestKey = -Infinity;
  for (const o of obs.objects) {
    const t = o.type;
    if (t === "boss" && !o.in_cutscene) return o; // boss is priority
    if (t === "enemy" || t === "enemy_elite") {
      if (o.pos[1] > py - 50) continue; // too close / below us -> don't aim into it
      const key = o.pos[1] * 2 - Math.abs(o.pos[0] - px) * 0.6;
      if (key > bestKey) { bestKey = key; best = o; }
    }
  }
  return best;
}

// ---------- upgrade selection ----------
// To beat a ~19.5M HP boss we need huge DPS AND sustain. DPS scaling comes mostly from
// MULTISHOT (more projectiles), fire rate, raw dmg, crit, satellites. Sustain comes from
// LIFESTEAL (scales with DPS) and eHP. We snowball EXP early (more levels => more upgrades),
// then lean sustain as the boss approaches.
function scoreUpgrade(op, obs) {
  const name = op.name || "";
  const desc = op.desc || "";
  const text = name + " " + desc;
  const rarityBonus = { green: 0, blue: 3, purple: 6, orange: 10 }[op.rarity] || 0;
  const boss = obs.reward_info && obs.reward_info.boss_reached;
  const lvl = obs.player.level;
  // Adaptive sustain: once we have a healthy eHP buffer (the rollout dodge keeps us alive),
  // stop over-investing in defense and pivot to DPS (which shortens the fight / avoids timeouts).
  const ehp = (obs.player.max_hp || 3000) + (obs.player.shield_max || 0);
  const sustainFactor = Math.max(0.3, Math.min(1, 1 - (ehp - 3000) / 11000));
  let s = 0;

  // MULTISHOT / extra projectiles — the dominant DPS multiplier (e.g. "弹道变为3发" ~= 3x).
  if (/split|分裂|多重|散射|追加弹|弹道|连发|[2-9]\s*发|双发|三发|四发|five|triple|double/i.test(text)) s += 90;
  if (/side|侧翼|侧向|两侧|环形|全向/i.test(text)) s += 70; // side streams / radial
  // Fire rate
  if (/射速|攻速|fire.?rate|冷却|攻击间隔|连射|急速/i.test(text)) s += 60;
  // Satellites / drones (extra autonomous DPS + soak)
  if (/卫星|环绕|僚机|satellite|drone|orbit|轨道/i.test(text)) s += 55;
  // Raw damage
  if (/伤害|damage|弹芯|attack|攻击力|威力/i.test(text)) s += 52;
  // Lifesteal — sustain that scales with our high DPS (out-heal the boss bullets)
  if (/吸血|lifesteal|life.?steal|汲取/i.test(text)) s += 56;
  // Crit
  if (/暴击|crit|会心/i.test(text)) s += 40;
  // Pierce
  if (/穿透|pierce/i.test(text)) s += 42;
  // Anti-boss damage (win faster: less time exposed to fire)
  if (/屠龙|王座|首领|领主|巨兽|boss/i.test(text)) s += 50;
  // AoE / explosion
  if (/爆炸|脉冲|explos|pulse|aoe|范围|波/i.test(text)) s += 32;
  // Bullet size (bigger hit area => easier aim / sometimes multi-hit)
  if (/口径|尺寸|size|变大|巨大/i.test(text)) s += 24;
  // eHP / SUSTAIN — scaled by sustainFactor: high when we lack a buffer (survive the gauntlet),
  // low once we have plenty of eHP (then DPS wins the fight faster, avoiding timeouts).
  if (/最大生命|max.?hp|生命上限|生命值|血量|生命\+|hp\b/i.test(text)) s += 38 * sustainFactor;
  if (/护盾|shield/i.test(text)) s += 44 * sustainFactor;
  if (/再生|自动修复|回复|血库|regen|nano|过量|超量/i.test(text)) s += 44 * sustainFactor;
  if (/防御|减伤|护甲|armor|resist|韧性|格挡/i.test(text)) s += 38 * sustainFactor;
  if (/无敌|invincib|免疫/i.test(text)) s += 34 * sustainFactor;
  // EXP multiplier — snowball levels, but only valuable BEFORE the boss (boss gives little exp)
  if (/经验|exp|学习|学者/i.test(text)) s += boss ? 4 : (lvl < 6 ? 64 : 40);
  // Magnet — helps collect exp; useful before boss
  if (/磁|magnet|拾取|吸取|范围/i.test(text) && /磁|magnet|拾取|吸取/i.test(text)) s += boss ? 4 : 22;
  // Misc
  if (/精英|elite/i.test(text)) s += 14;
  if (/移动|移速|speed|闪避|dodge/i.test(text)) s += 16;
  if (/掉落|drop|战利品/i.test(text)) s += 8;
  if (/金币|coin|经济|赏金/i.test(text)) s += 2;

  // Healing burst: value scales with how hurt we are right now (avoid wasting at full HP)
  const hpFrac = obs.player.hp / Math.max(1, obs.player.max_hp);
  if (/回满|治疗|修复|heal|回复|回血|急救/i.test(text)) {
    s += hpFrac < 0.4 ? 80 : (hpFrac < 0.7 ? 45 : (hpFrac < 0.95 ? 20 : 3));
  }

  return s + rarityBonus;
}

function chooseUpgrade(obs) {
  const opts = obs.pending_upgrade.options;
  let bestIdx = opts[0].index, bestScore = -Infinity;
  for (const op of opts) {
    const sc = scoreUpgrade(op, obs);
    if (sc > bestScore) { bestScore = sc; bestIdx = op.index; }
  }
  return bestIdx;
}

// ---------- main movement ----------
function decideMove(obs) {
  const px = obs.player.pos[0], py = obs.player.pos[1];
  const phw = obs.player.size[0] / 2, phh = obs.player.size[1] / 2;
  const cap = SPEED;

  // Build a unified threat list (precomputed once). Enemy bodies are far more dangerous
  // (lethal contact) than bullets, so higher weight + larger clearance margin.
  const threats = [];   // all threats (enemies + bullets) — for immediate & trap checks
  const bulletsT = [];  // bullets only — for medium-horizon openness (enemies we kill, so we
                        // must be allowed to sit under them; only bullets drive area-avoidance)
  const items = [];
  for (const o of obs.objects) {
    if (o.type === "enemy" || o.type === "enemy_elite") {
      const [hw, hh] = half(o);
      threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel ? o.vel[0] : 0, vy: o.vel ? o.vel[1] : 0, hw, hh, w: 130, margin: 16 });
    } else if (o.type === "boss" && !o.in_cutscene) {
      const [hw, hh] = half(o);
      threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel ? o.vel[0] : 0, vy: o.vel ? o.vel[1] : 0, hw, hh, w: 130, margin: 14 });
    } else if (o.type === "enemy_bullet") {
      const [hw, hh] = half(o);
      const tt = { x: o.pos[0], y: o.pos[1], vx: o.vel ? o.vel[0] : 0, vy: o.vel ? o.vel[1] : 0, hw, hh, w: 75, margin: 9 };
      threats.push(tt); bulletsT.push(tt);
    } else if (o.type === "item") {
      items.push(o);
    }
  }

  const target = pickTarget(obs);
  const aimX = target ? target.pos[0] : px;
  // We hit a target anywhere within ~half its width of its x. Boss is 120 wide (half 60),
  // so we have a WIDE alignment window and need NOT hug its exact x (which drags us into walls).
  const aimTol = target ? Math.max(8, target.size[0] / 2 - 4) : 10;
  const bossPresent = !!(target && target.type === "boss");
  const bandY = 545; // stay low for max reaction time to descending bullets

  // EXP collection (snowball fuel: ~half of exp is otherwise lost off the bottom). Pick the
  // single best item to drift toward, weighted by value, pickup urgency (low y = about to
  // despawn), and closeness. The pull (itemW) is weak and always subordinate to the safety/
  // danger terms below, so it never overrides dodging.
  let itemX = null, itemY = null, bestItemScore = -Infinity;
  for (const o of items) {
    const ix = o.pos[0], iy = o.pos[1];
    const d = Math.hypot(ix - px, iy - py);
    let val = o.exp_value || 1;
    const it = o.item_type || "";
    if (it === "heart" || it === "invincible" || it === "levelup") val = Math.max(val, 40);
    if (it === "magnet" || it === "bomb" || it === "coin") val = Math.max(val, 6);
    const urgency = Math.max(0, iy - 460) * 0.05; // low items about to be lost
    const sc = val * 1.0 + urgency - d * 0.06;
    if (sc > bestItemScore) { bestItemScore = sc; itemX = ix; itemY = iy; }
  }
  // Collecting exp aggressively (even during the boss) powers the snowball (lvl->DPS->survive).
  const itemW = 0.10;

  // candidate first-moves: hold + directions x magnitudes
  const cands = [[0, 0]];
  const mags = [cap, cap * 0.7, cap * 0.4];
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    for (const mg of mags) cands.push([Math.cos(ang) * mg, Math.sin(ang) * mg]);
  }

  const clampX = (v) => Math.max(phw + 2, Math.min(FIELD_W - phw - 2, v));
  const clampY = (v) => Math.max(phh + 2, Math.min(FIELD_H - phh - 2, v));
  const cx = FIELD_W / 2;

  // "Safe right now" = no bullet near our current position. When safe we can aim HARD at the boss
  // (maximize DPS in calm windows -> faster wins) at no survival cost (when bullets are near, the
  // danger term dominates and we dodge regardless).
  let nearestNow = 1e9;
  for (let b = 0; b < bulletsT.length; b++) {
    const o = bulletsT[b];
    const bd = Math.abs(o.x - px) + Math.abs(o.y - py);
    if (bd < nearestNow) nearestNow = bd;
  }
  const aimW = bossPresent ? (nearestNow > 150 ? 0.30 : 0.11) : 0.13;

  // Pass 1: score every candidate on immediate danger + openness + positioning (cheap).
  const scored = [];
  for (let i = 0; i < cands.length; i++) {
    const mdx = cands[i][0], mdy = cands[i][1];
    const nx = clampX(px + mdx), ny = clampY(py + mdy);

    // IMMEDIATE danger (all threats, next few ticks) — the core hard-safety term.
    const dImm = dangerAt(nx, ny, phw, phh, threats, 1, 8);

    // OPENNESS: distance to nearest bullet — prefer gaps / open space (avoid being surrounded).
    let nearB = 1e9;
    for (let b = 0; b < bulletsT.length; b++) {
      const o = bulletsT[b];
      const bd = Math.abs(o.x - nx) + Math.abs(o.y - ny);
      if (bd < nearB) nearB = bd;
    }

    let score = -dImm;
    if (nearB < 130) score -= (130 - nearB) * 0.06;

    // AIM: stay within the target's hit window. Boss-aim raised (rollout handles survival now)
    // to keep us under the boss more -> higher sustained boss DPS -> faster wins / fewer timeouts.
    const dxAim = Math.abs(nx - aimX);
    if (dxAim > aimTol) score -= (dxAim - aimTol) * aimW;

    // POSITIONING: stay central with escape room; corners/walls are death traps.
    score -= Math.abs(nx - cx) * 0.05;
    const mL = Math.max(0, 66 - nx), mR = Math.max(0, nx - (FIELD_W - 66));
    score -= (mL * mL + mR * mR) * 0.04;
    score -= Math.abs(ny - bandY) * 0.06;
    if (ny > 558) { const b = ny - 558; score -= b * b * 0.035; }
    if (ny < 360) score -= (360 - ny) * 0.13;
    if (itemX != null) score -= (Math.abs(nx - itemX) + Math.abs(ny - itemY) * 0.7) * itemW;
    score -= Math.hypot(mdx, mdy) * 0.01;

    scored.push({ i, nx, ny, score });
  }

  // Pass 2: ROLLOUT trap detection on the top candidates. Simulate committed wall-aware
  // fleeing from each; heavily penalize first-moves that lead to a trap (death within K steps),
  // scaled by how soon. This catches cornering several frames before it's unavoidable.
  scored.sort((a, b) => b.score - a.score);
  const TOP = Math.min(10, scored.length);
  const K = 16;
  let bestMove = cands[scored[0].i], bestScore = -Infinity;
  for (let s = 0; s < TOP; s++) {
    const c = scored[s];
    const surv = rolloutSurvival(c.nx, c.ny, phw, phh, threats, K, cap, clampX, clampY);
    // penalty grows the sooner the rollout dies; surviving all K => no penalty
    const finalScore = c.score - (K - surv) * (K - surv) * 0.9;
    if (finalScore > bestScore) { bestScore = finalScore; bestMove = cands[c.i]; }
  }

  return clampMag(bestMove[0], bestMove[1], cap);
}

module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    try {
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        const upgrade_choice = chooseUpgrade(obs);
        return { action: { move: [0, 0], upgrade_choice }, mem };
      }
      const move = decideMove(obs);
      return { action: { move, upgrade_choice: null }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
