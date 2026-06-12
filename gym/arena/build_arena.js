/**
 * build_arena.js — package a task into a black-box arena directory.
 *
 * Usage: node build_arena.js --task <id> [--out <dir>]   (default out: gym/dist/arena/<id>)
 *
 * The arena is EXACTLY what an agent node sees in its working directory:
 *   task.bundle.js     minified esbuild bundle of the task env (no source)
 *   run_policy.js      self-contained bundle of the generic runner (readable framework code)
 *   INTERFACE.md       INTERFACE.core.md + the task's INTERFACE.task.md
 *   DESCRIPTION.md     the task's black-box-safe goal description
 *   policy.template.js starting point
 *   manifest.json      task id/version, sha256 of every shipped file, training seeds
 *                      (the version pin: evals record it; the audit re-hashes against it)
 *
 * No task source, no registry, no held-out seeds.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");

const GYM = path.resolve(__dirname, "..");
const registry = require(path.join(GYM, "tasks", "registry.js"));

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      a[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return a;
}

function buildArena(taskId, outDir) {
  const entry = registry.entryPath(taskId);
  const taskDir = path.dirname(entry);
  const meta = require(entry).meta;
  if (!meta || meta.id !== taskId) {
    throw new Error(`task meta.id (${meta && meta.id}) does not match registry id (${taskId})`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // OVERLAY MODE (ported/legacy tasks): when meta.arena.overlay_dir is set, the
  // task supplies its ENTIRE agent-facing surface verbatim (its own pre-built
  // bundle, runner, docs, template) — e.g. a byte-identical reproduction of an
  // external proven trial workspace. The builder ships those files untouched
  // plus manifest.json (the version pin / audit anchor). Canonical scoring for
  // such tasks runs through the repo task module, not the arena (see evalkit).
  if (meta.arena && meta.arena.overlay_dir) {
    const overlay = path.join(taskDir, meta.arena.overlay_dir);
    for (const f of fs.readdirSync(overlay).sort()) {
      fs.copyFileSync(path.join(overlay, f), path.join(outDir, f));
    }
    return writeManifest(outDir, meta, "overlay");
  }

  // 1. The black-box simulator bundle (minified — structural black box, no source).
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    minify: true,
    legalComments: "none",
    banner: {
      js: `/* ${meta.id}@${meta.version} — black-box task bundle. require("./task.bundle.js") -> { meta, createEnv }. See INTERFACE.md. */`,
    },
    outfile: path.join(outDir, "task.bundle.js"),
  });

  // 2. The runner, bundled self-contained (core inlined; registry/task/policy requires
  //    are dynamic and stay runtime-resolved). Unminified: framework code is not secret.
  esbuild.buildSync({
    entryPoints: [path.join(GYM, "runner", "run_policy.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    minify: false,
    legalComments: "inline",
    outfile: path.join(outDir, "run_policy.js"),
  });

  // 3. INTERFACE.md = core (with seed placeholders filled) + task section.
  const core = fs
    .readFileSync(path.join(GYM, "arena", "INTERFACE.core.md"), "utf8")
    .replaceAll("$TRAINING_SEEDS_FIRST", String(meta.training_seeds[0]))
    .replaceAll("$TRAINING_SEEDS", meta.training_seeds.join(", "));
  const taskSection = fs.readFileSync(path.join(taskDir, "INTERFACE.task.md"), "utf8");
  fs.writeFileSync(path.join(outDir, "INTERFACE.md"), core + "\n" + taskSection);

  // 4. Description + policy template.
  fs.copyFileSync(path.join(taskDir, "DESCRIPTION.md"), path.join(outDir, "DESCRIPTION.md"));
  fs.copyFileSync(path.join(GYM, "arena", "policy.template.js"), path.join(outDir, "policy.template.js"));

  // 5. Manifest (the version pin).
  return writeManifest(outDir, meta, "standard");
}

function writeManifest(outDir, meta, arenaMode) {
  const files = {};
  for (const f of fs.readdirSync(outDir).sort()) {
    files[f] = sha256(fs.readFileSync(path.join(outDir, f)));
  }
  // The pinned simulator artifact: gauntlet's task.bundle.js in standard mode,
  // or the overlay's own pre-built bundle (e.g. env.bundle.js) in overlay mode.
  const bundleFile = ["task.bundle.js", "env.bundle.js"].find((f) => fs.existsSync(path.join(outDir, f))) || null;
  const manifest = {
    format: "gauntlet_arena_manifest_v1",
    arena_mode: arenaMode,
    task_id: meta.id,
    task_name: meta.name,
    task_version: meta.version,
    bundle_file: bundleFile,
    bundle_sha1_12: bundleFile
      ? crypto.createHash("sha1").update(fs.readFileSync(path.join(outDir, bundleFile))).digest("hex").slice(0, 12)
      : null,
    max_steps_default: meta.max_steps_default,
    training_seeds: meta.training_seeds,
    criterion: meta.criterion || null, // the task-owned eval comparable (v2 seam)
    files,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  if (!a.task) {
    process.stderr.write("usage: node build_arena.js --task <id> [--out <dir>]\n");
    process.exit(1);
  }
  const outDir = path.resolve(a.out || path.join(GYM, "dist", "arena", a.task));
  const manifest = buildArena(a.task, outDir);
  console.log(`arena built: ${outDir} (${manifest.task_id}@${manifest.task_version}, bundle ${manifest.bundle_sha1_12})`);
}

module.exports = { buildArena };
