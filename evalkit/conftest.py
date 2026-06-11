import sys
from pathlib import Path

# Make the evalkit package importable regardless of how pytest is invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent))
