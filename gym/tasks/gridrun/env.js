/**
 * gridrun — a turn-based dungeon-floor crawler on a 9x9 grid, 3 floors.
 *
 * Each floor is generated from the seed: scattered walls, 3 gems, ONE key,
 * ONE locked exit, and 1-2 hazards that ping-pong along deterministic patrol
 * routes (routes fixed at generation; position is a pure function of the
 * floor's step phase). The player moves one cell per step. Enter a gem/key
 * cell to pick it up; enter the exit WITH the key to complete the floor;
 * completing floor 3 wins. Touching a hazard (either direction) is death.
 * Completing a non-final floor opens a boon decision (flat score bonus vs.
 * freezing the next floor's hazards for a while), resolved via action.choice.
 *
 * Generation guarantees solvability: walls are carved, then BFS connectivity
 * from the start to key/exit/gems is verified (stationary fallback hazards
 * are also checked as blockers); failed layouts are deterministically redrawn.
 */

"use strict";

const { SeededPRNG } = require("../../core/prng.js");

/* ------------------------------ constants ------------------------------ */

const SIZE = 9; // grid is SIZE x SIZE
const FLOORS = 3;
const GEMS_PER_FLOOR = 3;
const MIN_REACHABLE = 40; // a layout must keep at least this many cells connected
const GEN_ATTEMPTS = 60; // deterministic redraw budget per floor

const FREEZE_STEPS = 12; // boon option 1: hazards hold still for this many steps
const GEM_POINTS = 15;
const FLOOR_POINTS = 100;
const BOON_POINTS = 40; // boon option 0: flat score bonus
const WIN_POINTS = 300;
const WIN_STEPS_LEFT_CAP = 100; // cap on the steps-left bonus at win

const MOVES = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
  wait: { dx: 0, dy: 0 },
};
const DIRS = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

const meta = {
  id: "gridrun",
  name: "GridRun — dungeon floor crawler",
  version: "1.0.0",
  max_steps_default: 400,
  training_seeds: [1, 2, 3, 4, 5, 6, 7, 8],
  example_actions: [
    { move: "north" },
    { move: "south" },
    { move: "east" },
    { move: "west" },
    { move: "wait" },
    { choice: 0 },
    { move: "north", choice: 1 },
  ],
};

/* ------------------------------ generation ----------------------------- */

function cellIdx(x, y) {
  return y * SIZE + x;
}

function cellX(c) {
  return c % SIZE;
}

function cellY(c) {
  return Math.floor(c / SIZE);
}

