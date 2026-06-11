/**
 * gridrun.test.js — behavior tests for the gridrun task: generation
 * properties/solvability, movement + pickup + boon semantics, hazard patrol
 * determinism, win/death/timeout paths, greedy-beats-noop, and pinned golden
 * state-only trajectory hashes.
 */

"use strict";

const { test, assert, assertEqual } = require("./harness.js");
const { runEpisode } = require("../core/episode.js");
const { stateOnlyHash } = require("../tools/capture_golden.js");

const gridrun = require("../tasks/gridrun/env.js");
const greedy = require("../tasks/gridrun/baselines/greedy.js");
const noop = require("../tasks/gridrun/baselines/noop.js");

const W = 9;
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/* --------------------------------- helpers -------------------------------- */

function key(x, y) {
  return `${x},${y}`;
}

/** Set of cells reachable from (x0,y0) over non-wall cells. */
function reachableFrom(obs, x0, y0) {
  const walls = new Set(obs.walls.map(([x, y]) => key(x, y)));
  const seen = new Set([key(x0, y0)]);
  const q = [[x0, y0]];
  for (let i = 0; i < q.length; i += 1) {
    const [x, y] = q[i];
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      if (walls.has(key(nx, ny)) || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      q.push([nx, ny]);
    }
  }
  return seen;
}

/** Invariants every freshly-entered floor must satisfy. */
function validateFloorEntry(obs, label) {
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < W;
  const walls = new Set(obs.walls.map(([x, y]) => key(x, y)));
  assertEqual(obs.grid.width, W, `${label}: grid width`);
  assertEqual(obs.grid.height, W, `${label}: grid height`);
  assert(inB(obs.player.x, obs.player.y), `${label}: player in bounds`);
  assert(!walls.has(key(obs.player.x, obs.player.y)), `${label}: player not on wall`);
  assertEqual(obs.key.held, false, `${label}: key not held on entry`);
  assertEqual(obs.exit.open, false, `${label}: exit locked on entry`);
  assertEqual(obs.gems.length, 3, `${label}: 3 gems on entry`);
  assert(obs.hazards.length >= 1 && obs.hazards.length <= 2, `${label}: 1-2 hazards`);

  const specials = [[obs.key.x, obs.key.y], [obs.exit.x, obs.exit.y], ...obs.gems];
  const cells = new Set();
  for (const [x, y] of specials) {
    assert(inB(x, y), `${label}: special in bounds`);
    assert(!walls.has(key(x, y)), `${label}: special not on wall`);
    assert(!cells.has(key(x, y)), `${label}: specials on distinct cells`);
    cells.add(key(x, y));
  }
  for (const hz of obs.hazards) {
    assert(inB(hz.x, hz.y), `${label}: hazard in bounds`);
    assert(!walls.has(key(hz.x, hz.y)), `${label}: hazard not on wall`);
    const hk = key(hz.x, hz.y);
    assert(hk !== key(obs.player.x, obs.player.y), `${label}: hazard not on start`);
    assert(hk !== key(obs.key.x, obs.key.y), `${label}: hazard not on key`);
    assert(hk !== key(obs.exit.x, obs.exit.y), `${label}: hazard not on exit`);
  }
  // Solvability: key, exit, and every gem reachable from the start.
  const reach = reachableFrom(obs, obs.player.x, obs.player.y);
  for (const [x, y] of specials) assert(reach.has(key(x, y)), `${label}: special at ${x},${y} reachable`);
}

/** Drive a policy in-process; returns { env, lastResult, actions } stopping when stop(last) is true. */
function driveUntil(seed, policyMod, stop, cap = 450) {
  const env = gridrun.createEnv();
  let mem = policyMod.init();
  let last = { obs: env.reset(seed, {}).obs, done: false, event: null };
  const actions = [];
  let steps = 0;
  while (!last.done && !stop(last) && steps < cap) {
    const out = policyMod.policy(last.obs, mem);
    mem = out.mem;
    actions.push(out.action);
    last = env.step(out.action);
    steps += 1;
  }
  return { env, last, actions };
}

