"""external.py — ingest an externally-developed manual trial.

A *manual trial* is a `policy.js` written OUTSIDE gauntlet's orchestration — e.g.
an interactive session in another harness, or another provider's model (GPT-5.5
Codex). To make such a policy directly comparable to a gauntlet cohort arm, two
consistency guarantees must hold before any number is trusted:

  1. **Substrate** — the simulator the external policy was developed against is
     byte-identical (sha256) to the canonical task's pinned bundle.
  2. **Prompt** — the instructions the external agent received are byte-identical
     to the reference prompt (or the mismatch is reported, not hidden).

Only then is the policy scored on the SAME seeds, in the SAME pinned canonical
arena, under the SAME criterion as every cohort arm — via the deterministic
per-batch boundary (`score_policy`). The external trial dir is read-only; the
ingest record is returned (and optionally written to a dir the caller owns), so
the external repo is never modified.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from ..boundary import default_gym_root
from .api import _build_arena, score_policy
from .criterion import criterion_fn, criterion_summary


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _find(trial_dir: Path, name: str) -> Path | None:
    """Locate a named file in the trial dir or its workspace/ subdir."""
    for cand in (trial_dir / name, trial_dir / "workspace" / name):
        if cand.exists():
            return cand
    return None


def canonical_substrate(task: str, gym_root: Path, node_bin: str = "node") -> dict:
    """Build the task's canonical arena to a temp dir and return its pinned
    bundle filename + sha256 + criterion (the authoritative substrate)."""
    with tempfile.TemporaryDirectory(prefix="gauntlet-ingest-arena-") as td:
        manifest = _build_arena(task, Path(td) / "arena", gym_root, node_bin)
        bundle_file = manifest.get("bundle_file")
        files = manifest.get("files", {})
        return {
            "bundle_file": bundle_file,
            "bundle_sha256": files.get(bundle_file),
            "task_version": manifest.get("task_version"),
            "criterion": manifest.get("criterion"),
        }


def ingest_external_trial(
    trial_dir: str | Path,
    *,
    task: str,
    heldout_seeds,
    fixed_seeds=None,
    reference_prompt: str | None = None,
    gym_root: str | Path | None = None,
    config: dict | None = None,
    timeout_s: int = 7200,
    node_bin: str = "node",
    policy_name: str = "policy.js",
    prompt_name: str = "PROMPT.md",
    bundle_name: str | None = None,
) -> dict:
    """Verify + canonically score an external manual trial. Returns a record
    with the consistency verdicts and criterion summaries (held-out + optional
    fixed comparison set). Raises if no policy.js is found."""
    trial_dir = Path(trial_dir).resolve()
    gym_root = Path(gym_root).resolve() if gym_root else default_gym_root()

    policy = _find(trial_dir, policy_name)
    if not policy:
        raise FileNotFoundError(f"no {policy_name} in {trial_dir} or its workspace/")

    sub = canonical_substrate(task, gym_root, node_bin)
    bundle_name = bundle_name or sub["bundle_file"]

    # --- substrate consistency ---
    ext_bundle = _find(trial_dir, bundle_name) if bundle_name else None
    ext_bundle_sha = _sha256(ext_bundle) if ext_bundle else None
    substrate = {
        "bundle_name": bundle_name,
        "external_bundle_sha256": ext_bundle_sha,
        "canonical_bundle_sha256": sub["bundle_sha256"],
        "match": (ext_bundle_sha is not None and ext_bundle_sha == sub["bundle_sha256"]),
        "found": ext_bundle is not None,
    }

    # --- prompt consistency ---
    ext_prompt = _find(trial_dir, prompt_name)
    prompt = {"checked": reference_prompt is not None, "found": ext_prompt is not None}
    if reference_prompt is not None:
        ref_sha = hashlib.sha256(reference_prompt.encode("utf-8")).hexdigest()
        ext_sha = _sha256(ext_prompt) if ext_prompt else None
        prompt.update(external_prompt_sha256=ext_sha, reference_prompt_sha256=ref_sha,
                      match=(ext_sha is not None and ext_sha == ref_sha))

    consistent = substrate["match"] and (prompt.get("match", True) if reference_prompt is not None else True)

    # --- canonical scoring (same arena, same criterion as every cohort arm) ---
    kind, fn = criterion_fn(sub.get("criterion"))
    out: dict = {
        "trial_dir": str(trial_dir),
        "task": task,
        "task_version": sub["task_version"],
        "policy_sha256": _sha256(policy),
        "criterion": kind,
        "consistent": consistent,
        "substrate": substrate,
        "prompt": prompt,
    }

    heldout = score_policy(policy, list(heldout_seeds), task=task, gym_root=gym_root,
                           config=config, timeout_s=timeout_s, node_bin=node_bin)
    out["heldout"] = {"ok": heldout.ok, "error": heldout.error,
                      "summary": criterion_summary(heldout.results, fn) if heldout.ok else {},
                      "results": heldout.results}
    if fixed_seeds is not None:
        fixed = score_policy(policy, list(fixed_seeds), task=task, gym_root=gym_root,
                             config=config, timeout_s=timeout_s, node_bin=node_bin)
        out["fixed"] = {"ok": fixed.ok, "error": fixed.error,
                        "summary": criterion_summary(fixed.results, fn) if fixed.ok else {},
                        "results": fixed.results}
    return out
