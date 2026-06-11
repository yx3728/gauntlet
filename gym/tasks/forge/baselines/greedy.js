/**
 * greedy.js — the interface-sufficiency baseline for "forge".
 *
 * Uses ONLY fields documented in INTERFACE.task.md: gold, inventory, goods,
 * recipe, craft_yield, upgrade_cost, workshop_level, days_left, prices,
 * pending_decision.
 *
 * Heuristic, in priority order each day:
 *   1. If a trader offer is open, accept the option with the largest immediate
 *      gain vs. market prices (decline if none is profitable).
 *   2. Sell all goods on hand (the craft margin was checked when crafting).
 *   3. Craft every ready batch when batch revenue beats input market value.
 *   4. Upgrade the workshop early (raises craft_yield) while keeping a reserve.
 *   5. Otherwise buy the most-needed recipe material for the batches gold can fund;
 *      if even one unit is unaffordable, sell surplus materials to refill the purse.
 */

"use strict";

// Tuned on the training seeds:
const UPGRADE_MAX_LEVEL = 3; // stop upgrading at level 3 — later upgrades rarely repay within the season
const CRAFT_MARGIN = 1.02; // craft only when batch revenue >= 102% of the inputs' market value
const RESERVE_BATCHES = 1; // after an upgrade, keep enough gold to fund one more batch
const UPGRADE_CUTOFF = 15; // don't upgrade with fewer days left — the cost can't repay itself

/** Current market value of one craft batch's inputs. */
function recipeValue(obs) {
  let v = 0;
  for (const [m, n] of Object.entries(obs.recipe)) v += n * obs.prices[m];
  return v;
}

/** How many full batches the current inventory supports. */
function batchesReady(obs) {
  let b = Infinity;
  for (const [m, n] of Object.entries(obs.recipe)) b = Math.min(b, Math.floor(obs.inventory[m] / n));
  return b;
}

/** Pick the trader option with the best immediate gain vs market; 0 = decline. */
function chooseDeal(obs) {
  let best = 0;
  let bestGain = 0;
  for (const o of obs.pending_decision.options) {
    if (o.kind === "bulk_buy") {
      const n = Math.min(o.qty, Math.floor(obs.gold / o.unit_price));
      const gain = n * (obs.prices[o.item] - o.unit_price);
      if (gain > bestGain) {
        bestGain = gain;
        best = o.index;
      }
    } else if (o.kind === "premium_sale") {
      const owned = o.item === "goods" ? obs.goods : obs.inventory[o.item];
      const market = o.item === "goods" ? obs.prices.goods : obs.prices[o.item];
      const n = Math.min(o.qty, owned);
      const gain = n * (o.unit_price - market);
      if (gain > bestGain) {
        bestGain = gain;
        best = o.index;
      }
    }
  }
  return best;
}

module.exports = {
  init() {
    return {};
  },

  policy(obs, mem) {
    const action = {};
    if (obs.pending_decision) action.choice = chooseDeal(obs);

    if (obs.goods > 0) {
      action.op = "sell";
      action.item = "goods";
      action.qty = obs.goods;
      return { action, mem };
    }

    const value = recipeValue(obs);
    const ready = batchesReady(obs);
    if (ready >= 1 && obs.craft_yield * obs.prices.goods >= value * CRAFT_MARGIN) {
      action.op = "craft";
      action.qty = ready;
      return { action, mem };
    }

    if (
      obs.upgrade_cost !== null &&
      obs.workshop_level < UPGRADE_MAX_LEVEL &&
      obs.days_left >= UPGRADE_CUTOFF &&
      obs.gold >= obs.upgrade_cost + RESERVE_BATCHES * value
    ) {
      action.op = "upgrade";
      return { action, mem };
    }

    // Buy toward as many batches as gold can fund (one material per day).
    const targetBatches = Math.max(1, Math.floor(obs.gold / value));
    let bestItem = null;
    let bestDeficit = 0;
    for (const [m, n] of Object.entries(obs.recipe)) {
      const deficit = targetBatches * n - obs.inventory[m];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestItem = m;
      }
    }
    if (bestItem && obs.gold >= obs.prices[bestItem]) {
      action.op = "buy";
      action.item = bestItem;
      action.qty = bestDeficit;
      return { action, mem };
    }

    // Cash-blocked: liquidate materials beyond one batch's needs to refill the purse.
    if (bestItem) {
      let surplusItem = null;
      let surplus = 0;
      for (const [m, n] of Object.entries(obs.recipe)) {
        const extra = obs.inventory[m] - n;
        if (extra > surplus) {
          surplus = extra;
          surplusItem = m;
        }
      }
      if (surplusItem) {
        action.op = "sell";
        action.item = surplusItem;
        action.qty = surplus;
        return { action, mem };
      }
    }

    action.op = "rest";
    return { action, mem };
  },
};
