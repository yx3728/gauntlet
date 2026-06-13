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
EVAL_REPORT, no auto-selected best-so-far. The agent keeps its own lightweight memory on disk
(`GAME_MODEL.md`, `NOTES.md`, `best_so_far.js`). The **cognitive content is near-verbatim** from
`prompts_v2.py`:

| role in v2 | lifted into PROMPT.md §"How to work" |
|---|---|
| `GROUNDING` (analyst) | "GROUND yourself" — observe geometry/motion via `pos` + SIGN of `vel`, controls/damage, objects/events; report only what's observed |
| `PERCEPTION_UPDATE` | "OBSERVE FURTHER when you break new ground" — update the world-model when a policy reaches further |
| `STRATEGIST` | "DIAGNOSE" (cite numbers; survive-to-boss vs damage-boss) + "EVOLVE & pick ONE change" (build on best; change approach if plateaued) |
| `CODER` | "IMPLEMENT on top of the best" (build on best-so-far, full policy, ~120 lines, never throws, deterministic) |
| `EVALUATOR` | "EVALUATE & keep the best" (goal-tracking selection metric from `reward_info` fields; re-orient as boss becomes reachable; keep best-so-far, never drift) |
| append-only best-so-far blackboard | "Memory discipline" + maintain `best_so_far.js` |

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
