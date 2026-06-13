/**
 * policy.js — Roguelike Skies bullet-hell policy.
 *
 * Core findings that drive this design:
 *  - Enemy BODY contact is lethal (damage ≈ enemy HP; elites ≈ instant death). Never touch one.
 *  - Enemy bullets: 300 dmg (waves) / 450 dmg (boss), slow (~4-5 px/tick). Player ~3000 HP.
 *  - Player auto-fires straight UP. Horizontal alignment with enemies is everything.
 *  - The win requires destroying ~19.4M boss HP, which needs massive damage scaling →
 *    you must LEVEL UP a lot, which needs lots of KILLS (exp). So: kill aggressively when
 *    safe, dodge hard when threatened, and pick upgrades that snowball damage & kill-rate.
 *
 * Movement: a receding-horizon sampling planner. For each candidate per-tick move, simulate
 * bullets/enemies forward (constant velocity) and score SAFETY (dominant). Offense (align
 * firing column with the densest enemy cluster / boss) and item collection only decide
 * among candidates that are safe — a clean two-mode behaviour (aim when safe, dodge when not).
 *
 * Must never throw; always returns a valid action.
 */
"use strict";

const ASSUMED_SPEED = 40;     // eval speed_cap (px/tick); our requested moves are clamped to this
const LOOKAHEAD = 24;         // ticks to simulate each candidate move forward
const NEAR_T = 8;             // ticks over which near-term clearance is measured
const THREAT_RADIUS = 260;    // only consider threats within this distance

// Candidate per-tick moves: 32 directions × 3 magnitudes (full / 0.6 / 0.3), plus hold.
function buildCandidates() {
  const cands = [[0, 0]];
  const N = 32;
  const mags = [ASSUMED_SPEED, ASSUMED_SPEED * 0.6, ASSUMED_SPEED * 0.3];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    for (const m of mags) cands.push([cx * m, cy * m]);
  }
  return cands;
}
const CANDIDATES = buildCandidates();

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Collection priority by pickup type (exp orbs handled by exp_value).
function itemWeight(it) {
  switch (it.item_type) {
    case "levelup": return 12;     // free level — accelerates DPS ramp
    case "invincible": return 9;   // temporary invulnerability
    case "heart": return 7;        // heal
    case "bomb": return 6;
    case "magnet": return 5;
    case "coin": return 2;
    default: return it.exp_value > 0 ? 1.4 + it.exp_value * 0.5 : 1.2;
  }
}

module.exports = {
  init() { return { tick: 0, picked: {} }; },

  policy(obs, mem) {
    if (!mem || typeof mem !== "object") mem = { tick: 0, picked: {} };
    if (!mem.picked) mem.picked = {};
    mem.tick = (mem.tick || 0) + 1;

    let upgrade_choice = null;
    try {
      if (obs.pending_upgrade && obs.pending_upgrade.options && obs.pending_upgrade.options.length) {
        const best = chooseUpgrade(obs.pending_upgrade.options, obs, mem);
        const chosen = obs.pending_upgrade.options[best];
        // The contract wants the option's `index` field; use it if present, else the array slot.
        upgrade_choice = chosen && chosen.index != null ? chosen.index : best;
        if (chosen) mem.picked[chosen.id] = (mem.picked[chosen.id] || 0) + 1;
      }
    } catch (e) { upgrade_choice = 0; }

    let move = [0, 0];
    try { move = planMove(obs, mem); } catch (e) { move = [0, 0]; }

    return { action: { move, upgrade_choice }, mem };
  },
};

