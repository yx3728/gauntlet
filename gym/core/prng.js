/**
 * prng.js
 * ----------------------------------------------------------------------------
 * Seeded pseudo-random number generator + a global `Math.random` override.
 * Ported nearly verbatim from the proven ai_playtest_pipeline implementation.
 *
 * THE DETERMINISM STORY:
 *   Every task draws ALL of its randomness from a SeededPRNG constructed in
 *   `reset(seed)`. The episode harness additionally installs a (separately
 *   seeded) global `Math.random` override per episode as a safety net — and as
 *   the proven mechanism for porting existing games whose source can't be
 *   edited (one global override beats touching N call sites). Reseed the SAME
 *   installed instance between episodes (do not re-install) so module-captured
 *   references stay valid.
 *
 * Algorithm: mulberry32. Tiny, fast, deterministic, good enough for game sims
 * (not cryptography). Seeds pass through splitmix32 so nearby integer seeds
 * (0,1,2,...) still produce well-separated streams.
 * ----------------------------------------------------------------------------
 */

"use strict";

/** splitmix32: scramble a 32-bit seed into a well-distributed 32-bit state. */
function splitmix32(seed) {
  let z = (seed >>> 0) + 0x9e3779b9;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

function makeMulberry32(state0) {
  let a = state0 >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A reseedable PRNG. `next()` returns a float in [0, 1) like Math.random.
 */
class SeededPRNG {
  constructor(seed) {
    this.reseed(seed == null ? 0 : seed);
  }

  reseed(seed) {
    // Accept integers and strings; store the canonical 32-bit seed.
    const n = typeof seed === "string" ? hashStringToInt(seed) : (seed >>> 0);
    this.seed = n >>> 0;
    this._next = makeMulberry32(splitmix32(this.seed));
    this.draws = 0; // count of values produced (useful for divergence debugging)
  }

  next() {
    this.draws += 1;
    return this._next();
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** Pick one element of a non-empty array. */
  pick(arr) {
    return arr[this.int(arr.length)];
  }
}

/** FNV-1a hash so string seeds (e.g. "heldout-7") are usable too. */
function hashStringToInt(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Install `prng` as the process-global Math.random. Returns the original so a
 * caller could restore it. After this, every `Math.random()` call anywhere in
 * the process draws from `prng`.
 */
function installGlobalMathRandom(prng) {
  const original = Math.random;
  Math.random = function seededRandom() {
    return prng.next();
  };
  return original;
}

module.exports = { SeededPRNG, installGlobalMathRandom, hashStringToInt };
