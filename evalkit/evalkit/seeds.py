"""seeds.py — the train / held-out seed split.

Agents iterate on TRAINING seeds (visible: baked into each task's meta and the
arena docs). Eval scores each trial's FINAL policy on a DISJOINT HELD-OUT set
the agent never sees — that held-out number is the comparable metric. Held-out
seeds live orchestrator-side only and are NEVER written into a workspace.

Held-out seeds are UNPREDICTABLE: drawn fresh per split via SystemRandom from
a large pool, never a fixed block — a fixed block (or any in-process PRNG) would
let a policy enumerate candidate seeds against the shipped bundle and recover an
oracle of all future randomness. Reproducibility comes from recording the drawn
split (evalkit.run persists it in trial.json), or from passing an explicit
`heldout_seeds=` set.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

# Training seeds are small ints (< TRAINING_SEED_MAX); held-out seeds are drawn
# from the disjoint pool [HELDOUT_POOL_MIN, HELDOUT_POOL_MAX] (32-bit-safe).
TRAINING_SEED_MAX = 10_000
HELDOUT_POOL_MIN = 10_000
HELDOUT_POOL_MAX = 2**31 - 1


@dataclass(frozen=True)
class SeedSplit:
    training: tuple[int, ...]
    heldout: tuple[int, ...]

    def __post_init__(self) -> None:
        if not self.training:
            raise ValueError("training seeds empty")
        if not self.heldout:
            raise ValueError("heldout seeds empty")
        overlap = set(self.training) & set(self.heldout)
        if overlap:
            raise ValueError(f"train/held-out overlap: {sorted(overlap)}")


def split_for(training_seeds, n_heldout: int = 30, heldout_seeds=None) -> SeedSplit:
    """Derive the split for a task: its visible training seeds + a disjoint
    held-out set.

    By default the held-out set is `n_heldout` DISTINCT seeds drawn via
    `random.SystemRandom` from [HELDOUT_POOL_MIN, HELDOUT_POOL_MAX] (sorted) —
    unpredictable by construction. Pass `heldout_seeds=` for an explicit,
    reproducible set (must be distinct; disjointness from training is enforced).
    """
    training = tuple(int(s) for s in training_seeds)
    too_big = sorted(s for s in training if s >= TRAINING_SEED_MAX)
    if too_big:
        raise ValueError(
            f"training seeds must be < {TRAINING_SEED_MAX} (the held-out pool starts there): {too_big}"
        )
    if heldout_seeds is not None:
        explicit = [int(s) for s in heldout_seeds]
        if len(set(explicit)) != len(explicit):
            raise ValueError("heldout_seeds contains duplicates")
        heldout = tuple(sorted(explicit))
    else:
        rng = random.SystemRandom()
        drawn: set[int] = set()
        while len(drawn) < n_heldout:
            drawn.add(rng.randint(HELDOUT_POOL_MIN, HELDOUT_POOL_MAX))
        heldout = tuple(sorted(drawn))
    return SeedSplit(training=training, heldout=heldout)
