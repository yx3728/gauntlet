/**
 * greedy.js — BFS pathing baseline for gridrun, using ONLY what INTERFACE.md
 * documents (the interface-sufficiency proof).
 *
 * Plan each step from scratch:
 *   1. boon decision open -> take option 1 (stasis), calming the new floor;
 *   2. a gem adjacent and safe -> grab it;
 *   3. BFS toward the key (or the exit once the key is held) over SAFE cells
 *      (not a wall, not a hazard cell, not within reach of an unfrozen
 *      hazard — they move one cell per step);
 *   4. no safe path: dodge if standing in a hazard's reach; otherwise hold
 *      position, and after STALL_LIMIT fruitless waits take the shortest
 *      path that merely ignores the danger ring (never onto a hazard cell).
 */

"use strict";

// Unfrozen hazards move 1 cell per step: keep out of cells they can reach.
const DANGER_RADIUS = 1;
// Consecutive waits with no safe route before risking the danger ring.
const STALL_LIMIT = 6;

function idx(x, y, w) {
  return y * w + x;
}

const DIRS = [
  { dx: 0, dy: -1, move: "north" },
  { dx: 0, dy: 1, move: "south" },
  { dx: 1, dy: 0, move: "east" },
  { dx: -1, dy: 0, move: "west" },
];

/** First move on a shortest path from `from` to `to` (BFS), or null. */
function bfsFirstStep(from, to, passable, w, h) {
  if (from === to) return null;
  const parent = new Map([[from, -1]]);
  const q = [from];
  for (let i = 0; i < q.length; i += 1) {
    const c = q[i];
    const x = c % w;
    const y = Math.floor(c / w);
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = idx(nx, ny, w);
      if (parent.has(n) || !passable(n)) continue;
      parent.set(n, c);
      if (n === to) {
        let cur = n;
        while (parent.get(cur) !== from) cur = parent.get(cur);
        return cur;
      }
      q.push(n);
    }
  }
  return null;
}

function moveToward(from, to, w) {
  const dx = (to % w) - (from % w);
  const dy = Math.floor(to / w) - Math.floor(from / w);
  if (dy < 0) return "north";
  if (dy > 0) return "south";
  if (dx > 0) return "east";
  if (dx < 0) return "west";
  return "wait";
}

module.exports = {
  init() {
    return { stall: 0 };
  },

  policy(obs, mem) {
    const stall = (mem && mem.stall) || 0;
    if (obs.pending_decision) return { action: { choice: 1 }, mem: { stall: 0 } };

    const w = obs.grid.width;
    const h = obs.grid.height;
    const wall = new Set(obs.walls.map(([x, y]) => idx(x, y, w)));
    const hazardCells = new Set();
    const danger = new Set(); // cells an unfrozen hazard could occupy next step
    for (const hz of obs.hazards) {
      hazardCells.add(idx(hz.x, hz.y, w));
      if (hz.frozen_for === 0) {
        danger.add(idx(hz.x, hz.y, w));
        for (const d of DIRS) {
          const x = hz.x + d.dx * DANGER_RADIUS;
          const y = hz.y + d.dy * DANGER_RADIUS;
          if (x >= 0 && y >= 0 && x < w && y < h) danger.add(idx(x, y, w));
        }
      }
    }
    const me = idx(obs.player.x, obs.player.y, w);
    const passable = (c) => !wall.has(c) && !hazardCells.has(c);
    const safe = (c) => passable(c) && !danger.has(c);
    const ret = (move, s) => ({ action: { move }, mem: { stall: s } });

    // Opportunistic gem grab: adjacent and safe.
    for (const [gx, gy] of obs.gems) {
      const g = idx(gx, gy, w);
      const dist = Math.abs(gx - obs.player.x) + Math.abs(gy - obs.player.y);
      if (dist === 1 && safe(g)) return ret(moveToward(me, g, w), 0);
    }

    const goal = obs.key.held ? idx(obs.exit.x, obs.exit.y, w) : idx(obs.key.x, obs.key.y, w);
    const safeStep = bfsFirstStep(me, goal, safe, w, h);
    if (safeStep != null) return ret(moveToward(me, safeStep, w), 0);

    // No safe route. If a hazard can reach us, dodge to any safe neighbor.
    if (danger.has(me)) {
      for (const d of DIRS) {
        const x = obs.player.x + d.dx;
        const y = obs.player.y + d.dy;
        if (x >= 0 && y >= 0 && x < w && y < h && safe(idx(x, y, w))) return ret(d.move, 0);
      }
    }
    // Forced (in danger) or stalled too long: risk the danger ring.
    const riskyStep = bfsFirstStep(me, goal, passable, w, h);
    if (riskyStep != null && (stall >= STALL_LIMIT || danger.has(me))) {
      return ret(moveToward(me, riskyStep, w), 0);
    }
    return ret("wait", stall + 1);
  },
};
