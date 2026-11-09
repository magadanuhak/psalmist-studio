"""Job registry: serialised GPU work + progress + cancel. Results may live in the persistent result cache."""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, Optional

from . import config

GPU_LOCK = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=3)


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind: str):
        self.id = uuid.uuid4().hex[:16]
        self.kind = kind
        self.status = "queued"  # queued | running | done | error | cancelled
        self.progress = 0.0
        self.error: Optional[str] = None
        self.result: Optional[dict] = None
        self.files: Dict[str, Path] = {}
        self.urls: Dict[str, str] = {}  # optional stable URLs (cache) overriding /jobs/{id}/files/..
        self.persist = False  # files belong to the result cache: never delete on prune
        self.cancel_flag = threading.Event()
        self.created = time.time()
        self.elapsed_ms: Optional[int] = None

    def check(self):
        if self.cancel_flag.is_set():
            raise Cancelled()

    def set_progress(self, p: float):
        self.check()
        self.progress = max(0.0, min(0.999, p))

    def public(self) -> dict:
        return {"job_id": self.id, "kind": self.kind, "status": self.status, "progress": round(self.progress, 3),
                "error": self.error, "result": self.result, "elapsed_ms": self.elapsed_ms}

    def file_urls(self) -> Dict[str, str]:
        return {n: self.urls.get(n, f"/jobs/{self.id}/files/{n}") for n in set(self.files) | set(self.urls)}


JOBS: Dict[str, Job] = {}


def _prune():
    if len(JOBS) <= config.MAX_RESULTS:
        return
    done = [k for k in sorted(JOBS, key=lambda k: JOBS[k].created) if JOBS[k].status not in ("queued", "running")]
    for jid in done[: max(0, len(JOBS) - config.MAX_RESULTS)]:
        if not JOBS[jid].persist:
            for p in JOBS[jid].files.values():
                p.unlink(missing_ok=True)
        JOBS.pop(jid, None)


def submit(kind: str, fn: Callable[[Job], dict], gpu: bool = True) -> Job:
    """Run fn(job) in the background. fn returns the JSON-able result and may set job.files / job.progress."""
    _prune()
    job = Job(kind)
    JOBS[job.id] = job

    def run():
        def body():
            if job.cancel_flag.is_set():
                job.status = "cancelled"
                return
            job.status = "running"
            t0 = time.perf_counter()
            try:
                job.result = fn(job)
                job.progress = 1.0
                job.status = "done"
            except Cancelled:
                job.status = "cancelled"
            except Exception as e:  # noqa: BLE001
                job.error = f"{type(e).__name__}: {e}"
                job.status = "error"
            job.elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if gpu:
            with GPU_LOCK:
                body()
        else:
            body()

    _pool.submit(run)
    return job


def cancel(job: Job) -> None:
    job.cancel_flag.set()
    if job.status == "queued":
        job.status = "cancelled"


def wait(job: Job, timeout: float = 3600.0) -> Job:
    t0 = time.time()
    while job.status in ("queued", "running") and time.time() - t0 < timeout:
        time.sleep(0.05)
    return job
