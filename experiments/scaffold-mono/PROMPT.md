# Your task: clear the game

You are an autonomous coding agent. Write the best **policy program** you can for the game in this
directory, by iterating: write code, run it, read the results, improve it. **There is no time, turn,
or token budget — keep refining until you are confident it is your best.**

## Start here
Read these two files in your working directory **first**:
- `GAME_DESCRIPTION.md` — what the game is and what you are trying to achieve
- `INTERFACE.md` — the complete data/API contract for the environment

Other files here:
- `env.bundle.js` — the game environment (a black box; it is minified — reading it is not useful, and
  there is no other source here)
- `run_policy.js` — runs YOUR policy and prints metrics
- `policy.template.js` — a neutral starting point for your policy
- `play_step.js`, `expand_trace.js` — (not needed for this task)

## What to do
1. Copy `policy.template.js` to `policy.js` and implement the contract in INTERFACE.md §6:
   `module.exports = { init?(), policy(obs, mem) -> { action, mem } }`
2. Test it: `node run_policy.js` — plays the **whole game** (no time limit) on seed 1 and prints
   per-game and aggregate metrics. Read them. (You may run several seeds at once, e.g.
   `node run_policy.js --seeds 1,11,23 --json`, and judge by the multi-seed result so you don't tune
   to one seed.)
3. Revise `policy.js` and re-run. Repeat — thoroughly — to make it as good as you can.

## The goal
The single most important thing is to **CLEAR THE GAME (通关): survive the waves, grow strong enough,
and DEFEAT THE BOSS to win.** Find your way to do that. The game has **no time limit** — play it all
the way through; **surviving without beating the boss does NOT clear the game.** You will see many
metrics along the way (a `progress` bar toward the end — 1.0 = cleared — plus `boss_hp_destroyed`,
`score`, `level`, `kills`, …); they are useful references to gauge how you're doing, **not the
target.** Don't settle for grinding the easy points — aim to win.

## How your final policy is evaluated (the scoring criterion)
After your session, your final `policy.js` is scored on **held-out seeds you do not see**, at the
**default regime: `speed_cap = 40`, `max_steps = 90000` — fixed for evaluation.** (You may change
them while iterating; the evaluation always uses these.) Per held-out seed:

    eval_score = cleared ? 1 + (90000 − win_step) / 90000    // a win scores in (1, 2]: the EARLIER the win, the higher
                         : progress                           // a non-win scores its progress, in [0, 1) — below every win

where `win_step` is the step count at which the game was won. So: **winning the game is the
prerequisite — any win outranks every non-win. Among wins, winning SOONER is better.** The in-game
`score` metric is only a progress reference during play — it is NOT the evaluation criterion; do not
fixate on it or grind it.

## Robustness
Handle the WHOLE documented space (`INTERFACE.md`), including things a short test might not trigger: a
level-up panel can appear at any time — when one is open, its options are in
`obs.pending_upgrade.options`, and your action must include a valid `upgrade_choice`; the boss has
phases; the game can end. Your `policy()` must never throw and must always return a valid action, and
it must be a deterministic function of `(obs, mem)`.

## Discover by playing
You learn the game's dynamics from the metrics and behaviour you observe, not from reading the
environment. Form a hypothesis, test it with a run, keep what works.

---

# How to work: run a disciplined improvement loop yourself

You are working alone, but the strongest way to improve a policy on a hard, long game like this is to
**play four roles in your own head every cycle** — analyst, strategist, coder, evaluator — and to
**keep a short written memory on disk** so you never lose the thread or drift backwards across a long
session. Nothing here is enforced; it is the working method that wins. Keep your own lightweight notes
(e.g. `GAME_MODEL.md`, `NOTES.md`, and a saved `best_so_far.js`) and update them as you go.

## First — GROUND yourself (analyst)
Before optimizing, figure out **how this game's world actually works, by OBSERVATION — not how to
win.** Write a tiny policy that prints `obs` fields (or read the metrics/objects from a run) and
determine, citing the **actual numbers you see**:
- **Geometry & motion** — where objects of each type appear and how they move: inspect each object's
  `pos` and the **SIGN of its `vel`** across frames.
- **Controls & damage** — what `move` actually does (units, clamping — see `speed_cap` in INTERFACE),
  and how your ship's **automatic fire** behaves (determine it from the `player_bullet` objects you
  observe and the schema).
