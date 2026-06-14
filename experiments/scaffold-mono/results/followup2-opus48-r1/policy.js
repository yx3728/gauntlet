"use strict";
/**
 * policy.js — Roguelike Skies
 *
 * Model (observed):
 *  - Player auto-fires straight UP from its x: 1000 dmg/shot, ~25-frame base interval.
 *    To hit an enemy you must align x with it. Grunts move straight down.
 *  - COLLISION with an enemy is lethal (1000-3000; a "swift" one-shots full HP). Avoid all contact.
 *  - Enemy bullets 300/450 dmg, speed ~4-5 (slow vs player speed 40).
 *  - Items fall down and drift to the bottom; magnet range collects them. exp_small=1, exp_medium=3.
 *  - Boss "crimson": 19.5M HP, sits at top y~150 sweeping side-to-side, accumulating bullet cloud.
 *  - WIN = destroy all boss HP. Snowball: survive long, kill adds → level → DPS grows → kill boss.
 *
 * Movement: lookahead candidate evaluation. Score each candidate next-position by predicted danger
 *  (swept-path collision THIS tick + closest-approach over a horizon) plus positional preference
 *  (under target x for DPS, collect exp, near bottom for reaction time, away from walls).
 */

const SPEED = 40;

// FINAL: all params hardcoded — no environment reads → a pure deterministic function of (obs, mem).
const num = (k, d) => d;
const TUNE = {
  HOME_OFF: num("HOME_OFF", 130),    // homeY = H - HOME_OFF
  FLOOR_OFF: num("FLOOR_OFF", 52),  // floorPen = H - FLOOR_OFF
  FLOOR_W: num("FLOOR_W", 4.0),
  VWUP: num("VWUP", 0.16),          // vertical pull weight when above home
  VWDN: num("VWDN", 0.30),          // vertical pull weight when below home
  BMARGIN: num("BMARGIN", 45),      // bullet/threat extra clearance margin
  BWEIGHT: num("BWEIGHT", 22),      // bullet graded weight
  WALLM: num("WALLM", 60),
  WALLW: num("WALLW", 90),
  BAND: num("BAND", 0.26),          // central band fraction
  AIMW: num("AIMW", 0.7),           // boss aim weight
  TSCALE: num("TSCALE", 0.7),       // aim scale under heavy fire
  TSN: num("TSN", 26),              // bullet count threshold for heavy fire
  ENEMY_SPD: num("ENEMY_SPD", 1.5), // enemy speed->radius factor
  ENEMY_PAD: num("ENEMY_PAD", 8),
  T: num("T", 16),
  FLOOR_START: num("FLOOR_START", 70), // quadratic floor penalty begins at H-FLOOR_START
  FLOOR_QW: num("FLOOR_QW", 200),      // quadratic floor weight
  FLOOR_SCALE: num("FLOOR_SCALE", 30), // quadratic floor scale (px)
  AGG_LEVEL: num("AGG_LEVEL", 14),     // level at which aggression is full
  AGG_MIN: num("AGG_MIN", 0.30),       // min aim multiplier (pure-survival floor)
  CTRL: "greedy",                      // movement controller (greedy lookahead — the proven best)
  BOSS_OFFSET: num("BOSS_OFFSET", 50), // stand this far off boss-center (avoid central down-stream)
  FARM_LEVEL: num("FARM_LEVEL", 13),   // below this level during boss: farm adds for exp (snowball)
  SURV_R: num("SURV_R", 120),          // x-range within which to divert toward a survival item
  K: num("K", 7),                      // rollout horizon (frames)
  BCLEAR: num("BCLEAR", 46),           // bullet clearance zone (px beyond hit radius) — quadratic penalty
  FRAG_DEF: num("FRAG_DEF", 1.4),      // defensive-upgrade multiplier when fragile
  FRAG_OFF: num("FRAG_OFF", 0.8),     // offensive-upgrade multiplier when fragile
  BSAFE: num("BSAFE", 40),             // desired bullet clearance (px)
  ESAFE: num("ESAFE", 58),             // desired enemy clearance (px)
  BW2: num("BW2", 3.0),                // bullet clearance weight
  EW2: num("EW2", 9.0),                // enemy clearance weight
  POSW: num("POSW", 1.0),              // positional cost overall weight
  OPEN_R: num("OPEN_R", 85),           // seek-open-space radius
  OPEN_W: num("OPEN_W", 0),          // seek-open-space weight
  OFFSET_MIN: num("OFFSET_MIN", 50),   // min boss offset once strong (lower = more centered DPS)
  OFFSET_DECAY: num("OFFSET_DECAY", 0),// boss offset shrinks by this per level above FARM_LEVEL
  FARM_AIMW: num("FARM_AIMW", 0.5),    // aim weight when chasing adds in FARM mode
  DIRS: num("DIRS", 16),               // candidate direction count
  TANK_EFF: num("TANK_EFF", 1.3),      // effHP frac above which to start tanking (camp boss, thread tight)
  TANK_MIN: num("TANK_MIN", 1.0),      // min bullet-clearance scale when fully tanking (1.0 = off)
  REROLL_FRAG: num("REROLL_FRAG", 28), // reroll score when fragile (fish for strong purples/oranges)
  STRONG_DEF: num("STRONG_DEF", 1.0),  // defensive-upgrade mult when strong (lower = lean offense to finish)
  STRONG_OFF: num("STRONG_OFF", 1.0),  // offensive-upgrade mult when strong
  SAT_FRAG: num("SAT_FRAG", 62),       // satellite score when fragile (passive farming → ignition)
  ESCAPE_W: num("ESCAPE_W", 0),        // trap-avoidance weight (0 = off)
  ESCAPE_MIN: num("ESCAPE_MIN", 3),    // want at least this many escape directions
};

