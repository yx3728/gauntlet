# INTERFACE.md — the environment API & data schema

This documents **everything you can observe and everything you can do** in this
environment. It is a complete, neutral reference: it describes the *shape* of the data
and the controls, and **says nothing about how to play well** — discovering that is your
job. Handle the **whole** space documented here anyway (events/decisions may not all
appear in a short test; the episode can end at any time).

The environment is a **deterministic, headless, step-based** simulator.

---

## 1. The env object

```js
const { meta, createEnv } = require("./task.bundle.js");
const env = createEnv();
let { obs } = env.reset(seed, config);        // start an episode
let { obs, done, event } = env.step(action);  // advance one decision step
```

- `reset(seed, config) -> { obs }` — `seed` is an integer (or string). The episode is a
  **pure function of the seed and your action sequence**: same seed + same actions ⇒
  identical trajectory, every time.
- `config` (all optional): `max_steps` caps the episode; task-specific keys are listed in
  the task section below.
- `step(action) -> { obs, done, event }` — `done` means the episode is over (further
  `step()` calls are no-ops returning the terminal state). `event` is `null` or a single
  event object (see the task section); the episode always ends with a
  `{ kind: "game_over", reason: "win" | "death" | "timeout" }` event.
- Malformed/missing actions are coerced to a safe default — the env never crashes on a
  bad action, but you should send well-formed ones.

## 2. Metrics (`obs.metrics`)

Reported every step. These are **reference signals** to help you gauge how you're doing —
the goal itself is in `DESCRIPTION.md`.

```js
obs.metrics = {
  score,        // a composite reference number (formula in the task section below)
  progress,     // 0..1, monotonic — how far toward fully clearing the task; 1.0 = cleared
  done_reason,  // null | "win" | "death" | "timeout"
  // ...task-specific metrics (task section below)
}
```

**Use these signals wisely; do not fixate on any single metric.** Clearing the task is the
ONLY goal — the numbers are references on the way there.

## 3. The policy contract

Author a module with this shape; the runner drives it:

```js
module.exports = {
  init() { return {/* your initial memory: any JSON-able value */}; },  // optional
  policy(obs, mem) {
    // ... decide ...
    return { action: {/* see the task section */}, mem };
  }
};
```

- `init()` is called once at the start of each episode.
- `mem` is **your** persistent memory across steps within an episode. Return the (possibly
  updated) `mem` each step; it is passed back next step. It must stay JSON-able.
- Keep `policy()` free of any external I/O; it must be a deterministic function of
  `(obs, mem)` for replays to hold.
- A `policy()` that throws ends that episode (recorded honestly) rather than crashing the
  batch — but handle the full schema so it doesn't.
- **If `obs.pending_decision` is present, a choice is open**: resolve it by including the
  documented choice field in your next action (a missing/invalid choice falls back to a
  safe default — make a real choice instead).

## 4. Running your policy

```
node run_policy.js --policy ./policy.js --seeds $TRAINING_SEEDS_FIRST --json
```

See `node run_policy.js --help` for all flags. `--seeds` accepts comma lists and ranges
(`1,2,5..9`).

**SEEDS:** the training seeds available to practise on are `$TRAINING_SEEDS` (start with
one; widen if you choose). Your final policy is also checked on a separate, **held-out**
set of seeds you don't see — prefer robust play over fitting one seed.

Every game you run is auto-saved (default `--log light`) to `game_logs/` as a small,
fully replayable record; `--log none` disables it.

---
