"""seeds.py — the train / held-out seed split.

Agents iterate on TRAINING seeds (visible: baked into each task's meta and the
arena docs). Eval scores each trial's FINAL policy on a DISJOINT HELD-OUT set
the agent never sees — that held-out number is the comparable metric. Held-out
seeds live orchestrator-side only and are NEVER written into a workspace.
"""

from __future__ import annotations

from dataclasses import dataclass, field

HELDOUT_START = 2000  # convention: held-out seeds are >= 2000; training seeds are small ints


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


def split_for(training_seeds, n_heldout: int = 30, heldout_start: int = HELDOUT_START) -> SeedSplit:
    """Derive the default split for a task: its visible training seeds + a
    disjoint held-out block starting at `heldout_start`."""
    training = tuple(int(s) for s in training_seeds)
    if training and max(training) >= heldout_start:
        raise ValueError(
            f"training seeds reach into the held-out range (>= {heldout_start}); "
            "pick a higher heldout_start"
        )
    heldout = tuple(range(heldout_start, heldout_start + n_heldout))
    return SeedSplit(training=training, heldout=heldout)