function clampMag(vx, vy, m) {
  const mag = Math.hypot(vx, vy);
  if (mag <= m || mag === 0) return [vx, vy];
  const s = m / mag;
  return [vx * s, vy * s];
}

// ---------- upgrade selection ----------
// fragile = true when low-level (survival matters far more than DPS — the snowball is fueled by
// add-kills which the base gun already handles). Boost defensive picks heavily when fragile.
function scoreUpgrade(o, fragile) {
  const t = `${o.name || ""} ${o.desc || ""} ${o.id || ""}`;
  let s = 0;
  const has = (re) => re.test(t);
  // Fragile (early): defense lean to survive & ignite. Strong (snowballing): offense lean — these
  // seeds already survive (excess shield) but TIME OUT before killing 58.5M HP → need more DPS.
  const offMul = fragile ? TUNE.FRAG_OFF : TUNE.STRONG_OFF;
  const defMul = fragile ? TUNE.FRAG_DEF : TUNE.STRONG_DEF;
  // boss-damage upgrades directly shorten the long DPS race (the win condition) — pure win-speed.
  if (has(/屠龙|对\s*boss|boss\s*伤害|首领.*伤害/i)) s += 86 * offMul;
  // offense scaling (key to killing the boss)
  if (has(/多重|散射|分裂|侧弹|追加|双发|三发|四发|五发|弹幕|额外.*弹|多发|弹道|环射/)) s += 100 * offMul;
  if (has(/射速|攻速|攻击速度|射击速度|连射/)) s += 95 * offMul;
  if (has(/伤害|攻击力|威力|弹芯/)) s += 90 * offMul;
  if (has(/暴击/)) s += 66 * offMul;
  if (has(/穿透/)) s += 60 * offMul;
  // satellites auto-kill adds WITHOUT aiming (passive farming while we dodge) + higher tiers destroy
  // bullets — they decouple farming from positioning, ideal for surviving & snowballing the early boss.
  if (has(/卫星|僚机|无人机|环绕|护卫/)) s += fragile ? TUNE.SAT_FRAG : 80;
  if (has(/爆炸|脉冲|冲击|连锁|弹射/)) s += 58 * offMul;
  if (has(/口径|尺寸|变大|弹体|巨大/)) s += 48 * offMul;
  // survivability (critical to surviving the boss bullet hell)
  if (has(/护盾/)) s += 74 * defMul;
  if (has(/减速|时间流|缓速/)) s += 88 * defMul; // slowing bullets is huge in bullet hell
  if (has(/最大生命|生命上限|血量上限|生命值/)) s += 64 * defMul;
  if (has(/回复|恢复|再生|回血|治疗|修复/)) s += 58 * defMul;
  if (has(/减伤|免伤|护甲|格挡/)) s += 62 * defMul;
  if (has(/闪避|无敌|闪现/)) s += 54 * defMul;
  if (has(/吸血/)) s += 30 * defMul;
  // utility
  if (has(/经验/)) s += 42;
  if (has(/磁吸|拾取|吸取/)) s += 46; // exp collection accelerates the snowball
  if (has(/掉落|战利品/)) s += 22;
  // reroll guarantees the NEXT pick contains a purple/orange (often a game-changing survival upgrade:
  // bullet-destruction / slow / shield). Worth fishing for when fragile if current options are weak.
  if (has(/重掷|reroll/)) s += fragile ? TUNE.REROLL_FRAG : 28;
  if (has(/反伤|静电|荆棘/)) s += 14;
  if (has(/金币|赏金|经济/)) s += 4;
  // rarity bonus
  const rb = { green: 0, blue: 16, purple: 38, orange: 66 };
  s += rb[o.rarity] || 0;
  return s;
}

