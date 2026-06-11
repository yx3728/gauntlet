/**
 * forge — Forge & Fortune: a non-spatial workshop-economy task.
 *
 * One step = one day. The player starts with a little gold, trades three raw
 * materials whose prices follow seeded random walks (with occasional seeded
 * market shifts), crafts goods from a fixed recipe (yield scales with the
 * workshop level), fields take-it-or-leave-it trader offers (pending
 * decisions), and wins by reaching a fixed target net worth before the season
 * ends. All published numbers/formulas live in INTERFACE.task.md.
 *
 * Layout: constants/meta -> generation (reset) -> step logic -> obs builder.
 */

"use strict";

const { SeededPRNG } = require("../../core/prng.js");

// ---------------------------------------------------------------------------
// Published constants (interface facts — keep in sync with INTERFACE.task.md)
// ---------------------------------------------------------------------------
const HORIZON = 60; // days in a season (1 step = 1 day)
const START_GOLD = 100;
const TARGET = 1000; // win when net_worth >= TARGET (seed-independent)
const MATERIALS = ["ore", "wood", "crystal"];
const RECIPE = { ore: 2, wood: 2, crystal: 1 }; // consumed per craft batch
const MAX_LEVEL = 5;
const UPGRADE_UNIT_COST = 150; // next upgrade costs 150 * current level
const PRICE_BOUNDS = { ore: [5, 24], wood: [3, 16], crystal: [9, 40] };
const DEMAND_BOUNDS = [0.58, 0.85]; // goods demand factor range
const WIN_BONUS = 500;
const DAY_BONUS = 10; // score per day remaining on a win
const QTY_CAP = 9999;
const OPS = ["buy", "sell", "craft", "upgrade", "rest"];

