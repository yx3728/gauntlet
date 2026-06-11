# SPEC — Long-Horizon Agent-Eval Framework (build north star)

> Single **north star** for this build. (Consolidates `PROJECT_CONCEPT.md` and adds the naming,
> testing, and governance decisions.) Governance is deliberately light: **this spec is the only
> law** — no constitution/CI apparatus; the project is simple. But **tests, modularization, and
> real incremental commits are non-negotiable.**

## 1. What it is
An open-source framework for **evaluating LLM agents on long-horizon tasks**: an agent (a
**black box**) develops a *policy* against a pluggable environment, scored on **held-out
instances**. The eval is **discriminating and diagnostic** (separates models, localizes *why*
each fails). Games are the first task domain; the design generalizes to any forward-computable,
scorable task and any agentic black box.

## 2. Architecture — two libraries

**Lib1 — the gym (TS/JS).** Pluggable games/tasks; each computes **forward** (`reset/step`) and
exposes a **standard, task-agnostic interface** + a black-box-safe description. Includes the
in-process **JS policy runner** and (later) the shared-core browser **human-recorder**. TS/JS is
forced (browser human-play + in-process policy execution).

**Lib2 — eval + orchestration (Python).** Two modules:
- **`agents`** *(module 1; was 2.3)* — the **black-box-node** layer: spawn an agent node, get back
  a **policy artifact + trace**. MVP = a **pass-through shim** (one node). Designed as a **seam**
  for future node types and coordination topologies (see §7); not built now.
- **`eval`** *(module 2; was 2.2)* — held-out scoring, baselines, robustness/diagnostic probes,
  methodology. **`eval` uses `agents`** to obtain policies, then scores them. This module holds
  the AI signal.

Python chosen for analysis convenience; the **Lib1↔Lib2 boundary is per-batch** (Python invokes
the JS runner once per policy×seed-batch) — coarse, never per-step; performance is **not** an MVP
concern.

**Flow.** `agents` spawns the node (e.g. `claude -p`, cwd = the JS **arena**: bundled Lib1 +
interface + description, **no source**) → the node writes a **JS policy**, tests it via Lib1's JS
runner in its arena → returns policy + trace. `eval` runs held-out scoring by invoking the JS
runner across held-out seeds → JSON → aggregate. The node is a **black box**; eval is indifferent
to its internals.

## 3. Design principles (hold even in MVP)
- **Lib1 forward-only & task-agnostic** — games never leak their specifics upward.
- **Lib2 depends on the interface contract, not on Lib1 concretely.** Agent = **black-box node**.
- **Simplicity in the build:** **no GUI, no CLI** — just a few clean **API functions** (called
  from a script/notebook). Generality lives in the *interface*; simplicity lives in the *build*
  ("design general, build minimal").
- **Black-box integrity** (node gets bundle + interface + description, no source).
- **Honesty/reproducibility:** traces, run manifests, held-out split, determinism.

## 4. Engineering quality & testing (REQUIRED)
- **Modularize** — separate files/modules; clean boundaries; no monoliths.
- **Unit tests at every major step** (gym determinism, interface-contract conformance, the
  held-out split, scoring/aggregation, the per-batch boundary, the node shim).
- **E2E does NOT use the big roguelike** (a real policy run there is ~1h+). The build **creates
  1–2 small, fast, structurally-different games** as e2e fixtures — a tiny finite-state game with
  a clear score/progress, where a policy runs in seconds.
  - These small games **double as the first interface-generality proof** (the portability check:
    same agent prompts run unchanged across them).
- **Two e2e levels:**
  - **Mock-node e2e (the workhorse, fast & free):** a stub node returns a fixed policy → full
    pipeline (`agents` → policy → `eval`) → assert it scores. *The black-box-node abstraction
    earns its keep here: it makes the pipeline testable without an LLM call.*
  - **Real-agent e2e (occasional, sparing):** a real `claude -p` node writes a policy on a small
    game → full pipeline → scored. Run **sparingly** (usage limits); a local agent node is an
    alternative.
- **Real incremental commits.** `WORKLOG.md` kept.

## 5. The MVP line (build exactly this; stop before the big game)
**In:** Lib1 (the task interface + JS policy runner + **1–2 small test games** + determinism);
Lib2 `eval` (held-out + baselines + the diagnostic probe, as a few **API functions** e.g.
`run(game, node, config) → trial`, `analyze(trial) → results`); Lib2 `agents` (the **shim**: one
black-box node, with a **mock** node for fast e2e and `claude -p` for real e2e); the **mock + a
sparing real** e2e green; unit tests green; modularized.

**Out (roadmap, §7 — do NOT build):** GUI; CLI; the big roguelike integration; multi-agent /
scaffolding implementation; the local-agent node; non-game tasks; any general framework.

**Done = e2e verified on the small games (mock + ≥1 real `claude -p`), API functions working,
tests passing, modularized — then STOP** before wiring the big game.

## 6. The seams (designed now, not built)
- **Lib1 task interface** → add games/tasks without touching Lib2.
- **`eval` ↔ `agents` seam (black-box-node)** → add coordination topologies without touching eval.
- **Node-type abstraction** → add node kinds (local agent, API loop) without touching eval/coord.

Design the seams to accommodate §7; implement only the shim + the small-game path.

## 7. Extension axes (so the seams are shaped right)
- **Lib1 axis (task generality):** a structurally-different game (cheap) → a **non-game task**
  (coding/algorithm → mini coding-bench). *Then* claim generality.
- **`agents` axis (the agent manifold — where the research rides):** **node types** (local-agent
  node via the MLX mini-harness; API-loop nodes) and **coordination topologies**
  (instruction-scaffold; multi-agent with on-disk reports + routing — the scaffolding ladder).
- **`eval` axis (incremental):** more probes/baselines; the human-vs-agent comparison (finite
  human cap from the recorder); the cross-scale failure-signature story.

## 8. Build context
This is largely **productizing + refactoring proven code**, not building from zero. The existing
playtest folder (which you may read and **copy from**) already has battle-tested pieces:
determinism (single seeded-PRNG override), `claude -p` orchestration with isolation/JSONL/budgets,
held-out eval, arena bundling + audit. **Reuse/adapt these into the clean two-lib structure**;
generalize the interface; add the small test games; modularize; test.
