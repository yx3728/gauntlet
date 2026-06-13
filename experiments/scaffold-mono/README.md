# scaffold-mono — proposed prompt: structured-cognition, single agent, no enforcement

`PROMPT.md` is a **proposed** prompt for running the local harness's memory-equipped **v2**
cognitive architecture as a **single Claude Code `claude -p` session** (the "mono" form). It is for
the **Sonnet 4.6 and Haiku 4.5** arms — the weak/mid models the local-harness pilot found most
limited by *amnesia/drift and self-evaluation*, which structured cognition targets.

## What it is — and how it differs from the multi-agent original

The local harness (`ai_playtest_pipeline/local_agentic_harness/t3/ablation`, run `v2-r1`,
`prompts_v2.py`) runs the loop as a **team of separate role-agents** that communicate only through
files, with the **harness enforcing** the structure:

> `P(init) → [ S → Coder(build on best-so-far) → Evaluator(metric + rank + EVAL_REPORT) → P(if a new
> frontier was reached) ] × cycles`, append-only scored blackboard, best-so-far as the live base.

This prompt **folds those four roles (analyst / strategist / coder / evaluator) into one agent** and
asks it to **run the loop itself**, with **no enforcement** — no harness switching roles, no computed
EVAL_REPORT, no role-separated files. The **cognitive content is near-verbatim** from `prompts_v2.py`:

| role in v2 | lifted into PROMPT.md §"How to work" |
|---|---|
| `GROUNDING` (analyst) | "GROUND yourself" — observe geometry/motion via `pos` + SIGN of `vel`, controls/damage, objects/events; report only what's observed |
| `PERCEPTION_UPDATE` | "OBSERVE FURTHER when you break new ground" — update the world-model when a policy reaches further |
| `STRATEGIST` | "DIAGNOSE" (cite numbers; survive-to-boss vs damage-boss) + "EVOLVE & pick ONE change" (build on best; change approach if plateaued) |
| `CODER` | "IMPLEMENT on top of your best" (build on the best version, ~120 lines, never throws, deterministic) |
| `EVALUATOR` | "EVALUATE — and don't regress" (goal-tracking selection metric from `reward_info` fields; re-orient as boss becomes reachable; revert if a change regresses) |
| append-only best-so-far blackboard | folded into the evaluate step (don't build on a regression) — but **not** as file bookkeeping (see below) |

### Cognitive method, not a recipe — and not a deliverables spec

The original harness made the *framework* manage the blackboard: versioned policy files, an
auto-selected best-so-far live base, role-separated docs, a computed selection metric. In our pipeline
**Claude Code manages its own files and context**, and **only the final `policy.js` is scored**, so
this prompt deliberately:
- asks for **no deliverables** (no `report.json`) and **no file/version bookkeeping** — Claude Code
  decides how to manage its work;
- gives **no answers** — in particular it does **not** tell the agent *which* metric fields to weight
  or *when* (an earlier draft spoonfed "lean on `progress` early, put `boss_*` first once you reach
  the boss"; removed). It only states the *cognitive principle*: rank by something that tracks
  clearing, not a proxy, and revise as you learn;
- keeps the contract/robustness facts in the base task section (not repeated inside the loop).

The one behavioural carry-over from "best-so-far" is purely cognitive — *build on what improves, drop
what regresses, keep `policy.js` at your best* — with no instruction on how to store versions.

### Imperative loop + a required written memory (restored)

The loop is phrased as a **directive to run** ("run it"; "run this loop, in order, every cycle:",
numbered steps), not a soft suggestion — a too-optional framing reads as ignorable. And the agent is
**required to maintain two written files as its memory**, because Claude Code **auto-compacts context
over a long session** and specifics silently drop out:
- `GAME_MODEL.md` — the observed world-model (the analyst artifact, as in the original v2 `GROUNDING`
  / `PERCEPTION_UPDATE` roles), extended as it sees more;
- `WORKLOG.md` — a running record of the current diagnosis, the strategy in play, and what's been
  tried + what it did (the strategist's memory), so the agent can pick the thread back up after a
  compaction and a plateau forces a real change of approach.

These are the agent's **own memory parallel to its context**, not deliverables or artifact
bookkeeping — there is still no `report.json`, no policy versioning, no best-js selection (Claude Code
owns the file + context; only the final `policy.js` is scored).

## What is held constant vs the bare-prompt cohort

To make this a clean **ablation against the v2 cohort** (`cohort-v2-n2`), everything except the
cognitive scaffold is **identical**: same task/substrate (vendored v2 bundle), same goal, the **same
`win_speed` criterion verbatim**, same contract/robustness/deliverables, same regime (speed_cap 40,
90k), same hardened `claude -p` recipe, no horizon. The **only** added variable is the
"How to work" cognitive structure. So a Sonnet/Haiku arm under this prompt vs under the bare cohort
prompt isolates **"does informing the cognitive loop help?"**

## Strategy firewall (verified)

The added content is **domain-general process guidance** — how to think (diagnose with numbers, change
one thing, build on best, define a goal-tracking metric, observe before assuming), **not** game
strategy. It carries **no game facts, no how-to-win hints, no prior findings** — matching the local
harness's own discipline ("domain-general, no game facts / no strategy / no prior findings; metrics
derived from goal + env-native fields only"). The only game-specific nouns are those already in the
agent-facing `GAME_DESCRIPTION.md` / `INTERFACE.md` (the goal = defeat the boss; the `reward_info`
field names). This keeps it inside the same firewall the cohort prompt respects.

## Status

**Proposed only — not yet run.** If approved, it slots into the existing cohort runner as a new arm
set (Sonnet ×N, Haiku ×N) on the frozen draw, identical to how the cohort arms were launched, by
passing this prompt text instead of the bare one.
