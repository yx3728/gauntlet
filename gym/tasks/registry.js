/**
 * registry.js — task id -> module resolution (repo-side only; never shipped in arenas).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const TASKS = {
  gridrun: "gridrun/env.js",
  forge: "forge/env.js",
  roguelike: "roguelike/env.js",
};

function entryPath(id) {
  const rel = TASKS[id];
  if (!rel) throw new Error(`unknown task "${id}" (known: ${Object.keys(TASKS).join(", ")})`);
  const p = path.join(__dirname, rel);
  if (!fs.existsSync(p)) throw new Error(`task "${id}" is registered but ${p} does not exist`);
  return p;
}

function resolve(id) {
  return require(entryPath(id));
}

function list() {
  return Object.keys(TASKS);
}

module.exports = { TASKS, entryPath, resolve, list };
