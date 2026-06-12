# Analysis — roguelike / claude-code:claude-fable-5/max

- status: **complete**, audit: **clean**
- held-out (n=30): score mean **110800.0** ± 96136.2034 (median 58220.0, max 306120.0), progress mean **0.9618**
- done reasons: {'death': 0.1, 'win': 0.9}  policy errors: 0.0
- baseline `greedy`: score mean 7698.8563, progress mean 0.4036
- baseline `noop`: score mean 1529.5653, progress mean 0.1906
- baseline `smart`: score mean 9916.7837, progress mean 0.3936
- generalization: training score 203789.2308 vs held-out 110800.0 (gap 92989.2308)
- baseline position: 17.712 on the noop→greedy scale
- failure breakdown: {'death': 0.1, 'win': 0.9}, worst seeds [{'seed': 705537212, 'progress': 0.418, 'done_reason': 'death'}, {'seed': 1993803303, 'progress': 0.648, 'done_reason': 'death'}, {'seed': 790867912, 'progress': 0.788, 'done_reason': 'death'}]
