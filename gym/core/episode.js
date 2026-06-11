/**
 * episode.js — the generic policy↔task step loop (task-agnostic).
 *
 * Drives a policy module against a task env for one episode. The semantics are
 * the proven runner semantics every policy in the playtest pipeline was
 * written against:
 *   - the policy is called in a try/catch: a throwing policy ends the episode
 *     with `policy_error` recorded — it never crashes the batch;
 *   - a falsy return / missing action defaults to `{}` (tasks must sanitize);
 *   - `mem` is replaced only when the `mem` key is present in the return;
 *   - light logs (action_log + periodic obs-hash checkpoints) are kept in
 *     memory and returned once at the end — NO per-step I/O;
 *   - a `max_steps + 5` backstop guards against a task whose `done` is broken.
 */

"use strict";

const crypto = require("crypto");
const { SeededPRNG, installGlobalMathRandom } = require("./prng.js");

// Safety-net global Math.random override: installed once per process, reseeded
// per episode with a stream distinct from the env's own SeededPRNG(seed).
let _net = null;
function reseedGlobalOverride(seed) {
  if (!_net) {
    _net = new SeededPRNG(0);
    installGlobalMathRandom(_net);
  }
  _net.reseed("net:" + String(seed));
}

function hashObs(obs) {
  return crypto.createHash("sha1").update(JSON.stringify(obs)).digest("hex").slice(0, 12);
}

/**
 * Run one episode.
 *
 * @param {object} taskMod   task module `{ meta, createEnv }`
 * @param {object} policyMod policy module `{ init?(), policy(obs, mem) }`
 * @param {number|string} seed
 * @param {object} config    task config; `max_steps` is the standard key
 * @param {object} opts      { onStep?, captureLight?, captureFull?, checkpointEvery? }
 * @returns {object} result  `{ seed, steps, events, ...metrics, policy_error?, _gamelog? }`
 */
function runEpisode(taskMod, policyMod, seed, config = {}, opts = {}) {
  const meta = taskMod.meta || {};
  const env = taskMod.createEnv();
  reseedGlobalOverride(seed);

  const captureLight = !!opts.captureLight;
  const captureFull = !!opts.captureFull;
  const onStep = opts.onStep;
  const checkpointEvery = opts.checkpointEvery || 100;

  let mem = typeof policyMod.init === "function" ? policyMod.init() : {};
  let { obs } = env.reset(seed, config);
  let last = { obs, done: false, event: null };

  const events = {};
  const action_log = [];
  const checkpoints = [];
  const full = [];
  let steps = 0;
  let policy_error;
  const cap = (config.max_steps || meta.max_steps_default || 10000) + 5; // backstop only

  while (steps < cap && !last.done) {
    let out;
    try {
      out = policyMod.policy(last.obs, mem);
    } catch (e) {
      policy_error = String((e && e.message) || e);
      break;
    }
    const action = (out && out.action) || {};
    if (out && typeof out === "object" && "mem" in out) mem = out.mem;
    last = env.step(action);
    steps += 1;
    if (captureLight) {
      action_log.push(action);
      if (steps % checkpointEvery === 0) checkpoints.push({ step: steps, obs_hash: hashObs(last.obs) });
    }
    if (captureFull) full.push({ step: steps, action, obs: last.obs, event: last.event, done: last.done });
    if (last.event) events[last.event.kind] = (events[last.event.kind] || 0) + 1;
    if (onStep) onStep({ step: steps, action, obs: last.obs, event: last.event, done: last.done });
  }

  const metrics = (last.obs && last.obs.metrics) || {};
  const result = Object.assign({ seed, steps, events }, metrics);
  if (policy_error) result.policy_error = policy_error;
  if (captureLight) result._gamelog = { action_log, checkpoints, full: captureFull ? full : null };
  return result;
}

module.exports = { runEpisode, hashObs };
