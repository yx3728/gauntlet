import pytest

from evalkit.seeds import HELDOUT_POOL_MAX, HELDOUT_POOL_MIN, TRAINING_SEED_MAX, SeedSplit, split_for


def test_default_split_draws_distinct_heldout_from_pool():
    s = split_for([1, 2, 3], n_heldout=30)
    assert s.training == (1, 2, 3)
    assert len(s.heldout) == 30
    assert len(set(s.heldout)) == 30  # distinct
    assert s.heldout == tuple(sorted(s.heldout))
    for seed in s.heldout:
        assert HELDOUT_POOL_MIN <= seed <= HELDOUT_POOL_MAX
    assert not set(s.training) & set(s.heldout)


def test_default_heldout_is_unpredictable():
    """A fixed held-out block would let a policy recover its seed in-process by
    enumerating candidates against the shipped bundle — splits must differ."""
    a = split_for([1, 2, 3], n_heldout=30)
    b = split_for([1, 2, 3], n_heldout=30)
    assert a.heldout != b.heldout


def test_n_heldout_is_respected():
    for n in (1, 4, 50):
        assert len(split_for([1], n_heldout=n).heldout) == n


def test_explicit_heldout_override():
    s = split_for([1, 2], heldout_seeds=[6000, 5000, 7000])
    assert s.heldout == (5000, 6000, 7000)  # sorted, exactly as given
    with pytest.raises(ValueError, match="duplicates"):
        split_for([1, 2], heldout_seeds=[5000, 5000])


def test_explicit_heldout_disjointness_enforced():
    with pytest.raises(ValueError, match="overlap"):
        split_for([1, 2], heldout_seeds=[2, 9000])


def test_overlap_rejected():
    with pytest.raises(ValueError, match="overlap"):
        SeedSplit(training=(1, 2000), heldout=(2000, 2001))


def test_training_seeds_too_big_rejected():
    with pytest.raises(ValueError, match=str(TRAINING_SEED_MAX)):
        split_for([1, TRAINING_SEED_MAX], n_heldout=10)
    with pytest.raises(ValueError, match="training seeds must be <"):
        split_for([1, 2_000_000], n_heldout=10)


def test_empty_sides_rejected():
    with pytest.raises(ValueError):
        SeedSplit(training=(), heldout=(2000,))
    with pytest.raises(ValueError):
        SeedSplit(training=(1,), heldout=())
