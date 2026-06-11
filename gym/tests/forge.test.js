/**
 * forge.test.js — behavior tests for the "forge" (Forge & Fortune) task:
 * generation properties, action/sanitization semantics, trader offers,
 * market shifts, win/timeout paths, golden trajectory hashes, and the
 * greedy-beats-noop interface-sufficiency check.
 */

"use strict";

const { test, assert, assertEqual } = require("./harness.js");
const { runEpisode } = require("../core/episode.js");
const { stateOnlyHash } = require("../tools/capture_golden.js");

const forge = require("../tasks/forge/env.js");
const noop = require("../tasks/forge/baselines/noop.js");
const greedy = require("../tasks/forge/baselines/greedy.js");

const PRICE_BOUNDS = { ore: [5, 24], wood: [3, 16], crystal: [9, 40] };

/** Drive a fresh env with a fixed action every step; collect every step result. */
function runFixed(seed, action, maxSteps = 100) {
  const env = forge.createEnv();
  let last = { obs: env.reset(seed, {}).obs, done: false, event: null };
  const steps = [last];
  let n = 0;
  while (!last.done && n < maxSteps) {
    last = env.step(action);
    steps.push(last);
    n += 1;
  }
  return { env, steps, last };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test("[forge] generation: different seeds produce different markets", () => {
  const env = forge.createEnv();
  const sigs = new Set();
  for (const s of [1, 2, 3, 4, 5]) {
    const { obs } = env.reset(s, {});
    sigs.add(JSON.stringify(obs.prices));
  }
  assert(sigs.size >= 3, `initial price vectors barely vary across seeds (${sigs.size}/5 unique)`);
});

test("[forge] generation: prices stay within published bounds for a full episode", () => {
  for (const s of [1, 5, 2000]) {
    const { steps } = runFixed(s, { op: "rest" });
    for (const t of steps) {
      for (const [m, [lo, hi]] of Object.entries(PRICE_BOUNDS)) {
        const p = t.obs.prices[m];
        assert(p >= lo && p <= hi, `seed ${s}: ${m} price ${p} outside [${lo},${hi}]`);
      }
      assert(t.obs.prices.goods >= 1, "goods price >= 1");
    }
  }
});

// ---------------------------------------------------------------------------
// Action semantics
// ---------------------------------------------------------------------------

test("[forge] buy: pays the observed price and adds inventory", () => {
  const env = forge.createEnv();
  const { obs: o0 } = env.reset(1, {});
  const p = o0.prices.ore;
  const { obs: o1 } = env.step({ op: "buy", item: "ore", qty: 3 });
  assertEqual(o1.inventory.ore, 3, "ore bought");
  assertEqual(o1.gold, o0.gold - 3 * p, "gold debited at the price observed before the step");
});

test("[forge] buy: unaffordable qty clamps to what gold covers", () => {
  const env = forge.createEnv();
  const { obs: o0 } = env.reset(1, {});
  const p = o0.prices.crystal;
  const affordable = Math.floor(o0.gold / p);
  const { obs: o1 } = env.step({ op: "buy", item: "crystal", qty: 9999 });
  assertEqual(o1.inventory.crystal, affordable, "clamped to affordable");
  assertEqual(o1.gold, o0.gold - affordable * p, "gold after clamped buy");
  assert(o1.gold >= 0, "gold never negative");
});

test("[forge] sell: caps at owned; selling nothing is a harmless no-op", () => {
  const env = forge.createEnv();
  const { obs: o0 } = env.reset(2, {});
  const { obs: o1 } = env.step({ op: "sell", item: "goods", qty: 5 });
  assertEqual(o1.gold, o0.gold, "no goods owned -> no gold change");
  assertEqual(o1.goods, 0, "goods still zero");
});

test("[forge] craft: consumes the recipe, yields craft_yield per batch", () => {
  const env = forge.createEnv();
  let { obs } = env.reset(3, {});
  ({ obs } = env.step({ op: "buy", item: "ore", qty: 2 }));
  ({ obs } = env.step({ op: "buy", item: "wood", qty: 2 }));
  ({ obs } = env.step({ op: "buy", item: "crystal", qty: 1 }));
  assertEqual(JSON.stringify(obs.inventory), JSON.stringify({ ore: 2, wood: 2, crystal: 1 }), "inputs in stock");
  const yieldPer = obs.craft_yield;
  assertEqual(yieldPer, 2, "level-1 yield is 2 per batch");
  ({ obs } = env.step({ op: "craft", qty: 1 }));
  assertEqual(obs.goods, yieldPer, "one batch crafted");
  assertEqual(JSON.stringify(obs.inventory), JSON.stringify({ ore: 0, wood: 0, crystal: 0 }), "recipe consumed");
  assertEqual(obs.metrics.goods_crafted, yieldPer, "cumulative crafted metric");
});

test("[forge] craft with empty inventory is a no-op; unaffordable upgrade is a no-op", () => {
  const env = forge.createEnv();
  const { obs: o0 } = env.reset(1, {});
  let { obs } = env.step({ op: "craft", qty: 5 });
  assertEqual(obs.goods, 0, "nothing crafted");
  ({ obs } = env.step({ op: "upgrade" })); // start gold 100 < cost 150
  assertEqual(obs.workshop_level, 1, "upgrade rejected");
  assertEqual(obs.gold, o0.gold, "gold untouched");
});

test("[forge] invalid op / junk action acts as rest (state preserved, day advances)", () => {
  const env = forge.createEnv();
  const { obs: o0 } = env.reset(4, {});
  const { obs: o1 } = env.step({ op: "hack", item: "everything", qty: -3 });
  assertEqual(o1.day, 1, "day advanced");
  assertEqual(o1.gold, o0.gold, "gold unchanged");
  assertEqual(JSON.stringify(o1.inventory), JSON.stringify(o0.inventory), "inventory unchanged");
  assertEqual(o1.workshop_level, 1, "level unchanged");
});

// ---------------------------------------------------------------------------
// Trader offers & market shifts
// ---------------------------------------------------------------------------

/** Rest until the first pending_decision appears; return { env, obs } or null. */
function restUntilOffer(seed) {
  const env = forge.createEnv();
  let last = { obs: env.reset(seed, {}).obs, done: false };
  let n = 0;
  while (!last.done && n < 70) {
    if (last.obs.pending_decision) return { env, obs: last.obs };
    last = env.step({ op: "rest" });
    n += 1;
  }
  return null;
}

test("[forge] trader offer: well-formed, opens with the event, default-declines on junk choice", () => {
  const found = restUntilOffer(1);
  assert(found, "no trader offer within a noop episode on seed 1");
  const pd = found.obs.pending_decision;
  assertEqual(pd.kind, "trader_offer", "kind");
  assert(pd.options.length >= 2 && pd.options.length <= 3, `2-3 options, got ${pd.options.length}`);
  assertEqual(pd.options[0].kind, "decline", "option 0 is decline");
  for (const o of pd.options.slice(1)) {
    assert(o.kind === "bulk_buy" || o.kind === "premium_sale", `deal kind ${o.kind}`);
    assert(["ore", "wood", "crystal", "goods"].includes(o.item), "deal item");
    assert(Number.isInteger(o.qty) && o.qty > 0, "deal qty");
    assert(Number.isInteger(o.unit_price) && o.unit_price >= 1, "deal unit_price");
  }
  const goldBefore = found.obs.gold;
  const { obs } = found.env.step({ op: "rest", choice: 99 }); // invalid -> decline
  assert(!obs.pending_decision, "offer closed after one step");
  assertEqual(obs.gold, goldBefore, "decline leaves gold unchanged");
  assertEqual(obs.metrics.deals_accepted, 0, "no deal recorded");
});

test("[forge] trader offer: accepting a bulk_buy applies the offer-time unit price", () => {
  // Find a seed whose first offer (under rest-play) contains a bulk_buy deal.
  let hit = null;
  for (let s = 1; s <= 30 && !hit; s += 1) {
    const found = restUntilOffer(s);
    if (!found) continue;
    const deal = found.obs.pending_decision.options.find((o) => o.kind === "bulk_buy");
    if (deal) hit = { ...found, deal };
  }
  assert(hit, "no bulk_buy offer found across seeds 1..30");
  const { env, obs: o0, deal } = hit;
  const n = Math.min(deal.qty, Math.floor(o0.gold / deal.unit_price));
  assert(n > 0, "deal affordable for the test");
  const { obs: o1 } = env.step({ op: "rest", choice: deal.index });
  assertEqual(o1.gold, o0.gold - n * deal.unit_price, "paid the fixed offer price");
  assertEqual(o1.inventory[deal.item], o0.inventory[deal.item] + n, "items delivered");
  assertEqual(o1.metrics.deals_accepted, 1, "deal counted");
});

test("[forge] market_shift: at least one per episode, and the jump is visible in obs prices", () => {
  for (const s of [1, 2, 3]) {
    const { steps } = runFixed(s, { op: "rest" });
    let seen = 0;
    for (const t of steps) {
      if (t.event && t.event.kind === "market_shift") {
        seen += 1;
        assertEqual(t.obs.prices[t.event.item], t.event.to, "event.to equals the observed price");
        assert(t.event.from !== t.event.to, "shift actually moved the price");
      }
    }
    // The env schedules 2-4 shifts per season; even with trader_offer events
    // masking same-day shifts, every episode must surface at least one.
    assert(seen >= 1, `no market_shift event in the seed ${s} noop episode`);
  }
});

// ---------------------------------------------------------------------------
// Win / timeout paths, progress & score semantics
// ---------------------------------------------------------------------------

test("[forge] timeout path: noop holds start value and times out at the horizon", () => {
  const r = runEpisode(forge, noop, 1, {}, {});
  assertEqual(r.done_reason, "timeout", "noop times out");
  assertEqual(r.steps, 60, "season is 60 days");
  assertEqual(r.net_worth, 100, "noop never trades: net worth stays at start gold");
  assert(r.progress < 1, "no win -> progress below 1");
  assertEqual(r.score, r.net_worth, "no win -> score is final net worth");
});

test("[forge] win path: greedy wins on some training seeds; progress 1.0 only on win", () => {
  let wins = 0;
  for (const s of forge.meta.training_seeds) {
    const r = runEpisode(forge, greedy, s, {}, {});
    assert(!r.policy_error, `greedy policy error on seed ${s}: ${r.policy_error}`);
    if (r.done_reason === "win") {
      wins += 1;
      assertEqual(r.progress, 1, "win -> progress 1.0");
      assert(r.net_worth >= 1000, "win means net worth at target");
      const daysLeft = 60 - r.steps;
      assertEqual(r.score, r.net_worth + 500 + 10 * daysLeft, "published score formula on win");
    } else {
      assert(r.progress < 1, "no win -> progress stays below 1.0");
    }
  }
  assert(wins >= 2, `greedy should win on at least 2 training seeds, won ${wins}`);
});

test("[forge] interface sufficiency: greedy mean score clearly beats noop", () => {
  const mean = (pol) => {
    let sum = 0;
    for (const s of forge.meta.training_seeds) sum += runEpisode(forge, pol, s, {}, {}).score;
    return sum / forge.meta.training_seeds.length;
  };
  const noopMean = mean(noop);
  const greedyMean = mean(greedy);
  assert(
    greedyMean > noopMean * 2,
    `greedy mean score ${greedyMean} should clearly beat noop mean ${noopMean}`
  );
});

// ---------------------------------------------------------------------------
// Golden trajectories (state-only hashes)
// ---------------------------------------------------------------------------

// Captured via: node tools/capture_golden.js --task forge --seeds 2000,2001
// Re-pinning these is a deliberate, reviewed act and REQUIRES a meta.version bump.
const GOLDEN = {
  s2000: "aa03364bb4ac47a0d2ea3db2a7fd1c63d999ee06", // 60 steps
  s2001: "26f4d7c714efe5899d23f8b8b56542cc4e146fe0", // 60 steps
};

test("[forge] golden state-only trajectory hashes (seeds 2000, 2001)", () => {
  assertEqual(forge.meta.version, "1.0.0", "goldens pinned for forge@1.0.0 — version changed, re-pin deliberately");
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const seed = Number(key.slice(1));
    const { hash } = stateOnlyHash(forge, seed);
    assertEqual(hash, expected, `golden hash for seed ${seed}`);
  }
});
