/** Tiny zero-dependency test harness (registry pattern from the proven pipeline). */

"use strict";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertEqual failed"}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function getTests() {
  return tests;
}

module.exports = { test, assert, assertEqual, getTests };
