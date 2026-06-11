# KICKSTART PROMPT — paste to Claude Fable (new folder)

You are building the MVP of a **long-horizon agent-eval framework**. `SPEC.md` in this folder is
your **north star** — read it fully first; it is the only governing document (the project is
deliberately simple — no constitution/CI apparatus). You are highly capable: I'm giving you the
**principles and the scope, not micro-decisions** — make the implementation calls yourself, in
keeping with the principles below.

## What you're building (and what you're NOT)
A clean **two-library** framework:
- **Lib1 (TS/JS)** — the gym: pluggable tasks computing `forward` (`reset/step`), a standard
  **task-agnostic** interface, a black-box-safe description, an in-process JS policy runner.
- **Lib2 (Python)** — `agents` module (a **pass-through shim**: spawn one black-box agent node →
  get a policy artifact + trace) and `eval` module (held-out scoring, baselines, a diagnostic
  probe, exposed as a **few API functions** — no CLI).

**Build to e2e-verified on 1–2 SMALL games, then STOP** before wiring the big roguelike. The big
game is too slow for e2e (~1h+ per policy); the small games are your fixtures.

## This is mostly productizing existing, proven code
A separate playtest folder exists; you **may read it and copy from it**. It already has
battle-tested pieces — determinism (a single seeded-PRNG override), `claude -p` orchestration with
isolation/JSONL/budgets, held-out eval, arena bundling + audit. **Reuse and refactor these** into
the clean two-lib structure rather than rebuilding from zero. Build clean in *this* folder.

## Principles, in priority order
1. **Engineering quality first.** Modularize (separate files, clean boundaries, no monoliths).
   **Unit tests at every major step.** Real incremental commits. `WORKLOG.md`.
2. **Generality, guaranteed.** Lib1 is forward-only and **task-agnostic** — a game's specifics
   (e.g. speed caps, bullets) **never leak upward**. Lib2 depends on the **interface contract**,
   not on Lib1 concretely. The agent is a **black-box node**; `eval` is indifferent to its insides.
3. **Interface generality (the seams).** Design — but do **not** build — three seams so v2 plugs
   in without rework: the **Lib1 task interface** (add tasks), the **`eval`↔`agents` seam**
   (add coordination topologies), the **node-type abstraction** (add node kinds). Shape them to
   accommodate the extension axes below.
4. **Extension-awareness (so the seams are shaped right — context, not work to do):**
   - *Lib1 axis:* more games → eventually a **non-game task** (a coding/algorithm task).
   - *`agents` axis:* more **node types** (a local-agent node) and **coordination topologies**
     (instruction-scaffold; multi-agent with on-disk reports — a scaffolding ladder).
   Build the seams to fit these; **implement only the shim** now.
5. **Simplicity (the counterweight).** Generality lives in the *interface*; simplicity lives in
   the *build*. **No GUI. No CLI. Just a few clean API functions.** Don't over-build; the shim is
   one node.

## Testing (required — see SPEC §4)
- Create **1–2 small, fast, structurally-different games** (tiny finite state, clear
  score/progress, a policy runs in seconds). They double as the **first generality proof**
  (same agent prompts run unchanged across them).
- **Mock-node e2e (workhorse, fast & free):** a stub node returns a fixed policy → run the full
  pipeline (`agents` → policy → `eval`) → assert it scores. The black-box-node abstraction is what
  makes this possible — use it.
- **Real-agent e2e (sparing):** one `claude -p` node writes a policy on a small game → full
  pipeline → scored. Use **sparingly** (usage limits); a local agent node is an acceptable
  alternative.
- Unit tests for: gym determinism, interface-contract conformance, held-out split,
  scoring/aggregation, the per-batch Lib1↔Lib2 boundary, the node shim.

## Definition of done (then stop)
- [ ] Two libs, modularized, clean interfaces.
- [ ] Lib1: task interface + JS runner + **1–2 small games** + determinism test.
- [ ] Lib2 `eval`: a few API functions (`run`, `analyze`, …) doing held-out scoring + baselines +
      the diagnostic probe.
- [ ] Lib2 `agents`: the shim (one node) + a **mock node**.
- [ ] **E2E green:** mock-node pipeline + **≥1 real `claude -p`** run on a small game.
- [ ] Unit tests green; incremental commits; `WORKLOG.md`.
- [ ] **STOP** before integrating the big roguelike.

## Working protocol
Full permission. Make implementation decisions yourself per the principles. **Stop and ask** only
on a genuinely blocking ambiguity or anything that would change the framework's semantics or
break the seams. Keep it simple; ship the MVP e2e-verified, then stop.

Start by reading `SPEC.md` and the existing playtest folder, then build.
