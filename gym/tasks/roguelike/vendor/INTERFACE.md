# INTERFACE.md — the environment API & data schema

This documents **everything you can observe and everything you can do** in the
environment. It is a complete, neutral reference: it describes the *shape* of the
data and the controls, and **says nothing about how to play well** — discovering
that is your job. Events documented here may not all appear in a short test; write
code that handles the **whole** space anyway (e.g. a level-up can pop up at any
time, a boss has phases, the game can end).

The environment is a **deterministic, tick-based, headless** simulator. It exposes
a Gym-style API. Coordinates: origin **top-left**, `x` increases **right**, `y`
increases **down**. All positions below are **object centers**. One "tick" is one
60 FPS frame of logical time; there is no wall clock.

---

## 1. The env object

```js
const { RogueEnv } = require("./env.bundle.js");
const env = new RogueEnv();
let { obs, reward_info } = env.reset(seed, config);     // start an episode
let { obs, reward_info, done, event } = env.step(action); // advance one decision
```

### `reset(seed, config) -> { obs, reward_info }`
- `seed` — integer (or string). The episode is a **pure function of the seed and
  your action sequence**: same seed + same actions ⇒ identical trajectory, every time.
- `config` (all optional):
  | key | default | meaning |
  |---|---|---|
  | `speed_cap` | `40` | max player **displacement per tick** (px). Your `move` is clamped to this **magnitude**: a move at or under it passes through unchanged; a larger one is scaled down to this length, **same direction** (not per-axis). Pass `Infinity` for uncapped. |
  | `frame_skip` | `1` | ticks advanced per `step()`. Your `move` is applied on each of those ticks. |
  | `max_steps` | `90000` | the episode ends on **win**, **death**, or when this many steps elapse (whichever first). 90 000 ≈ a long game; most finish well under it. **If your policy needs more time to finish (e.g. a slow grind), pass a larger value to extend**; pass a smaller one to cut runs short while iterating; `0` = no cap. |
  | `character_id` | `"striker"` | which ship. |

### `step(action) -> { obs, reward_info, done, event, ticks }`
- Advances the sim by `frame_skip` ticks (fewer if the episode ends or a decision
  point is hit mid-step), applying `action.move` each tick.
- `done` (bool) — episode over. After `done`, further `step()` calls are no-ops that
  keep returning the terminal state.
- `event` — `null` or a single event object (see §4). When several things happen at
  once, priority is `game_over` > `level_up` > `boss_phase`.
- `ticks` — how many ticks actually advanced this step (0 on a pure decision step).

---

## 2. Action schema

```js
action = {
  move: [dx, dy],        // desired per-tick displacement in px; clamped to speed_cap,
                         //   then to the screen. [0,0] = hold position.
  upgrade_choice: int|null  // REQUIRED only when the PRIOR step's event was level_up;
                            //   the index of the option to take. Ignored otherwise.
}
```
- Movement is the **only** continuous control — the ship **fires automatically**;
  there is no fire/aim action.
- If a `level_up` is pending and you pass `upgrade_choice: null` (or out of range),
  the env defaults to option `0` so the game can continue. Provide a real choice.

---

## 3. Observation schema

```js
obs = {
  frame: int,            // ticks elapsed this episode
  step:  int,            // step() calls so far
  frame_skip: int,       // ticks advanced per step() (your `move` is applied each tick)
  time_ms: number,       // in-game time elapsed (ms); frozen while an upgrade panel is open
  wave: 1|2|3,           // current stage
  field: { w, h },       // play-field size in px

  player: {
    pos: [x, y],         // center
    size: [w, h],
    hp, max_hp,
    shield_hp, shield_max,
    level, exp, xp_to_next,
    invincible_ms,       // >0 while temporarily invulnerable
    magnet_range,        // pickup radius (px)
    shoot_interval_ms,   // current autofire period
    side_bullets,        // extra side-stream count
    pierce,              // bool: shots pierce enemies
    satellites           // orbiting satellite count
  },

  objects: [ Obj, ... ], // everything on the field (see §3.1)
  spawned:   [id, ...],  // ids new THIS step
  despawned: [id, ...],  // ids present last step, gone this step

  reward_info: { ... },  // see §5

  // present ONLY while a level-up panel is open (otherwise absent):
  pending_upgrade: { options: [ { index, id, name, rarity, desc }, ... ] }
}
```

### 3.1 Objects
Every object has a **stable `id`** (same id across ticks while it lives; ids are
never reused), `type`, `pos` (center), `size`, and `vel` — velocity in **px per
tick**, the SAME units as `action.move`. Over one `step()` an object moves about
`vel × frame_skip` px, so to intercept a target with one step's move you want roughly
`(target_pos − player_pos)` spread across the step (per-tick `move ≈ (target − pos) /
frame_skip`). Type-specific fields:

