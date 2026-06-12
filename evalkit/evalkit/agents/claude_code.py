"""claude_code.py — the `claude -p` node (the proven hardened spawn recipe).

Isolation is a STRICT ALLOWLIST sandbox (NOT bypassPermissions, which would
auto-approve everything): permission-mode default + an explicit allowlist means
ONLY these filesystem/runner tools are usable; every other tool (Cron, Task,
Web*, MCP, ...) is denied by default. In headless -p mode allowlisted tools
auto-approve and non-listed ones auto-deny (no hang). --strict-mcp-config with
no MCP config given = ZERO MCP servers (the host's global config is never
loaded). Budgets are layered: hard wall-clock via process-group SIGKILL, agent
turns via --max-turns, the attempts budget is prompt-level (soft).
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

from .node import AgentNode, NodeBudgets

ALLOWED_TOOLS = ("Bash", "Read", "Write", "Edit", "Glob", "Grep")
DISALLOWED_TOOLS = ("WebFetch", "WebSearch", "Task")  # belt-and-suspenders on top of the allowlist


class ClaudeCodeNode(AgentNode):
    name = "claude-code"

    def __init__(
        self,
        model: str = "sonnet",
        effort: str | None = "high",
        claude_bin: str = "claude",
        allowed_tools: tuple[str, ...] = ALLOWED_TOOLS,
        disallowed_tools: tuple[str, ...] = DISALLOWED_TOOLS,
    ):
        self.model = model
        self.effort = effort  # None -> omit the flag (models without effort support)
        self.claude_bin = claude_bin
        self.allowed_tools = tuple(allowed_tools)
        self.disallowed_tools = tuple(disallowed_tools)
        self.name = f"claude-code:{model}/{effort or 'default'}"

    def build_cmd(self, budgets: NodeBudgets) -> list[str]:
        cmd = [
            self.claude_bin,
            "-p",
            "--model", self.model,
        ]
        if self.effort:
            cmd += ["--effort", self.effort]
        cmd += [
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", "default",
            "--allowedTools", *self.allowed_tools,
            "--strict-mcp-config",
            "--disallowedTools", *self.disallowed_tools,
            "--max-turns", str(budgets.max_turns),
        ]
        return cmd

    def run(self, workspace: Path, prompt: str, budgets: NodeBudgets) -> dict:
        workspace = Path(workspace)
        trace_path = workspace.parent / "trace.jsonl"
        err_path = workspace.parent / "stderr.log"
        cmd = self.build_cmd(budgets)

        t0 = time.time()
        status = "ok"
        exit_code: int | None = None
        try:
            with open(trace_path, "wb") as out_f, open(err_path, "wb") as err_f:
                # New session so the WHOLE process tree (claude spawns node
                # children) can be killed on timeout via killpg.
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(workspace),
                    stdin=subprocess.PIPE,
                    stdout=out_f,
                    stderr=err_f,
                    start_new_session=True,
                )
                try:
                    # Prompt is delivered via stdin, not as a CLI arg.
                    proc.communicate(input=prompt.encode("utf-8"), timeout=budgets.wall_clock_s)
                    exit_code = proc.returncode
                    if exit_code != 0:
                        status = "nonzero_exit"
                except subprocess.TimeoutExpired:
                    status = "timeout_killed"
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    try:
                        proc.communicate(timeout=10)  # drain pipes after SIGKILL
                    except Exception:
                        pass
                    exit_code = -9
                except BaseException:
                    # v2 crash-safety: an interrupted/odd-failing orchestrator must
                    # not orphan the claude process tree (a 3-4h, $20-80 child).
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    raise
        except FileNotFoundError as e:
            return {"status": "spawn_error", "wall_ms": 0, "trace_path": None, "error": str(e)}

        return {
            "status": status,
            "wall_ms": int((time.time() - t0) * 1000),
            "trace_path": str(trace_path),
            "exit_code": exit_code,
            "cmd": cmd,
        }
