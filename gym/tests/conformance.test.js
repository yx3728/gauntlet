/**
 * conformance.test.js — the mechanical enforcement of core/CONTRACT.md,
 * parameterized over every registered task (plus the minitask fixture).
 *
 * The determinism battery is the proven three-way design: closed-loop rerun,
 * fresh-instance rerun, and open-loop action-log replay, all compared by
 * trajectory hash; plus different-seeds-differ.
 */

"use strict";

const crypto = require("crypto");
const { test, assert, assertEqual } = require("./harness.js");
const { makeScriptedPolicy } = require("./fixtures/scripted_policy.js");
const registry = require("../tasks/registry.js");

const TASK_MODS = [{ label: "minitask", mod: require("./fixtures/minitask/env.js") }];
for (const id of registry.list()) {
  try {
    TASK_MODS.push({ label: id, mod: registry.resolve(id) });
  } catch (e) {
    if (process.env.GAUNTLET_ALLOW_MISSING_TASKS) {
      console.log(`  (conformance: skipping unavailable task "${id}": ${e.message})`);
    } else {
      test(`[${id}] task is resolvable`, () => {
        throw e;
      });
    }
  }
}

/** Run the shared scripted policy closed-loop; return trajectory hash + action log. */
function runScripted(mod, seed, opts = {}) {
  const env = opts.env || mod.createEnv();
  const pol = makeScriptedPolicy(mod);
  let mem = pol.init();
  let last = { obs: env.reset(seed, opts.config || {}).obs, done: false, event: null };
  const h = crypto.createHash("sha1");
  const log = [];
  const trajectory = [];
  let steps = 0;
  const cap = mod.meta.max_steps_default + 5;
  while (!last.done && steps < cap) {
    const out = pol.policy(last.obs, mem);
    mem = out.mem;
    log.push(out.action);
    last = env.step(out.action);
    steps += 1;
    h.update(JSON.stringify({ o: last.obs, e: last.event, d: last.done }));
    if (opts.collect) trajectory.push(last);
  }
  return { hash: h.digest("hex"), log, steps, last, trajectory, env };
}

/** Open-loop replay of a recorded action log; same hashing. */
function replayLog(mod, seed, log) {
  const env = mod.createEnv();
  env.reset(seed, {});
  const h = crypto.createHash("sha1");
  let steps = 0;
  for (const action of log) {
    const last = env.step(action);
    steps += 1;
    h.update(JSON.stringify({ o: last.obs, e: last.event, d: last.done }));
    if (last.done) break;
  }
  return { hash: h.digest("hex"), steps };
}