function replay(seed, actions) {
  const env = gridrun.createEnv();
  let last = { obs: env.reset(seed, {}).obs, done: false, event: null };
  for (const a of actions) last = env.step(a);
  return { env, last };
}

/* --------------------------------- tests ---------------------------------- */

test("[gridrun] generation: every entered floor is well-formed and solvable", () => {
  let floorsValidated = 0;
  for (const seed of [...gridrun.meta.training_seeds, 2000, 2001, "heldout-x"]) {
    const env = gridrun.createEnv();
    let mem = greedy.init();
    let last = { obs: env.reset(seed, {}).obs, done: false, event: null };
    validateFloorEntry(last.obs, `seed ${seed} floor 1`);
    floorsValidated += 1;
    let steps = 0;
    while (!last.done && steps < 450) {
      const out = greedy.policy(last.obs, mem);
      mem = out.mem;
      last = env.step(out.action);
      steps += 1;
      if (last.event && last.event.kind === "floor_complete") {
        validateFloorEntry(last.obs, `seed ${seed} floor ${last.obs.floor}`);
        floorsValidated += 1;
      }
    }
  }
  assert(floorsValidated >= 20, `expected to validate many floors, got ${floorsValidated}`);
});

test("[gridrun] generation: different seeds produce different layouts", () => {
  const a = gridrun.createEnv().reset(1, {}).obs;
  const b = gridrun.createEnv().reset(2, {}).obs;
  assert(JSON.stringify(a.walls) !== JSON.stringify(b.walls) || JSON.stringify(a.gems) !== JSON.stringify(b.gems),
    "seeds 1 and 2 generated identical floor 1");
});

test("[gridrun] movement: junk and blocked moves stay put, valid moves advance", () => {
  const env = gridrun.createEnv();
  const o0 = env.reset(1, {}).obs;
  const at = (o) => key(o.player.x, o.player.y);
  // Junk actions coerce to wait.
  for (const junk of [42, null, { move: "xyzzy" }, { move: ["north"] }, "south"]) {
    const r = env.step(junk);
    assertEqual(at(r.obs), at(o0), `junk action ${JSON.stringify(junk)} moved the player`);
  }
  // From seed 1's start, pick a blocked and a safely-open direction from obs.
  const walls = new Set(o0.walls.map(([x, y]) => key(x, y)));
  let blockedDir = null;
  let openDir = null;
  for (const [name, [dx, dy]] of Object.entries(DIRS)) {
    const x = o0.player.x + dx;
    const y = o0.player.y + dy;
    const blocked = x < 0 || y < 0 || x >= W || y >= W || walls.has(key(x, y));
    const hazDist = Math.min(...o0.hazards.map((hz) => Math.abs(hz.x - x) + Math.abs(hz.y - y)));
    if (blocked && !blockedDir) blockedDir = name;
    if (!blocked && hazDist >= 3 && !openDir) openDir = { name, x, y };
  }
  assert(blockedDir && openDir, "seed 1 start should offer both a blocked and an open direction");
  const r1 = env.step({ move: blockedDir });
  assertEqual(at(r1.obs), at(o0), "blocked move should not change position");
  const r2 = env.step({ move: openDir.name });
  assertEqual(at(r2.obs), key(openDir.x, openDir.y), "open move should advance one cell");
});

test("[gridrun] hazards: patrol is a pure function of the step count", () => {
  const run = () => {
    const env = gridrun.createEnv();
    let last = { obs: env.reset(3, {}).obs, done: false };
    const seq = [JSON.stringify(last.obs.hazards)];
    for (let i = 0; i < 30 && !last.done; i += 1) {
      last = env.step({ move: "wait" });
      seq.push(JSON.stringify(last.obs.hazards));
    }
    return seq;
  };
  const a = run();
  const b = run();
  assertEqual(b.join("|"), a.join("|"), "wait-only hazard sequences differ between fresh envs");
  assert(new Set(a).size > 1, "hazards never moved over 30 steps");
});