const meta = {
  id: "forge",
  name: "Forge & Fortune",
  version: "1.0.0",
  max_steps_default: 80, // every episode ends by day HORIZON=60 anyway
  training_seeds: [1, 2, 3, 4, 5, 6, 7, 8],
  example_actions: [
    { op: "rest" },
    { op: "buy", item: "ore", qty: 4 },
    { op: "buy", item: "crystal", qty: 2 },
    { op: "sell", item: "goods", qty: 3 },
    { op: "craft", qty: 2 },
    { op: "upgrade" },
    { op: "rest", choice: 1 },
  ],
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Map one PRNG draw to a daily integer price delta (mean 0). */
function walkDelta(u) {
  if (u < 0.1) return -2;
  if (u < 0.35) return -1;
  if (u < 0.65) return 0;
  if (u < 0.9) return 1;
  return 2;
}

/** Map one PRNG draw to a daily demand-factor delta (mean 0). */
function demandDelta(u) {
  if (u < 0.2) return -0.02;
  if (u < 0.4) return -0.01;
  if (u < 0.6) return 0;
  if (u < 0.8) return 0.01;
  return 0.02;
}

function recipeMarketValue(prices) {
  let v = 0;
  for (const m of MATERIALS) v += RECIPE[m] * prices[m];
  return v;
}

function goodsPriceOf(demand, prices) {
  return Math.max(1, Math.round(demand * recipeMarketValue(prices)));
}

function createEnv() {
  let st = null;

  // -------------------------------------------------------------------------
  // Generation (reset-time, all draws from st.rng)
  // -------------------------------------------------------------------------

  /** Schedule market shifts: day -> { item, factor }. */
  function rollShifts(rng) {
    const shifts = {};
    let n = 2 + rng.int(3); // 2..4 shifts per season
    let guard = 0;
    while (n > 0 && guard < 60) {
      guard += 1;
      const d = 5 + rng.int(50); // days 5..54
      if (!shifts[d]) {
        const up = rng.next() < 0.5;
        const mag = 1.25 + rng.next() * 0.2; // 25..45% jump
        shifts[d] = { item: rng.pick(MATERIALS), factor: up ? mag : 1 / mag };
        n -= 1;
      }
    }
    return shifts;
  }

  /** Schedule trader visit days: day -> true. */
  function rollTraderDays(rng) {
    const days = {};
    let n = 2 + rng.int(2); // 2..3 visits per season
    let guard = 0;
    while (n > 0 && guard < 60) {
      guard += 1;
      const d = 3 + rng.int(48); // days 3..50
      if (!days[d]) {
        days[d] = true;
        n -= 1;
      }
    }
    return days;
  }

  /** Build a trader offer at TODAY's prices (deal prices are fixed at offer time). */
  function rollOffer() {
    const rng = st.rng;
    const nDeals = rng.next() < 0.4 ? 2 : 1;
    const deals = [];
    for (let i = 0; i < nDeals; i += 1) {
      if (rng.next() < 0.5) {
        // bulk_buy: the player may buy up to qty of a material below market.
        const item = rng.pick(MATERIALS);
        const qty = 8 + rng.int(13); // 8..20
        const unit = Math.max(1, Math.round(st.prices[item] * (0.65 + rng.next() * 0.1)));
        deals.push({ kind: "bulk_buy", item, qty, unit_price: unit });
      } else {
        // premium_sale: the player may sell up to qty of an item above market.
        const item = rng.next() < 0.6 ? "goods" : rng.pick(MATERIALS);
        const market = item === "goods" ? st.goodsPrice : st.prices[item];
        const qty = 5 + rng.int(10); // 5..14
        const unit = Math.max(1, Math.round(market * (1.25 + rng.next() * 0.15)));
        deals.push({ kind: "premium_sale", item, qty, unit_price: unit });
      }
    }
    return { day: st.day, deals };
  }

  // -------------------------------------------------------------------------
  // Step logic
  // -------------------------------------------------------------------------

  /** Resolve the open trader offer; invalid/missing choice declines (option 0). */
  function resolveOffer(choiceRaw) {
    const offer = st.offer;
    st.offer = null;
    let c = Number.isInteger(choiceRaw) ? choiceRaw : 0;
    if (c < 0 || c > offer.deals.length) c = 0;
    if (c === 0) return; // decline
    const deal = offer.deals[c - 1];
    let n = 0;
    if (deal.kind === "bulk_buy") {
      n = Math.min(deal.qty, Math.floor(st.gold / deal.unit_price));
      if (n > 0) {
        st.gold -= n * deal.unit_price;
        st.inv[deal.item] += n;
      }
    } else {
      const owned = deal.item === "goods" ? st.goods : st.inv[deal.item];
      n = Math.min(deal.qty, owned);
      if (n > 0) {
        if (deal.item === "goods") st.goods -= n;
        else st.inv[deal.item] -= n;
        st.gold += n * deal.unit_price;
      }
    }
    if (n > 0) st.dealsAccepted += 1;
  }

  /** Apply the day's op at TODAY's (observed) prices. Sanitize everything. */
  function applyOp(a) {
    let op = typeof a.op === "string" && OPS.includes(a.op) ? a.op : "rest";
    let qty = Math.floor(Number(a.qty));
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > QTY_CAP) qty = QTY_CAP;
    const item = typeof a.item === "string" ? a.item : null;

    if (op === "buy") {
      if (!MATERIALS.includes(item)) return; // goods cannot be bought
      const p = st.prices[item];
      const n = Math.min(qty, Math.floor(st.gold / p));
      if (n > 0) {
        st.gold -= n * p;
        st.inv[item] += n;
      }
    } else if (op === "sell") {
      if (item === "goods") {
        const n = Math.min(qty, st.goods);
        st.goods -= n;
        st.gold += n * st.goodsPrice;
      } else if (MATERIALS.includes(item)) {
        const n = Math.min(qty, st.inv[item]);
        st.inv[item] -= n;
        st.gold += n * st.prices[item];
      }
    } else if (op === "craft") {
      let batches = qty;
      for (const m of MATERIALS) batches = Math.min(batches, Math.floor(st.inv[m] / RECIPE[m]));
      if (batches > 0) {
        for (const m of MATERIALS) st.inv[m] -= batches * RECIPE[m];
        const made = batches * (st.level + 1); // yield per batch = level + 1
        st.goods += made;
        st.goodsCrafted += made;
      }
    } else if (op === "upgrade") {
      const cost = UPGRADE_UNIT_COST * st.level;
      if (st.level < MAX_LEVEL && st.gold >= cost) {
        st.gold -= cost;
        st.level += 1;
      }
    }
    // "rest": nothing.
  }

  /** Advance the market to the (already incremented) new day. Returns a shift event or null. */
  function advanceMarket() {
    let shiftEvent = null;
    for (const m of MATERIALS) {
      const [lo, hi] = PRICE_BOUNDS[m];
      st.prices[m] = clamp(st.prices[m] + walkDelta(st.rng.next()), lo, hi);
    }
    st.demand = clamp(st.demand + demandDelta(st.rng.next()), DEMAND_BOUNDS[0], DEMAND_BOUNDS[1]);
    const shift = st.shifts[st.day];
    if (shift) {
      const [lo, hi] = PRICE_BOUNDS[shift.item];
      const from = st.prices[shift.item];
      const to = clamp(Math.round(from * shift.factor), lo, hi);
      st.prices[shift.item] = to;
      shiftEvent = { kind: "market_shift", item: shift.item, from, to };
    }
    st.goodsPrice = goodsPriceOf(st.demand, st.prices);
    return shiftEvent;
  }

  function netWorth() {
    let w = st.gold + st.goods * st.goodsPrice;
    for (const m of MATERIALS) w += st.inv[m] * st.prices[m];
    return w;
  }

  // -------------------------------------------------------------------------
  // Obs
  // -------------------------------------------------------------------------

  function buildObs(event) {
    const nw = st.netWorth;
    const daysLeft = HORIZON - st.day;
    const score = nw + (st.doneReason === "win" ? WIN_BONUS + DAY_BONUS * daysLeft : 0);
    const obs = {
      day: st.day,
      horizon: HORIZON,
      days_left: daysLeft,
      gold: st.gold,
      inventory: { ore: st.inv.ore, wood: st.inv.wood, crystal: st.inv.crystal },
      goods: st.goods,
      workshop_level: st.level,
      workshop_max_level: MAX_LEVEL,
      upgrade_cost: st.level < MAX_LEVEL ? UPGRADE_UNIT_COST * st.level : null,
      craft_yield: st.level + 1,
      recipe: { ore: RECIPE.ore, wood: RECIPE.wood, crystal: RECIPE.crystal },
      prices: { ore: st.prices.ore, wood: st.prices.wood, crystal: st.prices.crystal, goods: st.goodsPrice },
      net_worth: nw,
      target: TARGET,
      metrics: {
        score,
        progress: st.progress,
        done_reason: st.doneReason,
        gold: st.gold,
        net_worth: nw,
        workshop_level: st.level,
        goods: st.goods,
        goods_crafted: st.goodsCrafted,
        deals_accepted: st.dealsAccepted,
        day: st.day,
      },
    };
    if (st.offer && !st.done) {
      const options = [{ index: 0, kind: "decline", desc: "decline the offer" }];
      st.offer.deals.forEach((d, i) => {
        const verb = d.kind === "bulk_buy" ? "buy" : "sell";
        options.push({
          index: i + 1,
          kind: d.kind,
          item: d.item,
          qty: d.qty,
          unit_price: d.unit_price,
          desc: `${verb} up to ${d.qty} ${d.item} at ${d.unit_price} gold each`,
        });
      });
      obs.pending_decision = { kind: "trader_offer", options };
    }
    return { obs, done: st.done, event: event || null };
  }

  // -------------------------------------------------------------------------
  // Env API
  // -------------------------------------------------------------------------

  return {
    reset(seed, config = {}) {
      const rng = new SeededPRNG(seed);
      const prices = {
        ore: 8 + rng.int(6), // 8..13
        wood: 5 + rng.int(4), // 5..8
        crystal: 16 + rng.int(8), // 16..23
      };
      const demand = 0.6 + rng.next() * 0.12; // 0.60..0.72
      const cfgCap =
        Number.isInteger(config.max_steps) && config.max_steps > 0 ? config.max_steps : meta.max_steps_default;
      st = {
        rng,
        day: 0,
        lastDay: Math.min(HORIZON, cfgCap),
        gold: START_GOLD,
        inv: { ore: 0, wood: 0, crystal: 0 },
        goods: 0,
        level: 1,
        goodsCrafted: 0,
        dealsAccepted: 0,
        prices,
        demand,
        goodsPrice: goodsPriceOf(demand, prices),
        shifts: rollShifts(rng),
        traderDays: rollTraderDays(rng),
        offer: null,
        progress: 0,
        netWorth: 0,
        done: false,
        doneReason: null,
        terminal: null,
      };
      st.netWorth = netWorth();
      st.progress = Math.min(1, st.netWorth / TARGET);
      return { obs: buildObs(null).obs };
    },

    step(action) {
      if (st.done) return st.terminal; // idempotent terminal step
      const a = action && typeof action === "object" ? action : {};

      // 1. Resolve yesterday's trader offer (default: decline), then today's op.
      if (st.offer) resolveOffer(a.choice);
      applyOp(a);

      // 2. The day ends; the market moves into the new day.
      st.day += 1;
      const shiftEvent = advanceMarket();

      // 3. A trader may arrive in the evening (offer is open for one step).
      let offerEvent = null;
      if (st.traderDays[st.day]) {
        st.offer = rollOffer();
        offerEvent = { kind: "trader_offer", day: st.day, deals: st.offer.deals.length };
      }

      // 4. Valuation, progress, termination.
      st.netWorth = netWorth();
      st.progress = Math.max(st.progress, Math.min(1, st.netWorth / TARGET));
      let event = offerEvent || shiftEvent;
      if (st.netWorth >= TARGET) {
        st.done = true;
        st.doneReason = "win";
      } else if (st.day >= st.lastDay) {
        st.done = true;
        st.doneReason = "timeout";
      }
      if (st.done) {
        st.offer = null; // the season is over; no decision can remain open
        event = { kind: "game_over", reason: st.doneReason };
      }

      const out = buildObs(event);
      if (st.done) st.terminal = { obs: out.obs, done: true, event: null };
      return out;
    },
  };
}

module.exports = { meta, createEnv };
