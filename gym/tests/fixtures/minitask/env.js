/**
 * minitask — a tiny fixture task (NOT in the registry; tests only).
 * Doubles as a minimal reference implementation of core/CONTRACT.md.
 *
 * Rules: reach `target` points (seed-dependent) by playing add ∈ {0,1,2} each step
 * before the step cap. Halfway there, a one-time "bonus offer" opens a pending
 * decision: choice 0 = +1 now, choice 1 = gamble (+3 or +0, seeded).
 */

"use strict";

const { SeededPRNG } = require("../../../core/prng.js");

const meta = {
  id: "minitask",
  name: "Mini count-up (test fixture)",
  version: "0.1.0",
  max_steps_default: 60,
  training_seeds: [1, 2, 3],
  example_actions: [{ add: 0 }, { add: 1 }, { add: 2 }, { add: 2, choice: 1 }, { choice: 0 }],
};

function createEnv() {
  let st = null;

  function buildObs(event) {
    const obs = {
      step: st.steps,
      room_code: st.room_code,
      total: st.total,
      target: st.target,
      steps_left: st.maxSteps - st.steps,
      metrics: {
        score: st.total * 10 + (st.done_reason === "win" ? 100 + (st.maxSteps - st.steps) : 0),
        progress: st.progress,
        done_reason: st.done_reason,
        total: st.total,
        bonus_taken: st.bonusResolved,
      },
    };
    if (st.pendingOffer) {
      obs.pending_decision = {
        kind: "bonus_offer",
        options: [
          { index: 0, name: "steady", desc: "+1 point now" },
          { index: 1, name: "gamble", desc: "+3 points or nothing" },
        ],
      };
    }
    return { obs, done: st.done, event: event || null };
  }

  return {
    reset(seed, config = {}) {
      const rng = new SeededPRNG(seed);
      st = {
        rng,
        room_code: rng.int(1e6), // seed fingerprint in obs (cosmetic, like a level id)
        target: 12 + rng.int(12),
        total: 0,
        steps: 0,
        maxSteps: config.max_steps || meta.max_steps_default,
        progress: 0,
        done: false,
        done_reason: null,
        pendingOffer: false,
        bonusOffered: false,
        bonusResolved: false,
        terminal: null,
      };
      return { obs: buildObs(null).obs };
    },

    step(action) {
      if (st.done) return st.terminal; // idempotent terminal step
      const a = action && typeof action === "object" ? action : {};
      let event = null;

      if (st.pendingOffer) {
        const choice = a.choice === 1 ? 1 : 0; // safe default: option 0
        st.total += choice === 1 ? (st.rng.next() < 0.5 ? 3 : 0) : 1;
        st.pendingOffer = false;
        st.bonusResolved = true;
      } else {
        const add = a.add === 0 || a.add === 1 || a.add === 2 ? a.add : 0; // sanitize
        st.total += add;
      }
      st.steps += 1;

      if (!st.bonusOffered && st.total >= Math.floor(st.target / 2)) {
        st.bonusOffered = true;
        st.pendingOffer = true;
        event = { kind: "bonus_offer" };
      }

      st.progress = Math.max(st.progress, Math.min(1, st.total / st.target));
      if (st.total >= st.target) {
        st.done = true;
        st.done_reason = "win";
        event = { kind: "game_over", reason: "win" };
      } else if (st.steps >= st.maxSteps) {
        st.done = true;
        st.done_reason = "timeout";
        event = { kind: "game_over", reason: "timeout" };
      }

      const out = buildObs(event);
      if (st.done) st.terminal = { obs: out.obs, done: true, event: null };
      return out;
    },
  };
}

module.exports = { meta, createEnv };