| `type` | extra fields | notes |
|---|---|---|
| `enemy` | `hp, max_hp, enemy_type` | `enemy_type` ∈ `grunt, swift, tank, shooter, weaver` |
| `enemy_elite` | `hp, max_hp, enemy_type` | tougher enemy |
| `boss` | `hp, max_hp, variant, in_cutscene` | a boss; `variant` is a label identifying which boss this is (you may face more than one); `in_cutscene=true` ⇒ temporarily not a valid target |
| `enemy_bullet` | `dmg` | a hostile projectile |
| `item` | `item_type, exp_value` | a pickup (see below) |
| `player_bullet` | `dmg` | your own shot (shown for completeness) |

`item_type` ∈ `exp_small, exp_medium, exp_large, exp_huge` (experience),
`heart, bomb, magnet, coin` (common pickups), `levelup, invincible` (special
pickups that appear in some situations). Their effects are for you to observe.

---

## 4. Events

`event` is `null` most steps. The non-null kinds — **handle all of them**:

```js
// A level-up panel opened (the game is paused; time does not advance until resolved).
{ kind: "level_up",
  options: [ { index, id, name, rarity, desc }, ... ] }  // 2 or 3 options
```
Resolve it by returning, on your **next** `step`, an `action.upgrade_choice` equal to
one option's `index`. The panel may re-open immediately (multiple level-ups at once);
each is its own `level_up` event and consumes no game time. `rarity` ∈
`green, blue, purple, orange`. Some options are one-time; the set you see is
situational. **In the policy-coding path** (where `policy(obs, mem)` does not receive
the event), these same options are mirrored in **`obs.pending_upgrade.options`** while
the panel is open — read them there to choose deliberately.

```js
// A boss's state changed (a boss appeared, crossed an HP layer, or shifted phase).
{ kind: "boss_phase",
  variant, hp, max_hp, hp_layers_left, in_cutscene, first_sight }
```

```js
// The episode ended.
{ kind: "game_over", reason: "death" | "win" | "timeout" }
```

---

## 5. `reward_info` (metrics)

Reported every step and at episode end. These are **reference signals** to help you
gauge how you're doing — the goal itself is in `GAME_DESCRIPTION.md` (clear the game).

```js
reward_info = {
  progress,         // 0..1 — how far toward CLEARING the game (通关). 1.0 = cleared.
  boss_hp_frac,     // current boss HP remaining, 0..1 (null when no boss is present)
  boss_hp_destroyed,// current boss HP destroyed, 0..1 (null when no boss is present)
  score,            // a composite reference number (breakdown below)
  score_delta,      // change in score this step
  score_breakdown: { boss_cleared, wave, level, kills, survival_capped },
  survived_ms,      // in-game time survived
  survived_frames,
  steps,
  kills, level, wave,
  hp, max_hp,
  coins_earned,
  boss_reached,     // bool: a boss has appeared this episode
  boss_active,      // bool: a boss is currently on the field
  boss_cleared,     // bool: you have WON the game — all bosses defeated (通关)
  done_reason       // null | "death" | "win" | "timeout"
}
```
`score = 10000·boss_cleared + 2000·(wave−1) + 500·level + 100·kills + min(survived_seconds, 120)`
— one convenient summary among many. **Use these signals wisely; do not fixate on any single
metric.** Advancing through the game and, in the end, **winning it** is the ONLY goal — the
numbers are just references on the way there.

---

## 6. The policy contract (policy-coding path)

Author a module with this shape; the runner drives it:

```js
module.exports = {
  init() { return {/* your initial memory: any JSON-able value */}; },  // optional
  policy(obs, mem) {
    // ... decide ...
    return { action: { move: [dx, dy], upgrade_choice: null }, mem };
  }
};
```
- `mem` is **your** persistent strategic memory across steps within an episode (the
  env already gives you one-step derived features: `vel`, `spawned`, `despawned`).
  Return the (possibly updated) `mem` each step; it is passed back next step.
- `init()` is called once at the start of each episode. Keep `policy()` free of any
  external I/O; it must be a deterministic function of `(obs, mem)` for replays to hold.
- A `policy()` that throws ends that episode (recorded honestly) rather than crashing
  the batch — but you should handle the full schema so it doesn't.

See `run_policy.js --help` for how to run your policy and read back metrics.

**Per-game logs.** Every game you run is auto-saved (default `--log light`) to `game_logs/` as a
small, fully replayable record `{ seed, config, action_log, checkpoints, game_version }` — held in
memory and written once at the end (no per-step cost). `--log full` also embeds the per-step trace;
`--log none` turns it off. Regenerate a full per-step trace from any light log with
`node expand_trace.js game_logs/<file>`. (Your *code* history is already captured in the session
trace, so logs only need to record the games.)
