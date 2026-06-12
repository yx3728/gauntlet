# INTERIM REPORT — gauntlet's first real trial: the big roguelike × frontier agents

**Engineering proof:** gauntlet (the two-library agent-eval framework built in this repo) took a
real frontier agent through a genuinely long-horizon task on the big game — the manual-trial
pipeline's roguelike — **entirely through the framework**, and produced meaningful, faithful data.
This report covers the Opus 4.8 trial in full; the chained Sonnet 4.6 and Fable 5 trials (same
conditions) are appended as they complete.

Everything here is reproducible from persisted artifacts: `runs/roguelike-<model>-max/` (trial.json,
heldout.json, training.json, baselines.json, audit.json, comparison.json, trace.jsonl) with copies
archived under `experiments/roguelike-opus48/results/`. Mapping + deltas + confounds:
`experiments/roguelike-opus48/MAPPING.md`.

---

## 1. Setup (one deliberate change, everything else carried over)

- **Substrate:** trial template **v2** (speed_cap 40 px/tick, max_steps 90 000) vendored
  **byte-identically** (sha256-verified, all 7 workspace files) into a thin gauntlet task adapter
  that pins the eval regime structurally. The subject's workspace is those 7 files + a
  `manifest.json` provenance pin — nothing else.
- **Prompt:** the manual trial's T1 bare prompt **verbatim** (sha-gated at assembly) + the ONE
  deliberate addition (Step 3): the evaluation criterion —

      eval_score = cleared ? 1 + (90000 − win_step) / 90000   // wins in (1,2]; earlier = higher
                           : progress                          // non-wins in [0,1); below every win

  stated plainly and strategy-silently (winning is the prerequisite; among wins, sooner is better;
  the in-game score is a reference only). The eval comparable is computed by gauntlet post-hoc and
  never shown during play.
- **Node:** `ClaudeCodeNode` — the hardened `claude -p` recipe (strict-mcp-config, tool allowlist,
  Web*/Task denied), **no artificial horizon** (8h wall / 2000-turn runaway backstops only).
- **Scoring:** canonical, outside the node's reach: gauntlet re-scores the final `policy.js` at
  **40/90k** on a **fresh unpredictable held-out draw** (30 seeds), plus the manual trial's fixed
  seeds 2000–2029 for direct comparability, plus the task's three baselines on the same seeds.

### Faithfulness verification (before any tokens were spent)

| check | result |
|---|---|
| vendored files vs template-v2 registry | sha256 **identical**, all 7 + prompt |
| manual verified clears on OUR substrate | **byte-exact**: 2008→win@25129, 2011→win@26827 |
| cross-runner determinism (subject runner vs canonical scorer) | byte-identical over 2000-step trajectories (test in suite, 129/129 green) |
| mock-node full pipeline on the big game | green; every artifact persists |
| mid-run SIGKILL resilience | green; on-disk policy still scored |
| manual policy scored at the new regime (the same-regime anchor) | 0/30 @40/90k, 100% death, progress 0.3425 |

## 2. Headline result — Opus 4.8 (effort max)

The node ran **171.7 minutes** (2.9 h) and terminated **on its own** (no backstop, no kill): wrote
`policy.js` + `report.json`, iterated through ~135 runner invocations and 74 edits, audit-clean
behavior (benign /tmp scratch only).

**Canonical held-out, 30 unpredictable seeds, 40/90k:**