// ---------- movement planner ----------
function planMove(obs, mem) {
  const p = obs.player;
  const px = p.pos[0], py = p.pos[1];
  const phw = p.size[0] / 2, phh = p.size[1] / 2;
  const W = obs.field.w, H = obs.field.h;
  // Endgame FACETANK gate: once strong (lifesteal + fast fire + healthy), our healing-per-hit
  // outpaces incoming boss fire, so we can hold position on the boss for ~2x uptime → finish
  // faster. Gated on strength, so it is inert during the dangerous early game.
  const picked = (mem && mem.picked) || {};
  const strongLifesteal = picked.kill_butcher || ((picked.kill_blood || 0) >= 2);
  const hpEff = (p.hp + (p.shield_hp || 0)) / Math.max(1, p.max_hp);
  // Facetank only when truly overwhelming (strong lifesteal out-heals incoming fire, very fast
  // fire, near-full HP): hold on the boss to finish faster (earlier win = higher eval score).
  // Strict gate + gentle pull ⇒ never sacrifices a win, only speeds up a dominant one.
  const facetank = strongLifesteal && p.shoot_interval_ms <= 110 && hpEff >= 0.8;
  // AABB collision pads: player half-extents plus a safety margin per threat kind.
  // The boss body is huge and contact is an instant kill, so give it a wider berth.
  const BODY_MARGIN = 7, BULLET_MARGIN = 3, BOSS_MARGIN = 20;

  const bullets = [];
  const bodies = [];
  const enemies = [];
  const items = [];
  let boss = null;
  for (const o of obs.objects) {
    const t = o.type;
    if (t === "enemy_bullet") {
      const dx = o.pos[0] - px, dy = o.pos[1] - py;
      if (dx * dx + dy * dy <= THREAT_RADIUS * THREAT_RADIUS) {
        bullets.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
                       hw: o.size[0] / 2 + phw + BULLET_MARGIN, hh: o.size[1] / 2 + phh + BULLET_MARGIN });
      }
    } else if (t === "enemy" || t === "enemy_elite") {
      enemies.push(o);
      const dx = o.pos[0] - px, dy = o.pos[1] - py;
      if (dx * dx + dy * dy <= THREAT_RADIUS * THREAT_RADIUS) {
        bodies.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
                      hw: o.size[0] / 2 + phw + BODY_MARGIN, hh: o.size[1] / 2 + phh + BODY_MARGIN });
      }
    } else if (t === "boss") {
      boss = o;
      if (!o.in_cutscene) bodies.push({ x: o.pos[0], y: o.pos[1], vx: o.vel[0], vy: o.vel[1],
                      hw: o.size[0] / 2 + phw + BOSS_MARGIN, hh: o.size[1] / 2 + phh + BOSS_MARGIN });
    } else if (t === "item") {
      items.push(o);
    }
  }

  // Densest enemy (add) column — for leveling.
  let clusterX = px, clusterW = 0;
  if (enemies.length) {
    let bestW = -1, bestX = px;
    for (let i = 0; i < enemies.length; i++) {
      const ei = enemies[i];
      const tolI = ei.size[0] / 2 + 8;
      let w = 0;
      for (let j = 0; j < enemies.length; j++) {
        const ej = enemies[j];
        if (Math.abs(ej.pos[0] - ei.pos[0]) < tolI) {
          let ew = ej.type === "enemy_elite" ? 3 : 1;
          ew *= 1 + Math.max(0, ej.pos[1]) / H; // lower (closer) => more weight
          w += ew;
        }
      }
      if (w > bestW) { bestW = w; bestX = ei.pos[0]; }
    }
    clusterX = bestX; clusterW = bestW;
  }

  // Aim target X: the boss when present (shots hit anywhere within ~its half-width — flat-topped —
  // so we can weave while damaging it), else the densest add column.
  const bossActive = boss && !boss.in_cutscene;
  const bossY = bossActive ? boss.pos[1] : -999;
  let aimX = px, haveAim = false, aimReach = 0;
  if (bossActive) {
    aimX = boss.pos[0]; haveAim = true; aimReach = boss.size[0] / 2 + 30;
  } else if (enemies.length) {
    aimX = clusterX; haveAim = true; aimReach = 0;
  }

  let bestScore = -Infinity, bestMove = [0, 0];

  for (let c = 0; c < CANDIDATES.length; c++) {
    let vx = CANDIDATES[c][0], vy = CANDIDATES[c][1];
    const mag = Math.hypot(vx, vy);
    if (mag > ASSUMED_SPEED) { vx = vx / mag * ASSUMED_SPEED; vy = vy / mag * ASSUMED_SPEED; }

    let sx = px, sy = py;
    let firstBulletHit = Infinity, firstBodyHit = Infinity;
    let minNearClear = Infinity; // min AABB clearance over the first NEAR_T ticks
    for (let t = 1; t <= LOOKAHEAD; t++) {
      sx = clamp(sx + vx, phw, W - phw);
      sy = clamp(sy + vy, phh, H - phh);
      const near = t <= NEAR_T;
      // AABB clearance: separation on the looser axis. <0 on BOTH axes ⇒ overlap (hit).
      for (let k = 0; k < bullets.length; k++) {
        const b = bullets[k];
        const sepX = Math.abs(sx - (b.x + b.vx * t)) - b.hw;
        const sepY = Math.abs(sy - (b.y + b.vy * t)) - b.hh;
        const cl = sepX > sepY ? sepX : sepY;
        if (cl < 0 && t < firstBulletHit) firstBulletHit = t;
        if (near && cl < minNearClear) minNearClear = cl;
      }
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        const sepX = Math.abs(sx - (b.x + b.vx * t)) - b.hw;
        const sepY = Math.abs(sy - (b.y + b.vy * t)) - b.hh;
        const cl = sepX > sepY ? sepX : sepY;
        if (cl < 0 && t < firstBodyHit) firstBodyHit = t;
        if (near && cl < minNearClear) minNearClear = cl;
      }
    }

    const fx = sx, fy = sy;

    // ---- SAFETY (dominant) ----
    // Decaying hit penalties: a collision NOW is catastrophic; one many ticks out barely
    // matters (we re-plan every tick). This is what prevents corner-trapping & surprise hits.
    let safety = 0;
    if (firstBodyHit !== Infinity) safety -= 40000 * (1 - (firstBodyHit - 1) / LOOKAHEAD);
    if (firstBulletHit !== Infinity) safety -= 12000 * (1 - (firstBulletHit - 1) / LOOKAHEAD);
    safety += clamp(minNearClear, -25, 14) * 6;     // keep a near-term buffer
    // strategic positioning (always-on, small vs collision terms so it only biases, never
    // overrides dodging): stay central with escape room, in a lower-middle band.
    safety -= Math.abs(fx - W / 2) * 0.06;
    safety -= Math.abs(fy - H * 0.72) * 0.04;
    // stay BELOW the boss / out of the top region — bullets rain from above and fleeing UP into
    // the boss body is an instant kill. Keep a comfortable gap under the boss.
    if (fy < H * 0.45) safety -= (H * 0.45 - fy) * 0.5;
    if (bossY > -1 && fy < bossY + 95) safety -= (bossY + 95 - fy) * 0.7;
    // facetank: when truly overwhelming (strong lifesteal out-heals incoming fire), hold
    // horizontally on the boss to maximize uptime → finish faster.
    if (facetank && bossY > -1) {
      const off = Math.abs(fx - aimX) - aimReach * 0.5;
      if (off > 0) safety -= off * 0.28;
    }
    // wall avoidance
    const EDGE = 60;
    const dl = fx, dr = W - fx, dtop = fy, db = H - fy;
    if (dl < EDGE) safety -= (EDGE - dl) * (EDGE - dl) * 0.03;
    if (dr < EDGE) safety -= (EDGE - dr) * (EDGE - dr) * 0.03;
    if (dtop < EDGE) safety -= (EDGE - dtop) * (EDGE - dtop) * 0.018;
    if (db < EDGE) safety -= (EDGE - db) * (EDGE - db) * 0.03;

    // ---- OFFENSE + COLLECT (subordinate to safety; never trade away a real dodge) ----
    const noHit = firstBodyHit === Infinity && firstBulletHit === Infinity;
    const aimable = noHit && minNearClear > 9;       // solid buffer ⇒ aggressively aim
    let extra = 0;
    if (aimable && haveAim) {
      const adx = Math.max(0, Math.abs(fx - aimX) - aimReach); // flat-topped within aimReach
      extra += clamp(120 - adx, -100, 120) * 1.0;
      for (let e = 0; e < enemies.length; e++) {
        const en = enemies[e];
        if (en.pos[1] >= fy) continue;
        const tol = en.size[0] / 2 + 5;
        const adx2 = Math.abs(en.pos[0] - fx);
        if (adx2 < tol) extra += (en.type === "enemy_elite" ? 6 : 3) * (1 - adx2 / tol);
      }
    }
    // Collect pickups whenever not about to be hit (broader than aimable) — leveling is the win
    // bottleneck and exp orbs falling past us are the main waste. Bigger cap when fully safe.
    if (noHit) {
      let collect = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const dx = it.pos[0] - fx, dy = it.pos[1] - fy;
        const dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 210) collect += (1 - dd / 210) * itemWeight(it);
      }
      extra += clamp(collect, 0, aimable ? 55 : 24);
    }

    const score = safety + extra;
    if (score > bestScore) { bestScore = score; bestMove = [vx, vy]; }
  }

  return bestMove;
}

