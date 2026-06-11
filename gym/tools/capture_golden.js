/**
 * capture_golden.js — capture STATE-ONLY golden trajectory hashes for a task.
 *
 * Usage: node tools/capture_golden.js --task <id-or-path> [--seeds 2000,2001]
 *
 * Runs the shared scripted test policy (tests/fixtures/scripted_policy.js) and
 * prints one state-only sha1 per seed. The hash EXCLUDES obs.metrics so that
 * additive metric fields never invalidate goldens (proven design); anything
 * else that changes the hash is a real behavior change → bump meta.version and
 * re-pin deliberately.
 *
 * Golden seeds should come from the held-out range (>= 2000) so they never
 * collide with agent practice seeds.
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const { makeScriptedPolicy } = require("../tests/fixtures/scripted_policy.js");

function parseArgs(argv) {
  const a = { task: null, seeds: "2000,2001" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      a[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return a;
}

function stateOnlyHash(taskMod, seed) {
  const env = taskMod.createEnv();
  const pol = makeScriptedPolicy(taskMod);
  let mem = pol.init();
  let last = { obs: env.reset(seed, {}).obs, done: false, event: null };
  const h = crypto.createHash("sha1");
  let steps = 0;
  const cap = taskMod.meta.max_steps_default + 5;
  while (!last.done && steps < cap) {
    const out = pol.policy(last.obs, mem);
    mem = out.mem;
    last = env.step(out.action);
    steps += 1;
    const { metrics, ...stateObs } = last.obs;
    h.update(JSON.stringify({ o: stateObs, e: last.event, d: last.done }));
  }
  return { hash: h.digest("hex"), steps };
}

function resolveTaskModule(spec) {
  const fs = require("fs");
  const asPath = path.resolve(String(spec));
  if (fs.existsSync(asPath)) return require(asPath);
  return require(path.join(__dirname, "..", "tasks", "registry.js")).resolve(spec);
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  if (!a.task) {
    process.stderr.write("usage: node tools/capture_golden.js --task <id-or-path> [--seeds 2000,2001]\n");
    process.exit(1);
  }
  const mod = resolveTaskModule(a.task);
  console.log(`// golden state-only hashes for ${mod.meta.id}@${mod.meta.version}`);
  console.log("const GOLDEN = {");
  for (const s of String(a.seeds).split(",").map((x) => Number(x.trim()))) {
    const { hash, steps } = stateOnlyHash(mod, s);
    console.log(`  s${s}: "${hash}", // ${steps} steps`);
  }
  console.log("};");
}

module.exports = { stateOnlyHash };
