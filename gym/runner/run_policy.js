/**
 * run_policy.js — run a policy against a task and print metrics.
 *
 * Usage:
 *   node run_policy.js                          # ./policy.js on the default training seed
 *   node run_policy.js --seeds 1,2,5..9         # play these seeds (you choose how many)
 *   node run_policy.js --policy ./policy.js     # explicit policy file
 *   node run_policy.js --max_steps 200          # OPTIONAL: cap a run for fast iteration
 *   node run_policy.js --config '{"k":"v"}'     # task-specific config passthrough (JSON)
 *   node run_policy.js --log light|full|none    # per-game log level (default: light)
 *   node run_policy.js --trace trace.jsonl      # (debug) per-step JSONL trace
 *   node run_policy.js --json                   # machine-readable output only
 *   node run_policy.js --task <id-or-path>      # which task (default: ./task.bundle.js)
 *
 * Your policy.js must export { init?(), policy(obs, mem) -> { action, mem } }.
 * See INTERFACE.md for the contract and DESCRIPTION.md for the goal.
 *
 * SEEDS: by default you play the first training seed. You may practise on any of the
 * training seeds listed in INTERFACE.md — your call. Your final policy is also checked
 * on a separate, HELD-OUT set of seeds you don't see, so prefer robust play over
 * fitting one seed.
 *
 * PER-GAME LOGS: every game is auto-saved (default `light`) to game_logs/ — a small,
 * fully replayable record { seed, config, action_log, checkpoints, task version }.
 * Kept in memory and written once at the end. `--log none` disables it.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { runEpisode } = require("../core/episode.js");
const { aggregate } = require("../core/aggregate.js");

/** Resolve a task module from a path (bundle or env.js) or a registry id. */
function resolveTask(spec) {
  if (!spec) {
    const local = path.resolve("./task.bundle.js");
    if (fs.existsSync(local)) spec = local;
    else fail("no --task given and ./task.bundle.js not found in the current directory");
  }
  const asPath = path.resolve(String(spec));
  if (fs.existsSync(asPath)) {
    return { mod: require(asPath), entry: asPath };
  }
  // Registry lookup (repo mode only; the registry is never shipped into arenas).
  // Dynamic require so arena bundles neither include the registry nor any task source.
  let registry;
  try {
    registry = require(path.join(__dirname, "..", "tasks", "registry.js"));
  } catch (e) {
    fail(`task "${spec}" is not a file, and no task registry is available here`);
  }
  const entry = registry.entryPath(spec);
  return { mod: require(entry), entry };
}

function fail(msg) {
  process.stderr.write(`run_policy: ${msg}\n`);
  process.exit(1);
}

function fileSha1(p) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex").slice(0, 12);
  } catch (e) {
    return "unknown";
  }
}

function parseSeeds(spec, fallback) {
  if (!spec) return fallback.slice();
  const out = [];
  for (const part of String(spec).split(",")) {
    const m = part.match(/^(-?\d+)\.\.(-?\d+)$/);
    if (m) {
      for (let i = +m[1]; i <= +m[2]; i += 1) out.push(i);
    } else if (part.trim() !== "") {
      out.push(Number(part));
    }
  }
  return out;
}

