"""A6 endpoints: /beats, /structure, /pitch, /restore, /assistant (all load their model on demand)."""
import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from . import audio_io, beats, config, jobs, llm, pitch, restore, vram

router = APIRouter()


async def _read(f: UploadFile) -> bytes:
    data = await f.read()
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, "File too large")
    if not data:
        raise HTTPException(400, "Empty upload")
    return data


async def _gpu(fn, *a, **kw):
    def run():
        with jobs.GPU_LOCK:
            return fn(*a, **kw)

    try:
        return await asyncio.to_thread(run)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/vram")
def vram_status():
    return {**vram.status(), "llm_running": llm.running(), "llm_installed": llm.available()}


@router.post("/beats")
async def beats_ep(file: UploadFile = File(...)):
    """Beat This!: beats, downbeats, tempo map from any audio (vocal, mix, drums stem)."""
    data = await _read(file)
    t0 = time.perf_counter()
    out = await _gpu(beats.beats_from_bytes, data)
    return {**out, "elapsed_ms": int((time.perf_counter() - t0) * 1000)}


@router.post("/structure")
async def structure_ep(file: UploadFile = File(...), min_bars: int = Form(8)):
    """Segments (intro/verse/chorus/bridge/outro + app section_type) with the Beat This! beat/downbeat grid."""
    data = await _read(file)
    t0 = time.perf_counter()
    out = await _gpu(beats.structure_from_bytes, data, min_bars)
    return {**out, "elapsed_ms": int((time.perf_counter() - t0) * 1000)}


@router.post("/pitch")
async def pitch_ep(file: UploadFile = File(...), fmin: float = Form(60.0), fmax: float = Form(1100.0),
                   model: str = Form("full"), voicing_threshold: float = Form(0.3)):
    """CREPE (torchcrepe) frame pitch (10 ms hop): f0_hz (0 = unvoiced), voicing probability, voiced flag."""
    if model not in ("full", "tiny"):
        raise HTTPException(400, "model must be full|tiny")
    data = await _read(file)
    t0 = time.perf_counter()
    out = await _gpu(pitch.predict_bytes, data, fmin=fmin, fmax=fmax, model=model, voicing_threshold=voicing_threshold)
    return {**out, "elapsed_ms": int((time.perf_counter() - t0) * 1000)}


@router.post("/restore")
async def restore_ep(file: UploadFile = File(...), mode: int = Form(0)):
    """VoiceFixer: restore phone / room / clipped / band-limited speech or singing. Returns WAV (same rate/length)."""
    data = await _read(file)
    t0 = time.perf_counter()
    wav, info = await _gpu(restore.restore, data, mode)
    return Response(wav, media_type="audio/wav",
                    headers={"X-Elapsed-Ms": str(int((time.perf_counter() - t0) * 1000)), "X-Audio-Info": json.dumps(info)})


@router.get("/assistant/status")
def assistant_status():
    return {"installed": llm.available(), "running": llm.running(), "model": llm.MODEL.name, "idle_unload_s": llm.IDLE_S,
            "needs_mb": llm.NEED_MB, "free_mb": vram.free_mb()}


@router.post("/assistant/unload")
def assistant_unload():
    llm.stop()
    return assistant_status()


@router.post("/assistant")
async def assistant_ep(task: str = Form(...), prompt: str = Form(...), context: Optional[str] = Form(None),
                       schema: Optional[str] = Form(None)):
    """task = patch (-> validated settings patch) | explain | coach | chords. Romanian, fully offline (Qwen3-8B)."""
    if task not in ("patch", "explain", "coach", "chords"):
        raise HTTPException(400, "task must be patch|explain|coach|chords")
    if not llm.available():
        raise HTTPException(503, "Local LLM not installed")
    try:
        ctx = json.loads(context) if context else None
        sch = json.loads(schema) if schema else None
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"bad JSON: {e}") from e
    t0 = time.perf_counter()

    def run():
        if task == "patch":
            return llm.patch(prompt, ctx, sch)
        return llm.answer(task, prompt, ctx)

    try:
        out = await asyncio.to_thread(run)
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    return {**out, "elapsed_ms": int((time.perf_counter() - t0) * 1000)}
