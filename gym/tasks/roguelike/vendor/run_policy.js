/**
 * run_policy.js — run YOUR policy and print metrics. Episodes play until you win, die, or
 * reach the step budget (default 90k, extendable via --max_steps).
 *
 * Usage:
 *   node run_policy.js                       # ./policy.js on seed 1 (the default)
 *   node run_policy.js --seeds 1,2,3         # play these seeds (you choose how many)
 *   node run_policy.js --policy ./policy.js  # explicit policy file
 *   node run_policy.js --speed_cap 40 --frame_skip 1   # speed_cap default is 40 px/tick; "inf"=uncapped
 *   node run_policy.js --max_steps 8000      # OPTIONAL: cap a run for fast iteration
 *   node run_policy.js --log light|full|none # per-game log level (default: light)
 *   node run_policy.js --trace trace.jsonl   # (debug) dump a per-step JSONL trace inline
 *   node run_policy.js --json                # machine-readable output only
 *
 * PER-GAME LOGS: every game you play is auto-saved (default `light`) to game_logs/ —
 * a small, fully replayable record { seed, config, action_log, checkpoints, game_version }.
 * Kept in memory and written once at the end (no per-step I/O). `--log full` also embeds the
 * per-step trace; `--log none` disables it. Regenerate a full trace from a light log with
 * `node expand_trace.js game_logs/<file>`. Filenames are conflict-safe (seed + run token).
 *
 * Your policy.js must export { init?(), policy(obs, mem) -> { action, mem } }.
 * See INTERFACE.md §6 for the contract and GAME_DESCRIPTION.md for the goal.
 *
 * SEEDS: by default you play one seed (1). You may choose to practise on more
 * (--seeds 1,2,3) — your call; you don't have to. Your final policy is also checked on
 * a separate, held-out set of seeds you don't see, so prefer robust play over fitting
 * one seed. Default step budget is 90k (the game ends on win/death, or at the budget); pass a
 * LARGER --max_steps to extend (a slow grind may need it), or a smaller one to cut runs short.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { RogueEnv } = require("./env.bundle.js");

// Default seed when you don't pass --seeds (you choose to add more if you want).
const DEFAULT_SEEDS = [1];
// Other seeds available to practise on if you choose (held-out seeds are NOT here).
const TRAINING_SEEDS = [11, 23, 42, 57, 88, 101, 137, 199, 256, 314, 451, 512];

function runEpisode(env, policyMod, seed, config, opts = {}) {
  const onStep = typeof opts === "function" ? opts : opts.onStep; // back-compat
  const captureLight = !!(opts && opts.captureLight);
  const captureFull = !!(opts && opts.captureFull);
  let mem = typeof policyMod.init === "function" ? policyMod.init() : {};
  let { obs } = env.reset(seed, config);
  const field = obs.field;
  const events = {};
  const action_log = [];   // LIGHT: kept in memory, dumped once at the end (no per-step I/O)
  const checkpoints = [];  // periodic obs hashes to verify a replay reproduces the game
  const full = [];         // FULL: per-step obs/reward (big) — only when captureFull
  let steps = 0;
  let last = { obs, reward_info: obs.reward_info, event: null, done: false };
  const cap = (config.max_steps || 90000) + 5; // step-budget backstop; games end on win/death/budget
  while (steps < cap) {
    let out;
    try {
      out = policyMod.policy(last.obs, mem);
    } catch (e) {
      return Object.assign({ seed, steps, policy_error: String((e && e.message) || e) }, last.reward_info);
    }
    const action = (out && out.action) || { move: [0, 0], upgrade_choice: 0 };
    mem = out && "mem" in out ? out.mem : mem;
    last = env.step(action);
    steps += 1;
    if (captureLight) {
      action_log.push(action);
      if (steps % 600 === 0) checkpoints.push({ step: steps, obs_hash: hashObs(last.obs) });
    }
    if (captureFull) full.push({ step: steps, action, obs: last.obs, reward_info: last.reward_info, event: last.event, done: last.done });
    if (last.event) events[last.event.kind] = (events[last.event.kind] || 0) + 1;
    if (onStep) onStep({ step: steps, action, obs: last.obs, reward_info: last.reward_info, event: last.event, done: last.done });
    if (last.done) break;
  }
  const result = Object.assign({ seed, steps, events }, last.reward_info);
  if (captureLight) result._gamelog = { field, action_log, checkpoints, full: captureFull ? full : null };
  return result;
}

function hashObs(obs) {
  return crypto.createHash("sha1").update(JSON.stringify(obs)).digest("hex").slice(0, 12);
}

/** sha1 of the env bundle — the "game version" that a light log replays against. */
function bundleVersion() {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(path.join(__dirname, "env.bundle.js"))).digest("hex").slice(0, 12);
  } catch (e) { return "unknown"; }
}

