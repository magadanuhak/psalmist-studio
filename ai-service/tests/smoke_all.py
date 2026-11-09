"""Runs the three endpoint smoke tests (service must be running: start-ai.cmd)."""
import subprocess
import sys
from pathlib import Path

here = Path(__file__).parent
rc = 0
for name in ("smoke_denoise.py", "smoke_separate.py", "smoke_accompany.py"):
    print(f"\n=== {name}")
    rc |= subprocess.call([sys.executable, str(here / name)])
sys.exit(rc)
