"""Runtime configuration (env driven). Caches live OUTSIDE the project."""
import os
from pathlib import Path

HOST = "127.0.0.1"
PORT = 5175
ALLOWED_ORIGINS = ["http://localhost:5174"]  # dev origin only (spec: CORS only for the app)

CACHE = Path(os.environ.get("PSALMIST_AI_CACHE")
             or (Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "PsalmistAI" / "cache"))
CACHE.mkdir(parents=True, exist_ok=True)

# Point every model downloader at the external cache (must happen before torch/transformers import).
os.environ.setdefault("HF_HOME", str(CACHE / "hf"))
os.environ.setdefault("TORCH_HOME", str(CACHE / "torch"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("XDG_CACHE_HOME", str(CACHE / "xdg"))

DF_CACHE = CACHE / "deepfilternet"
RESULT_DIR = CACHE / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

AMT_MODEL = os.environ.get("PSALMIST_AMT_MODEL", "stanford-crfm/music-medium-800k")  # Apache-2.0 weights
DEMUCS_MODEL = "htdemucs"
MAX_UPLOAD_MB = 200
MAX_RESULTS = 12
