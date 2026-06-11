/** prng.test.js — contract tests for the seeded PRNG (ported spec from the proven suite). */

"use strict";

const { test, assert, assertEqual } = require("./harness.js");
const { SeededPRNG, installGlobalMathRandom, hashStringToInt } = require("../core/prng.js");

test("prng: same seed => identical 1000-draw stream", () => {
  const a = new SeededPRNG(42);
  const b = new SeededPRNG(42);
  for (let i = 0; i < 1000; i += 1) assertEqual(a.next(), b.next(), `draw ${i}`);
});

test("prng: reseed resets the stream", () => {
  const a = new SeededPRNG(7);
  const first = [a.next(), a.next(), a.next()];
  a.reseed(7);
  assertEqual(a.draws, 0, "draws counter reset");
  for (const v of first) assertEqual(a.next(), v, "reseeded stream");
});

test("prng: values in [0, 1)", () => {
  const a = new SeededPRNG(123);
  for (let i = 0; i < 5000; i += 1) {
    const v = a.next();
    assert(v >= 0 && v < 1, `value ${v} out of range`);
  }
});

test("prng: string seeds are usable and deterministic", () => {
  const a = new SeededPRNG("heldout-7");
  const b = new SeededPRNG("heldout-7");
  const c = new SeededPRNG("heldout-8");
  assertEqual(a.next(), b.next(), "same string seed");
  assert(new SeededPRNG("heldout-7").next() !== c.next(), "different string seeds");
  assertEqual(hashStringToInt("heldout-7"), hashStringToInt("heldout-7"), "stable hash");
});

test("prng: nearby integer seeds give separated streams", () => {
  const a = new SeededPRNG(1);
  const b = new SeededPRNG(2);
  let same = 0;
  for (let i = 0; i < 100; i += 1) if (a.next() === b.next()) same += 1;
  assert(same === 0, `adjacent seeds collided on ${same}/100 draws`);
});

test("prng: int(n) and pick() are in range and deterministic", () => {
  const a = new SeededPRNG(9);
  const b = new SeededPRNG(9);
  const arr = ["x", "y", "z"];
  for (let i = 0; i < 200; i += 1) {
    const v = a.int(10);
    assert(Number.isInteger(v) && v >= 0 && v < 10, `int ${v}`);
    assertEqual(b.int(10), v, "int determinism");
  }
  assert(arr.includes(new SeededPRNG(3).pick(arr)), "pick in range");
});

test("prng: global override draws from the installed instance and survives reseed", () => {
  const original = Math.random;
  try {
    const p = new SeededPRNG(5);
    installGlobalMathRandom(p);
    const seq1 = [Math.random(), Math.random()];
    p.reseed(5);
    assertEqual(Math.random(), seq1[0], "reseed (same instance) reproduces");
    const q = new SeededPRNG(5);
    q.next();
    assertEqual(Math.random(), q.next(), "stream matches a fresh PRNG");
  } finally {
    Math.random = original;
  }
});
