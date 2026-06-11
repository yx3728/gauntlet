"""evalkit.eval — held-out scoring, baselines, the diagnostic probe (module 2).

This module holds the AI signal: `run` obtains a policy through the agents
seam and scores it on held-out seeds; `analyze` turns a trial into comparable
numbers and failure localization.
"""

from .api import Analysis, Trial, analyze, run, score_policy
from .audit import audit, audit_trace, audit_workspace
from .baselines import discover_baselines, run_baselines
from .probe import diagnostic_probe
from .scoring import summarize

__all__ = [
    "run",
    "analyze",
    "score_policy",
    "Trial",
    "Analysis",
    "summarize",
    "diagnostic_probe",
    "run_baselines",
    "discover_baselines",
    "audit",
    "audit_trace",
    "audit_workspace",
]
