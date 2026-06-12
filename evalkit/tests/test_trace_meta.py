import json

from evalkit.agents.trace_meta import extract_trace_meta


def write_trace(tmp_path, events):
    p = tmp_path / "trace.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return p


def test_extracts_conditions_cost_and_compactions(tmp_path):
    events = [
        {"type": "system", "subtype": "init", "session_id": "s1", "model": "claude-x",
         "tools": ["Bash", "Read"], "version": "2.1.174", "cwd": "/w", "timestamp": "2026-01-01T00:00:00Z"},
        {"type": "assistant", "timestamp": "2026-01-01T00:10:00Z", "message": {"content": []}},
        {"type": "system", "subtype": "compact_boundary",
         "compact_metadata": {"trigger": "auto", "pre_tokens": 170000, "post_tokens": 12000},
         "timestamp": "2026-01-01T01:00:00Z"},
        {"type": "rate_limit_event", "status": "allowed", "timestamp": "2026-01-01T01:30:00Z"},
        # result is NOT the last line (v1 lesson: background notifications follow it)
        {"type": "result", "subtype": "success", "num_turns": 42, "total_cost_usd": 12.34,
         "duration_api_ms": 1000, "usage": {"output_tokens": 5},
         "modelUsage": {"claude-x": {"contextWindow": 200000}},
         "permission_denials": [], "session_id": "s1", "timestamp": "2026-01-01T02:00:00Z"},
        {"type": "system", "subtype": "task_notification", "timestamp": "2026-01-01T02:00:01Z"},
    ]
    tm = extract_trace_meta(write_trace(tmp_path, events))
    assert tm["session"]["session_id"] == "s1"
    assert tm["session"]["version"] == "2.1.174"
    assert tm["total_cost_usd"] == 12.34
    assert tm["num_turns"] == 42
    assert tm["context_windows"] == {"claude-x": 200000}
    assert tm["compaction_count"] == 1
    assert tm["compactions"][0]["pre_tokens"] == 170000
    assert tm["rate_limit_events"] == 1
    assert tm["session_start"] == "2026-01-01T00:00:00Z"
    assert tm["session_end"] == "2026-01-01T02:00:01Z"


def test_tolerant_on_garbage_and_absence(tmp_path):
    assert extract_trace_meta(None) == {}
    assert extract_trace_meta(tmp_path / "nope.jsonl") == {}
    p = tmp_path / "bad.jsonl"
    p.write_text("not json\n[1,2,3]\n")
    assert extract_trace_meta(p) == {}
