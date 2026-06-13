/**
 * policy.js — Roguelike Skies bullet-hell policy.
 * Delegates to the tunable engine with the best-found config.
 *
 * Discovered by playing:
 *  - Field 360x640. Player autofires straight UP. Enemy/boss bullets are SLOW (3-5 px/tick);
 *    player moves up to ~40 px/tick, so dodging is always physically possible — deaths are
 *    positioning errors (getting cornered).
 *  - Touching an enemy/boss body is ~lethal. Bullets do 300-450 dmg.
 *  - Boss "crimson" ~19.4M HP, 5 phases, enters ~frame 5400 (wave 3), sweeps + fires downward fans.
 *    progress ~= 0.4 + 0.6*boss_hp_destroyed. Winning needs surviving the long fight while leveling
 *    DPS up (adds keep spawning -> farm exp). Earlier win scores higher.
 *  - 2-ply "escape" lookahead (reject positions with no safe exit next tick) avoids cornering.
 */
"use strict";

const { makePolicy } = require("./engine.js");

const BEST_T = {
  ESCAPE_W: 2.0,
  ESCAPE_TOP: 12,
};

module.exports = makePolicy(BEST_T);
