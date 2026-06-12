# Report skeleton / notes (internal — final report goes to INTERIM_REPORT.md)

Structure for Step 5:

1. **Headline (engineering):** gauntlet took a frontier agent (Opus 4.8/max) through the big
   roguelike end-to-end — unbounded dev session, canonical 40/90k held-out scoring, audit,
   full artifact persistence — with zero bypasses of the framework.
2. **Faithfulness:**
   - substrate: vendored bundle sha-identical; manual clears reproduce byte-exactly
     (2008→win@25129, 2011→win@26827); cross-runner determinism test; parity gate on the
     final policy (vendor runner == canonical scorer per-seed).
   - subject surface: 7 workspace files byte-identical; prompt = manual prompt verbatim +
     criterion section only (sha-gated).
   - clear-rate comparison vs manual baseline (use MANUAL_BASELINE constants + Wilson CIs;
     anchors: 20%@∞/90k cross-regime; 0/30 measured same-regime @40/90k; non-monotonic
     finite-cap row 0–7%; cap 40 never swept in the manual pipeline).
3. **New dimension:** win_step distribution among clears + eval_score table (canonical and
   fixed-seed 2000–2029). Manual comparison: six ∞-clears at [25129..78336].
4. **Overfit signal:** train (13 seeds) vs held-out clear-rate/win_step; subject self-report
   (report.json best_result) vs canonical.
5. **Engineering checklist:** artifacts persisted (trial.json/heldout/training/baselines/
   audit/trace/prompt); node status (+ whether the 8h/2000-turn backstop fired — disclose if
   truncated); audit verdict + notable findings; kill-resilience held (smoke); pipeline
   unchanged vs the small games (same evalkit.run / analyze).
6. **Confounds (from MAPPING.md):** n=1 per arm (±1 seed = 3.3pp; Wilson CIs), criterion-as-
   treatment, dev-regime shift bundled with treatment, -p vs interactive, seed-set draw.
7. **Trial timeline:** node wall-clock, turns, trace size, # policies/iterations (from trace),
   cost tokens if recoverable.

Data sources: runs/roguelike-opus48-max/{trial.json, heldout.json, training.json,
baselines.json, audit.json, eval_score_table.json, comparison.json, ANALYSIS.md},
experiments/roguelike-opus48/manual_policy_at_40_90k.json (+ .provenance.json).