function chooseUpgrade(options, fragile) {
  let bestIdx = options[0].index, best = -Infinity;
  for (const o of options) {
    const s = scoreUpgrade(o, fragile);
    if (s > best) { best = s; bestIdx = o.index; }
  }
  return bestIdx;
}

// ---------- targeting ----------
function pickAimX(obs, px, py) {
  let boss = null;
  for (const o of obs.objects) if (o.type === "boss" && !o.in_cutscene) { boss = o; break; }
  if (boss) return { x: boss.pos[0], boss: true };
  // else: lowest enemy above us (most urgent), prefer near in x
  let best = null, bestScore = Infinity;
  for (const o of obs.objects) {
    if (o.type !== "enemy" && o.type !== "enemy_elite") continue;
    const ey = o.pos[1];
    if (ey > py - 20) continue;
    const score = Math.abs(o.pos[0] - px) - ey * 0.06;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  if (best) return { x: best.pos[0], boss: false };
  return null;
}

// nearest add (small enemy) above the player — for farming exp during the boss fight
function nearestAdd(obs, px, py) {
  let best = null, bestD = Infinity;
  for (const o of obs.objects) {
    if (o.type !== "enemy" && o.type !== "enemy_elite") continue;
    if (o.pos[1] > py - 20) continue;
    const d = Math.abs(o.pos[0] - px) + Math.max(0, py - o.pos[1]) * 0.15;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

// Item value classes. Special items are survival/snowball lifelines during the boss:
//  bomb = CLEARS ALL BULLETS, invincible = 5s immunity, levelup = instant level, heart = heal/shield.
const ITEM_BASE = { bomb: 120, invincible: 110, levelup: 95, heart: 62, exp_huge: 55, exp_large: 40, exp_medium: 28, exp_small: 20, magnet: 34, coin: 4 };
function itemBase(t) { return ITEM_BASE[t] !== undefined ? ITEM_BASE[t] : 14; }
function isSurvivalItem(t) { return t === "bomb" || t === "invincible" || t === "levelup" || t === "heart"; }

// Best item to go collect: high-value items (bombs/invincibles/levelups) are worth chasing even
// through fire (a bomb clears it; invincible negates it). Returns {item, base, surv} or null.
function pickPriorityItem(obs, px, py) {
  let best = null, bestScore = -Infinity, bestBase = 0;
  for (const o of obs.objects) {
    if (o.type !== "item") continue;
    const t = o.item_type || "";
    if (t === "coin") continue;
    const dx = o.pos[0] - px, dy = o.pos[1] - py;
    if (dy < -340) continue; // too far above to reach soon
    const base = itemBase(t);
    // reachability cost: x-distance dominates (item falls to us); far-above costs more.
    const reach = Math.abs(dx) * 0.5 + Math.max(0, -dy) * 0.35 + Math.max(0, dy) * 0.5;
    const score = base * 3 - reach;
    if (score > bestScore) { bestScore = score; best = o; bestBase = base; }
  }
  if (!best) return null;
  return { item: best, base: bestBase, surv: isSurvivalItem(best.item_type) };
}

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    try {
      const p = obs.player;
      const [px, py] = p.pos;
      const W = obs.field.w, H = obs.field.h;
      const hw = (p.size && p.size[0] ? p.size[0] : 24) / 2;
      const hh = (p.size && p.size[1] ? p.size[1] : 30) / 2;

      // Level-up panel open: choose and hold. Defense-first while fragile (low level).
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        const fragile = p.level < TUNE.FARM_LEVEL;
        return { action: { move: [0, 0], upgrade_choice: chooseUpgrade(obs.pending_upgrade.options, fragile) }, mem };
      }

      // Build threat list once. r = hit radius (collision/bullet contact).
      const threats = [];
      let nBullets = 0;
      for (const o of obs.objects) {
        if (o.type === "enemy_bullet") {
          nBullets++;
          threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: 12 + hw * 0.4, lethal: 1.0, w: 22 });
        } else if (o.type === "enemy" || o.type === "enemy_elite") {
          const spd = Math.hypot(o.vel[0], o.vel[1]);
          const er = (o.size ? Math.max(o.size[0], o.size[1]) / 2 : 14);
          // speed-scaled safety margin: fast enemies (swift) need a wider berth
          threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: er + hw + TUNE.ENEMY_PAD + spd * TUNE.ENEMY_SPD, lethal: 4.0, w: 50 });
        } else if (o.type === "boss" && !o.in_cutscene) {
          const br = (o.size ? Math.max(o.size[0], o.size[1]) / 2 : 60);
          threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: br + hw + 4, lethal: 4.0, w: 60 });
        }
      }

      const aim = pickAimX(obs, px, py);
      const bossPresent = aim && aim.boss;
      const pi = pickPriorityItem(obs, px, py);

      // Combat aim (primary).
      let desiredX = px, aimWeight = 0.5;
      if (bossPresent) {
        const sign = aim.x <= W / 2 ? 1 : -1;
        if (p.level < TUNE.FARM_LEVEL) {
          // FARM mode: too fragile to camp the boss stream — chase adds for exp (snowball fuel).
          const add = nearestAdd(obs, px, py);
          if (add) { desiredX = add.pos[0]; aimWeight = TUNE.FARM_AIMW; }
          else { desiredX = aim.x + sign * TUNE.BOSS_OFFSET; aimWeight = 0.4; }
        } else {
          // DPS mode: stand off the boss CENTER (the 64% straight-down stream) but in its ~120px
          // hitbox so shots connect. As we get stronger (higher level), center more for max DPS.
          const off = Math.max(TUNE.OFFSET_MIN, TUNE.BOSS_OFFSET - (p.level - TUNE.FARM_LEVEL) * TUNE.OFFSET_DECAY);
          desiredX = aim.x + sign * off;
          aimWeight = TUNE.AIMW;
        }
      } else if (aim) {
        desiredX = aim.x;
        aimWeight = 0.6;
      } else if (pi) {
        desiredX = pi.item.pos[0];
        aimWeight = 0.7;
      }

      // Item divert: scan for the nearest reachable SURVIVAL item (bomb clears bullets, invincible =
      // 5s immunity, levelup = instant level, heart = heal) and nearest reachable EXP item. Prefer
      // survival; else collect exp. Only diverts when item is close & about to fall to us, never
      // overriding the bullet dodge (aimEff is damped under fire).
      let survX = null, survD = Infinity, expX = null, expD = Infinity;
      for (const o of obs.objects) {
        if (o.type !== "item") continue;
        const t = o.item_type || "";
        if (t === "coin") continue;
        const dx = Math.abs(o.pos[0] - px), dyAbove = py - o.pos[1];
        if (dyAbove > 200 || dyAbove < -60) continue;
        const d = dx + Math.max(0, dyAbove) * 0.3;
        if (isSurvivalItem(t)) { if (dx < TUNE.SURV_R && d < survD) { survD = d; survX = o.pos[0]; } }
        else { if (dx < 80 && d < expD) { expD = d; expX = o.pos[0]; } }
      }
      if (survX !== null) { desiredX = survX; aimWeight = Math.max(aimWeight, 0.85); }
      else if (expX !== null) { desiredX = expX; aimWeight = Math.max(aimWeight, 0.6); }
      // Keep the aim target in a central band: the boss is 120px wide, so a central player still
      // hits it — this stops the player chasing the boss into a wall/corner (the #1 death).
      const bandL = W * TUNE.BAND, bandR = W * (1 - TUNE.BAND);
      if (desiredX < bandL) desiredX = bandL; else if (desiredX > bandR) desiredX = bandR;

      // Mild adaptive emphasis: under heavy fire, relax the aim pull a little so the dodge can find
      // gaps — but never gut it (DPS + add-kills fuel the snowball). Edge penalties stay full.
      const threatScale = nBullets > TUNE.TSN ? TUNE.TSCALE : 1.0;
      // Adaptive aggression: when low level / low HP, prioritize survival over camping under the boss
      // (the dense bullet stream). Ramps up with level and HP so DPS kicks in once we can tank.
      // Effective HP (hp + shield) drives aggression: a shielded player can tank the stream and DPS/farm.
      const effFrac = p.max_hp > 0 ? Math.min(2.0, (p.hp + (p.shield_hp || 0)) / p.max_hp) : 1;
      const aggression = Math.min(1, p.level / TUNE.AGG_LEVEL) * (0.40 + 0.40 * effFrac);
      const aimMul = TUNE.AGG_MIN + (1 - TUNE.AGG_MIN) * aggression;
      const homeY = H - TUNE.HOME_OFF;
      const floorStart = H - TUNE.FLOOR_START;
      const floorPen = H - TUNE.FLOOR_OFF;
      const T = TUNE.T; // lookahead horizon (frames)
      // Effective aim weight: damped under heavy fire / at low level so dodging always dominates.
      const aimEff = aimWeight * threatScale * aimMul;
      // TANK MODE: a strong, well-shielded player can afford to thread bullets tightly (camp the boss
      // for max DPS uptime → faster wins). Reduce bullet clearance-seeking as effHP rises (NOT the
      // lethal-hit avoidance — direct hits are always avoided). Fragile players keep full margin.
      let bScale = 1.0;
      if (effFrac > TUNE.TANK_EFF) bScale = Math.max(TUNE.TANK_MIN, 1.0 - (effFrac - TUNE.TANK_EFF) * 0.85);
      const bMargin = TUNE.BMARGIN * bScale;
      const bWeight = TUNE.BWEIGHT * bScale;

      function dangerAt(cx, cy, mx, my) {
        let cost = 0;
        let nearBullet = Infinity; // closest predicted bullet approach — used to seek open space
        for (let i = 0; i < threats.length; i++) {
          const th = threats[i];
          // (1) immediate tick: both move (player by (mx,my), threat by (vx,vy)). Swept min distance.
          const rel0x = px - th.x, rel0y = py - th.y;
          const relvx = mx - th.vx, relvy = my - th.vy;
          const rvv = relvx * relvx + relvy * relvy;
          let ts = 0;
          if (rvv > 1e-6) { ts = -(rel0x * relvx + rel0y * relvy) / rvv; if (ts < 0) ts = 0; else if (ts > 1) ts = 1; }
          const sx = rel0x + relvx * ts, sy = rel0y + relvy * ts;
          const sweptD2 = sx * sx + sy * sy;
          const R = th.r;
          if (sweptD2 < R * R) {
            cost += th.lethal * 2000;
          }
          // (2) future: player held at (cx,cy), threat continues from its next-tick pos.
          const tx2 = th.x + th.vx, ty2 = th.y + th.vy;
          const rx = tx2 - cx, ry = ty2 - cy;
          const vv = th.vx * th.vx + th.vy * th.vy;
          let tmin = 0;
          if (vv > 1e-6) { tmin = -(rx * th.vx + ry * th.vy) / vv; if (tmin < 0) tmin = 0; else if (tmin > T) tmin = T; }
          const ax = rx + th.vx * tmin, ay = ry + th.vy * tmin;
          const d2 = ax * ax + ay * ay;
          const soon = 1 - (tmin / (T + 2)) * 0.7;
          if (d2 < R * R) {
            cost += th.lethal * 900 * soon;
          } else {
            const d = Math.sqrt(d2);
            const isBullet = th.lethal === 1.0;
            const margin = R + (isBullet ? bMargin : TUNE.BMARGIN);
            const w = isBullet ? bWeight : th.w;
            if (d < margin) cost += w * ((margin - d) / margin) * soon;
            if (th.lethal === 1.0 && d < nearBullet) nearBullet = d;
          }
        }
        // Seek OPEN SPACE: gently prefer the candidate whose nearest bullet is furthest away, so the
        // player proactively stays in gaps instead of waiting until it is boxed in (then bled out).
        if (nearBullet < TUNE.OPEN_R) cost += TUNE.OPEN_W * (TUNE.OPEN_R - nearBullet);
        return cost;
      }

      function posCost(cx, cy) {
        let c = 0;
        c += Math.abs(cx - desiredX) * aimEff;
        // vertical comfort: gentle pull toward the low band.
        const dyc = cy - homeY;
        c += (dyc >= 0 ? dyc * TUNE.VWDN : -dyc * TUNE.VWUP);
        // Strong QUADRATIC floor barrier: bullets rain down & pile up at the bottom, so being low is a
        // trap (can't out-run falling bullets downward). Keep the player up with room to dodge.
        if (cy > floorStart) { const t = (cy - floorStart) / TUNE.FLOOR_SCALE; c += t * t * TUNE.FLOOR_QW; }
        if (cy > floorPen) c += (cy - floorPen) * TUNE.FLOOR_W;
        if (cy < 150) c += (150 - cy) * 1.0;                 // don't drift up into the swarm
        // wall/corner avoidance (full strength even under fire — being trapped is fatal). Quadratic
        // so it grows fast near the edge and keeps the player proactively off the walls.
        const wallM = TUNE.WALLM;
        if (cx < wallM) { const t = (wallM - cx) / wallM; c += t * t * TUNE.WALLW; }
        if (cx > W - wallM) { const t = (cx - (W - wallM)) / wallM; c += t * t * TUNE.WALLW; }
        return c;
      }

      const minX = hw + 2, maxX = W - hw - 2, minY = hh + 2, maxY = H - hh - 2;

      // ---- ROLLOUT controller (alternative; not used by default — greedy proved better). Builds its
      // near-threat lists lazily only if selected, to avoid wasted per-frame work in the greedy path.
      const nearB = [], nearE = [];
      if (TUNE.CTRL === "rollout") {
        for (const o of obs.objects) {
          if (o.type === "enemy_bullet") {
            const d = Math.hypot(o.pos[0] - px, o.pos[1] - py);
            if (d < 260) nearB.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: 12 + hw * 0.4 });
          } else if (o.type === "enemy" || o.type === "enemy_elite") {
            const d = Math.hypot(o.pos[0] - px, o.pos[1] - py);
            if (d < 260) { const er = o.size ? Math.max(o.size[0], o.size[1]) / 2 : 14; nearE.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: er + hw + 2 }); }
          } else if (o.type === "boss" && !o.in_cutscene) {
            const br = o.size ? Math.max(o.size[0], o.size[1]) / 2 : 60;
            nearE.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], r: br + hw + 2 });
          }
        }
      }
      const K = TUNE.K;
      function rolloutCost(vx, vy) {
        let x = px, y = py, cost = 0;
        let bMin = Infinity, eMin = Infinity;
        for (let t = 1; t <= K; t++) {
          x += vx; y += vy;
          if (x < minX) x = minX; else if (x > maxX) x = maxX;
          if (y < minY) y = minY; else if (y > maxY) y = maxY;
          for (let i = 0; i < nearB.length; i++) {
            const b = nearB[i];
            const bx = b.x + b.vx * t, by = b.y + b.vy * t;
            const d = Math.hypot(x - bx, y - by) - b.r;
            if (d < bMin) bMin = d;
          }
          for (let i = 0; i < nearE.length; i++) {
            const e = nearE[i];
            const ex = e.x + e.vx * t, ey = e.y + e.vy * t;
            const d = Math.hypot(x - ex, y - ey) - e.r;
            if (d < eMin) eMin = d;
          }
        }
        if (bMin < 0) cost += 6000 - bMin * 80; else if (bMin < TUNE.BSAFE) cost += (TUNE.BSAFE - bMin) * TUNE.BW2;
        if (eMin < 0) cost += 30000 - eMin * 200; else if (eMin < TUNE.ESAFE) cost += (TUNE.ESAFE - eMin) * TUNE.EW2;
        // positional cost at the immediate next position; scaled down when threatened so survival wins.
        const nx0 = Math.max(minX, Math.min(maxX, px + vx)), ny0 = Math.max(minY, Math.min(maxY, py + vy));
        const threatened = Math.min(bMin, eMin) < TUNE.BSAFE;
        cost += posCost(nx0, ny0) * TUNE.POSW * (threatened ? 0.5 : 1.0);
        return cost;
      }

      // Candidate moves: stay + ring of directions at several magnitudes.
      let bestMove = [0, 0], bestCost = Infinity;
      const mags = TUNE.DIRS >= 24 ? [0, 8, 18, 30, 40] : [0, 12, 24, 40];
      const dirs = TUNE.DIRS;
      if (TUNE.CTRL === "rollout") {
        for (let mi = 0; mi < mags.length; mi++) {
          const mag = mags[mi];
          const steps = mag === 0 ? 1 : dirs;
          for (let di = 0; di < steps; di++) {
            const ang = (di / dirs) * Math.PI * 2;
            const vx = mag === 0 ? 0 : Math.cos(ang) * mag;
            const vy = mag === 0 ? 0 : Math.sin(ang) * mag;
            const cost = rolloutCost(vx, vy);
            if (cost < bestCost) { bestCost = cost; bestMove = [vx, vy]; }
          }
        }
        const [mxr, myr] = clampMag(bestMove[0], bestMove[1], SPEED);
        return { action: { move: [mxr, myr], upgrade_choice: null }, mem };
      }
      // Trap-avoidance: count how many escape directions remain from a candidate spot one tick later
      // (bullets advanced ~2 ticks). A spot with few escapes is a developing trap — penalize it so the
      // myopic greedy doesn't walk into corners of the bullet field. Only active when ESCAPE_W > 0.
      function escapeCount(x, y) {
        let safe = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          let nx = x + Math.cos(a) * 40, ny = y + Math.sin(a) * 40;
          if (nx < minX) nx = minX; else if (nx > maxX) nx = maxX;
          if (ny < minY) ny = minY; else if (ny > maxY) ny = maxY;
          let hit = false;
          for (let i = 0; i < threats.length; i++) {
            const th = threats[i];
            if (th.lethal !== 1.0) continue;
            const bx = th.x + th.vx * 2, by = th.y + th.vy * 2;
            const ddx = nx - bx, ddy = ny - by;
            if (ddx * ddx + ddy * ddy < (th.r + 10) * (th.r + 10)) { hit = true; break; }
          }
          if (!hit) safe++;
        }
        return safe;
      }
      const useEscape = TUNE.ESCAPE_W > 0 && nBullets > 8;
      for (let mi = 0; mi < mags.length; mi++) {
        const mag = mags[mi];
        const steps = mag === 0 ? 1 : dirs;
        for (let di = 0; di < steps; di++) {
          const ang = (di / dirs) * Math.PI * 2;
          let dx = mag === 0 ? 0 : Math.cos(ang) * mag;
          let dy = mag === 0 ? 0 : Math.sin(ang) * mag;
          let cx = px + dx, cy = py + dy;
          if (cx < minX) cx = minX; else if (cx > maxX) cx = maxX;
          if (cy < minY) cy = minY; else if (cy > maxY) cy = maxY;
          const mx = cx - px, my = cy - py;
          let cost = dangerAt(cx, cy, mx, my) + posCost(cx, cy);
          if (useEscape) { const e = escapeCount(cx, cy); if (e < TUNE.ESCAPE_MIN) cost += (TUNE.ESCAPE_MIN - e) * TUNE.ESCAPE_W; }
          if (cost < bestCost) { bestCost = cost; bestMove = [mx, my]; }
        }
      }

      const [mx, my] = clampMag(bestMove[0], bestMove[1], SPEED);
      return { action: { move: [mx, my], upgrade_choice: null }, mem };
    } catch (e) {
      return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
    }
  },
};
