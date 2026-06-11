/**
 * aggregate.js — task-agnostic aggregation over episode results.
 *
 * Works by introspecting the metrics envelope rather than naming task-specific
 * fields: numeric fields become {mean, median, min, max} distributions, boolean
 * fields become rates, `done_reason` becomes a rates object, and policy errors
 * become a rate. Lib2 consumes this shape without knowing the task.
 */

"use strict";

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

const SKIP_KEYS = new Set(["seed", "events", "policy_error", "done_reason", "_gamelog"]);

/**
 * @param {object[]} results episode results from runEpisode()
 * @returns {object} aggregate
 */
function aggregate(results) {
  const agg = { n: results.length };
  if (!results.length) return agg;

  // Discover field types across all results (a field may be absent in some).
  const numeric = new Set();
  const boolean = new Set();
  for (const r of results) {
    for (const [k, v] of Object.entries(r)) {
      if (SKIP_KEYS.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) numeric.add(k);
      else if (typeof v === "boolean") boolean.add(k);
    }
  }

  for (const k of numeric) {
    const v = results.map((r) => Number(r[k]) || 0).sort((a, b) => a - b);
    const sum = v.reduce((a, b) => a + b, 0);
    agg[k] = {
      mean: round4(sum / v.length),
      median: v[Math.floor((v.length - 1) / 2)],
      min: v[0],
      max: v[v.length - 1],
    };
  }
  for (const k of boolean) {
    agg[`${k}_rate`] = round4(results.filter((r) => r[k]).length / results.length);
  }

  const reasons = {};
  for (const r of results) {
    const reason = r.done_reason == null ? "none" : String(r.done_reason);
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  agg.done_reason_rates = Object.fromEntries(
    Object.entries(reasons).map(([k, c]) => [k, round4(c / results.length)])
  );
  agg.policy_error_rate = round4(results.filter((r) => r.policy_error).length / results.length);
  return agg;
}

module.exports = { aggregate, round4 };