for (const { label, mod } of TASK_MODS) {
  const seed0 = () => mod.meta.training_seeds[0];

  test(`[${label}] meta shape`, () => {
    const m = mod.meta;
    assert(typeof m.id === "string" && m.id.length, "meta.id");
    assert(typeof m.name === "string" && m.name.length, "meta.name");
    assert(/^\d+\.\d+\.\d+$/.test(m.version), `meta.version semver, got ${m.version}`);
    assert(Number.isInteger(m.max_steps_default) && m.max_steps_default > 0, "meta.max_steps_default");
    assert(Array.isArray(m.training_seeds) && m.training_seeds.length >= 1, "meta.training_seeds");
    assert(Array.isArray(m.example_actions) && m.example_actions.length >= 3, "meta.example_actions (>=3)");
    assert(typeof mod.createEnv === "function", "createEnv");
  });

  test(`[${label}] reset shape + metrics envelope`, () => {
    const env = mod.createEnv();
    const r = env.reset(seed0(), {});
    assert(r && typeof r.obs === "object" && r.obs !== null, "reset returns { obs }");
    const m = r.obs.metrics;
    assert(m && typeof m === "object", "obs.metrics present");
    assert(typeof m.score === "number" && Number.isFinite(m.score), "metrics.score number");
    assert(typeof m.progress === "number" && m.progress >= 0 && m.progress <= 1, "metrics.progress in [0,1]");
    assert(m.done_reason === null, "metrics.done_reason null at reset");
  });

  test(`[${label}] obs is JSON-serializable and stable through round-trip`, () => {
    const { last } = runScripted(mod, seed0());
    const s1 = JSON.stringify(last.obs);
    const s2 = JSON.stringify(JSON.parse(s1));
    assertEqual(s2, s1, "obs JSON round-trip");
  });

  test(`[${label}] determinism: closed-loop rerun (same instance, reseeded)`, () => {
    const a = runScripted(mod, seed0());
    const b = runScripted(mod, seed0(), { env: a.env }); // reuse instance; reset must fully reinit
    assertEqual(b.hash, a.hash, "same-instance rerun hash");
  });

  test(`[${label}] determinism: fresh-instance rerun`, () => {
    const a = runScripted(mod, seed0());
    const b = runScripted(mod, seed0());
    assertEqual(b.hash, a.hash, "fresh-instance hash");
  });

  test(`[${label}] determinism: open-loop action-log replay`, () => {
    const a = runScripted(mod, seed0());
    const b = replayLog(mod, seed0(), a.log);
    assertEqual(b.hash, a.hash, "open-loop replay hash");
    assertEqual(b.steps, a.steps, "open-loop replay steps");
  });

  test(`[${label}] determinism: different seeds produce different trajectories`, () => {
    const s = seed0();
    const a = runScripted(mod, s);
    const b = runScripted(mod, s + 1);
    const c = runScripted(mod, 2000);
    assert(a.hash !== b.hash, `seeds ${s} vs ${s + 1} identical`);
    assert(a.hash !== c.hash, `seeds ${s} vs 2000 identical`);
  });

  test(`[${label}] progress is monotonic and in [0,1]`, () => {
    const { trajectory } = runScripted(mod, seed0(), { collect: true });
    let prev = 0;
    for (const t of trajectory) {
      const p = t.obs.metrics.progress;
      assert(p >= 0 && p <= 1, `progress ${p} out of range`);
      assert(p >= prev - 1e-12, `progress decreased: ${prev} -> ${p}`);
      prev = p;
    }
  });

  test(`[${label}] terminates within max_steps_default (scripted + noop policies)`, () => {
    const a = runScripted(mod, seed0());
    assert(a.last.done === true, `scripted episode not done after ${a.steps} steps`);
    assert(a.steps <= mod.meta.max_steps_default, `scripted took ${a.steps} > max_steps_default`);
    assert(a.last.obs.metrics.done_reason, "done_reason set at end");

    const env = mod.createEnv();
    let last = { obs: env.reset(seed0(), {}).obs, done: false };
    let steps = 0;
    while (!last.done && steps < mod.meta.max_steps_default + 5) {
      last = env.step({});
      steps += 1;
    }
    assert(last.done === true, `noop episode not done after ${steps} steps`);
    assert(steps <= mod.meta.max_steps_default, `noop took ${steps} > max_steps_default`);
  });

  test(`[${label}] episode ends with a game_over event matching done_reason`, () => {
    const { trajectory } = runScripted(mod, seed0(), { collect: true });
    const lastStep = trajectory[trajectory.length - 1];
    assert(lastStep.done, "last collected step is done");
    assert(lastStep.event && lastStep.event.kind === "game_over", "final event is game_over");
    assertEqual(lastStep.event.reason, lastStep.obs.metrics.done_reason, "event.reason == metrics.done_reason");
  });

  test(`[${label}] terminal step is idempotent`, () => {
    const a = runScripted(mod, seed0());
    const env = a.env;
    const h0 = crypto.createHash("sha1").update(JSON.stringify(a.last.obs)).digest("hex");
    for (let i = 0; i < 3; i += 1) {
      const r = env.step({ add: 2, anything: i });
      assert(r.done === true, "done stays true after terminal");
      const h = crypto.createHash("sha1").update(JSON.stringify(r.obs)).digest("hex");
      assertEqual(h, h0, "terminal obs stable");
    }
  });

  test(`[${label}] malformed actions never throw (sanitize rule)`, () => {
    const env = mod.createEnv();
    env.reset(seed0(), {});
    for (const bad of [null, undefined, 42, "x", [], { choice: -1 }, { huge: "x".repeat(5000) }, { move: { evil: true } }]) {
      const r = env.step(bad);
      assert(r && typeof r.obs === "object", "step returned obs on malformed action");
    }
  });

  test(`[${label}] pending_decision (when present) has well-formed options`, () => {
    const { trajectory } = runScripted(mod, seed0(), { collect: true });
    let seen = 0;
    for (const t of trajectory) {
      const pd = t.obs.pending_decision;
      if (pd) {
        seen += 1;
        assert(Array.isArray(pd.options) && pd.options.length >= 1, "pending_decision.options");
      }
    }
    // Not all tasks must use pending decisions; shape is checked only when present.
    void seen;
  });

  test(`[${label}] obs freshness: earlier obs not mutated by later steps`, () => {
    const env = mod.createEnv();
    let last = { obs: env.reset(seed0(), {}).obs };
    const snapshot = JSON.stringify(last.obs);
    const kept = last.obs;
    for (let i = 0; i < 5; i += 1) env.step(mod.meta.example_actions[i % mod.meta.example_actions.length]);
    assertEqual(JSON.stringify(kept), snapshot, "previously returned obs changed");
  });

  test(`[${label}] speed: a full noop episode runs in <100ms`, () => {
    const env = mod.createEnv();
    const t0 = Date.now();
    let last = { obs: env.reset(seed0(), {}).obs, done: false };
    let steps = 0;
    while (!last.done && steps < mod.meta.max_steps_default + 5) {
      last = env.step({});
      steps += 1;
    }
    const ms = Date.now() - t0;
    assert(ms < 100, `noop episode took ${ms}ms`);
  });

  test(`[${label}] config.max_steps caps the episode`, () => {
    const env = mod.createEnv();
    let last = { obs: env.reset(seed0(), { max_steps: 3 }).obs, done: false };
    let steps = 0;
    while (!last.done && steps < 10) {
      last = env.step({});
      steps += 1;
    }
    assert(last.done === true && steps <= 3, `max_steps=3 not honored (done=${last.done} steps=${steps})`);
  });
}
