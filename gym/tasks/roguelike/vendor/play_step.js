/**
 * play_step.js — stateless step client for the DIRECT-PLAY path.
 *
 * Because the sim is deterministic, there is no persistent game server: a session
 * is just a seed + an append-only action log. Each call replays the whole log from
 * the seed and returns the resulting state. (For short games this is cheap.)
 *
 * Commands (state lives under a --session directory):
 *   # start / restart a game:
 *   node play_step.js --session run/ --reset --seed 42 [--speed_cap inf --frame_skip 6 --max_steps 4000]
 *
 *   # take one action (appends to the log, replays, prints the new state):
 *   node play_step.js --session run/ --action '{"move":[3,-2],"upgrade_choice":null}'
 *
 *   # re-print the current state without acting:
 *   node play_step.js --session run/ --status
 *
 * Output (JSON on stdout): { obs, reward_info, done, event, step }.
 * A bigger `frame_skip` means each action covers more game time (fewer, coarser
 * decisions); pick what suits a turn-by-turn player.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { RogueEnv } = require("./env.bundle.js");

function parseArgs(argv) {
  const a = { session: "session", reset: false, status: false, action: null, seed: "1", speed_cap: "40", frame_skip: "1", max_steps: "0", character: "striker" };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--reset") { a.reset = true; continue; }
    if (k === "--status") { a.status = true; continue; }
    if (k.startsWith("--")) { a[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return a;
}

function metaPath(dir) { return path.join(dir, "meta.json"); }
function actionsPath(dir) { return path.join(dir, "actions.jsonl"); }

function loadActions(dir) {
  const p = actionsPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Replay seed+config+actions and return the final { obs, reward_info, done, event, step }. */
function replay(meta, actions) {
  const env = new RogueEnv();
  const config = { speed_cap: meta.speed_cap === "inf" ? Infinity : Number(meta.speed_cap), frame_skip: meta.frame_skip, max_steps: meta.max_steps, character_id: meta.character_id };
  let { obs, reward_info } = env.reset(meta.seed, config);
  let last = { obs, reward_info, done: false, event: null, step: 0 };
  for (let i = 0; i < actions.length; i += 1) {
    if (last.done) break;
    const r = env.step(actions[i]);
    last = { obs: r.obs, reward_info: r.reward_info, done: r.done, event: r.event, step: i + 1 };
  }
  return last;
}

function out(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

/** On game over, save a small replayable LIGHT log (same format as run_policy). Filename is
 *  content-hashed (these are per-action processes), so distinct games never clobber. */
function saveGameLog(meta, actions, last) {
  try {
    const crypto = require("crypto");
    const ver = crypto.createHash("sha1").update(fs.readFileSync(path.join(__dirname, "env.bundle.js"))).digest("hex").slice(0, 12);
    const h = crypto.createHash("sha1").update(JSON.stringify(actions)).digest("hex").slice(0, 10);
    const dir = path.join(process.cwd(), "game_logs");
    fs.mkdirSync(dir, { recursive: true });
    const ri = last.reward_info || {};
    const rec = {
      format: "rogue_game_trace_v1", level: "light", source: "direct_play", game_version: ver, seed: meta.seed,
      config: { speed_cap: meta.speed_cap, frame_skip: meta.frame_skip, max_steps: meta.max_steps, character_id: meta.character_id, field: last.obs && last.obs.field },
      reward_info: { progress: ri.progress, score: ri.score, wave: ri.wave, level: ri.level, kills: ri.kills, boss_reached: ri.boss_reached, boss_cleared: ri.boss_cleared, survived_ms: ri.survived_ms, done_reason: ri.done_reason },
      checkpoints: last.obs ? [{ step: last.step, obs_hash: crypto.createHash("sha1").update(JSON.stringify(last.obs)).digest("hex").slice(0, 12) }] : [],
      action_log: actions,
    };
    fs.writeFileSync(path.join(dir, `play_s${meta.seed}_${h}.json`), JSON.stringify(rec));
  } catch (e) { /* logging must never break play */ }
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  const dir = path.resolve(a.session);

  if (a.reset) {
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      seed: /^-?\d+$/.test(a.seed) ? parseInt(a.seed, 10) : a.seed,
      speed_cap: a.speed_cap,
      frame_skip: parseInt(a.frame_skip, 10) || 1,
      max_steps: parseInt(a.max_steps, 10) || 90000, // default budget 90k; pass larger to extend
      character_id: a.character,
    };
    fs.writeFileSync(metaPath(dir), JSON.stringify(meta));
    fs.writeFileSync(actionsPath(dir), "");
    const last = replay(meta, []);
    out(last);
    process.exit(0);
  }

  if (!fs.existsSync(metaPath(dir))) {
    out({ error: `no session at ${a.session}; run with --reset --seed <n> first` });
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath(dir), "utf8"));
  let actions = loadActions(dir);

  if (a.status || a.action == null) {
    out(replay(meta, actions));
    process.exit(0);
  }

  // take an action
  let action;
  try {
    action = JSON.parse(a.action);
  } catch (e) {
    out({ error: `--action must be JSON, e.g. '{"move":[1,0],"upgrade_choice":null}'` });
    process.exit(1);
  }
  // Don't extend a finished game.
  const cur = replay(meta, actions);
  if (cur.done) { out(Object.assign({ note: "game already over; --reset to play again" }, cur)); process.exit(0); }

  fs.appendFileSync(actionsPath(dir), JSON.stringify(action) + "\n");
  actions = actions.concat([action]);
  const r = replay(meta, actions);
  if (r.done) saveGameLog(meta, actions, r); // auto-save the finished game (replayable)
  out(r);
}

module.exports = { replay };