function parseArgs(argv) {
  const a = { task: null, policy: "./policy.js", seeds: "", max_steps: "0", config: null, trace: null, json: false, log: "light", "log-dir": "game_logs" };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--json") { a.json = true; continue; }
    if (k === "--help" || k === "-h") { a.help = true; continue; }
    if (k.startsWith("--")) { a[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return a;
}

/** Write one game's replayable log; conflict-safe filename (run token + index). */
function writeGameLog(result, taskInfo, config, level, dir, runToken, idx) {
  const gl = result._gamelog;
  if (!gl) return null;
  const out = {
    format: "gauntlet_game_log_v1",
    level,
    task: taskInfo,
    seed: result.seed,
    config,
    metrics: Object.fromEntries(Object.entries(result).filter(([k]) => !["events", "_gamelog"].includes(k))),
    checkpoints: gl.checkpoints,
    action_log: gl.action_log,
  };
  if (level === "full" && gl.full) out.full = gl.full;
  fs.mkdirSync(dir, { recursive: true });
  const fname = `game_${taskInfo.id}_s${result.seed}_${runToken}_${String(idx).padStart(3, "0")}.json`;
  const full = path.join(dir, fname);
  fs.writeFileSync(full, JSON.stringify(out));
  return full;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*+/, "").trim());
    process.exit(0);
  }

  const { mod: taskMod, entry } = resolveTask(a.task);
  if (!taskMod || !taskMod.meta || typeof taskMod.createEnv !== "function") {
    fail(`task module at ${entry} does not export { meta, createEnv }`);
  }
  const meta = taskMod.meta;
  const taskInfo = { id: meta.id, version: meta.version, bundle_sha: fileSha1(entry) };

  let config = {};
  if (a.config) {
    try {
      config = JSON.parse(a.config);
    } catch (e) {
      fail(`--config is not valid JSON: ${e.message}`);
    }
  }
  const maxSteps = parseInt(a.max_steps, 10) || 0;
  if (maxSteps > 0) config.max_steps = maxSteps;

  const defaultSeeds = (meta.training_seeds && meta.training_seeds.length) ? [meta.training_seeds[0]] : [1];
  const seeds = parseSeeds(a.seeds, defaultSeeds);
  const policyPath = path.resolve(a.policy);
  if (!fs.existsSync(policyPath)) fail(`policy file not found: ${policyPath}`);
  const policyMod = require(policyPath);

  let traceStream = null;
  let onStep = null;
  if (a.trace) {
    traceStream = fs.createWriteStream(a.trace, { flags: "w" });
    onStep = (rec) => traceStream.write(JSON.stringify(rec) + "\n");
  }

  const logLevel = String(a.log || "light").toLowerCase();
  const captureLight = logLevel !== "none";
  const captureFull = logLevel === "full";
  const logDir = a["log-dir"] || "game_logs";
  const runToken = Date.now().toString(36) + "-" + process.pid;

  const results = seeds.map((s) => runEpisode(taskMod, policyMod, s, { ...config }, { onStep, captureLight, captureFull }));
  if (traceStream) traceStream.end();

  const savedLogs = [];
  if (captureLight) {
    results.forEach((r, i) => {
      const p = writeGameLog(r, taskInfo, config, logLevel, logDir, runToken, i);
      if (p) savedLogs.push(p);
      delete r._gamelog; // keep it out of the printed JSON
    });
  }
  const agg = aggregate(results);

  if (a.json) {
    process.stdout.write(JSON.stringify({ task: taskInfo, config, seeds, results, aggregate: agg, log_level: logLevel, game_logs: savedLogs }) + "\n");
    return;
  }

  console.log(`task=${taskInfo.id}@${taskInfo.version}  policy=${a.policy}  seeds=${seeds.length}  log=${logLevel}`);
  for (const r of results) {
    console.log(
      `  seed ${String(r.seed).padStart(5)}: progress ${String(Math.round((r.progress || 0) * 100) + "%").padStart(4)}  ` +
      `score ${String(r.score).padStart(8)}  steps ${String(r.steps).padStart(6)}  (${r.done_reason || "?"})` +
      (r.policy_error ? `  ERROR:${r.policy_error}` : "")
    );
  }
  console.log("  --- aggregate ---");
  console.log(`  progress mean ${Math.round((agg.progress?.mean || 0) * 100)}%  best ${Math.round((agg.progress?.max || 0) * 100)}%   (1.0 = task cleared)`);
  console.log(`  score    mean ${agg.score?.mean}  median ${agg.score?.median}  min ${agg.score?.min}  max ${agg.score?.max}`);
  console.log(`  done_reasons ${JSON.stringify(agg.done_reason_rates)}  policy_errors ${agg.policy_error_rate}`);
  if (savedLogs.length) console.log(`  saved ${savedLogs.length} replayable game log(s) -> ${logDir}/`);
}

if (require.main === module) main();

module.exports = { parseSeeds, resolveTask };
