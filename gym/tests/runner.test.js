/** runner.test.js — episode-harness semantics, aggregation, and the --json CLI boundary. */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { test, assert, assertEqual } = require("./harness.js");
const { runEpisode } = require("../core/episode.js");
const { aggregate } = require("../core/aggregate.js");
const { parseSeeds } = require("../runner/run_policy.js");

const minitask = require("./fixtures/minitask/env.js");

test("episode: a throwing policy ends the episode with policy_error (no crash)", () => {
  const pol = {
    init: () => ({ n: 0 }),
    policy(obs, mem) {
      if (mem.n >= 2) throw new Error("boom at step 3");
      return { action: { add: 1 }, mem: { n: mem.n + 1 } };
    },
  };
  const r = runEpisode(minitask, pol, 1, {}, {});
  assert(r.policy_error && r.policy_error.includes("boom"), `policy_error: ${r.policy_error}`);
  assertEqual(r.steps, 2, "stopped after 2 successful steps");
  assert(typeof r.score === "number", "metrics still present from last good state");
});

test("episode: a throwing init() is contained with policy_error and steps=0", () => {
  const pol = {
    init: () => { throw new Error("init boom"); },
    policy: () => ({ action: { add: 1 } }),
  };
  const r = runEpisode(minitask, pol, 1, {}, {});
  assert(r.policy_error && r.policy_error.includes("init boom"), `policy_error: ${r.policy_error}`);
  assertEqual(r.steps, 0, "no steps taken");
  assert(typeof r.score === "number", "metrics still present from the reset obs");
});

test("episode: harness fields win over same-named task metrics in the result", () => {
  // A hostile/buggy task could publish reserved keys in obs.metrics; the harness
  // envelope (seed/steps/events) must take precedence in the assembled result.
  const evil = {
    meta: { id: "evil", max_steps_default: 5 },
    createEnv() {
      let n = 0;
      return {
        reset: () => ({ obs: { metrics: { score: 0, progress: 0, done_reason: null, seed: "clobber", steps: -1 } } }),
        step: () => {
          n += 1;
          return { obs: { metrics: { score: n, progress: 1, done_reason: "win", seed: "clobber", steps: -1 } }, done: true, event: { kind: "game_over", reason: "win" } };
        },
      };
    },
  };
  const r = runEpisode(evil, { policy: () => ({ action: {} }) }, 7, {}, {});
  assertEqual(r.seed, 7, "harness seed wins");
  assertEqual(r.steps, 1, "harness steps wins");
  assertEqual(r.score, 1, "non-reserved metrics still pass through");
});

test("episode: falsy policy return defaults to {} and the run completes", () => {
  const pol = { policy: () => undefined };
  const r = runEpisode(minitask, pol, 1, {}, {});
  assert(r.done_reason === "timeout", `noop-by-default should time out, got ${r.done_reason}`);
  assert(!r.policy_error, "no policy_error");
});

test("episode: mem is replaced only when the 'mem' key is present", () => {
  // Self-asserting policy: alternates returning mem; throws if persistence breaks.
  const pol = {
    init: () => ({ n: 0 }),
    policy(obs, mem) {
      if (typeof mem.n !== "number") throw new Error("mem lost");
      if (obs.step % 2 === 0) return { action: { add: 1 }, mem: { n: mem.n + 1 } };
      return { action: { add: 1 } }; // no 'mem' key: previous mem must persist
    },
  };
  const r = runEpisode(minitask, pol, 2, {}, {});
  assert(!r.policy_error, `mem persistence broke: ${r.policy_error}`);
});

test("episode: light capture returns action_log + checkpoints, written once", () => {
  const pol = { policy: () => ({ action: { add: 1 } }) };
  const r = runEpisode(minitask, pol, 1, {}, { captureLight: true, checkpointEvery: 5 });
  assert(r._gamelog, "_gamelog present");
  assertEqual(r._gamelog.action_log.length, r.steps, "one action per step");
  assert(r._gamelog.checkpoints.length >= 1, "checkpoints captured");
  assert(r._gamelog.checkpoints[0].obs_hash.length === 12, "12-hex obs hash");
});

test("aggregate: numeric distributions, boolean rates, done_reason rates, error rate", () => {
  const agg = aggregate([
    { seed: 1, steps: 10, score: 100, progress: 0.5, done_reason: "win", flag: true },
    { seed: 2, steps: 20, score: 200, progress: 1.0, done_reason: "timeout", flag: false },
    { seed: 3, steps: 30, score: 0, progress: 0, done_reason: null, policy_error: "x", flag: false },
  ]);
  assertEqual(agg.n, 3, "n");
  assertEqual(agg.score.mean, 100, "score mean");
  assertEqual(agg.score.median, 100, "score median");
  assertEqual(agg.score.min, 0, "score min");
  assertEqual(agg.score.max, 200, "score max");
  assertEqual(agg.flag_rate, 0.3333, "boolean rate");
  assertEqual(agg.done_reason_rates.win, 0.3333, "win rate");
  assertEqual(agg.done_reason_rates.none, 0.3333, "none rate");
  assertEqual(agg.policy_error_rate, 0.3333, "policy_error rate");
  assert(!("done_reason" in agg), "done_reason not aggregated as a numeric field");
});

