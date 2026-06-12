/**
 * policy.template.js — starting point for the policy-coding path.
 *
 * Copy this to `policy.js` and make it good. It must export the contract in
 * INTERFACE.md §6: { init?(), policy(obs, mem) -> { action, mem } }.
 *
 * This stub just holds position and takes the first upgrade — it is intentionally
 * un-strategic and will not get far. Read obs (INTERFACE.md §3), keep what you need
 * in `mem`, and return a `move` (per-tick displacement) plus, when a level_up is
 * pending, an `upgrade_choice`.
 */
"use strict";

module.exports = {
  // Optional. Returns your initial per-episode memory (any JSON-able value).
  init() {
    return {};
  },

  // Required. Called once per step. Pure function of (obs, mem).
  policy(obs, mem) {
    // --- read the world (see INTERFACE.md §3) ---
    // const [px, py] = obs.player.pos;
    // for (const o of obs.objects) { /* o.type, o.pos, o.vel, ... */ }

    // --- decide a move (per-tick displacement; [0,0] = hold) ---
    const move = [0, 0];

    // --- if a level-up panel is open, you MUST choose an option index ---
    // While the panel is open, the options are in obs.pending_upgrade.options
    // (each has index/id/name/rarity/desc). Inspect them to choose deliberately.
    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length) {
      // e.g. pick deliberately based on obs.pending_upgrade.options[i].{name,rarity,desc}
      upgrade_choice = 0;
    }

    return { action: { move, upgrade_choice }, mem };
  },
};
