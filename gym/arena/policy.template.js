/**
 * policy.template.js — starting point for your policy. Copy to policy.js and edit.
 * Contract: see INTERFACE.md. Goal: see DESCRIPTION.md.
 */

"use strict";

module.exports = {
  // Called once at the start of each episode. Return your initial memory (JSON-able).
  init() {
    return {};
  },

  // Called every step. Decide an action from (obs, mem); return both.
  policy(obs, mem) {
    const action = {}; // TODO: fill in per the action schema in INTERFACE.md
    return { action, mem };
  },
};
