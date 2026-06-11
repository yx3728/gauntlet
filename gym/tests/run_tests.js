/** Discover and run tests/*.test.js (alphabetical). Exit 1 on any failure. */

"use strict";

const fs = require("fs");
const path = require("path");
const { getTests } = require("./harness.js");

const dir = __dirname;
for (const f of fs.readdirSync(dir).sort()) {
  if (f.endsWith(".test.js")) require(path.join(dir, f));
}

let passed = 0;
let failed = 0;
const t0 = Date.now();
for (const { name, fn } of getTests()) {
  const s = Date.now();
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}  (${Date.now() - s}ms)`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(String(e.stack || e).split("\n").slice(0, 3).map((l) => `      ${l}`).join("\n"));
  }
}
const total = passed + failed;
console.log(`\n${passed}/${total} passed${failed ? `, ${failed} FAILED` : ""}  (${Date.now() - t0}ms)`);
if (failed) process.exit(1);