// ---------- upgrade selection ----------
// Winning fast = ramp DPS fast while surviving. Two engines:
//  (1) LEVEL FAST early: exp multipliers, full-screen magnet (auto-collect all exp), LV+ drops.
//  (2) DPS: fire-rate (floors ~30ms ⇒ ~14x), multishot (3/5/9 + side), satellites, damage, crit,
//      boss-damage. Plus dual-purpose defense (timeflow slows bullets; satellites clear bullets).
// Scores are keyed on the known upgrade pool; a regex fallback handles anything unseen.
//
// id -> base score, or a function(level) -> score for level-scaled picks.
const UPG = {
  // --- leveling engine (front-loaded; decays as we level) ---
  exp_smart:      (lv) => lv < 20 ? 95 : 40,   // +200% exp
  exp_basic:      (lv) => lv < 18 ? 78 : 32,    // +100% exp
  exp_quantum:    (lv) => lv < 22 ? 84 : 50,    // 5% LV+ drop on kill — free levels
  mag_hole:       (lv) => lv < 24 ? 80 : 45,    // full-screen magnet — auto-collect all exp
  mag_well:       (lv) => lv < 18 ? 56 : 24,    // +300% pickup
  mag_basic:      (lv) => lv < 16 ? 46 : 18,    // +175% pickup
  drop_basic:     (lv) => lv < 18 ? 40 : 18,    // elites always drop
  reroll_premium: 36,                            // next pick guaranteed purple/orange

  // --- multishot / coverage (top DPS) ---
  ms_split_l: 96,   // 9 bullets
  ms_split_m: 78,   // 5 bullets
  ms_split_s: 60,   // 3 bullets
  bullet_void: 82,  // +6 bullets, crit fixed 95% (dmg/firerate -30%) — big net coverage+crit
  // satellites: position-independent DPS (bypasses the boss-uptime problem) + sat_orbit_2 also
  // destroys enemy bullets (defense). Dual-purpose ⇒ prioritise.
  sat_orbit_2: 92,
  sat_orbit: 76,

  // --- fire rate ---
  fr_turbo: 88,  // +128%
  fr_cool: 74,   // +64%
  fr_basic: 58,  // +32%

  // --- damage / crit / boss ---
  dmg_l: 70, dmg_m: 50, dmg_s: 38,
  mix_vulcan: 76, mix_terminal: 66, mix_fire: 56,  // combined dmg+firerate / dmg+crit
  boss_hunter: 64, elite_hunter: 34,
  crit_lethal: 40, crit_aim: 34,
  pc_pierce: 46,         // pierce — bullets keep hitting (boss + adds)
  bs_size_s: 40,         // +100% bullet size — bigger hitbox, easier boss/enemy hits
  kill_pulse_3: 30, kill_pulse: 44,  // explosion / chance clear-screen

  // --- defense (dual-purpose / sustain) — boosted EARLY to survive the boss danger-zone ---
  timeflow_shield: 86,   // slows nearby bullets & enemies 50% — makes dodging far easier
  turncoat_shield: 44,   // redirect nearby bullets at enemies
  shield_extra: (lv) => lv < 16 ? 72 : 42,
  shield_basic: (lv) => lv < 14 ? 60 : 32,
  regen_nano: (lv) => lv < 18 ? 64 : 38,
  regen_basic: (lv) => lv < 14 ? 50 : 26,
  kill_butcher: 66,      // lifesteal +5% — scales with DPS, great sustain throughout
  kill_blood: (lv) => lv < 16 ? 46 : 26,
  heal_overflow_2: 34, heal_overflow: 20,
  heal_quick: (lv) => lv < 12 ? 30 : 12, thorn_blaze: 18, thorn_static: 6,

  // --- economy (low) ---
  mix_econ: 10, coin_small: 4,
};

