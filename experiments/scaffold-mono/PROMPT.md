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

# How to work: observe first, then run an improvement loop

This is a hard, long game; the reliable way to win it is to **first understand the world, then run a
disciplined loop many times** — so **run it**, and note which step you are on. You do the work of four
roles yourself — **analyst, strategist, coder, evaluator.** This is a way of working, not a source of
answers: the *how-to-win* is yours to discover.

**Keep a written memory — this matters.** Over a long session your context will be **automatically
compacted** as it grows, and specifics you were relying on can silently drop out. So maintain two
files on disk and re-read them as your real memory:
- `GAME_MODEL.md` — your factual picture of how the world works.
- `WORKLOG.md` — your running record: your current ranking rule, the latest evaluation/diagnosis, and
  **every attempt with its metrics and what you changed** — so that after a compaction you can pick
  the thread back up, and a plateau pushes you to change approach instead of circling.

**First, OBSERVE (analyst) — once at the start, and again only when new regions open up, not every
iteration.** By **observation, not by guessing how to win**, build a factual picture: where each
object type appears and how it moves (watch each object's `pos` and the **sign of its `vel`** across
frames), what `move` actually does (units, clamping — see `speed_cap`), how your automatic fire
behaves, and the objects/events you meet (INTERFACE §3.1; `level_up` / `boss_phase` / `game_over`).
Record it in `GAME_MODEL.md` — only what you actually saw, not what you assume. When one of your
policies reaches **further into the game than any before**, observe that new region's frames (run it
and inspect them) and fold them into your picture. Do not re-observe from scratch each turn.

**Then run this loop, in order, every iteration:**

1. **PLAN (strategist).** From your most recent EVALUATION (step 3 last iteration) and your world
   picture: name the **single main reason** your best policy so far still falls short of the goal,
   then decide a short, **ordered list of 2–4 concrete, implementable changes** to your best-so-far
   that address it, ordered by expected impact. Keep each change simple — prefer parametric or local
   edits; do not set yourself problems that need inventing new algorithms.

2. **IMPLEMENT (coder).** Write the policy that applies those changes, **building on your
   best-so-far** — edit it, don't rewrite from scratch; keep what already works. Write it out in
   full, as complex as the job needs. Then run it and read its metrics.

3. **EVALUATE (evaluator).** Assess what just happened, in two parts:
   - **(a) how you rank attempts** — state, and update as you learn, an explicit rule that ranks your
     attempts toward the goal (an ordering or a weighted combination of the env's own `reward_info`
     fields; INTERFACE: do not fixate on any single metric), and apply it to keep `policy.js` at your
     best. If a change regressed, build your next plan on the better version, not the worse one.
   - **(b) diagnosis** — in a few concrete lines from the `reward_info`: what the latest policy
     actually did (how far it got, where it died) and whether it beat your prior best, by which fields.

   This evaluation is what your next PLAN reads.

Keep iterating — PLAN, IMPLEMENT, EVALUATE — and don't stop while you can still improve. There is no
separate "final answer" to choose: `policy.js`, kept at your best, is the only thing scored.

## Seeds
By default you play seed 1; practising on a few (e.g. `--seeds 1,11,23`) and judging by the multi-seed
result helps you avoid tuning to one seed. Your final policy is also checked on a **separate, held-out
set of seeds you do not see**, so prefer an approach that **generalizes** rather than fitting the
seeds you practise on. `policy.js` is the only thing scored — make sure it is your strongest version.