test("[gridrun] noop: always times out at the full budget with score 0", () => {
  for (const seed of gridrun.meta.training_seeds) {
    const r = runEpisode(gridrun, noop, seed, {}, {});
    assertEqual(r.done_reason, "timeout", `seed ${seed}: noop should time out`);
    assertEqual(r.steps, gridrun.meta.max_steps_default, `seed ${seed}: noop steps`);
    assertEqual(r.score, 0, `seed ${seed}: noop score`);
  }
});

test("[gridrun] pickups and progress: key collection raises progress before the floor", () => {
  const { last } = driveUntil(1, greedy, (l) => l.event && l.event.kind === "key_collected");
  assert(last.event && last.event.kind === "key_collected", "greedy never picked up the key on seed 1");
  assertEqual(last.obs.key.held, true, "key.held after pickup");
  assertEqual(last.obs.key.x, null, "key.x null when held");
  assertEqual(last.obs.exit.open, true, "exit.open after pickup");
  assert(Math.abs(last.obs.metrics.progress - 0.5 / 3) < 1e-9, "progress = (0 floors + 0.5 key)/3");
});

test("[gridrun] boon: floor completion opens a well-formed pending decision", () => {
  const { last } = driveUntil(1, greedy, (l) => l.event && l.event.kind === "floor_complete");
  assert(last.event && last.event.kind === "floor_complete", "greedy never completed floor 1 on seed 1");
  assertEqual(last.event.floor, 1, "completed floor number");
  assertEqual(last.obs.floor, 2, "obs already shows the next floor");
  assertEqual(last.obs.key.held, false, "key resets on the new floor");
  const pd = last.obs.pending_decision;
  assert(pd && pd.kind === "boon", "pending_decision present with kind boon");
  assertEqual(pd.options.length, 2, "two boon options");
  assertEqual(pd.options[0].index, 0, "option 0 index");
  assertEqual(pd.options[1].index, 1, "option 1 index");
  assertEqual(last.obs.metrics.floors_completed, 1, "floors_completed");
  assert(Math.abs(last.obs.metrics.progress - 1 / 3) < 1e-9, "progress = 1 floor / 3");
});

test("[gridrun] boon: junk resolution defaults to option 0 (flat +40 score)", () => {
  const { env, last, actions } = driveUntil(1, greedy, (l) => l.event && l.event.kind === "floor_complete");
  void actions;
  const before = last.obs.metrics.score;
  const r = env.step({ bogus: "stuff" }); // no valid choice -> option 0
  assert(r.event && r.event.kind === "boon_chosen" && r.event.choice === 0, "boon_chosen choice 0");
  assertEqual(r.obs.metrics.bonus_boons_taken, 1, "bonus boon counted");
  assertEqual(r.obs.metrics.score, before + 40, "score +40 from boon option 0");
  assert(!r.obs.pending_decision, "pending_decision cleared");
});

test("[gridrun] boon: choice 1 freezes hazards for exactly 12 steps", () => {
  const a = driveUntil(1, greedy, (l) => l.event && l.event.kind === "floor_complete");
  const { env } = replay(1, a.actions); // identical state via open-loop replay
  let r = env.step({ choice: 1 });
  assert(r.event && r.event.kind === "boon_chosen" && r.event.choice === 1, "boon_chosen choice 1");
  for (const hz of r.obs.hazards) assertEqual(hz.frozen_for, 12, "frozen_for set to 12");
  const frozenPos = JSON.stringify(r.obs.hazards.map((hz) => [hz.x, hz.y]));
  for (let i = 0; i < 12; i += 1) {
    r = env.step({ move: "wait" });
    assertEqual(JSON.stringify(r.obs.hazards.map((hz) => [hz.x, hz.y])), frozenPos, `hazards moved during freeze (wait ${i + 1})`);
  }
  assertEqual(r.obs.hazards[0].frozen_for, 0, "freeze expired after 12 steps");
  r = env.step({ move: "wait" });
  assert(JSON.stringify(r.obs.hazards.map((hz) => [hz.x, hz.y])) !== frozenPos, "hazards resume patrolling after the freeze");
});