/** BFS over non-wall cells from `start`; returns the set of reachable cells. */
function bfsReachable(wallSet, start) {
  const seen = new Set([start]);
  const q = [start];
  for (let i = 0; i < q.length; i += 1) {
    const x = cellX(q[i]);
    const y = cellY(q[i]);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const n = cellIdx(nx, ny);
      if (wallSet.has(n) || seen.has(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

/**
 * Maximal horizontal/vertical runs of open, reachable cells (length >= 3)
 * that avoid the excluded cells (start/key/exit) — candidate patrol routes.
 */
function findSegments(wallSet, reachable, excluded) {
  const segs = [];
  const flush = (run) => {
    if (run.length >= 3 && reachable.has(run[0]) && !run.some((c) => excluded.has(c))) segs.push(run);
  };
  for (let y = 0; y < SIZE; y += 1) {
    let run = [];
    for (let x = 0; x <= SIZE; x += 1) {
      if (x < SIZE && !wallSet.has(cellIdx(x, y))) run.push(cellIdx(x, y));
      else {
        flush(run);
        run = [];
      }
    }
  }
  for (let x = 0; x < SIZE; x += 1) {
    let run = [];
    for (let y = 0; y <= SIZE; y += 1) {
      if (y < SIZE && !wallSet.has(cellIdx(x, y))) run.push(cellIdx(x, y));
      else {
        flush(run);
        run = [];
      }
    }
  }
  return segs;
}

/**
 * Generate one floor: walls, start, exit, key, gems, hazards. Redraws (from
 * the same rng stream, so deterministically) until the layout is solvable.
 * `floorNo` is 0-based; deeper floors get slightly more walls.
 */
function generateFloor(rng, floorNo) {
  for (let attempt = 0; attempt < GEN_ATTEMPTS; attempt += 1) {
    const start = cellIdx(rng.int(SIZE), rng.int(SIZE));
    const wallCount = 11 + 2 * floorNo + rng.int(5);
    const wallSet = new Set();
    let guard = 0;
    while (wallSet.size < wallCount && guard < 300) {
      guard += 1;
      const c = cellIdx(rng.int(SIZE), rng.int(SIZE));
      if (c !== start) wallSet.add(c);
    }

    const reachable = bfsReachable(wallSet, start);
    if (reachable.size < MIN_REACHABLE) continue;

    // Exit, key, and gems on distinct reachable cells (never the start).
    const candidates = [...reachable].filter((c) => c !== start).sort((a, b) => a - b);
    const picked = [];
    for (let i = 0; i < 2 + GEMS_PER_FLOOR; i += 1) {
      picked.push(candidates.splice(rng.int(candidates.length), 1)[0]);
    }
    const exit = picked[0];
    const key = picked[1];
    const gems = picked.slice(2);

    // Hazard patrol routes: straight segments excluding start/key/exit.
    const excluded = new Set([start, key, exit]);
    const segs = findSegments(wallSet, reachable, excluded);
    const hazardCount = 1 + rng.int(2);
    const hazards = [];
    for (let i = 0; i < hazardCount; i += 1) {
      if (segs.length) {
        let route = segs.splice(rng.int(segs.length), 1)[0];
        if (route.length > 6) {
          const len = 4 + rng.int(3);
          const off = rng.int(route.length - len + 1);
          route = route.slice(off, off + len);
        }
        hazards.push({ route, offset: rng.int(2 * route.length - 2) });
      } else if (candidates.length) {
        // Stationary sentry fallback (free reachable cell; no key/exit/gems/start).
        hazards.push({ route: [candidates.splice(rng.int(candidates.length), 1)[0]], offset: 0 });
      }
    }
    if (!hazards.length) continue;

    // Stationary hazards block their cell forever — re-verify key/exit reachability.
    const blockers = hazards.filter((h) => h.route.length === 1).map((h) => h.route[0]);
    if (blockers.length) {
      const reach2 = bfsReachable(new Set([...wallSet, ...blockers]), start);
      if (!reach2.has(key) || !reach2.has(exit)) continue;
    }

    return { start, wallSet, walls: [...wallSet].sort((a, b) => a - b), exit, key, gems, hazards };
  }

  // Last-resort fixed open floor (practically unreachable; guarantees termination).
  return {
    start: cellIdx(0, 0),
    wallSet: new Set(),
    walls: [],
    exit: cellIdx(8, 8),
    key: cellIdx(8, 0),
    gems: [cellIdx(0, 8), cellIdx(4, 4), cellIdx(2, 6)],
    hazards: [{ route: [cellIdx(5, 3), cellIdx(5, 4), cellIdx(5, 5)], offset: 0 }],
  };
}

/* ------------------------------ simulation ------------------------------ */

/** Hazard position at a given floor phase: ping-pong along its route. */
function hazardPos(h, phase) {
  const len = h.route.length;
  if (len === 1) return h.route[0];
  const period = 2 * len - 2;
  const m = (h.offset + phase) % period;
  return h.route[m < len ? m : period - m];
}

function createEnv() {
  let st = null;

  function computeScore() {
    return st.gemsCollected * GEM_POINTS + st.floorsCompleted * FLOOR_POINTS + st.bonusBoons * BOON_POINTS + st.winBonus;
  }

  function buildObs(event) {
    const fl = st.floors[st.floorIdx];
    const obs = {
      step: st.steps,
      steps_left: st.maxSteps - st.steps,
      floor: st.floorIdx + 1,
      floors_total: FLOORS,
      grid: { width: SIZE, height: SIZE },
      player: { x: st.px, y: st.py },
      walls: fl.walls.map((c) => [cellX(c), cellY(c)]),
      gems: st.gems.map((c) => [cellX(c), cellY(c)]),
      key: st.hasKey ? { held: true, x: null, y: null } : { held: false, x: cellX(fl.key), y: cellY(fl.key) },
      exit: { x: cellX(fl.exit), y: cellY(fl.exit), open: st.hasKey },
      hazards: fl.hazards.map((h) => {
        const c = hazardPos(h, st.phase);
        return { x: cellX(c), y: cellY(c), frozen_for: st.frozenLeft };
      }),
      metrics: {
        score: computeScore(),
        progress: st.progress,
        done_reason: st.done_reason,
        floor: st.floorIdx + 1,
        floors_completed: st.floorsCompleted,
        gems_collected: st.gemsCollected,
        has_key: st.hasKey,
        bonus_boons_taken: st.bonusBoons,
      },
    };
    if (st.pending) {
      obs.pending_decision = {
        kind: "boon",
        options: [
          { index: 0, name: "treasure", desc: "flat score bonus, banked immediately" },
          { index: 1, name: "stasis", desc: "this floor's hazards hold still for your next " + FREEZE_STEPS + " steps" },
        ],
      };
    }
    return { obs, done: st.done, event: event || null };
  }

  return {
    reset(seed, config = {}) {
      const rng = new SeededPRNG(seed);
      const floors = [];
      for (let f = 0; f < FLOORS; f += 1) floors.push(generateFloor(rng, f));
      const ms = Number(config && config.max_steps);
      st = {
        floors,
        maxSteps: Number.isInteger(ms) && ms > 0 ? ms : meta.max_steps_default,
        steps: 0,
        floorIdx: 0,
        px: cellX(floors[0].start),
        py: cellY(floors[0].start),
        hasKey: false,
        gems: floors[0].gems.slice(),
        phase: 0, // hazard patrol phase on the current floor
        frozenLeft: 0, // steps hazards stay put (stasis boon)
        pending: false, // boon decision open?
        floorsCompleted: 0,
        gemsCollected: 0,
        bonusBoons: 0,
        winBonus: 0,
        progress: 0,
        done: false,
        done_reason: null,
        terminal: null,
      };
      return { obs: buildObs(null).obs };
    },

    step(action) {
      if (st.done) return st.terminal; // idempotent terminal step
      const a = action && typeof action === "object" && !Array.isArray(action) ? action : {};
      st.steps += 1;
      let event = null;

      if (st.pending) {
        // Between floors: only the boon choice is processed (moves are ignored).
        const choice = a.choice === 1 ? 1 : 0; // safe default: option 0
        if (choice === 1) st.frozenLeft = FREEZE_STEPS;
        else st.bonusBoons += 1;
        st.pending = false;
        event = { kind: "boon_chosen", choice };
      } else {
        const fl = st.floors[st.floorIdx];
        const move = typeof a.move === "string" && Object.prototype.hasOwnProperty.call(MOVES, a.move) ? a.move : "wait";
        let nx = st.px + MOVES[move].dx;
        let ny = st.py + MOVES[move].dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || fl.wallSet.has(cellIdx(nx, ny))) {
          nx = st.px; // blocked: stay put
          ny = st.py;
        }
        const dest = cellIdx(nx, ny);
        const hazardsNow = fl.hazards.map((h) => hazardPos(h, st.phase));
        st.px = nx;
        st.py = ny;

        if (hazardsNow.includes(dest)) {
          st.done = true;
          st.done_reason = "death"; // walked into a hazard
        } else {
          const gi = st.gems.indexOf(dest);
          if (gi >= 0) {
            st.gems.splice(gi, 1);
            st.gemsCollected += 1;
            event = { kind: "gem_collected", x: nx, y: ny };
          } else if (!st.hasKey && dest === fl.key) {
            st.hasKey = true;
            event = { kind: "key_collected", x: nx, y: ny };
          }

          if (st.hasKey && dest === fl.exit) {
            st.floorsCompleted += 1;
            if (st.floorIdx === FLOORS - 1) {
              st.done = true;
              st.done_reason = "win";
              st.winBonus = WIN_POINTS + Math.min(st.maxSteps - st.steps, WIN_STEPS_LEFT_CAP);
            } else {
              // Advance to the next floor; the boon decision opens (hazards
              // do not move on this step or while the decision is pending).
              st.floorIdx += 1;
              const nf = st.floors[st.floorIdx];
              st.px = cellX(nf.start);
              st.py = cellY(nf.start);
              st.hasKey = false;
              st.gems = nf.gems.slice();
              st.phase = 0;
              st.frozenLeft = 0;
              st.pending = true;
              event = { kind: "floor_complete", floor: st.floorsCompleted };
            }
          } else if (st.frozenLeft > 0) {
            st.frozenLeft -= 1; // hazards hold still
          } else {
            st.phase += 1; // hazards patrol one cell
            const here = cellIdx(st.px, st.py);
            if (fl.hazards.some((h) => hazardPos(h, st.phase) === here)) {
              st.done = true;
              st.done_reason = "death"; // a hazard walked into the player
            }
          }
        }
      }

      // Floors completed + half-credit for holding the floor's key; 1.0 only on
      // win (the winning step still has has_key true, hence the clamp).
      st.progress = Math.max(st.progress, Math.min(1, (st.floorsCompleted + (st.hasKey ? 0.5 : 0)) / FLOORS));
      if (!st.done && st.steps >= st.maxSteps) {
        st.done = true;
        st.done_reason = "timeout";
      }
      if (st.done) event = { kind: "game_over", reason: st.done_reason };

      const out = buildObs(event);
      if (st.done) st.terminal = { obs: out.obs, done: true, event: null };
      return out;
    },
  };
}

module.exports = { meta, createEnv };