/**
 * Write one game's log. LIGHT = {seed, config, action_log, checkpoints, version} —
 * small and fully replayable (re-run action_log on seed to regenerate everything;
 * see expand_trace.js). FULL also embeds the per-step trace. Conflict-safe filename:
 * seed + a per-process run token + a per-game index, so concurrent/repeat runs never
 * clobber each other.
 */
function writeGameLog(result, config, gameVersion, level, dir, runToken, idx) {
  const gl = result._gamelog;
  if (!gl) return null;
  const out = {
    format: "rogue_game_trace_v1",
    level,
    game_version: gameVersion,
    seed: result.seed,
    config: {
      speed_cap: config.speed_cap === Infinity ? "inf" : config.speed_cap,
      frame_skip: config.frame_skip,
      max_steps: config.max_steps,
      character_id: config.character_id,
      field: gl.field,
    },
    reward_info: {
      progress: result.progress, score: result.score, wave: result.wave, level: result.level,
      kills: result.kills, boss_reached: result.boss_reached, boss_cleared: result.boss_cleared,
      survived_ms: result.survived_ms, done_reason: result.done_reason,
    },
    checkpoints: gl.checkpoints,
    action_log: gl.action_log,
  };
  if (level === "full" && gl.full) out.full = gl.full;
  fs.mkdirSync(dir, { recursive: true });
  const fname = `game_s${result.seed}_${runToken}_${String(idx).padStart(3, "0")}.json`;
  const full = path.join(dir, fname);
  fs.writeFileSync(full, JSON.stringify(out));
  return full;
}

function aggregate(results) {
  const fields = ["progress", "score", "survived_ms", "kills", "level", "wave"];
  const agg = { n: results.length };
  for (const f of fields) {
    const v = results.map((r) => Number(r[f]) || 0).sort((a, b) => a - b);
    const sum = v.reduce((a, b) => a + b, 0);
    agg[f] = { mean: round2(sum / v.length), median: v[Math.floor((v.length - 1) / 2)], min: v[0], max: v[v.length - 1] };
  }
  const rate = (p) => round2(results.filter(p).length / Math.max(1, results.length));
  agg.boss_reached_rate = rate((r) => r.boss_reached);
  agg.boss_cleared_rate = rate((r) => r.boss_cleared);
  agg.death_rate = rate((r) => r.done_reason === "death");
  agg.timeout_rate = rate((r) => r.done_reason === "timeout");
  return agg;
}

function round2(v) { return Math.round(v * 100) / 100; }

function parseSeeds(spec) {
  if (!spec) return DEFAULT_SEEDS.slice();
  const out = [];
  for (const part of String(spec).split(",")) {
    const m = part.match(/^(-?\d+)\.\.(-?\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i += 1) out.push(i); }
    else if (part.trim() !== "") out.push(Number(part));
  }
  return out;
}

