import pytest

from evalkit.seeds import SeedSplit, split_for


def test_default_split_is_disjoint_and_deterministic():
    s = split_for([1, 2, 3], n_heldout=30)
    assert s.training == (1, 2, 3)
    assert s.heldout == tuple(range(2000, 2030))
    assert not set(s.training) & set(s.heldout)
    assert split_for([1, 2, 3], n_heldout=30) == s


def test_overlap_rejected():
    with pytest.raises(ValueError, match="overlap"):
        SeedSplit(training=(1, 2000), heldout=(2000, 2001))


def test_training_reaching_heldout_range_rejected():
    with pytest.raises(ValueError, match="held-out range"):
        split_for([1, 2500], n_heldout=10)


def test_empty_sides_rejected():
    with pytest.raises(ValueError):
        SeedSplit(training=(), heldout=(2000,))
    with pytest.raises(ValueError):
        SeedSplit(training=(1,), heldout=())
