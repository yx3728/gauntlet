/**
 * noop.js — the trivial baseline policy: never move; pick upgrade option 0.
 *
 * Policy contract (the SAME contract subject agents implement in arena/policy.js):
 *   module.exports = {
 *     init() -> mem            // optional; initial strategic memory (any JSON-able value)
 *     policy(obs, mem) -> { action, mem }
 *   }
 * where action = { move:[dx,dy], upgrade_choice:int|null }.
 */
"use strict";

module.exports = {
  init() {
    return {};
  },
  policy(obs, mem) {
    return { action: { move: [0, 0], upgrade_choice: 0 }, mem };
  },
};
