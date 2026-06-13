"use strict";

/*
 * Roguelike Skies policy — vertical bullet-hell. Fire straight UP (auto). Enemies
 * descend from the top. Contact with enemy/boss bodies is ~lethal; bullets chip.
 *
 * Goal: destroy the boss (~19.5M HP, appears at fixed frame 5400, hovers top-center).
 * Enemies keep spawning during the boss fight => keep leveling. Snowball:
 *   DPS -> kills -> exp -> levels -> upgrades -> DPS.
 * PIERCE matters in the boss fight: without it, spawning mobs block our upward stream.
 *
 * Controller: candidate per-tick velocities, each ROLLED OUT a few ticks (threats
 * advanced by velocity), scored by collision risk + edge avoidance minus objective
 * (align X under boss/killable enemy, home altitude, drift to exp). Survival dominates.
 */

const SPEED = 40;

// ---------- Upgrade selection (tuned to KILL THE BOSS) ----------
const UPGRADE_PRIORITY = {
  tyrant_breaker: 100, boss_hunter: 96, mix_perfect: 94,
  pc_pierce: 90,
  exp_smart: 84, exp_basic: 72,
  fr_turbo: 86, mix_vulcan: 85, fr_cool: 80, dmg_m: 79, mix_terminal: 78,
  mix_fire: 75, fr_basic: 73, dmg_s: 69, crit_aim: 61,
  bullet_crush: 82, timeflow_shield: 77, shield_extra: 80, shield_basic: 71,
  ms_split_m: 67, ms_split_s: 63, sat_orbit: 65,
  turncoat_shield: 52, heal_quick: 64, kill_pulse: 50,
  mag_basic: 60, reroll_premium: 58, drop_basic: 41, bs_size_s: 45,
  heal_overflow: 58, kill_pulse_3: 43, kill_blood: 67, regen_basic: 64,
  thorn_blaze: 29, thorn_static: 21,
  mix_econ: 8, coin_small: 5,
};

function upgradeScore(opt, defensive) {
  let s = UPGRADE_PRIORITY[opt.id];
  if (s === undefined) {
    const txt = (opt.id || "") + (opt.name || "") + (opt.desc || "");
    s = 30;
    if (/boss|王座|屠龙|破坏者/i.test(txt)) s += 60;
    if (/穿透|pierce/i.test(txt)) s += 55;
    if (/伤害|damage|dmg/i.test(txt)) s += 45;
    if (/射速|rate|急速/i.test(txt)) s += 42;
    if (/经验|exp/i.test(txt)) s += 40;
    if (/护盾|shield|减速|时间流/i.test(txt)) s += 35;
    if (/分裂|多重|side|split|卫星|satellite/i.test(txt)) s += 32;
    if (/金币|coin|econ/i.test(txt)) s -= 15;
  }
  // When weak (the level<=8 death window) OR currently hurt, favor immediate EHP/defense
  // so we survive long enough for the DPS snowball to take over.
  if (defensive) {
    if (/^(shield_basic|shield_extra|heal_quick|mix_perfect)$/.test(opt.id)) s += 45;
    else if (/^(bullet_crush|timeflow_shield|turncoat_shield|heal_overflow|regen_basic|kill_blood|shield)/.test(opt.id)) s += 28;
  }
  const r = { green: 0, blue: 1, purple: 2, orange: 3 }[opt.rarity] || 0;
  return s * 10 + r;
}

function chooseUpgrade(obs) {
  const opts = obs.pending_upgrade && obs.pending_upgrade.options;
  if (!opts || !opts.length) return 0;
  const p = obs.player;
  const effFrac = (p.hp + (p.shield_hp || 0)) / (p.max_hp + (p.shield_max || 0) + 1);
  const defensive = p.level <= 8 || effFrac < 0.45;
  let best = opts[0].index, bestScore = -Infinity;
  for (const o of opts) {
    const sc = upgradeScore(o, defensive);
    if (sc > bestScore) { bestScore = sc; best = o.index; }
  }
  return best;
}

