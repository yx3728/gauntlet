"""One-time data salvage + provenance recovery for the three trials (bookkeeping
audit follow-up). Extracts everything the traces already contain but trial.json
dropped, rescues volatile /tmp artifacts, persists the missing per-seed raws,
sanitizes traces for archival, and copies primary artifacts into the committed
results archive.

Usage: python3 experiments/roguelike-opus48/salvage_provenance.py
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "evalkit"))
import evalkit  # noqa: E402

ARMS = {
    "roguelike-opus48-max": "opus48",
    "roguelike-sonnet46-max": "sonnet46",
    "roguelike-fable5-max": "fable5",
}
RESULTS = HERE / "results"
HOME = str(Path.home())

# Volatile /tmp artifacts the agents created (from the trace forensics).
TMP_SALVAGE = {
    "roguelike-opus48-max": ["/tmp/eval24.txt", "/tmp/eval24b.txt", "/tmp/eval24c.txt", "/tmp/eval24d.txt",
                             "/tmp/eval24e.txt", "/tmp/eval24f.txt", "/tmp/eval40.txt", "/tmp/eval40b.txt", "/tmp/all70.txt"],
    "roguelike-sonnet46-max": ["/tmp/t3.jsonl", "/tmp/trace_full.jsonl", "/tmp/trace_b.jsonl"],
    "roguelike-fable5-max": [],
}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_trace(trace: Path) -> dict:
    """Single pass: init/version, result event (scan, don't tail), compactions,
    rate limits, first/last timestamps."""
    out = {"compact_boundary": [], "rate_limit_events": 0, "first_ts": None, "last_ts": None,
           "init": None, "result": None}
    with open(trace, errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = e.get("timestamp")
            if ts:
                out["first_ts"] = out["first_ts"] or ts
                out["last_ts"] = ts
            t = e.get("type")
            if t == "system":
                if e.get("subtype") == "init" and out["init"] is None:
                    out["init"] = {k: e.get(k) for k in ("session_id", "model", "tools", "claude_code_version", "version", "cwd")}
                elif e.get("subtype") == "compact_boundary":
                    cm = e.get("compact_metadata", {})
                    out["compact_boundary"].append({"trigger": cm.get("trigger") or e.get("trigger"),
                                                    "pre_tokens": cm.get("pre_tokens") or e.get("pre_tokens"),
                                                    "post_tokens": cm.get("post_tokens") or e.get("post_tokens")})
            elif t == "rate_limit_event":
                out["rate_limit_events"] += 1
            elif t == "result":
                out["result"] = {k: e.get(k) for k in ("subtype", "num_turns", "duration_ms", "duration_api_ms",
                                                        "total_cost_usd", "usage", "modelUsage", "permission_denials", "session_id")}
    return out


def git_sha_at(ts_iso: str) -> str:
    """Last commit at or before the given ISO timestamp."""
    out = subprocess.run(["git", "log", "--format=%H %cI", "--all"], capture_output=True, text=True, cwd=REPO)
    best = None
    for line in out.stdout.splitlines():
        sha, ct = line.split(" ", 1)
        if ct <= ts_iso and (best is None or ct > best[1]):
            best = (sha, ct)
    return best[0][:12] if best else "unknown"


def sanitize_trace(src: Path, dst: Path) -> dict:
    """Archive-safe trace: drop system/rate_limit lines (the init event enumerates
    host tools/plugins/MCP inventory — a privacy leak per the proven pipeline's
    sanitizer), redact $HOME and emails. Provenance from those events is captured
    separately by scan_trace BEFORE this runs."""
    kept = dropped = 0
    email = re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+")
    with open(src, errors="replace") as f, open(dst, "w") as g:
        for line in f:
            try:
                t = json.loads(line).get("type")
            except Exception:
                t = None
            if t in ("system", "rate_limit_event"):
                dropped += 1
                continue
            line = line.replace(HOME, "<HOME>")
            line = email.sub("<email>", line)
            g.write(line)
            kept += 1
    return {"kept": kept, "dropped_system_lines": dropped}


def main():
    node_v = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    sw = subprocess.run(["sw_vers", "-productVersion"], capture_output=True, text=True).stdout.strip()
    cost_table = {}

    for trial, arm in ARMS.items():
        tdir = REPO / "runs" / trial
        rdir = RESULTS / arm
        rdir.mkdir(parents=True, exist_ok=True)
        print(f"=== {trial} -> results/{arm}")

        # 1. Trace-derived provenance + cost (the data trial.json dropped).
        scan = scan_trace(tdir / "trace.jsonl")
        res = scan["result"] or {}
        cost_table[arm] = {"total_cost_usd": res.get("total_cost_usd"), "num_turns": res.get("num_turns"),
                           "duration_api_ms": res.get("duration_api_ms"),
                           "compactions": len(scan["compact_boundary"])}
        prov = {
            "trial": trial,
            "session": scan["init"],
            "session_start": scan["first_ts"],
            "session_end": scan["last_ts"],
            "result_event": res,
            "compact_boundary_events": scan["compact_boundary"],
            "rate_limit_events": scan["rate_limit_events"],
            "context_windows": {m: (v or {}).get("contextWindow") for m, v in (res.get("modelUsage") or {}).items()},
            "gauntlet_git_sha_at_session_start": git_sha_at(scan["first_ts"]) if scan["first_ts"] else "unknown",
            "node_version_now": node_v,
            "macos_version_now": sw,
            "note": "Reconstructed post-hoc from trace.jsonl + git log (bookkeeping audit 2026-06-12). "
                    "git SHA = last commit before session start; HEAD moved during sessions, so scoring/analysis "
                    "code versions are the commits noted in WORKLOG. Future trials should stamp this at run time.",
        }
        (rdir / "provenance.json").write_text(json.dumps(prov, indent=2))
        (rdir / "costs.json").write_text(json.dumps({**cost_table[arm], "usage": res.get("usage"),
                                                     "modelUsage": res.get("modelUsage")}, indent=2))

        # 2. Volatile /tmp salvage -> runs/<trial>/salvage/ (gitignored bulk), manifest committed.
        sdir = tdir / "salvage"
        manifest = []
        for p in TMP_SALVAGE[trial]:
            p = Path(p)
            if p.exists():
                sdir.mkdir(exist_ok=True)
                dst = sdir / p.name
                if not dst.exists():
                    shutil.copy2(p, dst)
                manifest.append({"file": p.name, "bytes": dst.stat().st_size, "sha256": sha256(dst), "from": str(p)})
                print(f"  salvaged {p} ({dst.stat().st_size} B)")
            else:
                manifest.append({"file": p.name, "from": str(p), "status": "GONE"})
                print(f"  GONE: {p}")
        # game_logs: too big to commit — manifest only.
        gl = tdir / "workspace" / "game_logs"
        gl_stat = None
        if gl.is_dir():
            files = list(gl.iterdir())
            gl_stat = {"count": len(files), "bytes": sum(f.stat().st_size for f in files)}
        (rdir / "salvage_manifest.json").write_text(json.dumps({"tmp_salvage": manifest, "game_logs": gl_stat}, indent=2))

        # 3. The missing per-seed raws: re-run the @inf diagnostic persisting raw
        #    (deterministic; regenerable, now also recorded).
        inf_raw = tdir / "inf_diagnostic_raw.json"
        if not inf_raw.exists():
            policy = tdir / "workspace" / "policy.js"
            vendor = REPO / "gym" / "tasks" / "roguelike" / "vendor"
            seeds = ",".join(str(s) for s in range(2000, 2030))
            out = subprocess.run(["node", str(vendor / "run_policy.js"), "--policy", str(policy),
                                  "--seeds", seeds, "--speed_cap", "inf", "--frame_skip", "1",
                                  "--max_steps", "90000", "--log", "none", "--json"],
                                 capture_output=True, text=True, cwd=str(vendor), timeout=7200)
            inf_raw.write_text(out.stdout.strip().splitlines()[-1])
            print("  persisted @inf per-seed raw")

        # 4. Primary artifacts -> committed archive.
        copies = {"workspace/policy.js": "policy.js", "heldout.json": "heldout.json",
                  "training.json": "training.json", "baselines.json": "baselines.json",
                  "heldout_fixed_2000_2029.json": "heldout_fixed_2000_2029.json",
                  "inf_diagnostic_raw.json": "inf_diagnostic_raw.json"}
        for src, dst in copies.items():
            s = tdir / src
            if s.exists():
                shutil.copy2(s, rdir / dst)

        # 5. Sanitized trace -> committed archive.
        st = rdir / "trace.sanitized.jsonl"
        if not st.exists():
            stats = sanitize_trace(tdir / "trace.jsonl", st)
            print(f"  sanitized trace: kept {stats['kept']} lines, dropped {stats['dropped_system_lines']} system lines")

    shutil.copy2(REPO / "runs" / "roguelike-opus48-max" / "prompt.txt", RESULTS / "PROMPT.txt")
    (RESULTS / "cost_summary.json").write_text(json.dumps(cost_table, indent=2))
    print("\ncost summary:", json.dumps(cost_table))


if __name__ == "__main__":
    main()