| metric | value |
|---|---|
| **clear rate (通关, primary)** | **73.3% (22/30)**, Wilson95 [0.56, 0.86] |
| **win_step among clears (NEW dimension)** | median **56 979**, mean 55 265, range 29 600–80 085 |
| eval_score | mean 1.127, median 1.331 |
| progress mean | 0.844; failures: 8 deaths (progress 0.40–0.90), 0 timeouts, 0 policy errors |
| fixed seeds 2000–2029 (manual's set) | **76.7% (23/30)**, win median 58 361 |
| baselines (same seeds) | noop 1 872 / greedy 7 193 / smart 8 076 mean score → policy at 12.8 on the noop→greedy scale |

**Comparison to the manual trial (`ladder-t1`, the baseline this reproduces against):**

| arm | dev regime | clear @40/90k (2000–2029) | clear @∞/90k | win steps |
|---|---|---|---|---|
| manual Opus 4.8 (interactive, v1, ∞) | ∞ | **0/30** (measured anchor) | 20% (6/30) | 25 129–78 336 (∞ only) |
| **gauntlet Opus 4.8 (this trial, v2, 40)** | 40 | **76.7% (23/30)** | 76.7% (23/30, diagnostic) | 40 645–88 951 @ fixed seeds |

Reading this honestly (see Confounds): the gauntlet run did not merely *reproduce* the manual
clear-rate — it transformed it. The manual ∞-developed policy collapses to 0/30 at the 40-cap
regime (and its finite-cap sweep is non-monotonic, 0–7%, with cap 40 never swept); the
gauntlet-run agent, developing **under** the eval regime with the **win-first criterion stated**,
produced a policy that clears ~3/4 of held-out seeds — and is regime-robust (identical behavior at
∞: it hardcodes its own 40 px/tick movement, i.e. the agent internalized the eval condition).
The *capability* story is consistent with the manual record (same model, same game, same
interface; the manual agent's own self-estimate at its own regime was ~51%); the *outcome* story
shows how much the eval's stated criterion + dev regime matter. At n=1 per arm, the criterion
effect and regime effect are bundled and not separable.

**The new dimension the manual trial lacked:** among the 22 canonical clears, win_step spans
29 600–80 085 (median ~57 k) — a full speed distribution per policy, automatically produced by the
eval_score criterion, at zero extra cost. The manual pipeline only ever observed win timing
incidentally (six clears, 25–78 k).

**Overfit signal:** training seeds 76.9% (10/13) vs held-out 73.3% — no gap (the manual trial's
self-report-vs-canonical gap was ~51% → 20%). The subject's self-report here (~87% on self-chosen
seeds) vs 73.3% canonical is a modest self-eval gap, now measured rather than guessed.

## 3. Integrity & engineering checklist

- **Parity gate (publish-blocker, passed):** the final policy replayed through the SUBJECT's own
  vendored runner vs gauntlet's canonical scorer — per-seed identical on all 8 fields (steps,
  score, done_reason, progress, kills, level, wave, survived_ms).
