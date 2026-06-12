"""mock.py — the mock node: returns a fixed policy without any LLM call.

This is the e2e workhorse: the black-box-node abstraction makes the full
pipeline (agents -> policy -> eval) testable fast and free.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .node import AgentNode, NodeBudgets


class MockNode(AgentNode):
    name = "mock"

    def __init__(self, policy_source: str, report: dict | None = None, write_report: bool = True):
        """`policy_source` is the JS source of the policy the "agent" produces
        (e.g. a task baseline, for tests). A synthetic stream-json-ish trace is
        written so trace-consuming code paths (audit) run for real."""
        self.policy_source = policy_source
        self.report = report if report is not None else {
            "best_result": {},
            "how_far": "mock node: fixed policy, no exploration",
            "failure_modes": [],
            "lessons": [],
            "attempts_used": 0,
        }
        self.write_report = write_report

    def run(self, workspace: Path, prompt: str, budgets: NodeBudgets) -> dict:
        t0 = time.time()
        workspace = Path(workspace)
        (workspace / "policy.js").write_text(self.policy_source)
        if self.write_report:
            (workspace / "report.json").write_text(json.dumps(self.report, indent=2))

        trace_path = workspace.parent / "trace.jsonl"
        # Shaped like a real stream-json session so trace-consuming paths (audit,
        # telemetry extraction) run for real: init carries session/tools/version,
        # result carries usage/cost/modelUsage.
        events = [
            {"type": "system", "subtype": "init", "session_id": "mock-session", "model": "mock",
             "tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"], "version": "0.0.0-mock",
             "cwd": str(workspace), "timestamp": "1970-01-01T00:00:00Z"},
            {
                "type": "assistant",
                "timestamp": "1970-01-01T00:00:01Z",
                "message": {
                    "content": [
                        {"type": "text", "text": "mock node: writing the fixed policy"},
                        {"type": "tool_use", "name": "Write", "input": {"file_path": "policy.js"}},
                    ]
                },
            },
            {"type": "result", "subtype": "success", "num_turns": 1, "duration_ms": 1,
             "duration_api_ms": 1, "total_cost_usd": 0.0, "permission_denials": [],
             "usage": {"input_tokens": 0, "output_tokens": 0},
             "modelUsage": {"mock": {"contextWindow": 0, "maxOutputTokens": 0}},
             "session_id": "mock-session", "timestamp": "1970-01-01T00:00:02Z"},
        ]
        with open(trace_path, "w") as f:
            for e in events:
                f.write(json.dumps(e) + "\n")

        return {
            "status": "ok",
            "wall_ms": int((time.time() - t0) * 1000),
            "trace_path": str(trace_path),
        }
