# Analysis — roguelike / claude-code:claude-sonnet-4-6/max

- status: **complete**, audit: **flagged**
- held-out (n=30): score mean **23114.3423** ± 23028.3693 (median 14331.24, max 113720.0), progress mean **0.4534**
- done reasons: {'death': 0.8333, 'win': 0.1667}  policy errors: 0.0
- baseline `greedy`: score mean 7156.3563, progress mean 0.3995
- baseline `noop`: score mean 2235.4747, progress mean 0.2168
- baseline `smart`: score mean 9821.8977, progress mean 0.4142
- generalization: training score 34310.6285 vs held-out 23114.3423 (gap 11196.2861)
- baseline position: 4.2429 on the noop→greedy scale
- failure breakdown: {'death': 0.8333, 'win': 0.1667}, worst seeds [{'seed': 1771582392, 'progress': 0.185, 'done_reason': 'death'}, {'seed': 1298750507, 'progress': 0.188, 'done_reason': 'death'}, {'seed': 500191106, 'progress': 0.244, 'done_reason': 'death'}]
