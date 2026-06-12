from evalkit.eval.criterion import criterion_fn, criterion_summary, wilson95


def test_win_speed_semantics_match_v1_eval_score():
    kind, fn = criterion_fn({"kind": "win_speed", "cap": 90000})
    assert kind == "win_speed"
    # win: 1 + (cap - win_step)/cap, earlier = higher
    assert fn({"done_reason": "win", "win_step": 45000}) == 1.5
    assert fn({"done_reason": "win", "win_step": 9600, "progress": 1}) == 1 + (90000 - 9600) / 90000
    # win at exactly the cap -> 1.0, still above every non-win (progress < 1)
    assert fn({"done_reason": "win", "win_step": 90000}) == 1.0
    assert fn({"done_reason": "timeout", "progress": 0.97}) == 0.97
    assert fn({"done_reason": "death", "progress": 0.4}) == 0.4
    # win_step falls back to steps (vendored-runner-shaped results)
    assert fn({"done_reason": "win", "steps": 45000}) == 1.5


def test_fallback_and_unknown():
    kind, fn = criterion_fn(None)
    assert kind == "score" and fn({"score": 123}) == 123.0
    kind, _ = criterion_fn({"kind": "score"})
    assert kind == "score"
    try:
        criterion_fn({"kind": "nope"})
        assert False, "should raise"
    except ValueError:
        pass


def test_criterion_summary_rates_and_win_steps():
    _, fn = criterion_fn({"kind": "win_speed", "cap": 90000})
    results = [
        {"done_reason": "win", "win_step": 30000, "progress": 1},
        {"done_reason": "win", "win_step": 60000, "progress": 1},
        {"done_reason": "death", "progress": 0.5},
        {"done_reason": "timeout", "progress": 0.9},
    ]
    s = criterion_summary(results, fn)
    assert s["n"] == 4 and s["clears"] == 2 and s["clear_rate"] == 0.5
    lo, hi = s["clear_rate_wilson95"]
    assert 0 < lo < 0.5 < hi < 1
    assert s["win_step"]["median"] == 45000
    assert s["max"] > 1 > s["min"]
    assert criterion_summary([], fn) == {"n": 0}


def test_wilson95_known_values():
    lo, hi = wilson95(6, 30)  # the v1 manual baseline: 20% [9.5, 37.3]
    assert (lo, hi) == (0.0951, 0.3731)
    assert wilson95(0, 0) == (0.0, 1.0)
    lo, hi = wilson95(0, 30)
    assert lo == 0.0 and hi < 0.15
