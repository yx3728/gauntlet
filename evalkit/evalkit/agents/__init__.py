"""evalkit.agents — the black-box node layer (module 1).

`develop()` is the MVP coordination: a PASS-THROUGH SHIM around one node.
It is also the seam (seam 2) where coordination topologies plug in later
(instruction scaffolds, multi-agent with on-disk reports, ...): any future
topology keeps this exact signature —

    (workspace, prompt, node(s), budgets) -> NodeResult

so `eval` never changes. Deliverable collection lives HERE (not in node
implementations): the convention is what's on disk in the workspace —
policy.js + report.json — regardless of how the session ended.
"""

from __future__ import annotations

import json
from pathlib import Path

from .node import AgentNode, NodeBudgets, NodeResult
from .mock import MockNode
from .claude_code import ClaudeCodeNode

__all__ = ["AgentNode", "NodeBudgets", "NodeResult", "MockNode", "ClaudeCodeNode", "develop"]


def develop(
    workspace: str | Path,
    prompt: str,
    node: AgentNode,
    budgets: NodeBudgets | None = None,
) -> NodeResult:
    """Spawn one black-box agent node in `workspace` -> policy artifact + trace.

    The MVP topology: one node, pass-through. Returns a NodeResult whose
    deliverables (policy_path, report) are whatever the node left on disk —
    a wall-clock-killed node that wrote policy.js still counts.
    """
    workspace = Path(workspace)
    budgets = budgets or NodeBudgets()

    meta = node.run(workspace, prompt, budgets)

    policy = workspace / "policy.js"
    report_file = workspace / "report.json"
    report = None
    report_error = None
    if report_file.exists():
        try:
            report = json.loads(report_file.read_text())
        except Exception as e:  # non-fatal: a malformed self-report is data too
            report_error = str(e)

    trace = meta.get("trace_path")
    result = NodeResult(
        node=node.name,
        status=meta.get("status", "ok"),
        wall_ms=int(meta.get("wall_ms", 0)),
        policy_path=policy if policy.exists() else None,
        report=report,
        trace_path=Path(trace) if trace else None,
        meta={k: v for k, v in meta.items() if k not in ("status", "wall_ms", "trace_path")},
    )
    if report_error:
        result.meta["report_parse_error"] = report_error
    return result