// ---------- Main policy ----------
module.exports = {
  init() { return {}; },

  policy(obs, mem) {
    try {
      return decide(obs, mem);
    } catch (e) {
      // Never throw — return a safe, valid action (resolve any pending upgrade with 0).
      let uc = 0;
      try {
        const o = obs && obs.pending_upgrade && obs.pending_upgrade.options;
        if (o && o.length) uc = o[0].index;
      } catch (_) {}
      return { action: { move: [0, 0], upgrade_choice: uc }, mem: mem || {} };
    }
  },
};

function decide(obs, mem) {
    if (!mem) mem = {};
    const upgrade_choice = chooseUpgrade(obs);

    const player = obs.player;
    const px = player.pos[0], py = player.pos[1];
    const fw = obs.field.w, fh = obs.field.h;
    const phw = player.size[0] / 2;
    const phh = player.size[1] / 2;
    const pr = Math.max(phw, phh);

    // Partition objects
    const threats = [];
    const items = [];
    let boss = null;
    for (let i = 0; i < obs.objects.length; i++) {
      const o = obs.objects[i];
      const t = o.type;
      if (t === "enemy_bullet") {
        const half = o.size ? Math.max(o.size[0], o.size[1]) / 2 : 6;
        const hitR = pr + half + 4;
        threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], hitR, softR: hitR + 26, lethal: 0 });
      } else if (t === "enemy" || t === "enemy_elite") {
        const half = o.size ? Math.max(o.size[0], o.size[1]) / 2 : 18;
        const isElite = t === "enemy_elite";
        const big = isElite ? 2.1 : 1;
        const hitR = pr + half + (isElite ? 14 : 10);
        threats.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1], hitR, softR: hitR + (isElite ? 58 : 40), lethal: big });
      } else if (t === "boss") {
        // Always avoid the boss BODY (contact is ~lethal), even mid-cutscene; only treat
        // it as a DPS/align target when it's actually targetable (not in cutscene).
        const half = Math.max(o.size ? o.size[0] : 60, o.size ? o.size[1] : 60) / 2;
        const hitR = pr + half + 12;
        threats.push({ x: o.pos[0], y: o.pos[1], vx: (o.vel ? o.vel[0] : 0), vy: (o.vel ? o.vel[1] : 0), hitR, softR: hitR + 30, lethal: 1.5 });
        if (!o.in_cutscene) boss = o;
      } else if (t === "item") {
        items.push(o);
      }
    }

    // ----- objective target: X to align under (boss > nearest killable enemy) -----
    // When the boss DIVES low it would crush us against the bottom; in that case
    // dodge its column sideways (stay low). When it rests high, align under it (DPS).
    let targetX = null;
    let avoidColumn = false, bossX = 0;
    if (boss) {
      targetX = boss.pos[0];
      bossX = boss.pos[0];
      if (boss.pos[1] > 190) avoidColumn = true;
    } else {
      let best = null, bestScore = Infinity;
      for (let i = 0; i < obs.objects.length; i++) {
        const e = obs.objects[i];
        if (e.type !== "enemy" && e.type !== "enemy_elite") continue;
        const ey = e.pos[1];
        if (ey > py - 6) continue;
        const dx = Math.abs(e.pos[0] - px);
        const dy = py - ey;
        let sc = dx + dy * 0.25 + (e.type === "enemy_elite" ? 30 : 0);
        if (sc < bestScore) { bestScore = sc; best = e; }
      }
      if (best) targetX = best.pos[0];
    }

    // Special pickups are survival/power lifesavers — path to them strongly:
    //   bomb = clears ~59 bullets (screen clear), invincible = +5s invuln,
    //   heart = heal, levelup = free level. Pursue the best reachable one.
    let special = null, specialScore = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const ty = it.item_type || "";
      if (!/bomb|invincible|heart|levelup/.test(ty)) continue;
      if (it.pos[1] < 200) continue; // don't dive up into the danger zone for it
      const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
      if (d > 340) continue;
      const v = /bomb|invincible/.test(ty) ? 320 : /levelup/.test(ty) ? 240 : 150; // heart 150
      const sc = d - v;
      if (sc < specialScore) { specialScore = sc; special = it; }
    }

    // best exp item to drift toward (mild attraction to closest valuable pickup)
    let item = null, itemScore = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.pos[1] < py - 70) continue; // don't get baited upward for small exp
      const d = Math.hypot(it.pos[0] - px, it.pos[1] - py);
      if (d > 230) continue;
      const val = it.exp_value || 1;
      let sc = d - val * 8;
      if (sc < itemScore) { itemScore = sc; item = it; }
    }

    // While invincible (from a pickup) we cannot be hit — ignore danger and play
    // aggressively: grab everything, sit under the boss for DPS.
    const invSafe = (player.invincible_ms || 0) > 200;

    // Early in the boss fight our DPS is tiny (~0.015%/s), so sitting under the boss
    // for negligible damage is a bad trade vs survival. Ramp boss-align with level:
    // low level => prioritize dodging/leveling; high level => align for real DPS.
    const bossAlignW = 0.7 * Math.min(1, Math.max(0.28, (player.level - 5) / 9));

    // ----- rollout-based candidate evaluation -----
    const T = 7;
    const idealY = fh - 130;

    function evalCandidate(vx, vy) {
      let hard = 0, soft = 0;
      if (!invSafe)
      for (let t = 1; t <= T; t++) {
        let qx = px + vx * t, qy = py + vy * t;
        if (qx < phw) qx = phw; else if (qx > fw - phw) qx = fw - phw;
        if (qy < phh) qy = phh; else if (qy > fh - phh) qy = fh - phh;
        const decay = 1 - (t - 1) / (T + 2);
        for (let i = 0; i < threats.length; i++) {
          const th = threats[i];
          const ox = th.x + th.vx * t, oy = th.y + th.vy * t;
          const dx = ox - qx, dy = oy - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 > th.softR * th.softR) continue;
          const d = Math.sqrt(d2);
          if (d < th.hitR) {
            hard += (th.lethal > 0 ? 1000 * th.lethal : 220) * decay;
          } else {
            const frac = (th.softR - d) / (th.softR - th.hitR);
            soft += (th.lethal > 0 ? 130 * th.lethal : 20) * frac * decay;
          }
        }
      }
      let qx = px + vx, qy = py + vy;
      if (qx < phw) qx = phw; else if (qx > fw - phw) qx = fw - phw;
      if (qy < phh) qy = phh; else if (qy > fh - phh) qy = fh - phh;
      // edges/corners — keep-out so we dodge sideways and never get pinned
      let edge = 0;
      const m = 52;
      if (qx < m) edge += (m - qx) * 1.8;
      if (qx > fw - m) edge += (qx - (fw - m)) * 1.8;
      const mb = 64;
      if (qy > fh - mb) edge += (qy - (fh - mb)) * 2.3; // bottom near-wall
      // CEILING: never flee up past mid-screen. The boss dives deep then retreats;
      // escaping upward PAST it lands us in the lethal top/spawn zone (a common death).
      const yCeil = fh * 0.46;
      if (qy < yCeil) edge += (yCeil - qy) * 2.0;
      // objective
      let obj = 0;
      if (avoidColumn) {
        // boss diving: penalize being in its column; prefer to be off to the side
        const colDist = Math.abs(qx - bossX);
        if (colDist < 150) obj -= (colDist - 150) * 0.7; // closer to column = worse
      } else if (targetX !== null) {
        // boss target: level-scaled weight; mob target: full weight (for exp/leveling)
        obj -= Math.abs(targetX - qx) * (boss ? bossAlignW : 0.7);
      }
      const dyH = qy - idealY;
      obj -= (dyH > 0 ? dyH * 0.22 : -dyH * 0.10);
      if (special) obj -= Math.hypot(special.pos[0] - qx, special.pos[1] - qy) * 0.6;
      else if (item) obj -= Math.hypot(item.pos[0] - qx, item.pos[1] - qy) * 0.16;

      return hard + soft + edge - obj;
    }

    let bestVx = 0, bestVy = 0, bestVal = evalCandidate(0, 0);
    const N = 32;
    const mags = [SPEED, SPEED * 0.66, SPEED * 0.33];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      for (let m = 0; m < mags.length; m++) {
        const vx = cx * mags[m], vy = cy * mags[m];
        const val = evalCandidate(vx, vy);
        if (val < bestVal) { bestVal = val; bestVx = vx; bestVy = vy; }
      }
    }

    let mx = bestVx, my = bestVy;
    const mag = Math.hypot(mx, my);
    if (mag > SPEED) { mx = mx / mag * SPEED; my = my / mag * SPEED; }

    return { action: { move: [mx, my], upgrade_choice }, mem };
}
