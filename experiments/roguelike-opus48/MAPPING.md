# Mapping — manual trial (`ai_playtest_pipeline`) → gauntlet (Step 1 deliverable)

Ground truth read (not modified): `trials/_template_v2` (the proven v2 template: speed_cap 40,
max_steps 90 000), `trials/ladder-t1` (the manual Opus 4.8 trial), `trials/ladder-t1-eval/RESULTS.md`,
`trials/TEMPLATE_VERSIONS.md`, `trials/MANIFEST.md`.

## What the manual agent saw ↔ where it lives in gauntlet

| manual trial (ladder-t1 / template v2) | gauntlet |
|---|---|
| `workspace/` 7 files: `env.bundle.js`, `INTERFACE.md`, `GAME_DESCRIPTION.md`, `run_policy.js`, `play_step.js`, `policy.template.js`, `expand_trace.js` | `gym/tasks/roguelike/vendor/` — **byte-identical** (sha256-verified against the v2 registry `trials/TEMPLATE_VERSIONS.md`), shipped verbatim into every trial workspace via the arena **overlay** mode |
| `PROMPT.md` (T1 bare; byte-identical v1==v2, sha `aac306f5…`) | `experiments/roguelike-opus48/PROMPT.base.md` (sha-checked copy) + **the one deliberate addition: the scoring-criterion section** (Step 3) → assembled `PROMPT.md`, passed to `evalkit.run(prompt=…)` |
| gym defaults: `speed_cap=40`, `max_steps=90000` (v2 runner defaults) | identical in the vendored runner the subject uses; **pinned structurally** in the canonical scoring task (`gym/tasks/roguelike/env.js`: speed_cap 40 / frame_skip 1 / 90k always) — tested (`gym/tests/roguelike.test.js`) |
| `claude --model claude-opus-4-8 --effort max --strict-mcp-config --dangerously-skip-permissions` (interactive; observed tool usage in its session trace: **only Bash/Edit/Read/Write**) | `ClaudeCodeNode("claude-opus-4-8", "max")` = the hardened **`claude -p`** recipe (strict-mcp-config, allowlist Bash/Read/Write/Edit/Glob/Grep, deny Web*/Task) — carried over per the task brief |
| unlimited session (hand-run) | **no artificial limit**: wall-clock 8h / 2000 turns as RUNAWAY BACKSTOPS only (user-approved; expected 1–3h); deliverables-on-disk safety net retained |
| held-out: fixed seeds 2000–2029, scored by `heldout_eval`-style sweep scripts at explicit flags | canonical: `evalkit.run` → unpredictable held-out draw, scored through the canonical repo task at 40/90k; **plus** a secondary fixed-seed 2000–2029 scoring (`evalkit.score_policy`) for direct comparability with the manual numbers |
| in-game `score` (composite, formula in INTERFACE §5) | **unchanged**; mapped to `obs.metrics.score` as the tracking reference. Eval comparable (`eval_score`, win-speed-aware) is computed by gauntlet post-hoc and never shown during play |
| `report.json` self-report shape | unchanged (same shape requested in the same prompt text) |
| trial provenance: `.template_version` stamp + TEMPLATE_VERSIONS registry | `manifest.json` in the arena/workspace (sha256 of every shipped file) + `trial.json` |

## Deltas (everything else is carried over unchanged)

1. **DELIBERATE (Step 3):** the scoring criterion — winning is the prerequisite; among wins,
   earlier is higher (`eval_score`); stated plainly + strategy-silent in the prompt addition.
2. Workspace contains one extra file: `manifest.json` (gauntlet's provenance/audit anchor;
   content-neutral — file hashes + training seeds already disclosed in the runner). The agent also
   does not get `README.md`-style trial notes (the manual agent never saw those either).
3. Interactive session → headless `claude -p` (prescribed by the brief: "the hardened `claude -p`
   recipe … carried over unchanged"). The manual session's actual tool usage (Bash/Edit/Read/Write)
   is fully inside the gauntlet allowlist, so the narrower surface is not a behavioral restriction
   in practice.
4. Held-out seed SET differs (unpredictable draw vs fixed 2000–2029) — prescribed by the brief
   (Step 4.3); mitigated by the secondary fixed-seed scoring for the comparison table.
5. Dev regime context: the manual Opus trial ran under **v1 (speed_cap=∞)** and its policy was
   later swept across caps; **no Opus@40-developed trial exists** (v2 has zero trials). So the
   faithfulness comparison crosses regimes; this trial = Opus developed AND scored at 40/90k.
   We additionally score the manual ladder-t1 policy through gauntlet at 40/90k (the same-regime
   measured anchor) and reproduce its ∞ clears exactly via the vendored runner.

None of the deltas changes what the subject is told about the game (STOP-and-flag rule satisfied:
items 2–4 are harness-side and/or prescribed by the brief; item 5 is a property of the available
baseline, recorded honestly here and in the report).

## Comparison baseline (from `ladder-t1` / `ladder-t1-eval`, verified against the RAW sweep data)

- Held-out (30 seeds, 2000–2029): **20% clear @90k @∞** (6/30; converged — every 30k-timeout
  resolved by 90k); 7% @30k.
- **Finite caps (90k sweep, per `speed_sweep_90k.csv` — NON-monotonic, low-rate):** 0 @2–5,
  **3% @6**, 0 @8–10, **3% @12**, 0 @14, **7% @19**, 0 @20, **7% @50**, **3% @90**, 20% @∞.
  **Cap 40 was never swept**; its nearest measured neighbors are 0% @20 and 7% @50 on a verified
  non-monotonic curve (the "death valley" finding in `HUMAN_SPEED_FINDINGS.md`), so no value can
  be interpolated — the only valid @40 anchor is our directly measured one below.
- **Same-regime measured anchor:** the manual ladder-t1 policy scored canonically @40/90k on
  seeds 2000–2029 = **0/30, 100% death, progress mean 0.3425**
  (`manual_policy_at_40_90k.json`; ±1 seed = 3.3pp at n=30 — 0/30 vs 2/30 is within noise).
- Win timing among the six ∞/90k held-out clears (steps): **25129, 26827, 40198, 59337, 76138,
  78336** — the "~25–30k on the fast seeds, up to ~78k with the full budget" story.
- Self-eval-vs-canonical gap: the subject's self-reported ~51% clear (measured by itself, at its
  own ∞ dev regime, on self-chosen "held-out-style" seeds) vs 20% canonical held-out — a
  self-evaluation-vs-canonical gap, not a clean train-vs-held-out measure.
- Verified deterministic: clears reproduce exactly (e.g. 2008→win@25129, 2011→win@26827 —
  reproduced byte-exactly on OUR vendored bundle pre-run).

## Confounds the report must disclose

1. **n = 1 session per arm** — Claude sampling is nondeterministic; at 30 seeds, ±1 seed = 3.3pp;
   clear-rate deltas of a couple of seeds are within session variance.
2. **Criterion-as-treatment:** the scoring-criterion addition is *expected* to change behavior
   (win-first, speed-aware). Faithful reproduction applies to the substrate, never the behavior.
3. **Dev-regime shift is bundled with the treatment** (v1 ∞ → v2 40/90k, prescribed by the brief):
   at n=1, the criterion effect is not separable from the regime effect.
4. **Backstop contingency:** if the node status is `timeout_killed` (8h/2000-turn runaway
   backstop fired), the comparison is against a truncated development run — must be stated.
5. Headless `claude -p` vs interactive session; held-out seed set differs (mitigated by the
   secondary fixed-seed 2000–2029 scoring).
