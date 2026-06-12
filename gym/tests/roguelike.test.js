/**
 * roguelike.test.js — adapter-specific tests for the vendored big game.
 *
 * The load-bearing one is CROSS-RUNNER DETERMINISM: the gauntlet adapter (the
 * canonical scoring path) must produce byte-identical trajectories to the
 * vendored v2 run_policy.js (the runner the subject agent iterates with, run
 * here as a real subprocess exactly like a subject runs it). If these ever
 * diverge, canonical scores would silently stop reproducing subject-observed
 * behavior — the exact failure mode the trial exists to rule out.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { test, assert, assertEqual } = require("./harness.js");
const { runEpisode } = require("../core/episode.js");
const { stateOnlyHash } = require("../tools/capture_golden.js");

const roguelike = require("../tasks/roguelike/env.js");
const VENDOR = path.join(__dirname, "..", "tasks", "roguelike", "vendor");

// Deterministic, obs-INDEPENDENT test policy (pure function of the step index,
// so it behaves identically under both runners regardless of obs decoration).
const CROSS_POLICY_SRC = `
"use strict";
module.exports = {
  init() { return { i: 0 }; },
  policy(obs, mem) {
    const i = mem.i;
    const move = [((i * 7) % 81) - 40, ((i * 13) % 81) - 40];
    const upgrade_choice = i % 3;
    return { action: { move, upgrade_choice }, mem: { i: i + 1 } };
  },
};
`;

const CROSS_STEPS = 2000;
const CROSS_SEED = 11;

test("[roguelike] golden pin: goldens below are for roguelike@2.0.0 (template v2)", () => {
  assertEqual(roguelike.meta.version, "2.0.0", "version changed — re-pin goldens deliberately");
});

test("[roguelike] cross-runner determinism: gauntlet adapter == vendored v2 runner (subprocess)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-roguelike-x-"));
  try {
    // 1. Subject side: the REAL vendored runner, as a subprocess, full log.
    fs.writeFileSync(path.join(tmp, "policy.js"), CROSS_POLICY_SRC);
    const out = spawnSync(
      "node",
      [
        path.join(VENDOR, "run_policy.js"),
        "--policy", path.join(tmp, "policy.js"),
        "--seeds", String(CROSS_SEED),
        "--speed_cap", "40",
        "--frame_skip", "1",
        "--max_steps", String(CROSS_STEPS),
        "--log", "full",
        "--log-dir", path.join(tmp, "game_logs"),
        "--json",
      ],
      { encoding: "utf8", cwd: VENDOR, timeout: 120000, maxBuffer: 1024 * 1024 * 512 }
    );
    assertEqual(out.status, 0, `vendor runner exit (stderr: ${out.stderr})`);
    const vendorBatch = JSON.parse(out.stdout.trim().split("\n").pop());
    const vendorResult = vendorBatch.results[0];
    const logFile = vendorBatch.game_logs[0];
    const vendorFull = JSON.parse(fs.readFileSync(path.isAbsolute(logFile) ? logFile : path.join(VENDOR, logFile))).full;
    assert(Array.isArray(vendorFull) && vendorFull.length > 0, "vendor full log captured");

    // 2. Canonical side: the gauntlet adapter through the gauntlet episode harness.
    const policyMod = require(path.join(tmp, "policy.js"));
    const result = runEpisode(roguelike, policyMod, CROSS_SEED, { max_steps: CROSS_STEPS }, { captureLight: true, captureFull: true });
    const mine = result._gamelog.full;

    // 3. Step-by-step byte-level comparison (adapter obs minus its metrics
    //    decoration == vendor obs; plus done/event streams).
    assertEqual(mine.length, vendorFull.length, "step counts");
    for (let i = 0; i < mine.length; i += 1) {
      const { metrics, ...stateObs } = mine[i].obs;
      const a = JSON.stringify({ o: stateObs, e: mine[i].event, d: mine[i].done });
      const b = JSON.stringify({ o: vendorFull[i].obs, e: vendorFull[i].event, d: vendorFull[i].done });
      if (a !== b) {
        assert(false, `trajectory diverges at step ${i + 1}`);
      }
    }

    // 4. Final metrics agree.
    assertEqual(result.score, vendorResult.score, "final score");
    assertEqual(result.progress, vendorResult.progress, "final progress");
    assertEqual(result.kills, vendorResult.kills, "final kills");
    assertEqual(result.done_reason, vendorResult.done_reason, "done_reason");
    assertEqual(result.steps, vendorResult.steps, "steps");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("[roguelike] the speed cap is pinned at 40 in the canonical task (applied, not advisory)", () => {
  const env = roguelike.createEnv();
  let last = { obs: env.reset(7, { max_steps: 200 }).obs, done: false };
  let prev = last.obs.player.pos;
  let moved = 0;
  for (let i = 0; i < 60 && !last.done; i += 1) {
    // Far over the cap, bouncing between walls so the screen clamp doesn't park us.
    const dir = Math.floor(i / 6) % 2 === 0 ? 1 : -1;
    last = env.step({ move: [4000 * dir, 0] });
    const pos = last.obs.player.pos;
    const d = Math.hypot(pos[0] - prev[0], pos[1] - prev[1]);
    assert(d <= 40 + 1e-6, `per-tick displacement ${d} exceeds the 40px cap`);
    if (d > 30) moved += 1;
    prev = pos;
  }
  assert(moved > 10, "the cap test actually produced full-speed movement");
});

test("[roguelike] vendored subject runner defaults == the eval regime (40 / 90k)", () => {
  // The subject's own runner defaults must equal the canonical eval numbers,
  // so what the agent tunes under is what it is scored under.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-roguelike-d-"));
  try {
    fs.writeFileSync(path.join(tmp, "noop.js"), "module.exports = { policy: () => ({ action: { move: [0,0], upgrade_choice: 0 } }) };\n");
    const out = spawnSync(
      "node",
      [path.join(VENDOR, "run_policy.js"), "--policy", path.join(tmp, "noop.js"), "--log", "none", "--json"],
      { encoding: "utf8", cwd: VENDOR, timeout: 120000, maxBuffer: 1024 * 1024 * 64 }
    );
    assertEqual(out.status, 0, `vendor runner exit (stderr: ${out.stderr})`);
    const batch = JSON.parse(out.stdout.trim().split("\n").pop());
    assertEqual(String(batch.config.speed_cap), "40", "default speed_cap");
    assertEqual(batch.config.max_steps, 90000, "default max_steps");
    assertEqual(JSON.stringify(batch.seeds), "[1]", "default seed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("[roguelike] win_step is null on non-win and metrics carry the envelope", () => {
  const env = roguelike.createEnv();
  let last = { obs: env.reset(11, { max_steps: 50 }).obs, done: false };
  let steps = 0;
  while (!last.done && steps < 60) {
    last = env.step({ move: [0, 0], upgrade_choice: 0 });
    steps += 1;
  }
  assert(last.done, "episode ended at the cap");
  const m = last.obs.metrics;
  assertEqual(m.done_reason, "timeout", "timeout at tiny cap");
  assertEqual(m.win_step, null, "win_step null on non-win");
  for (const k of ["score", "progress", "kills", "level", "wave", "survived_ms"]) {
    assert(typeof m[k] === "number", `metrics.${k} numeric`);
  }
  assert(typeof m.boss_cleared === "boolean" && typeof m.boss_reached === "boolean", "boolean milestones");
});

// Golden state-only trajectory hashes for roguelike@2.0.0 (held-out-range seeds;
// captured via: node tools/capture_golden.js --task roguelike --seeds 2000,2001).
// Re-pinning requires a meta.version bump (see the version-pin test above).
test("[roguelike] golden state-only trajectory hashes (seeds 2000, 2001)", () => {
  const GOLDEN = { s2000: "41d12f23f540a0ab4f7f7df63c12af02b53ecc69", s2001: "f1f21f0643716c61c430ea8a7d64d3bca1281c66" };
  for (const [key, want] of Object.entries(GOLDEN)) {
    const seed = Number(key.slice(1));
    const { hash } = stateOnlyHash(roguelike, seed);
    assertEqual(hash, want, `golden ${key}`);
  }
});
