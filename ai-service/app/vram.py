"""VRAM manager (12 GB RTX 3060): models load on demand; before a big load, idle models are unloaded (LRU)."""
import gc
import threading
import time
from typing import Callable, Dict, Optional

import torch

_lock = threading.RLock()
_unloaders: Dict[str, Callable[[], None]] = {}
_last_use: Dict[str, float] = {}
MARGIN_MB = 800


def free_mb() -> int:
    if not torch.cuda.is_available():
        return 10**6
    return torch.cuda.mem_get_info()[0] // 2**20


def register(name: str, unload: Callable[[], None]) -> None:
    with _lock:
        _unloaders[name] = unload
        _last_use[name] = time.time()


def touch(name: str) -> None:
    _last_use[name] = time.time()


def unregister(name: str) -> None:
    with _lock:
        _unloaders.pop(name, None)
        _last_use.pop(name, None)


def ensure_free(need_mb: int, keep: Optional[str] = None) -> int:
    """Unload least-recently-used registered models until `need_mb` (+margin) is free. Returns free MB."""
    with _lock:
        for name in sorted(_unloaders, key=lambda n: _last_use.get(n, 0)):
            if free_mb() >= need_mb + MARGIN_MB:
                break
            if name == keep:
                continue
            try:
                _unloaders[name]()
            except Exception:  # noqa: BLE001
                pass
            _unloaders.pop(name, None)
            _last_use.pop(name, None)
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        return free_mb()


def status() -> dict:
    return {"free_mb": free_mb(), "resident": sorted(_unloaders)}
