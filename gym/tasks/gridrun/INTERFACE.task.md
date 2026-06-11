## Task: GridRun (`gridrun`)

A turn-based crawler on a 9x9 grid, 3 floors. One action per step. This section
documents the complete shape of the task's config, actions, observations,
events, and scoring. Handle the whole space described here even if a short test
run never shows a given event or decision — the episode can end at any time.

### Coordinates

- `x` is the column, `0 .. grid.width - 1`, increasing **east** (rightward).
- `y` is the row, `0 .. grid.height - 1`, increasing **south** (downward).
- `north` decreases `y`; `south` increases `y`; `east` increases `x`; `west` decreases `x`.

### Config keys

| key         | type | default | meaning                                            |
| ----------- | ---- | ------- | -------------------------------------------------- |
| `max_steps` | int  | 400     | step budget; reaching it ends the episode (`"timeout"`) |

No other task-specific config keys.

### Action schema

```js
{ move: "north" | "south" | "east" | "west" | "wait",  // one cell per step
  choice: 0 | 1 }                                       // only read while a decision is pending
```

- A missing/invalid `move` is coerced to `"wait"`. Moving into a wall or off the
  grid leaves you in place (the step is still consumed).
- While `obs.pending_decision` is present, `move` is **ignored**; `choice`
  resolves the decision (missing/invalid `choice` defaults to option `0`). The
  resolving step consumes one step of the budget.

### Observation schema

```js
{
  step: int,                 // steps taken so far this episode
  steps_left: int,           // budget remaining
  floor: int,                // current floor, 1..floors_total
  floors_total: 3,
  grid: { width: 9, height: 9 },
  player: { x: int, y: int },
  walls: [[x, y], ...],      // impassable cells on this floor
  gems: [[x, y], ...],       // uncollected gems on this floor
  key: { held: bool,         // true once picked up on this floor
         x: int | null,      // cell position while not held; null when held
         y: int | null },
  exit: { x: int, y: int,
          open: bool },      // open === key.held; entering while open completes the floor
  hazards: [                 // 1..2 per floor
    { x: int, y: int,        // current cell
      frozen_for: int }      // steps this hazard will hold still (0 = it moves
  ],                         //   1 cell along its fixed patrol route each step)
  pending_decision: {        // PRESENT ONLY while a boon choice is open
    kind: "boon",
    options: [
      { index: 0, name: "treasure", desc: string },
      { index: 1, name: "stasis",   desc: string }
    ]
  },
  metrics: { ... }           // see Metrics below
}
```

Cell rules:

- Entering a gem cell collects the gem; entering the key cell picks up the key
  (each floor has exactly one key and one exit).
- Entering the exit with `key.held === true` completes the floor. Entering it
  while locked (`open === false`) is just standing on a normal cell.
- Entering a hazard's cell — or a hazard stepping onto yours — ends the episode
  with `done_reason: "death"`.
- Hazards patrol fixed routes deterministically. Each step you act first, then
  every hazard with `frozen_for === 0` advances one cell (and `frozen_for > 0`
  counts down by one instead).

Floor transition: completing floor 1 or 2 immediately shows the **next** floor
(your position is its start cell, `key.held` is reset to `false`) together with
`pending_decision`. Hazards do not move during the completing step or while the
decision is open. Completing floor 3 ends the episode with `"win"` instead.

Boon decision (`pending_decision.kind === "boon"`), resolved via `action.choice`:

- option `0` ("treasure"): a flat score bonus, banked immediately;
- option `1` ("stasis"): the new floor's hazards get `frozen_for` set (they hold
  still for your next 12 steps).

### Events

`event` is `null` or exactly one object per step (highest-priority occurrence):

| kind             | payload fields            | when                                            |
| ---------------- | ------------------------- | ----------------------------------------------- |
| `gem_collected`  | `x, y`                    | you entered a gem cell                          |
| `key_collected`  | `x, y`                    | you entered the key cell                        |
| `floor_complete` | `floor` (1 or 2)          | you exited a non-final floor (boon opens)       |
| `boon_chosen`    | `choice` (0 or 1)         | a pending boon decision was resolved            |
| `game_over`      | `reason`                  | terminal; `reason` ∈ `"win" "death" "timeout"`  |

`game_over.reason` always equals the final `metrics.done_reason`.

### Score formula & metrics

```
score = 15 * gems_collected
      + 100 * floors_completed
      + 40 * bonus_boons_taken
      + (on win only: 300 + min(steps_left_at_win, 100))
```

All components are finite and capped: at most 3 gems per floor, 3 floors, 2
boon decisions per episode.

```js
metrics = {
  score: number,            // formula above
  progress: number,         // running max of min(1, (floors_completed + 0.5*has_key) / 3);
                            //   1.0 only on a win
  done_reason: null | "win" | "death" | "timeout",
  floor: int,               // current floor, 1..3
  floors_completed: int,    // 0..3
  gems_collected: int,      // 0..9, episode total
  has_key: bool,            // holding the current floor's key
  bonus_boons_taken: int    // 0..2, times boon option 0 was taken
}
```