- **Audit:** verdict "review" — all findings are benign `/tmp` scratch-file reads by the agent's
  own analysis scripts; zero network/MCP/source-reach/tamper findings; workspace hash-verified
  against the manifest (the agent's 20+ exploration scripts are expected artifacts).
- **Artifacts:** every required file persisted (trial.json, heldout.json, training.json,
  baselines.json, audit.json, prompt.txt, 3.8 MB trace.jsonl, comparison.json, ANALYSIS.md).
- **Kill-resilience:** proven in the pre-run smoke (SIGKILLed node's on-disk policy scored
  end-to-end); not needed in the real run (clean self-termination).
- **Same pipeline, unchanged:** the identical `evalkit.run`/`analyze` path that runs the two small
  MVP games ran the big game; the only task-specific code is the thin adapter + this experiment's
  analysis scripts.

## 4. Confounds (must be read with the table)

1. **n = 1 session per arm**; at 30 seeds ±1 seed = 3.3 pp (Wilson CIs reported throughout).
2. **Criterion-as-treatment:** the scoring section is *meant* to change behavior; faithfulness
   claims apply to the substrate, never the behavior.
3. **Dev-regime shift bundled with the treatment** (manual = v1/∞; this = v2/40, per the brief):
   the two effects are not separable at n=1.
4. Headless `claude -p` vs interactive manual session (observed manual tool usage was inside the
   gauntlet allowlist; both 1M-context, verified).
5. Held-out seed sets differ (unpredictable draw vs fixed 2000–2029) — both reported; they agree
   (73.3% vs 76.7%).

## 5. Chained trials (same conditions, serial — per user directive)

| arm | status | clear @40/90k canonical (Wilson95) | clear @40/90k fixed 2000–2029 | win_step median (clears) | session |
|---|---|---|---|---|---|
| Sonnet 4.6 / max | **done** | **16.7%** (5/30) [.07,.34] | 3.3% (1/30) | 40 733 | 3.6 h, self-terminated, audit **flagged** (see below) |
| Opus 4.8 / max | **done** | **73.3%** (22/30) [.56,.86] | 76.7% (23/30) | 56 979 | 2.9 h, self-terminated, audit review (benign) |
| Fable 5 / max (single `-p` node) | **done** | **90.0%** (27/30) [.74,.97] | 80.0% (24/30) | 40 463 | 3.2 h, self-terminated, audit **clean** |

### Sonnet 4.6 leg — detail

- Manual Sonnet baseline (`ladder-t1-sonnet46`, ∞-developed): **0% at every cap including ∞**;
  combat-bottlenecked. Gauntlet's 40-developed Sonnet: 16.7% canonical / 3.3% on the manual's
  fixed seed set — above zero, far below Opus. Parity gate OK; zero policy errors.
- **Seed-set sensitivity is real at low rates:** 5/30 on the canonical draw vs 1/30 on
  2000–2029 (overlapping CIs; Fisher p≈0.2) — the per-seed-set numbers are both reported, and
  this spread is itself a finding the manual single-set methodology could not see.
- **Overfit, measured:** training seeds 30.8% clear vs held-out 16.7%; score 34.3k vs 23.1k —
  the overfit signature the manual pipeline saw in Sonnet, now quantified by the probe.
- Wins, when they come, are FAST: median 40 733 steps (min 20 289) vs Opus's 56 979 — a
  high-variance rush profile vs Opus's reliable grind (visible only in the win_step dimension).
- No `report.json` — and the trace shows WHY (errata E4): the prompt's report instruction
  was **destroyed by auto-compaction** (it survives only as a vague echo in the compaction
  summaries; near session end the agent deliberates "Let me check if there's a report.json
  format to write" and never recovers the schema). This is a compaction casualty, not mere
  agent indiscipline; deliverables-on-disk carried the trial. Not regime-robust: @∞
  diagnostic 3.3%. Its own in-trace broad scan (36/500 self-run seeds = 7.2% [5.2, 9.8])
  suggests the 16.7% canonical headline was a lucky draw.
- **Audit flagged — forensics (CORRECTED in §7, errata E1/E2):** (a) one `credential_access`
  hit is a false positive (the agent read its OWN session's tool-result overflow under
  `~/.claude/projects/<this-session>/…`); (b) the audit flagged 3 `repo_reach_in_command`
  hits, but the retrospective trace audit found **~10 git commands total — the cwd-relative
  ones were missed** (no absolute path to match). The unflagged `git log --oneline -5`
  returned commit messages **containing the Opus arm's result** ("Opus 4.8 trial results:
  73.3% canonical held-out clear…"), and `git ls-files` listed framework source filenames.
  So the information gained was MORE than the original "filenames only" forensic stated:
  prior-arm headline numbers (anchoring contamination), though still no seeds, no game
  source contents, no strategy. **Held-out scoring integrity holds** (seeds existed only in
  orchestrator memory; canonical re-score outside the workspace), but the audit verdict
  under-reported the reach, and the contamination existed because results were committed
  mid-chain into the same repo the workspaces live in. Fixes in §8.
- **Condition asymmetry (disclosed late — errata E3):** Sonnet ran at a **200k context
  window with 5 auto-compactions** (each wiping ~90% of working memory, ~170k→~14k tokens),
  while Opus and Fable ran at 1M with zero. The `run_trial.py` "identical conditions" claim
  is false for this arm; compaction demonstrably degraded the session (see report.json note
  below) and plausibly contributes to Sonnet's fragile profile.

### Fable 5 leg — detail

- Single `-p` node (NOT multi-agent): the manual fable arm that scored 97% @∞ was ultracode
  multi-agent orchestration — not comparable; the manual single-agent fable arm was never
  evaluated, so **this is the first single-agent Fable number on this game**: 90% canonical /
  80% on the manual's fixed seed set, audit **clean**, parity gate OK, zero policy errors.
- **Fast as well as reliable:** win_step median 40 463 — Opus-level clear-reliability territory
  at Sonnet-level win speed; min 9 600 steps (the fastest win observed in any arm, manual or
  gauntlet); eval_score mean 1.469 (vs Opus 1.127, Sonnet 0.549).
- Training 92.3% vs held-out 90% clear — no clear-rate overfit (training score mean is higher
  because practice runs farmed longer).
- Session behavior (CORRECTED — errata E2/E5): used background-shell parallelism (31
  TaskOutput reads of its own Bash jobs). TaskOutput/ToolSearch are **not in the allowlist**
  — they are permission-exempt harness machinery, revealing that `--allowedTools` is a
  permission gate, not a closed tool universe (benign here; audit rule added to the roadmap).
  And the "no boundary findings" claim was a **false negative**: at session start Fable ran
  an unflagged cwd-relative repo probe (`git rev-parse --show-toplevel && git log --oneline |
  head -20 && git ls-files | head -50`) and saw BOTH prior arms' headline results in commit
  messages. No seeds/source/strategy contents; held-out integrity holds; but the verdict
  "clean" was wrong and the later arms of the chain were anchoring-contaminated by
  mid-chain result commits.
- Self-report: 94.2% over 131/139 self-run seed-episodes, median ~43.7k — close to canonical
  (90%, 40.5k): the most calibrated self-eval of the three arms.

## 6. Synthesis (all three arms, identical conditions)

The eval discriminates cleanly and in a new dimension the manual pipeline lacked:

| | Sonnet 4.6 | Opus 4.8 | Fable 5 |
|---|---|---|---|
| canonical clear @40/90k (own draw) | 16.7% | 73.3% | 90.0% |
| fixed seeds 2000–2029 | 3.3% | 76.7% | 80.0% |
| **pooled (both sets, n=60)** | **10.0%** [4.7, 20.1] | **75.0%** [62.8, 84.2] | **85.0%** [73.9, 91.9] |
| eval_score mean | 0.549 | 1.127 | 1.469 |
| win_step median | 40 733 | 56 979 | 40 463 |
| session cost / turns / compactions | $22.86 / 274 / **5** | $53.23 / 269 / 0 | $81.43 / 234 / 0 |
| context window | **200k** | 1M | 1M |
| profile | fragile rusher (fast rare wins, 83% death, overfits) | reliable grinder (slow consistent wins, no overfit) | fast + reliable (calibrated self-eval) |
| manual baseline (∞-dev) | 0% at every cap | 20% @∞ / 0% @40 | n/a single-agent (97% @∞ multi-agent) |

**Paired comparison caveat (errata E6 — important):** the canonical numbers were measured on
three DISJOINT unpredictable draws (zero seed overlap). On the one **shared** seed set
(2000–2029) the apparent Opus-vs-Fable reliability gap shrinks from 16.7pp to **3.3pp**
(76.7% vs 80.0%; McNemar discordants 5 vs 6 — not significant at n=30). What robustly
separates Fable from Opus in this data is **win speed** (median 40.5k vs 57k steps,
eval_score 1.469 vs 1.127) and cross-regime stability — NOT clear-rate. Sonnet ≪ both holds
on every seed set. Chain total cost: **≈ $157.52**.

- **Faithfulness:** substrate byte-identical and exact-reproducing; parity gate passed on every
  arm's final policy; the model ORDERING reproduces the manual record (Sonnet ≪ Opus < Fable)
  with the same qualitative failure modes (Sonnet combat-bottlenecked/fragile; Opus
  survival-first grinder).
- **The treatment matters:** developing UNDER the eval regime with the win-first criterion
  lifted every arm far above its ∞-developed manual counterpart evaluated at 40 (Sonnet
  0→3–17%, Opus 0→73–77%). At n=1 the criterion and regime effects are bundled (Confounds §4).
- **The new dimension works:** win_step separates Fable from Opus (same-ish reliability, ~1.4×
  faster wins) — invisible to a clear-rate-only eval.
- **Engineering:** three multi-hour frontier sessions ran end-to-end through the unchanged
  pipeline with zero orchestration failures, full artifact persistence, working integrity
  audits (one benign-review, one real-but-contained flag, one clean), and deterministic
  canonical re-scoring throughout.

---

## 7. Errata (corrections to this report's earlier statements)

Scientific record of claims this report (or its sources) made that the post-chain
retrospective audit — 4 investigators + adversarial verifiers over the traces, artifacts,
and code — disproved. Each was corrected in place above; this section preserves what was
wrong and how it was caught.

| # | wrong claim (where) | corrected finding (evidence) |
|---|---|---|
| E1 | "Information gained: top-20 tracked FILENAMES … no file contents" (§5 Sonnet forensics) | Sonnet ran ~10 git commands; the audit flagged only the 3 carrying absolute paths. The unflagged cwd-relative `git log --oneline -5` returned **commit messages containing the Opus arm's result**; `git ls-files` listed framework source names. (Verified in trace tool_results.) |
| E2 | "within the tool allowlist; no boundary findings at all" (§5 Fable) | TaskOutput/ToolSearch are permission-exempt harness tools, **not** allowlisted — `--allowedTools` is a permission gate, not a closed tool universe. And Fable ran an **unflagged** session-start repo probe seeing BOTH prior arms' results; the audit verdict "clean" was a false negative. |
| E3 | "All trials in the series run under IDENTICAL conditions; only the model differs" (run_trial.py) | Sonnet ran at a **200k context window with 5 auto-compactions** (~170k→~14k tokens each); Opus/Fable at 1M with zero. Effective memory is part of the treatment and differed structurally. (Trace `modelUsage.contextWindow` + `compact_boundary` events.) |
| E4 | Sonnet's missing report.json attributed to "the known ~1/2 self-report capture failure mode" (§5) | It was a **compaction casualty**: the report instruction was compacted out of context; the agent later deliberated "Let me check if there's a report.json format to write" and never recovered the schema. The previously known mode was SIGKILL truncation; this is a new, distinct mode. |
| E5 | "audit: clean" treated as "no boundary events" (Fable row, §5 table) | Verdict stands as the audit's output, but it missed a real (benign) boundary event — recorded here as a false negative of the current rule set. |
| E6 | §6 presented 73.3% vs 90.0% as the headline Opus/Fable comparison | Those numbers come from **disjoint seed draws**. On the shared set: 76.7% vs 80.0%, McNemar 5-vs-6 discordants — no significant reliability difference. The robust Fable-vs-Opus separations are win speed and regime stability. |

The corrections do not change: the model ORDERING (Sonnet ≪ Opus ≈/≲ Fable), every
faithfulness result (substrate byte-identity, exact reproductions, parity gates), the
manual-baseline comparisons, or any canonical number — those re-derive exactly from the
persisted per-seed artifacts. What changes is the cross-arm *interpretation* (E3, E6) and
the audit's *completeness story* (E1, E2, E5).

## 8. What the three trials revealed about gauntlet (framework retrospective)

Method: a 4-pool retrospective audit (session-trace forensics; framework fit; integrity
layer; eval methodology) of ~9.7h of frontier sessions, 33 findings, every high-impact one
adversarially verified against the artifacts (0 refuted). Full detail in the audit outputs;
this section is the curated, prioritized result.

### 8.1 What held up under real load (validated design bets)

1. **Canonical-scoring independence is the load-bearing integrity wall — and it held.**
   Everything that went wrong at the node boundary (repo peeks, compactions, tool-surface
   drift) was *contained* by scoring the final policy outside the node's reach on
   memory-only seed draws: parity gates passed per-seed on all three arms; zero policy
   errors across 180 canonical episodes; workspace re-hash clean everywhere.
2. **Deliverables-on-disk as the unit of success.** All three nodes self-terminated well
   under the backstops (234–274 turns vs 2000; 2.9–3.6h vs 8h), and the one lost deliverable
   (Sonnet's report.json) cost nothing scientifically because policy.js-on-disk is what gets
   scored.
3. **Full-trace persistence is the honesty backstop.** Every error in this errata section
   was caught FROM gauntlet's own trace.jsonl — cost, context windows, compactions, the
   unflagged git commands, the tool surface. The framework recorded everything even where it
   didn't yet *report* everything.
4. **The one-deliberate-change discipline worked end-to-end.** The criterion text propagated
   into behavior (Opus hardcoded `SPEED = 40`; the formula survived 4 of Sonnet's 5
   compaction summaries; Fable cited "the exact evaluation regime"), and the win_step
   dimension it bought is the most robust cross-arm separator in the data.
5. **The seams absorbed the big game with declared extensions, not hacks** — overlay arenas,
   `meta.heavy`, `run(prompt=, config=)`, the adapter-owned RNG — and the whole experiment
   (parity gate, fixed-seed scoring, comparison tables) composed OUTSIDE the framework from
   the public API, with zero mid-chain framework patches.
6. **Mock smoke + kill-resilience predicted the real runs.** Zero orchestration failures,
   empty stderr, no permission denials, across the entire chain.

### 8.2 Problems (high impact — bit us, or could corrupt results)

1. **Per-trial held-out draws break cross-arm comparability** (the E6 erratum). Each arm sat
   a different exam; at n=30, draws move clear-rates by up to 13pp (Sonnet 16.7% vs 3.3%).
   *Fix (S):* experiment-level frozen draw — draw once, pass `heldout_seeds=` to every arm
   (the seam already exists), persist the draw out of node reach. *Fix (M):* an
   `evalkit.cross_score(trials)` that re-scores every arm's policy on the union of all draws
   and emits paired tables (the pooled n=60 numbers in §6 are a hand-made preview; ~25
   CPU-min, zero tokens).
2. **Node conditions are part of the treatment and were neither pinned nor recorded** (E3).
   Context window, compactions, served-model identity, rate limits — all in the trace, none
   in trial.json, no cross-arm condition diff. *Fix (S/M):* parse the trace's result/system
   events at session end into `NodeResult.meta` (cost, usage, turns, contextWindow,
   compactions) and emit an explicit confound line for any condition differing across arms
   of one experiment. Compaction count belongs in every analysis as a long-horizon failure
   signature in its own right.
3. **The audit under-detects exactly the reach class that occurred** (E1/E2/E5): cwd-relative
   VCS commands carry no absolute path and matched no rule; harness-internal tools execute
   outside the allowlist unflagged; meanwhile 81% of emitted findings were false positives
   from the harness's OWN scratch paths (/tmp eval files, `~/.claude/projects/<own-session>`
   overflow), and the one real signal was diluted. *Fixes (all S):* flag VCS invocations when
   the workspace is not itself a repo; flag any executed tool outside (allowlist ∪ documented
   harness-internal set) and pin the advertised tool list into trial.json; whitelist the
   session's OWN scratch roots (derivable from the trace init event); group findings by rule.
4. **Workspaces live inside the framework repo, and results were committed mid-chain into
   it** — the combination that turned benign curiosity into cross-arm contamination. One
   `cd ..` from the workspace is the orchestrator's own code, prior arms' artifacts, and a
   result-bearing git history. *Fix (S):* default workspaces to a neutral location outside
   any repo; *procedure fix (free):* never commit result-bearing text into a repo reachable
   from a live arm's cwd — stage results after the chain (this run's lesson learned the
   honest way).
5. **No crash-safe persistence or resume for a 3–4h, $23–81 trial.** trial.json (including
   the seed draw!) is written only at run end; an orchestrator crash mid-node orphans the
   claude child and forfeits the arm (the artifacts survive, but no code path consumes a
   half-finished trial dir). *Fix (M):* write `trial.json{status: running}` + the split
   BEFORE the node starts; wrap the child in a process-group with cleanup; add a
   `resume(trial_dir)` that re-enters at the scoring stage when a policy exists.
6. **"Flagged" had no defined operational meaning** — the response was ad-hoc manual
   forensics, which anchored on the (incomplete) audit findings and produced E1. *Fix (M):*
   an always-on `forensics.json` ledger (every tool_use classified: read/write,
   inside/outside, target class) + verdict semantics defined in code, so a human reviews a
   complete ledger, not grep output.

### 8.3 High-value improvements (capability gaps the trials exposed)

1. **A task-owned criterion seam.** The real comparable (win-first/win-speed eval_score)
   lives in experiment scripts; evalkit's generic probe ran on the farmable raw score and
   produced a **false overfit alarm on Fable** (largest score-gap, no clear-rate overfit —
   92.3% train vs 90% held-out). Move `criterion(result) -> float` into task meta; analyze
   uses it for gaps/baseline-position/CIs, falling back to score. (M)
2. **Cost/usage accounting as a first-class output** — $157.52 of chain spend was invisible
   until this audit. (S; same trace parse as #8.2.2.)
3. **Live observability** — a status.json heartbeat (turns, last event, trace bytes,
   compactions) + `evalkit.watch(trial_dir)`; operators hand-rolled trace-size monitors for
   9.7 hours. (M)
4. **The experiment layer** — chain-of-arms with a shared cohort, registry of trials
   (runs/registry.jsonl), cross-arm tables, Wilson CIs in evalkit proper. run_trial.py argv +
   flat runs/ + hand-made comparison.json is scar tissue every future experiment would
   rewrite. (M)
5. **Reference-policy tier** — noop/greedy/smart all die at 100% on this task; normalization
   against them reads 4–18× and anchors nothing. The manual ladder-t1 policy (already
   canonically scored, criterion 0.34) is the right kind of anchor; let tasks/experiments
   register reference policies that score automatically. (S–M)
6. **report.json finalize nudge** — one bounded `claude -p --resume <session_id>` turn when
   the report is missing at session end (either end mode), recorded as nudge-elicited.
   "Write early" is proven insufficient against compaction. (M)

### 8.4 Nice-to-haves (workable today, awkward)

Chunked batch scoring (a pathological seed currently discards a whole batch); baseline-run
caching keyed on (policy, seeds, substrate) for shared cohorts; win-at-cap / win_step edge
semantics written into CONTRACT + conformance (Opus won a seed at step 88 951 of 90 000 —
1.2% from the boundary the comparable is discontinuous at); arrival-timestamp sidecar for
traces (model-vs-tool time attribution); workspace size accounting/cleanup (Sonnet left
2.1 GB); audit finding grouping; sanitize-and-archive traces as a built-in step.

### 8.5 Priority order

1. (S) Frozen shared draw + workspaces outside the repo + no mid-chain result commits — the
   three together close the comparability AND contamination holes for the very next chain.
2. (S) Trace-derived telemetry into trial.json (cost, conditions, compactions, tool surface)
   + the three audit rules (VCS, unexpected-tool, own-scratch whitelist).
3. (M) Crash-safe persistence + resume.
4. (M) Criterion seam + CIs in evalkit (kills the false-overfit class of error).
5. (M) Experiment layer + cross_score + registry.
6. (M) Heartbeat observability; report-nudge; reference tier; the §8.4 list opportunistically.

## 9. Data bookkeeping & provenance (audit answers)

A dedicated lineage audit traced every number in this report back to disk. Verdict:
**substantially robust — every headline number re-derives exactly from persisted per-seed
artifacts — with named gaps, all of which were recoverable and have now been recovered.**

**Was anything lost?** Nothing irrecoverable. Items that were summary-only or volatile, now
fixed: the @∞-diagnostic and parity-gate per-seed raws were discarded after summarization
(deterministically regenerable; @∞ raws have now been re-run and persisted for all arms);
intermediate policy versions are overwritten on disk but reconstructable from the trace
(verified **byte-exact** for Sonnet — 59 versions — and near-exact for Opus/Fable, whose
Bash-based edits need a bash-aware replayer; Fable's 6 on-disk checkpoints provide ground
truth); Opus/Fable ran `--log none` so dev game logs were never written (regenerable only by
replay); Sonnet's 1.8 GB of game logs and a 1.4 GB dev trace lived in gitignored/volatile
locations — **salvaged today** into the trial dirs with sha256 manifests.

**What was not recorded (and is now)?** Per-trial cost/tokens/turns; absolute session
start/end; context windows and compaction events; claude CLI version (2.1.174 for all
three); gauntlet git SHA at session start (reconstructed from trace timestamps × commit
times: Opus@950c429, Sonnet@189dc77, Fable@179de55 — with the caveat that HEAD moved during
sessions, which future stamping at run time eliminates); node/OS versions; exact scoring
command lines (reconstructable from pinned code). All recovered post-hoc into per-arm
`provenance.json` + `costs.json`; the §8 roadmap makes them recorded-at-run-time.

**What can still be included (and now is)?** Committed to the results archive today:
the three final `policy.js` files (the central evaluated artifacts — previously only in
gitignored runs/), all per-seed raw batches (held-out, training, baselines, fixed-seed, @∞),
the exact prompt, sanitized traces (system/rate-limit events stripped — they enumerate host
tool/plugin inventory — and $HOME/emails redacted; provenance extracted first), costs,
provenance, and salvage manifests. Remaining disk-only (size): Sonnet's 1.8 GB game logs +
1.4 GB dev trace (sha256-manifested in the archive). One structural dependency is recorded
rather than resolved: the manual-baseline constants cite raw CSVs in the sibling
`ai_playtest_pipeline` repo.

**Residual bookkeeping risks:** re-running analysis scripts overwrites derived files in
place (safe while the substrate is pinned; versioning would be safer); `config: {}` in batch
records means the 40/90k regime is pinned by code version rather than echoed as data (the
adapter version + bundle sha make it unambiguous, but an explicit config echo is cheaper to
audit); trial.json-at-end doubles as a completion marker but leaves the seed draw
memory-only during the hours it matters most (§8.2.5).
