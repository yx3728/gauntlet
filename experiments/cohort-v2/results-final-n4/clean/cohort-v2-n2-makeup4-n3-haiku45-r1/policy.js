"use strict";

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    const move = [0, 0];
    let upgrade_choice = 0;
    if (obs.pending_upgrade && obs.pending_upgrade.options.length) {
      upgrade_choice = 0;
    }
    return { action: { move, upgrade_choice }, mem };
  },
};
