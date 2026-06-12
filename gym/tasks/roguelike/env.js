/**
 * roguelike — "Roguelike Skies", the big game from the manual-trial pipeline,
 * wrapped as a gauntlet task. THIN ADAPTER ONLY: the simulator is the vendored,
 * sha256-pinned `vendor/env.bundle.js` (trial template v2 — speed_cap 40,
 * max_steps 90 000), byte-identical to what the manual trials shipped. The
 * adapter maps the env to the gauntlet contract; it re-authors NOTHING.
 *
 * THE EVAL REGIME IS PINNED HERE: speed_cap = 40 px/tick and frame_skip = 1
 * always; max_steps defaults to 90 000 (config.max_steps can cap it tighter for
 * tests). Subjects explore other configs with their own workspace runner; the
 * canonical score is whatever THIS task computes.
 *
 * RNG OWNERSHIP (the cross-runner determinism story): the game draws all its
 * randomness from the process-global Math.random. The vendored bundle installs
 * its own seeded override at load; gauntlet's episode harness installs a
 * safety-net override per episode. To make trajectories identical no matter
 * which harness drives the env — and to keep two interleaved env instances
 * isolated — each adapter env owns a SeededPRNG seeded exactly like the
 * bundle's own (same mulberry32/splitmix32, same seed normalization) and
 * RE-INSTALLS it as Math.random before EVERY reset/step. Same seed ⇒ same draw
 * stream ⇒ byte-identical trajectories vs the vendored runner (verified by the
 * cross-runner test in tests/roguelike.test.js).
 */

"use strict";

const { SeededPRNG, installGlobalMathRandom } = require("../../core/prng.js");
const { RogueEnv } = require("./vendor/env.bundle.js");

const CAP_DEFAULT = 90000; // the v2 regime's episode budget (the eval's number)
const SPEED_CAP = 40; // px/tick — fixed for this task (the eval's number)

const meta = {
  id: "roguelike",
  name: "Roguelike Skies (manual-trial v2 regime: speed_cap 40, 90k budget)",
  version: "2.1.0", // 2.1.0 = +meta.criterion (eval-comparable declaration ONLY;
  // game/trajectory semantics byte-identical to 2.0.0 — goldens unchanged)
  max_steps_default: CAP_DEFAULT,
  // Seed 1 is the default dev seed of the v2 template; the rest are the named
  // TRAINING_SEEDS baked into the vendored runner. Held-out seeds live
  // orchestrator-side only.
  training_seeds: [1, 11, 23, 42, 57, 88, 101, 137, 199, 256, 314, 451, 512],
  example_actions: [
    { move: [0, 0], upgrade_choice: 0 },
    { move: [40, 0], upgrade_choice: null },
    { move: [-25, 12] },
    { move: [0, -40], upgrade_choice: 1 },
    { move: [8, 8], upgrade_choice: 2 },
  ],
  heavy: true, // full episodes run ~0.5-1.5s — conformance uses capped episodes
  // The eval comparable (v2 criterion seam) — semantics identical to the v1
  // experiment's eval_score: win -> 1+(cap-win_step)/cap in (1,2]; else progress.
  criterion: { kind: "win_speed", cap: CAP_DEFAULT },
  arena: { overlay_dir: "vendor" }, // ship the byte-identical v2 workspace files
};

function sanitizeAction(a) {
  const src = a && typeof a === "object" && !Array.isArray(a) ? a : {};
  let move = src.move;
  if (
    !Array.isArray(move) ||
    move.length !== 2 ||
    !Number.isFinite(Number(move[0])) ||
    !Number.isFinite(Number(move[1]))
  ) {
    move = [0, 0];
  } else {
    move = [Number(move[0]), Number(move[1])];
  }
  const uc = Number.isInteger(src.upgrade_choice) ? src.upgrade_choice : null;
  return { move, upgrade_choice: uc };
}

function createEnv() {
  const env = new RogueEnv();
  const rng = new SeededPRNG(0); // this env's private stream (see header)
  let steps = 0;
  let terminal = null; // cached terminal step output (cloned per call)

  function own() {
    installGlobalMathRandom(rng);
  }

  /** Build the gauntlet metrics envelope from the game's reward_info. */
  function withMetrics(obs, doneReason) {
    const ri = obs.reward_info || {};
    obs.metrics = {
      score: Number(ri.score) || 0,
      progress: Number(ri.progress) || 0,
      done_reason: doneReason,
      win_step: doneReason === "win" ? steps : null,
      boss_cleared: !!ri.boss_cleared,
      boss_reached: !!ri.boss_reached,
      boss_hp_destroyed: ri.boss_hp_destroyed == null ? null : Number(ri.boss_hp_destroyed),
      kills: Number(ri.kills) || 0,
      level: Number(ri.level) || 0,
      wave: Number(ri.wave) || 0,
      survived_ms: Number(ri.survived_ms) || 0,
      // NOTE: reward_info.steps is deliberately NOT mirrored (reserved key).
    };
    return obs;
  }

  return {
    reset(seed, config = {}) {
      const maxSteps =
        Number.isFinite(Number(config.max_steps)) && Number(config.max_steps) > 0
          ? Number(config.max_steps)
          : CAP_DEFAULT;
      steps = 0;
      terminal = null;
      own();
      rng.reseed(seed == null ? 0 : seed); // same normalization as the bundle's own PRNG
      const r = env.reset(seed, {
        speed_cap: SPEED_CAP,
        frame_skip: 1,
        max_steps: maxSteps,
        character_id: "striker",
      });
      return { obs: withMetrics(r.obs, null) };
    },

    step(action) {
      if (terminal) return JSON.parse(JSON.stringify(terminal)); // idempotent, unaliased
      own();
      const r = env.step(sanitizeAction(action));
      steps += 1;
      const doneReason = (r.obs.reward_info && r.obs.reward_info.done_reason) || null;
      const out = { obs: withMetrics(r.obs, doneReason), done: !!r.done, event: r.event || null };
      // Cache a DEEP CLONE so a caller mutating the final returned obs cannot
      // corrupt the recorded terminal state.
      if (out.done) terminal = JSON.parse(JSON.stringify({ obs: out.obs, done: true, event: null }));
      return out;
    },
  };
}

module.exports = { meta, createEnv };
