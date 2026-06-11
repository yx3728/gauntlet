/**
 * arena.test.js — direct unit test of the arena builder (arena/build_arena.js).
 *
 * Builds a real task (forge) into a tmp dir and checks the black-box packaging
 * invariants: the bundle is requireable and exports { meta, createEnv }, the
 * training seeds are baked into INTERFACE.md (no placeholder survives), the
 * manifest hashes match the shipped files, and the minified bundle leaks no
 * source paths. esbuild is a devDependency, so this test runs repo-side only.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { test, assert, assertEqual } = require("./harness.js");
const { buildArena } = require("../arena/build_arena.js");

test("arena: buildArena ships a complete, self-consistent black-box directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-arena-test-"));
  try {
    const manifest = buildArena("forge", tmp);
    assertEqual(manifest.task_id, "forge", "manifest task id");

    // The bundle is the only env entry point and must be requireable as-is.
    const bundle = require(path.join(tmp, "task.bundle.js"));
    assert(bundle && typeof bundle.createEnv === "function", "bundle exports createEnv");
    assert(bundle.meta && typeof bundle.meta === "object", "bundle exports meta");
    assertEqual(bundle.meta.id, "forge", "bundle meta.id");
    assertEqual(bundle.meta.version, manifest.task_version, "bundle version matches manifest");

    // INTERFACE.md has the training seeds baked in; no placeholder survives.
    const iface = fs.readFileSync(path.join(tmp, "INTERFACE.md"), "utf8");
    assert(iface.includes(bundle.meta.training_seeds.join(", ")), "joined training seeds in INTERFACE.md");
    assert(!iface.includes("$TRAINING_SEEDS"), "$TRAINING_SEEDS placeholder left in INTERFACE.md");

    // Manifest hashes match the shipped files (the audit's re-hash invariant),
    // and manifest.files covers exactly what's in the dir (minus manifest.json).
    const shipped = fs.readdirSync(tmp).filter((f) => f !== "manifest.json").sort();
    assertEqual(JSON.stringify(Object.keys(manifest.files).sort()), JSON.stringify(shipped), "manifest.files covers the shipped set");
    for (const [f, expected] of Object.entries(manifest.files)) {
      const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, f))).digest("hex");
      assertEqual(actual, expected, `manifest sha256 for ${f}`);
    }

    // Black-box check: the minified bundle must not leak source paths.
    const src = fs.readFileSync(path.join(tmp, "task.bundle.js"), "utf8");
    assert(!src.includes("core/prng.js"), "bundle leaks the core/prng.js source path");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