test("aggregate: even-n median averages the middle pair (matches evalkit's statistics.median)", () => {
  const agg = aggregate([
    { seed: 1, steps: 1, score: 200 },
    { seed: 2, steps: 2, score: 0 },
    { seed: 3, steps: 3, score: 301 },
    { seed: 4, steps: 4, score: 100 },
  ]);
  assertEqual(agg.score.median, 150, "even-n median is the mean of the two middle values");
  assertEqual(agg.steps.median, 2.5, "even-n median may be fractional");
  assertEqual(agg.score.min, 0, "min unchanged");
  assertEqual(agg.score.max, 301, "max unchanged");
});

test("parseSeeds: csv + ranges + fallback", () => {
  assertEqual(JSON.stringify(parseSeeds("1,2,5..9", [0])), "[1,2,5,6,7,8,9]", "csv+range");
  assertEqual(JSON.stringify(parseSeeds("", [3, 4])), "[3,4]", "fallback");
  assertEqual(JSON.stringify(parseSeeds("2000..2002", [0])), "[2000,2001,2002]", "range only");
});

const RUNNER = path.join(__dirname, "..", "runner", "run_policy.js");
const MINITASK_PATH = path.join(__dirname, "fixtures", "minitask", "env.js");

/** Spawn the runner CLI against the minitask fixture with extra args. */
function runCli(extraArgs, cwd) {
  return spawnSync("node", [RUNNER, "--task", MINITASK_PATH, ...extraArgs], {
    encoding: "utf8",
    cwd,
    timeout: 30000,
  });
}

test("CLI: --json emits exactly one parseable line with the batch protocol shape", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-runner-test-"));
  try {
    const policyPath = path.join(tmp, "policy.js");
    fs.writeFileSync(policyPath, "module.exports = { policy: () => ({ action: { add: 2 } }) };\n");
    const out = runCli(["--policy", policyPath, "--seeds", "1,2", "--log", "none", "--json"], tmp);
    assertEqual(out.status, 0, `runner exit (stderr: ${out.stderr})`);
    const lines = out.stdout.trim().split("\n");
    assertEqual(lines.length, 1, "exactly one stdout line");
    const j = JSON.parse(lines[0]);
    assertEqual(j.task.id, "minitask", "task id");
    assert(j.task.bundle_sha && j.task.bundle_sha !== "unknown", "bundle sha present");
    assertEqual(j.seeds.length, 2, "two seeds");
    assertEqual(j.results.length, 2, "two results");
    assert(typeof j.results[0].score === "number", "result score");
    assert(j.aggregate && j.aggregate.n === 2, "aggregate present");
    assert(j.aggregate.done_reason_rates, "done_reason_rates present");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: a crashing policy is contained and reported per-seed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-runner-test-"));
  try {
    const policyPath = path.join(tmp, "policy.js");
    fs.writeFileSync(policyPath, "module.exports = { policy: () => { throw new Error('dead'); } };\n");
    const out = runCli(["--policy", policyPath, "--seeds", "1", "--log", "none", "--json"], tmp);
    assertEqual(out.status, 0, "runner still exits 0 (failure is data)");
    const j = JSON.parse(out.stdout.trim());
    assert(j.results[0].policy_error.includes("dead"), "policy_error reported");
    assertEqual(j.aggregate.policy_error_rate, 1, "error rate 1");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: a throwing init() is contained and reported per-seed with steps=0", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-runner-test-"));
  try {
    const policyPath = path.join(tmp, "policy.js");
    fs.writeFileSync(
      policyPath,
      "module.exports = { init: () => { throw new Error('init dead'); }, policy: () => ({ action: { add: 1 } }) };\n"
    );
    const out = runCli(["--policy", policyPath, "--seeds", "1", "--log", "none", "--json"], tmp);
    assertEqual(out.status, 0, `runner still exits 0 (stderr: ${out.stderr})`);
    const j = JSON.parse(out.stdout.trim());
    assert(j.results[0].policy_error.includes("init dead"), "init policy_error reported");
    assertEqual(j.results[0].steps, 0, "no steps taken");
    assertEqual(j.aggregate.policy_error_rate, 1, "error rate 1");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI: non-numeric --seeds tokens fail fast with a clear message", () => {
  const out = runCli(["--seeds", "1,x,3", "--log", "none", "--json"]);
  assertEqual(out.status, 1, "exit 1 on bad seeds token");
  assert(out.stderr.includes('invalid token "x"'), `stderr: ${out.stderr}`);
});

test("CLI: an inverted --seeds range (empty result) fails fast", () => {
  const out = runCli(["--seeds", "9..5", "--log", "none", "--json"]);
  assertEqual(out.status, 1, "exit 1 on empty seed set");
  assert(out.stderr.includes("produced no seeds"), `stderr: ${out.stderr}`);
});

test("CLI: a value-taking flag with a missing value fails fast", () => {
  const atEnd = runCli(["--policy"]); // value missing at end of argv
  assertEqual(atEnd.status, 1, "exit 1 when the value is missing");
  assert(atEnd.stderr.includes("--policy requires a value"), `stderr: ${atEnd.stderr}`);

  const beforeFlag = runCli(["--seeds", "--json"]); // next token is another flag
  assertEqual(beforeFlag.status, 1, "exit 1 when the next token is a flag");
  assert(beforeFlag.stderr.includes("--seeds requires a value"), `stderr: ${beforeFlag.stderr}`);
});
