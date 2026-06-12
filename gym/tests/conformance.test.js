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
    // GAUNTLET_ALLOW_MISSING_TASKS is an escape hatch for INCREMENTAL TASK
    // DEVELOPMENT only: while a task is being scaffolded (registered but its
    // env.js not yet written/loadable), set it to skip that task instead of
    // failing the whole suite. It must NEVER be set in CI or for release runs —
    // a registered task that doesn't resolve is otherwise a hard failure.
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
  const config = opts.config || {};
  let last = { obs: env.reset(seed, config).obs, done: false, event: null };
  const h = crypto.createHash("sha1");
  const log = [];
  const trajectory = [];
  let steps = 0;
  const cap = (config.max_steps || mod.meta.max_steps_default) + 5;
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

/** Open-loop replay of a recorded action log; same hashing, SAME config. */
function replayLog(mod, seed, log, config = {}) {
  const env = mod.createEnv();
  env.reset(seed, config);
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

  // HEAVY tasks (meta.heavy — ported big games whose full episodes run for
  // seconds, not milliseconds): the battery runs under a tight max_steps
  // config — the SAME config on both sides of every determinism comparison,
  // so every contract property is still enforced — and the speed budget is
  // relaxed from the small-fixture bound.
  const heavy = !!mod.meta.heavy;
  const cfg = () => (heavy ? { max_steps: 3000 } : {});
  const stepBudget = heavy ? 3000 : mod.meta.max_steps_default;
  const speedBudgetMs = heavy ? 10000 : 50;
  const runS = (seed, opts = {}) => runScripted(mod, seed, { config: cfg(), ...opts });
  const replayS = (seed, log) => replayLog(mod, seed, log, cfg());

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

  test(`[${label}] obs values are strictly JSON-safe (reset, mid-episode, terminal)`, () => {
    // A stringify/parse round-trip can only catch circularity; walk the tree instead
    // and reject anything JSON would silently drop or mangle (undefined, NaN,
    // Infinity, functions, class instances, Dates, ...).
    function walk(v, p) {
      if (v === null) return;
      const t = typeof v;
      if (t === "boolean" || t === "string") return;
      if (t === "number") {
        assert(Number.isFinite(v), `${p}: non-finite number ${v}`);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${p}[${i}]`));
        return;
      }
      if (t === "object") {
        const proto = Object.getPrototypeOf(v);
        assert(proto === Object.prototype || proto === null, `${p}: non-plain object`);
        for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
        return;
      }
      assert(false, `${p}: non-JSON value of type "${t}"`);
    }
    const env = mod.createEnv();
    walk(env.reset(seed0(), {}).obs, "reset.obs");
    const { trajectory, last } = runS(seed0(), { collect: true });
    walk(trajectory[Math.floor(trajectory.length / 2)].obs, "mid.obs");
    walk(last.obs, "terminal.obs");
  });

  test(`[${label}] obs.metrics never uses reserved harness result keys`, () => {
    // The episode harness merges obs.metrics into its result envelope; these keys
    // are reserved by CONTRACT.md §3 and must not appear as task metrics.
    const RESERVED = ["seed", "steps", "events", "policy_error", "_gamelog"];
    const check = (obs, where) => {
      for (const k of RESERVED) assert(!(k in obs.metrics), `reserved key "${k}" in obs.metrics (${where})`);
    };
    const env = mod.createEnv();
    check(env.reset(seed0(), {}).obs, "reset");
    const { trajectory } = runS(seed0(), { collect: true });
    trajectory.forEach((t, i) => check(t.obs, `step ${i + 1}`));
  });

  test(`[${label}] determinism: closed-loop rerun (same instance, reseeded)`, () => {
    const a = runS(seed0());
    const b = runS(seed0(), { env: a.env }); // reuse instance; reset must fully reinit
    assertEqual(b.hash, a.hash, "same-instance rerun hash");
  });

  test(`[${label}] determinism: fresh-instance rerun`, () => {
    const a = runS(seed0());
    const b = runS(seed0());
    assertEqual(b.hash, a.hash, "fresh-instance hash");
  });

  test(`[${label}] determinism: open-loop action-log replay`, () => {
    const a = runS(seed0());
    const b = replayS(seed0(), a.log);
    assertEqual(b.hash, a.hash, "open-loop replay hash");
    assertEqual(b.steps, a.steps, "open-loop replay steps");
  });

  test(`[${label}] determinism: cross-instance isolation (interleaved envs don't interact)`, () => {
    // Two envs in one process, different seeds, steps interleaved: each trajectory
    // must hash identically to replaying its (seed, action log) alone. Any
    // module-level mutable state in the env makes the interleaved run diverge.
    const sA = seed0();
    const sB = sA + 1;
    const envA = mod.createEnv();
    const envB = mod.createEnv();
    const polA = makeScriptedPolicy(mod);
    const polB = makeScriptedPolicy(mod);
    let memA = polA.init();
    let memB = polB.init();
    let lastA = { obs: envA.reset(sA, cfg()).obs, done: false, event: null };
    let lastB = { obs: envB.reset(sB, cfg()).obs, done: false, event: null };
    const hA = crypto.createHash("sha1");
    const hB = crypto.createHash("sha1");
    const logA = [];
    const logB = [];
    const cap = stepBudget + 5;
    for (let i = 0; (!lastA.done || !lastB.done) && i < cap; i += 1) {
      if (!lastA.done) {
        const out = polA.policy(lastA.obs, memA);
        memA = out.mem;
        logA.push(out.action);
        lastA = envA.step(out.action);
        hA.update(JSON.stringify({ o: lastA.obs, e: lastA.event, d: lastA.done }));
      }
      if (!lastB.done) {
        const out = polB.policy(lastB.obs, memB);
        memB = out.mem;
        logB.push(out.action);
        lastB = envB.step(out.action);
        hB.update(JSON.stringify({ o: lastB.obs, e: lastB.event, d: lastB.done }));
      }
    }
    assertEqual(hA.digest("hex"), replayS(sA, logA).hash, "interleaved env A == solo (seed, action log) replay");
    assertEqual(hB.digest("hex"), replayS(sB, logB).hash, "interleaved env B == solo (seed, action log) replay");
  });

  test(`[${label}] determinism: different seeds produce different trajectories`, () => {
    const s = seed0();
    const a = runS(s);
    const b = runS(s + 1);
    const c = runS(2000);
    assert(a.hash !== b.hash, `seeds ${s} vs ${s + 1} identical`);
    assert(a.hash !== c.hash, `seeds ${s} vs 2000 identical`);
  });

  test(`[${label}] progress is monotonic and in [0,1]`, () => {
    const { trajectory } = runS(seed0(), { collect: true });
    let prev = 0;
    for (const t of trajectory) {
      const p = t.obs.metrics.progress;
      assert(p >= 0 && p <= 1, `progress ${p} out of range`);
      assert(p >= prev - 1e-12, `progress decreased: ${prev} -> ${p}`);
      prev = p;
    }
  });

  test(`[${label}] terminates within the step budget (scripted + noop policies)`, () => {
    const a = runS(seed0());
    assert(a.last.done === true, `scripted episode not done after ${a.steps} steps`);
    assert(a.steps <= stepBudget, `scripted took ${a.steps} > ${stepBudget}`);
    assert(a.last.obs.metrics.done_reason, "done_reason set at end");

    const env = mod.createEnv();
    let last = { obs: env.reset(seed0(), cfg()).obs, done: false };
    let steps = 0;
    while (!last.done && steps < stepBudget + 5) {
      last = env.step({});
      steps += 1;
    }
    assert(last.done === true, `noop episode not done after ${steps} steps`);
    assert(steps <= stepBudget, `noop took ${steps} > ${stepBudget}`);
  });

  test(`[${label}] episode ends with a game_over event matching done_reason`, () => {
    const { trajectory } = runS(seed0(), { collect: true });
    const lastStep = trajectory[trajectory.length - 1];
    assert(lastStep.done, "last collected step is done");
    assert(lastStep.event && lastStep.event.kind === "game_over", "final event is game_over");
    assertEqual(lastStep.event.reason, lastStep.obs.metrics.done_reason, "event.reason == metrics.done_reason");
  });

  test(`[${label}] terminal step is idempotent and returns fresh, unaliased obs`, () => {
    const a = runS(seed0());
    const env = a.env;
    const h0 = crypto.createHash("sha1").update(JSON.stringify(a.last.obs)).digest("hex");
    for (let i = 0; i < 3; i += 1) {
      const r = env.step({ add: 2, anything: i });
      assert(r.done === true, "done stays true after terminal");
      const h = crypto.createHash("sha1").update(JSON.stringify(r.obs)).digest("hex");
      assertEqual(h, h0, "terminal obs stable");
      // Mutate the returned obs: the NEXT terminal step must be unaffected
      // (post-done steps must return fresh copies, never an aliased cache).
      r.obs.metrics.score = -999999;
      r.obs.__mutated_by_test = true;
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
    const { trajectory } = runS(seed0(), { collect: true });
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

  test(`[${label}] obs freshness: earlier obs (reset AND mid-episode) not mutated by later steps`, () => {
    const env = mod.createEnv();
    let last = { obs: env.reset(seed0(), {}).obs };
    const resetSnapshot = JSON.stringify(last.obs);
    const resetKept = last.obs;
    for (let i = 0; i < 3; i += 1) last = env.step(mod.meta.example_actions[i % mod.meta.example_actions.length]);
    const midSnapshot = JSON.stringify(last.obs);
    const midKept = last.obs;
    for (let i = 3; i < 8; i += 1) env.step(mod.meta.example_actions[i % mod.meta.example_actions.length]);
    assertEqual(JSON.stringify(resetKept), resetSnapshot, "reset obs changed by later steps");
    assertEqual(JSON.stringify(midKept), midSnapshot, "mid-episode obs changed by later steps");
  });

  test(`[${label}] speed: a full noop episode fits the budget (<${heavy ? "10s (heavy)" : "50ms"})`, () => {
    const env = mod.createEnv();
    const t0 = Date.now();
    let last = { obs: env.reset(seed0(), {}).obs, done: false };
    let steps = 0;
    while (!last.done && steps < mod.meta.max_steps_default + 5) {
      last = env.step({});
      steps += 1;
    }
    const ms = Date.now() - t0;
    assert(ms < speedBudgetMs, `noop episode took ${ms}ms (budget ${speedBudgetMs}ms)`);
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
