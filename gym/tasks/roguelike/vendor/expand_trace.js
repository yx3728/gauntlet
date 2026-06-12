/**
 * expand_trace.js — regenerate the FULL per-step trace from a LIGHT game log.
 *
 * A light log { seed, config, action_log } plus the deterministic env reproduces the
 * entire game exactly. This replays it and emits the full per-step trace (obs, reward,
 * event, done), and verifies the replay against the light log's checkpoints.
 *
 * Usage:
 *   node expand_trace.js game_logs/game_s1_xxx.json            # prints summary + verify
 *   node expand_trace.js game_logs/game_s1_xxx.json out.jsonl  # also write per-step JSONL
 */
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const { RogueEnv } = require("./env.bundle.js");

function hashObs(obs) {
  return crypto.createHash("sha1").update(JSON.stringify(obs)).digest("hex").slice(0, 12);
}

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath) {
    console.log("usage: node expand_trace.js <light_log.json> [out.jsonl]");
    process.exit(1);
  }
  const log = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const cfg = log.config || {};
  const field = cfg.field || { w: 360, h: 640 };
  // Reconstruct the env at the same field size the log recorded.
  const env = new RogueEnv({ windowWidth: field.w, windowHeight: field.h });
  if (env.W !== field.w || env.H !== field.h) {
    console.error(`WARN: env field ${env.W}x${env.H} != log field ${field.w}x${field.h} (run in a fresh process for an exact match).`);
  }
  const config = {
    speed_cap: cfg.speed_cap === "inf" ? Infinity : Number(cfg.speed_cap),
    frame_skip: cfg.frame_skip || 1,
    max_steps: cfg.max_steps || 200000,
    character_id: cfg.character_id || "striker",
  };

  let { obs } = env.reset(log.seed, config);
  const lines = outPath ? [] : null; // accumulate then write synchronously (no flush race)
  const checkpoints = {};
  for (const c of log.checkpoints || []) checkpoints[c.step] = c.obs_hash;
  let step = 0;
  let mismatches = 0;
  let last = { obs, reward_info: obs.reward_info, event: null, done: false };
  for (const action of log.action_log) {
    last = env.step(action);
    step += 1;
    if (lines) lines.push(JSON.stringify({ step, action, obs: last.obs, reward_info: last.reward_info, event: last.event, done: last.done }));
    if (checkpoints[step] && hashObs(last.obs) !== checkpoints[step]) mismatches += 1;
    if (last.done) break;
  }
  if (lines) fs.writeFileSync(outPath, lines.join("\n") + "\n");

  const ri = last.reward_info;
  const verified = mismatches === 0 ? "✓ checkpoints match" : `✗ ${mismatches} checkpoint mismatch(es)`;
  console.log(`expanded ${step} steps from ${inPath}  [${verified}]`);
  console.log(`  game_version ${log.game_version} | seed ${log.seed} | progress ${ri.progress} | cleared ${ri.boss_cleared} | reason ${ri.done_reason}`);
  if (outPath) console.log(`  full per-step trace -> ${outPath}`);
  process.exit(mismatches === 0 ? 0 : 2);
}

main();