- **Objects & events you will encounter** — the object types in INTERFACE §3.1, and the
  `level_up` / `boss_phase` / `game_over` events.

Record this as a concise **world-model** (`GAME_MODEL.md`). Report ONLY what you observed or what
INTERFACE states — do not assume mechanics you haven't seen.

## Then — repeat this cycle until you are confident it is your best

**(1) DIAGNOSE (strategist).** Citing **specific numbers** from your latest runs, name the **single
most important reason your BEST policy so far still falls short of the GOAL** (clear the game — defeat
the boss). In particular, distinguish **"not surviving far enough to reach the boss"** from
**"reaching the boss but not damaging it."**

**(2) EVOLVE & pick ONE change (strategist).** Evolve your plan to fix **THAT** weakness, **building on
what your best policy already does well.** If your last change did **not** improve the best, **change
approach — do not restate it.** Then commit to **ONE concrete, implementable change** to make to the
best policy (what to add or alter, and why), stated relative to the current best.

**(3) IMPLEMENT on top of the best (coder).** Apply that one change by **BUILDING ON your best policy
so far** — start from it, apply the change. **Do NOT rewrite from scratch or throw away what already
works** unless the change truly requires it. Write the **FULL policy** as `policy.js`. Keep it
**SHORT and COMPLETE** (~120 lines, readable). Handle the whole schema so `policy()` never throws
(`level_up` via `obs.pending_upgrade.options`, boss phases, `game_over`); keep it deterministic in
`(obs, mem)`. Run it (a few seeds) and fix it until it runs cleanly **and** implements the change.

**(4) EVALUATE & keep the best (evaluator).** Decide a **selection metric** for ranking policies
toward the GOAL, using ONLY the env's own `reward_info` fields —
`{boss_cleared, boss_reached, boss_hp_destroyed, progress, score, kills, survived_ms, wave, level, hp}`
— as a lexicographic order or a weighted combination that tracks **CLEARING the game, not a local
proxy.** Ask **which fields can be high while making no progress toward winning**, and don't reward
those. **Re-orient the metric as the game opens up:** early on (boss never reached) it will lean on
`progress` / `survived_ms`; the moment you actually reach or damage the boss, put
`boss_cleared` / `boss_hp_destroyed` / `boss_reached` first. By that metric, decide: **is the latest
attempt better or worse than your best-so-far, and why?** If it is better, it becomes the new
best — **save it as `best_so_far.js`.** If it is worse, **keep the previous best** and build your next
change on that (never let your working policy drift to a worse version).

**(5) OBSERVE FURTHER when you break new ground (analyst).** Whenever a policy reaches **further into
the game than any before** — into regions earlier policies never survived to observe — look at the new
frames and **UPDATE `GAME_MODEL.md`** with the newly-visible mechanics (a boss and how it
behaves / moves / phases, new enemy or bullet types, new hazards), citing the actual numbers. Keep the
prior facts that still hold; add or correct only what the new region shows. Then feed that back into
your next DIAGNOSE.

**Memory discipline (why the notes matter):** keep an explicit **best-so-far** and always build the
next attempt on it; track **which strategies you've already tried and the best score each one led
to**, so that a plateau makes you genuinely **change approach** rather than restate a plan that didn't
work. This is the difference between iterating and thrashing.

## Seeds
By default you play seed 1; practising on a few (e.g. `--seeds 1,11,23`) and judging by the multi-seed
result helps you avoid tuning to one seed. Your final policy will also be checked on a **separate,
held-out set of seeds you do not see**, so prefer an approach that **generalizes** rather than fitting
the seeds you practise on.

## Deliverables (leave both in this directory)
- `policy.js` — your best policy (keep this file equal to your best-so-far at all times).
- `report.json` — write it once you have a working policy and keep it updated, with this exact shape:
  ```json
  {
    "best_result": { "cleared": false, "progress": 0.0, "level": 0, "wave": 0,
                     "boss_reached": false, "boss_hp_destroyed": 0.0, "score": 0, "survival_ms": 0 },
    "how_far": "one sentence: did you clear the game? how much boss HP did you destroy?",
    "failure_modes": ["what tended to kill you / limit you"],
    "lessons": ["what you learned about playing this game"],
    "attempts_used": 0
  }
  ```

Stay within this directory; everything you need is here. When you are confident you've done your best,
make sure `policy.js` and `report.json` are saved.
