"""evalkit — Lib2 of the gauntlet framework: eval + orchestration.

Two modules:
  - ``evalkit.agents`` — the black-box node layer: spawn one agent node in an
    isolated arena workspace, get back a policy artifact + trace.
  - ``evalkit.eval``   — held-out scoring, baselines, the diagnostic probe,
    exposed as a few API functions (no CLI): ``run``, ``analyze``.

evalkit depends on the gym's *interface contract* (the ``--json`` batch
protocol and the metrics envelope), never on a task's specifics.
"""

from .seeds import SeedSplit, split_for
from .boundary import BatchResult, run_policy_batch
from .agents import AgentNode, NodeBudgets, NodeResult, MockNode, ClaudeCodeNode, develop
from .eval import run, analyze, run_baselines, Trial, Analysis

__all__ = [
    "SeedSplit",
    "split_for",
    "BatchResult",
    "run_policy_batch",
    "AgentNode",
    "NodeBudgets",
    "NodeResult",
    "MockNode",
    "ClaudeCodeNode",
    "develop",
    "run",
    "analyze",
    "run_baselines",
    "Trial",
    "Analysis",
]
