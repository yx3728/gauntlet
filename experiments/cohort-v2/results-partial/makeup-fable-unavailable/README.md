# Fable makeup runs — TERMINATED by mid-session loss of Fable access (NOT counted)

After the first makeup Fable rep (cohort-v2-n2-makeup-fable5-r1, clean 69/80) finished at
20:34 local, two further Fable reps were launched while access still tested live:
  - makeup2-fable5-r1: died at turn 88, $23.58 — API: "issue with the selected model
    (claude-fable-5)... may not exist or you may not have access". Wrote a partial policy
    before dying; gauntlet collected + scored it (20/80, win_med 14843) — a TRUNCATED
    development artifact, NOT a clean rep. Do not pool.
  - makeup3-fable5-r1: died at turn 56, $7.95 — same access error, no policy (no_policy).
A fresh `claude -p --model claude-fable-5` smoke immediately after also returns the access
error → Fable access was withdrawn during these runs (the announced suspension took effect).
The first makeup Fable rep (86.3%) is the only clean Fable datapoint from this wave.
gauntlet lost zero artifacts across both terminations (the robustness point). runs/ untouched.
