/** noop.js — always plays the default action (wait). The do-nothing reference. */

"use strict";

module.exports = {
  init() {
    return {};
  },
  policy(obs, mem) {
    return { action: { move: "wait" }, mem };
  },
};
