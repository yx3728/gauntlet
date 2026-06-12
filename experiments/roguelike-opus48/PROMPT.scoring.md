## How your final policy is evaluated (the scoring criterion)

After your session, your final `policy.js` is scored on **held-out seeds you do not see**, at
the **default regime: `speed_cap = 40`, `max_steps = 90000` — fixed for evaluation.** (You may
change them while iterating; the evaluation always uses these.) Per held-out seed:

    eval_score = cleared ? 1 + (90000 − win_step) / 90000    // a win scores in (1, 2]: the EARLIER the win, the higher
                         : progress                           // a non-win scores its progress, in [0, 1) — below every win

where `win_step` is the step count at which the game was won. So: **winning the game is the
prerequisite — any win outranks every non-win. Among wins, winning SOONER is better.** The
in-game `score` metric is only a progress reference during play — it is NOT the evaluation
criterion; do not fixate on it or grind it.
