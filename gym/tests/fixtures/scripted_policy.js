/**
 * scripted_policy.js — the shared deterministic test policy.
 *
 * Builds a closed-loop policy (a pure function of obs) that weaves a task's
 * meta.example_actions with deterministic junk, so conformance tests and golden
 * trajectories exercise real code paths AND the sanitize-never-throw rule.
 *
 * WARNING: golden trajectory hashes depend on this file's exact arithmetic.
 * Any change here invalidates every task's goldens (re-pin deliberately).
 */

"use strict";

const JUNK = [{}, null, 42, "x", { bogus: true }, { choice: 0 }, { choice: 99 }, { add: -5 }];

function makeScriptedPolicy(taskMod) {
  const ex = (taskMod.meta && taskMod.meta.example_actions) || [];
  return {
    init() {
      return { n: 0 };
    },
    policy(obs, mem) {
      const n = mem.n;
      let action;
      if (n % 4 === 3) {
        action = JUNK[n % JUNK.length];
      } else if (ex.length) {
        // Obs-dependent pick (closed-loop): diverging obs => diverging actions.
        const k = (n * 7 + JSON.stringify(obs).length) % ex.length;
        action = ex[k];
      } else {
        action = {};
      }
      return { action, mem: { n: n + 1 } };
    },
  };
}

module.exports = { makeScriptedPolicy, JUNK };
