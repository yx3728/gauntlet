import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GYM_ROOT = REPO_ROOT / "gym"
MINITASK = GYM_ROOT / "tests" / "fixtures" / "minitask" / "env.js"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def gym_root() -> Path:
    return GYM_ROOT


@pytest.fixture(scope="session")
def minitask_path() -> Path:
    return MINITASK


@pytest.fixture()
def tmp_policy(tmp_path):
    """Write a tiny valid policy file and return its path."""

    def _write(source: str = "module.exports = { policy: () => ({ action: { add: 2 } }) };\n"):
        p = tmp_path / "policy.js"
        p.write_text(source)
        return p

    return _write
