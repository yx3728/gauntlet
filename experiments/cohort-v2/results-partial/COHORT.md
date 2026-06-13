# Cohort — cohort-v2-n2 (roguelike@2.1.0, criterion `win_speed`)

- frozen held-out: n=80; concurrency 4; started 2026-06-12T15:31:17Z, finished 2026-06-12T20:20:56Z

| arm | rep | clear (Wilson95) | criterion mean | win_step med | cost | turns | compact | ctx window | audit |
|---|---|---|---|---|---|---|---|---|---|
| haiku45 | r1 | 0.0 (0.0, 0.0458) | 0.2021 | — | $1.2443182000000002 | 95 | 0 | 200000 | review |
| haiku45 | r2 | 0.0 (0.0, 0.0458) | 0.1967 | — | $1.0761497 | 76 | 0 | 200000 | review |
| **haiku45** | **pooled** | **0.0 (0.0, 0.0234)** | **0.1994** | **—** | | | | | |
| sonnet46 | r1 | 0.1125 (0.0603, 0.2002) | 0.545 | 62525 | $14.304256949999996 | 168 | 3 | 200000 | review |
| sonnet46 | r2 | 0.0375 (0.0128, 0.1045) | 0.4138 | 42843 | $33.29066579999999 | 410 | 8 | 200000 | review |
| **sonnet46** | **pooled** | **0.075 (0.0434, 0.1265)** | **0.4794** | **53105.5** | | | | | |
| opus48 | r1 | 0.5625 (0.4534, 0.6659) | 0.9382 | 67370 | $46.06638049999998 | 242 | 0 | 1000000 | review |
| opus48 | r2 | 0.2625 (0.1786, 0.3682) | 0.7302 | 71043 | $52.77541199999999 | 270 | 0 | 1000000 | review |
| **opus48** | **pooled** | **0.4125 (0.3391, 0.49)** | **0.8342** | **68040.5** | | | | | |
| fable5 | r1 | —  | — | — | $— | None | 0 | None | review |
| fable5 | r2 | 0.375 (0.2769, 0.4845) | 0.8332 | 57123.0 | $— | None | 0 | None | review |
| **fable5** | **pooled** | **0.375 (0.2769, 0.4845)** | **0.8332** | **57123.0** | | | | | |

## Condition differences across arms (explicit confounds)
- **context_window** differs: {"haiku45#0": 200000, "haiku45#1": 200000, "sonnet46#2": 200000, "sonnet46#3": 200000, "opus48#4": 1000000, "opus48#5": 1000000, "fable5#6": null, "fable5#7": null}
- **gauntlet_sha** differs: {"haiku45#0": "5b70a2853546", "haiku45#1": "5b70a2853546", "sonnet46#2": "5b70a2853546", "sonnet46#3": "5b70a2853546", "opus48#4": "5b70a2853546", "opus48#5": "5b70a2853546", "fable5#6": "4c71d0225fe2", "fable5#7": "165f20d72ee2"}
