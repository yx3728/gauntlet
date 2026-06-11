"""node.py — the node-type abstraction (seam 3).

An AgentNode is a BLACK BOX: it is dropped into an isolated arena workspace
with a prompt and budgets, and what comes back is whatever it left on disk
(policy.js, report.json) plus a trace. eval is indifferent to its internals.

Adding a node kind (a local-agent harness, an API loop, ...) = subclassing
AgentNode; nothing in eval or in the coordination layer changes.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class NodeBudgets:
    """Hard + soft budgets for one node session.

    wall_clock_s and max_turns are HARD (enforced by the spawner); attempts is
    a soft, prompt-level budget (we do not trust node self-policing for the
    hard ones)."""

    wall_clock_s: int = 1200
    max_turns: int = 80
    attempts: int = 8


@dataclass
class NodeResult:
    """What a node session produced. `status` is about the session process;
    deliverables may exist even for non-ok statuses (e.g. a wall-clock-killed
    node that already wrote policy.js — deliverables-on-disk are the unit of
    success, not clean exits)."""

    node: str
    status: str  # "ok" | "timeout_killed" | "nonzero_exit" | "spawn_error"
    wall_ms: int
    policy_path: Path | None = None
    report: dict | None = None
    trace_path: Path | None = None
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "node": self.node,
            "status": self.status,
            "wall_ms": self.wall_ms,
            "policy_path": str(self.policy_path) if self.policy_path else None,
            "report": self.report,
            "trace_path": str(self.trace_path) if self.trace_path else None,
            "meta": self.meta,
        }


class AgentNode(abc.ABC):
    """One black-box agent node. Implementations run a session in `workspace`
    (already containing the arena files) and return session metadata; the
    coordination layer collects deliverables from disk afterwards."""

    name: str = "node"

    @abc.abstractmethod
    def run(self, workspace: Path, prompt: str, budgets: NodeBudgets) -> dict:
        """Run one session. Returns a meta dict with at least:
        {"status": str, "wall_ms": int, "trace_path": str|None}.
        Extra keys are preserved in NodeResult.meta."""
