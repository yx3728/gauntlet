# Analysis — roguelike / claude-code:claude-opus-4-8/max

- status: **complete**, audit: **review**
- held-out (n=30): score mean **69952.506** ± 59625.1066 (median 54020.0, max 265420.0), progress mean **0.8439**
- done reasons: {'death': 0.2667, 'win': 0.7333}  policy errors: 0.0
- baseline `greedy`: score mean 7192.848, progress mean 0.3962
- baseline `noop`: score mean 1872.243, progress mean 0.2174
- baseline `smart`: score mean 8075.9, progress mean 0.397
- generalization: training score 63304.6154 vs held-out 69952.506 (gap -6647.8906)
- baseline position: 12.7956 on the noop→greedy scale
- failure breakdown: {'death': 0.2667, 'win': 0.7333}, worst seeds [{'seed': 407807269, 'progress': 0.4, 'done_reason': 'death'}, {'seed': 776744063, 'progress': 0.402, 'done_reason': 'death'}, {'seed': 1559467981, 'progress': 0.404, 'done_reason': 'death'}]
