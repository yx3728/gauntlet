import json

from evalkit.agents import ClaudeCodeNode, MockNode, NodeBudgets, develop

NOOP_POLICY = "module.exports = { policy: () => ({ action: {} }) };\n"


def test_mock_node_through_the_shim(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    node = MockNode(policy_source=NOOP_POLICY)
    res = develop(ws, "prompt text", node, NodeBudgets(attempts=3))

    assert res.status == "ok"
    assert res.node == "mock"
    assert res.policy_path == ws / "policy.js"
    assert res.policy_path.read_text() == NOOP_POLICY
    assert res.report and "how_far" in res.report
    # Trace lives ALONGSIDE the workspace (never inside it) and is valid JSONL.
    assert res.trace_path == tmp_path / "trace.jsonl"
    events = [json.loads(l) for l in res.trace_path.read_text().splitlines()]
    assert events[0]["type"] == "system"
    assert any(e.get("type") == "result" for e in events)


def test_shim_collects_deliverables_from_disk_not_from_node(tmp_path):
    """Deliverables-on-disk are the unit of success: a node that wrote nothing
    yields no policy; a malformed report is recorded, not fatal."""
    ws = tmp_path / "workspace"
    ws.mkdir()

    class BareNode(MockNode):
        def run(self, workspace, prompt, budgets):
            (workspace / "report.json").write_text("{not json")
            return {"status": "timeout_killed", "wall_ms": 5, "trace_path": None}

    res = develop(ws, "p", BareNode(policy_source=""), NodeBudgets())
    assert res.status == "timeout_killed"
    assert res.policy_path is None
    assert res.report is None
    assert "report_parse_error" in res.meta


def test_claude_cmd_is_the_hardened_recipe():
    node = ClaudeCodeNode(model="sonnet", effort="high")
    cmd = node.build_cmd(NodeBudgets(max_turns=42))
    s = " ".join(cmd)
    assert cmd[:2] == ["claude", "-p"]
    assert "--permission-mode default" in s
    assert "bypassPermissions" not in s
    assert "--strict-mcp-config" in s
    assert "--allowedTools Bash Read Write Edit Glob Grep" in s
    assert "--disallowedTools WebFetch WebSearch Task" in s
    assert "--max-turns 42" in s
    assert "--output-format stream-json" in s
    assert node.name == "claude-code:sonnet/high"


def test_claude_spawn_error_is_contained(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    node = ClaudeCodeNode(claude_bin="/nonexistent/claude-bin")
    res = develop(ws, "p", node, NodeBudgets(wall_clock_s=5))
    assert res.status == "spawn_error"
    assert res.policy_path is None
