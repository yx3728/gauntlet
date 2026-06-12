# cohort-v2-n2 — PARTIAL RESULTS (robustness test; NOT final production data)

Interrupted cohort: fable5-r2 killed by operator at ~9min (no policy); fable5-r1 killed by
operator at ~50min (policy on disk -> scored; truncated development); sonnet46-r2's session
died at the account session limit (410 turns, 8 compactions; policy on disk -> scored;
truncated). haiku45 x2, sonnet46-r1, opus48-r1, opus48-r2 ran to natural completion.
Frozen shared draw n=80 (in cohort.json); v1 policies cross-scored on the same draw.
The framework lost ZERO artifacts through two kills + one limit death (the robustness result).
Raw runs remain untouched under runs/ (incl. traces); never delete.