test("[gridrun] win path: greedy wins seed 1 and the published score formula holds", () => {
  const { last } = driveUntil(1, greedy, () => false);
  assertEqual(last.obs.metrics.done_reason, "win", "greedy should win seed 1");
  assertEqual(last.obs.metrics.progress, 1, "progress 1.0 on win");
  assertEqual(last.obs.metrics.floors_completed, 3, "all floors completed");
  const m = last.obs.metrics;
  const expected = m.gems_collected * 15 + m.floors_completed * 100 + m.bonus_boons_taken * 40
    + 300 + Math.min(last.obs.steps_left, 100);
  assertEqual(m.score, expected, "score formula");
});

test("[gridrun] death path: walking into patrols ends with done_reason death", () => {
  // Hazard-seeker: BFS toward the nearest hazard, ignoring all danger.
  const seeker = {
    init: () => ({}),
    policy(obs, mem) {
      if (obs.pending_decision) return { action: { choice: 0 }, mem };
      const walls = new Set(obs.walls.map(([x, y]) => key(x, y)));
      const goals = new Set(obs.hazards.map((hz) => key(hz.x, hz.y)));
      const me = key(obs.player.x, obs.player.y);
      const parent = new Map([[me, null]]);
      const q = [[obs.player.x, obs.player.y]];
      let hit = null;
      for (let i = 0; i < q.length && !hit; i += 1) {
        const [x, y] = q[i];
        for (const [name, [dx, dy]] of Object.entries(DIRS)) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = key(nx, ny);
          if (nx < 0 || ny < 0 || nx >= W || ny >= W || walls.has(nk) || parent.has(nk)) continue;
          parent.set(nk, { from: key(x, y), name });
          if (goals.has(nk)) { hit = nk; break; }
          q.push([nx, ny]);
        }
      }
      if (!hit) return { action: { move: "wait" }, mem };
      let cur = hit;
      while (parent.get(cur).from !== me) cur = parent.get(cur).from;
      return { action: { move: parent.get(cur).name }, mem };
    },
  };
  let deaths = 0;
  for (const seed of [1, 2, 3, 4]) {
    const r = runEpisode(gridrun, seeker, seed, {}, {});
    if (r.done_reason === "death") {
      deaths += 1;
      assert(r.progress < 1, "death must not report full progress");
    }
  }
  assert(deaths >= 2, `expected the hazard-seeker to die on most seeds, got ${deaths}/4`);
});

test("[gridrun] interface sufficiency: greedy mean score clearly beats noop", () => {
  const seeds = gridrun.meta.training_seeds;
  const mean = (pol) => seeds.reduce((s, seed) => s + runEpisode(gridrun, pol, seed, {}, {}).score, 0) / seeds.length;
  const g = mean(greedy);
  const n = mean(noop);
  assert(g > n, `greedy (${g}) must beat noop (${n})`);
  assert(g >= n + 100, `greedy (${g}) should beat noop (${n}) by a wide margin`);
});

// Golden state-only hashes for gridrun@1.0.0, captured via:
//   node tools/capture_golden.js --task gridrun --seeds 2000,2001
// Re-pinning these is a deliberate, reviewed act and REQUIRES a meta.version bump.
const GOLDEN = {
  s2000: "94b092184fed26b6b075bf8897dbf405392d6093", // 400 steps
  s2001: "821534d3e2cd3bd55f1c436017b23073ee58f9a0", // 400 steps
};

test("[gridrun] golden state-only trajectory hashes (seeds 2000, 2001)", () => {
  assertEqual(stateOnlyHash(gridrun, 2000).hash, GOLDEN.s2000, "golden hash seed 2000");
  assertEqual(stateOnlyHash(gridrun, 2001).hash, GOLDEN.s2001, "golden hash seed 2001");
});