function regexScore(d, level) {
  let s = 0;
  if (/攻击间隔|攻速|射速|间隔|冷却|频率/.test(d)) s += 70;
  if (/分裂|弹道|多重|连发|散射|齐射/.test(d)) s += 80;
  if (/卫星|环绕/.test(d)) s += 64;
  if (/Boss|boss|首领/.test(d)) s += 60;
  if (/伤害/.test(d)) s += 44;
  if (/暴击/.test(d)) s += 34;
  if (/穿透/.test(d)) s += 40;
  if (/经验/.test(d)) s += level < 20 ? 85 : 36;
  if (/磁|拾取/.test(d)) s += level < 18 ? 50 : 22;
  if (/掉落|道具/.test(d)) s += level < 18 ? 40 : 18;
  if (/减速|时间流|清屏|清除|弹幕/.test(d)) s += 60;
  if (/吸血/.test(d)) s += 40;
  if (/护盾/.test(d)) s += 38;
  if (/(每秒|持续).*(回复|修复)|再生/.test(d)) s += 36;
  if (/最大生命|生命上限|血量上限/.test(d)) s += 28;
  if (/尺寸|口径|扩大/.test(d)) s += 30;
  if (/金币|经济|赏金/.test(d)) s += 4;
  return s;
}

// Sets used for state-aware survival anchoring.
const SHIELD_IDS = { shield_basic: 1, shield_extra: 1, heal_quick: 1 };
const REGEN_IDS = { regen_basic: 1, regen_nano: 1 };
const LIFESTEAL_IDS = { kill_blood: 1, kill_butcher: 1 };
const MULTISHOT_IDS = { ms_split_s: 1, ms_split_m: 1, ms_split_l: 1, bullet_void: 1 };