function parseArgs(argv) {
  const a = { policy: "./policy.js", seeds: "", speed_cap: "40", frame_skip: "1", max_steps: "0", character: "striker", trace: null, json: false, log: "light", "log-dir": "game_logs" };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--json") { a.json = true; continue; }
    if (k === "--help" || k === "-h") { a.help = true; continue; }
    if (k.startsWith("--")) { a[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return a;
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  if (a.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*+/, "").trim());
    process.exit(0);
  }
  const config = {
    speed_cap: a.speed_cap === "inf" ? Infinity : Number(a.speed_cap),
    frame_skip: parseInt(a.frame_skip, 10) || 1,
    max_steps: parseInt(a.max_steps, 10) || 90000, // default budget 90k; --max_steps N to extend/cut short
    character_id: a.character,
  };
  const seeds = parseSeeds(a.seeds);
  const policyMod = require(path.resolve(a.policy));

  let traceStream = null;
  let onStep = null;
  if (a.trace) {
    traceStream = fs.createWriteStream(a.trace, { flags: "w" });
    onStep = (rec) => traceStream.write(JSON.stringify(rec) + "\n");
  }

  // Per-game logging: none | light (default) | full. Light is small + replayable.
  const logLevel = String(a.log || "light").toLowerCase();
  const captureLight = logLevel !== "none";
  const captureFull = logLevel === "full";
  const logDir = a["log-dir"] || "game_logs";
  const gameVersion = bundleVersion();
  // conflict-safe per-process token: ms-time (base36) + pid. Different invocations →
  // different tokens; multiple games within one invocation → distinct index.
  const runToken = Date.now().toString(36) + "-" + process.pid;

  const env = new RogueEnv();
  const results = seeds.map((s) => runEpisode(env, policyMod, s, config, { onStep, captureLight, captureFull }));
  if (traceStream) traceStream.end();

  const savedLogs = [];
  if (captureLight) {
    results.forEach((r, i) => {
      const p = writeGameLog(r, config, gameVersion, logLevel, logDir, runToken, i);
      if (p) savedLogs.push(p);
      delete r._gamelog; // keep it out of the printed JSON
    });
  }
  const agg = aggregate(results);

  if (a.json) {
    process.stdout.write(JSON.stringify({ config: { ...config, speed_cap: a.speed_cap }, seeds, results, aggregate: agg, log_level: logLevel, game_logs: savedLogs }) + "\n");
  } else {
    console.log(`policy=${a.policy}  seeds=${seeds.length}  speed_cap=${a.speed_cap}  frame_skip=${config.frame_skip}  log=${logLevel}`);
    for (const r of results) {
      console.log(
        `  seed ${String(r.seed).padStart(4)}: progress ${String(Math.round((r.progress || 0) * 100) + "%").padStart(4)}  ` +
        `boss-HP-destroyed ${Math.round((r.boss_hp_destroyed || 0) * 100)}%  score ${String(r.score).padStart(8)}  survived ${Math.round(r.survived_ms / 1000)}s  ` +
        `kills ${r.kills}  lvl ${r.level}  wave ${r.wave}  ${r.boss_cleared ? "BOSS-CLEARED" : r.boss_reached ? "boss-reached" : ""}  (${r.done_reason})` +
        (r.policy_error ? `  ERROR:${r.policy_error}` : "")
      );
    }
    console.log("  --- aggregate ---");
    console.log(`  progress mean ${Math.round(agg.progress.mean * 100)}%  best ${Math.round(agg.progress.max * 100)}%   (1.0 = game cleared / 通关)`);
    console.log(`  score   mean ${agg.score.mean}  median ${agg.score.median}  min ${agg.score.min}  max ${agg.score.max}`);
    console.log(`  survived(ms) mean ${agg.survived_ms.mean}   kills mean ${agg.kills.mean}   level mean ${agg.level.mean}   wave mean ${agg.wave.mean}`);
    console.log(`  boss_reached ${agg.boss_reached_rate}  boss_cleared ${agg.boss_cleared_rate}  death ${agg.death_rate}  timeout ${agg.timeout_rate}`);
    if (savedLogs.length) console.log(`  saved ${savedLogs.length} replayable game log(s) -> ${logDir}/ (level=${logLevel}; expand with: node expand_trace.js <file>)`);
  }
}

module.exports = { runEpisode, aggregate, TRAINING_SEEDS };
