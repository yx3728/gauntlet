# The Task Interface Contract (gym/core)

This is the **task-agnostic interface** every gym task must implement. Lib2 (evalkit) and
the generic runner depend on exactly this contract — never on a task's specifics. A task's
specifics (its action schema, its objects, its scoring details) live entirely inside the
task directory and its `INTERFACE.task.md`; they must never leak into core or Lib2.

The conformance suite (`gym/tests/conformance.test.js`) enforces this contract mechanically
for every task in the registry. A task is not done until it passes.

## 1. Module shape

A task is a directory `gym/tasks/<id>/` containing:

```
env.js              the simulator (single file; may use core/prng.js — nothing else)
DESCRIPTION.md      black-box-safe goal description ("store page" register; strategy-silent)
INTERFACE.task.md   the task-specific schema doc (appended to INTERFACE.core.md at arena build)
baselines/noop.js   trivial floor policy
baselines/greedy.js simple heuristic using only the documented interface (the
                    "interface sufficiency" reference — proves the docs are enough to play)
```

`env.js` exports:

```js
module.exports = { meta, createEnv };
```

- `meta = {`
  - `id: string` — must equal the directory name,
  - `name: string`,
  - `version: string` — semver of the task logic; bump on ANY behavior change
    (golden trajectory hashes pin this),
  - `max_steps_default: int` — every episode MUST terminate (done=true) within this
    many steps under ANY policy,
  - `training_seeds: int[]` — the seeds agents may practise on (visible in the arena);
    held-out seeds live orchestrator-side only and are ≥ 2000 by convention, so
    **generate content from the seed in a way that works for any 32-bit int/string**,
  - `example_actions: object[]` — 3–8 representative valid actions (JSON values).
    Used by the conformance fuzzer to exercise real code paths deterministically.
- `}`

## 2. Env API

```js
const env = createEnv();
let { obs } = env.reset(seed, config);        // start an episode
let { obs, done, event } = env.step(action);  // advance one decision step
```

- `reset(seed, config) -> { obs }` — `seed` is an int or string. The episode is a
  **pure function of (seed, action sequence)**: same seed + same actions ⇒ identical
  trajectory, every time, across instances and processes.
- `config` — optional object. `max_steps` is the one standard key (cap the episode; the
  task decides whether hitting it means `"timeout"`). Task-specific config keys are
  allowed; they are passed through Lib2 opaquely.
- `step(action) -> { obs, done, event }`
  - `done` — boolean. After `done`, further `step()` calls are idempotent no-ops returning
    the terminal state.
  - `event` — `null` or ONE object `{ kind, ... }` per step (if several things happen,
    surface the highest-priority one). A final `{ kind: "game_over", reason }` event is
    mandatory when the episode ends.

## 3. The metrics envelope (the task-agnostic part of obs)

`obs.metrics` MUST always be present and contain at least:

```js
obs.metrics = {
  score: number,        // the comparable composite; publish its formula in INTERFACE.task.md
                        //   and cap any farmable component (no unbounded grinding)
  progress: number,     // 0..1, MONOTONIC running max within the episode; 1.0 = task cleared
  done_reason: null | "win" | "death" | "timeout",
  // ... any task-specific numbers/booleans (aggregated generically by introspection)
}
```

Everything else in `obs` is task-specific, but:

- `obs` must be **fully JSON-serializable** and rebuilt fresh each step (no aliasing —
  mutating a previously returned obs must not change history).
- **Pending decisions must be visible IN obs** (e.g. `obs.pending_decision = { options:
  [...] }` while a choice is open), never only in `event` — policies see only obs.
- Keep units self-describing and consistent (document them in INTERFACE.task.md).

## 4. Actions: sanitize, never throw

`step()` must accept ANY value as `action` — `{}`, `null`, numbers, junk objects — and
coerce it to a safe default (typically "do nothing / default choice"). Every required
decision has a safe default so the env can never stall or crash on a malformed policy.
A policy that throws is handled by the harness (episode ends, `policy_error` recorded);
an env that throws is a contract violation.

## 5. Determinism

- ALL randomness comes from `new SeededPRNG(seed)` (require `../../core/prng.js`)
  constructed inside `reset()`. Never `Math.random`, `Date.now()`, or any ambient state.
- Different seeds must produce genuinely different episodes (content generation must
  depend on the seed).
- Module-level mutable state is forbidden — two envs created in the same process must not
  interact (cross-instance determinism is tested).

## 6. Size & speed budget

Tiny finite state; a full episode (≤ `max_steps_default` steps) must run in **well under
50ms**. These tasks are e2e fixtures: thousands of rollouts must be free.

## 7. Docs (black-box integrity)

- `DESCRIPTION.md`: the goal the way a player would understand it; genre, controls
  philosophy, win condition. **No mechanics numbers, no strategy hints** — "their effects
  are for you to observe."
- `INTERFACE.task.md`: the complete, neutral schema reference — config keys, action
  schema, the full obs schema, every event kind, the score formula and metrics fields.
  Document the SHAPE of everything; say nothing about how to play well. Include the
  warning to handle the whole event/decision space even if a short test never shows it.

## 8. Task-specific tests

Ship `gym/tests/<id>.test.js` with: behavior tests of the task's rules, plus **golden
trajectory hashes** (use `node tools/capture_golden.js --task <id>`) pinned for 2+ seeds —
the golden hash covers **state only** (obs minus `metrics`) so additive metric fields don't
invalidate goldens. Re-pinning a golden = a deliberate, reviewed act + a `meta.version` bump.