const SUSTAIN_IDS = Object.assign({ timeflow_shield: 1, sat_orbit_2: 1 }, SHIELD_IDS, REGEN_IDS, LIFESTEAL_IDS);

function chooseUpgrade(options, obs, mem) {
  const p = obs && obs.player;
  const level = (p && p.level) || 1;
  const picked = (mem && mem.picked) || {};
  const hasShield = (p && p.shield_max > 0) || picked.shield_basic || picked.shield_extra;
  const regenCount = (picked.regen_basic || 0) + (picked.regen_nano || 0);
  const lifestealCount = (picked.kill_blood || 0) + (picked.kill_butcher || 0);
  const multishotCount = (picked.ms_split_s || 0) + (picked.ms_split_m || 0) + (picked.ms_split_l || 0) + (picked.bullet_void || 0);
  const magnetRange = (p && p.magnet_range) || 40;
  // Count sustain upgrades taken so far; guarantee a survival floor before going full DPS.
  let sustainCount = 0;
  for (const id in picked) if (SUSTAIN_IDS[id]) sustainCount += picked[id];
  const rarW = { green: 0, blue: 4, purple: 9, orange: 16 };

  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    let s = rarW[o.rarity] || 0;
    const known = UPG[o.id];
    if (known !== undefined) s += typeof known === "function" ? known(level) : known;
    else s += regexScore((o.desc || "") + " " + (o.name || "") + " " + (o.id || ""), level);

    // --- state-aware survival floor: anchor the build so we don't die in the boss danger-zone ---
    if (!hasShield && SHIELD_IDS[o.id]) s += 60;                   // rush the first shield (2x effective HP)
    if (regenCount === 0 && REGEN_IDS[o.id] && level < 20) s += 30; // first regen
    if (lifestealCount === 0 && LIFESTEAL_IDS[o.id]) s += 26;       // first lifesteal (scales with DPS)
    if (multishotCount === 0 && MULTISHOT_IDS[o.id]) s += 22;       // first multishot (kill-rate snowball)
    if (magnetRange < 70 && o.id.indexOf("mag_") === 0) s += 28;    // rush first magnet (reliable exp collection ⇒ faster ramp)
    // Until we have a few sustain sources, push any sustain upgrade up (a full game gives 30+
    // picks, so front-loading sustain does not cost late-game DPS).
    if (sustainCount < 3 && SUSTAIN_IDS[o.id]) s += (3 - sustainCount) * 14;

    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}
