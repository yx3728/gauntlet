/** noop.js — the floor baseline: rest every day, never trade, never choose. */

"use strict";

module.exports = {
  init() {
    return {};
  },
  policy(obs, mem) {
    return { action: { op: "rest" }, mem };
  },
};
