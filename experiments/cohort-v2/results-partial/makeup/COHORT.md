# Cohort — cohort-v2-n2-makeup (roguelike@2.1.0, criterion `win_speed`)

- frozen held-out: n=80; concurrency 2; started 2026-06-12T21:22:31Z, finished 2026-06-13T01:07:36Z

| arm | rep | clear (Wilson95) | criterion mean | win_step med | cost | turns | compact | ctx window | audit |
|---|---|---|---|---|---|---|---|---|---|
| sonnet46 | r1 | 0.0 (0.0, 0.0458) | 0.4033 | — | $11.8750051 | 120 | 2 | 200000 | review |
| **sonnet46** | **pooled** | **0.0 (0.0, 0.0458)** | **0.4033** | **—** | | | | | |
| fable5 | r1 | 0.8625 (0.7703, 0.9215) | 1.4598 | 40604 | $87.35204500000002 | 234 | 0 | 1000000 | review |
| **fable5** | **pooled** | **0.8625 (0.7703, 0.9215)** | **1.4598** | **40604** | | | | | |

## Condition differences across arms (explicit confounds)
- **context_window** differs: {"sonnet46#0": 200000, "fable5#1": 1000000}
