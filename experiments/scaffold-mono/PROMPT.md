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
Only your **final `policy.js`** is scored — on **held-out seeds you do not see**, at the **default
regime: `speed_cap = 40`, `max_steps = 90000` — fixed for evaluation.** (You may change them while
iterating; the evaluation always uses these.) Per held-out seed:

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

# How to work: a cognitive method (not a recipe)

There are no answers here — only a way of thinking that tends to win on a hard, long game. Each cycle,
play four roles in your own head: **analyst, strategist, coder, evaluator.** Manage your own files and
context as you see fit; if there are hard-won findings you can't afford to lose as the session grows
(e.g. an observed world-model), consider writing them down and re-reading them.

**Ground (analyst).** Before optimizing, work out how the world actually behaves by **observation, not
by guessing how to win**: where each object type appears and how it moves (watch each object's `pos`
and the **sign of its `vel`** across frames), what `move` actually does (units, clamping — see
`speed_cap`), how your automatic fire behaves, and the objects/events you meet (INTERFACE §3.1;
`level_up` / `boss_phase` / `game_over`). Note only what you observed.

Then repeat:

- **Diagnose.** From the actual numbers, name the **single biggest reason** your best policy still
  falls short of the goal — e.g. is it failing to survive far enough to reach the boss, or reaching it
  but not damaging it?
- **Change one thing.** Evolve your plan to fix **that** weakness, building on what already works. If
  your last change didn't help, **change approach rather than restate it.** Commit to one concrete
  change.
- **Implement on your best.** Apply it on top of your current best policy — not a rewrite.
- **Judge toward the goal.** Decide for yourself how to rank policies so the ranking tracks **clearing
  the game**, not a local proxy that can climb while you get no closer to winning — and revise that
  judgement as you learn what actually matters. Build on what improves; drop what regresses; keep
  `policy.js` at your best.
- **Look further.** When a policy survives into territory you hadn't seen, observe the new mechanics
  there and fold them back into your next diagnosis.

## Seeds
By default you play seed 1; practising on a few (e.g. `--seeds 1,11,23`) and judging by the multi-seed
result helps you avoid tuning to one seed. Your final policy is also checked on a **separate, held-out
set of seeds you do not see**, so prefer an approach that **generalizes** rather than fitting the
seeds you practise on. When you're confident you've done your best, make sure `policy.js` is your
strongest version — it is the only thing scored.
