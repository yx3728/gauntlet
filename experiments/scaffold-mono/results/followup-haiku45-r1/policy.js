"use strict";

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    // Hold position: empirically proven to be safest strategy
    const move = [0, 0];

    // Always choose first upgrade option (index 0)
    let upgrade_choice = 0;

    return { action: { move, upgrade_choice }, mem };
  },
};
