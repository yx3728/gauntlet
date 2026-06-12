"""trace_meta.py — extract session conditions + cost from a claude stream-json
trace (v2 fix #3: conditions/cost telemetry — the v1 retrospective showed these
were recorded in traces but dropped from trial records, hiding a 200k-vs-1M
context asymmetry and $157 of chain spend).

Tolerant by design: returns {} for absent/non-stream-json traces (other node
kinds), and never raises. SCANS for the result event (it is not always the
last line — background-task notifications can follow it)."""

from __future__ import annotations

import json
from pathlib import Path

RESULT_KEYS = (
    "subtype", "num_turns", "duration_ms", "duration_api_ms",
    "total_cost_usd", "usage", "modelUsage", "permission_denials", "session_id",
)
INIT_KEYS = ("session_id", "model", "tools", "claude_code_version", "version", "cwd")


def extract_trace_meta(trace_path: str | Path | None) -> dict:
    if not trace_path:
        return {}
    trace_path = Path(trace_path)
    if not trace_path.exists():
        return {}

    init = result = None
    compactions: list[dict] = []
    rate_limit_events = 0
    first_ts = last_ts = None

    try:
        with open(trace_path, errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(e, dict):
                    continue
                ts = e.get("timestamp")
                if ts:
                    first_ts = first_ts or ts
                    last_ts = ts
                t = e.get("type")
                if t == "system":
                    sub = e.get("subtype")
                    if sub == "init" and init is None:
                        init = {k: e.get(k) for k in INIT_KEYS if e.get(k) is not None}
                    elif sub == "compact_boundary":
                        cm = e.get("compact_metadata") or {}
                        compactions.append({
                            "trigger": cm.get("trigger") or e.get("trigger"),
                            "pre_tokens": cm.get("pre_tokens") or e.get("pre_tokens"),
                            "post_tokens": cm.get("post_tokens") or e.get("post_tokens"),
                        })
                elif t == "rate_limit_event":
                    rate_limit_events += 1
                elif t == "result":
                    result = {k: e.get(k) for k in RESULT_KEYS if e.get(k) is not None}
    except OSError:
        return {}

    if init is None and result is None:
        return {}

    model_usage = (result or {}).get("modelUsage") or {}
    return {
        "session": init or {},
        "session_start": first_ts,
        "session_end": last_ts,
        "result": result or {},
        "total_cost_usd": (result or {}).get("total_cost_usd"),
        "num_turns": (result or {}).get("num_turns"),
        "context_windows": {m: (v or {}).get("contextWindow") for m, v in model_usage.items()},
        "compactions": compactions,
        "compaction_count": len(compactions),
        "rate_limit_events": rate_limit_events,
    }
