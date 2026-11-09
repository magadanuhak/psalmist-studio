"""Psalmist Studio local AI service. 127.0.0.1:5175, CORS only for http://localhost:5174."""
import asyncio
import base64
import json
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from importlib import metadata
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config  # noqa: F401  (sets cache env vars before torch/transformers import)
from . import analysis, audio_io, jobs, learn, more, practice, separate

import torch  # noqa: E402

API_VERSION = "1.0.0"
_started = time.time()
_warm = {"denoise": "idle", "separate": "idle", "accompany": "idle"}


def _ver(pkg: str):
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return None


def _warmup():
    """Load all models once in the background so the first real request is fast."""
    from . import accompany, denoise, separate

    for name, fn in (("denoise", denoise.load), ("separate", separate.load), ("accompany", accompany.load)):
        _warm[name] = "loading"
        try:
            fn()
            _warm[name] = "ready"
        except Exception as e:  # noqa: BLE001
            _warm[name] = f"error: {type(e).__name__}: {e}"


@asynccontextmanager
async def lifespan(_app):
    if os.environ.get("PSALMIST_AI_PRELOAD", "1") != "0":
        threading.Thread(target=_warmup, daemon=True).start()
    yield


app = FastAPI(title="Psalmist Studio AI", version=API_VERSION, lifespan=lifespan)
app.include_router(more.router)
app.add_middleware(TrustedHostMiddleware,
                   allowed_hosts=["127.0.0.1", "localhost", "127.0.0.1:5175", "localhost:5175", "testserver"])
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["*"], expose_headers=["X-Elapsed-Ms", "X-Audio-Info"], max_age=600)


async def _read_upload(f: UploadFile) -> bytes:
    data = await f.read()
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File too large (max {config.MAX_UPLOAD_MB} MB)")
    if not data:
        raise HTTPException(400, "Empty upload")
    return data


@app.get("/health")
def health():
    gpu = None
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info()
        p = torch.cuda.get_device_properties(0)
        gpu = {"name": p.name, "vram_total_mb": total // 2**20, "vram_free_mb": free // 2**20,
               "compute_capability": f"{p.major}.{p.minor}"}
    return {
        "ok": True, "service": "psalmist-ai", "api_version": API_VERSION,
        "uptime_s": int(time.time() - _started),
        "gpu": gpu, "device": "cuda" if gpu else "cpu",
        "models": {
            "denoise": {"name": "DeepFilterNet3", "status": _warm["denoise"], "license": "MIT OR Apache-2.0"},
            "separate": {"name": config.DEMUCS_MODEL, "status": _warm["separate"], "license": "MIT"},
            "accompany": {"name": config.AMT_MODEL, "status": _warm["accompany"], "license": "Apache-2.0"},
        },
        "versions": {"python": sys.version.split()[0], "torch": torch.__version__,
                     "cuda": torch.version.cuda, "deepfilternet": _ver("deepfilternet"), "demucs": _ver("demucs"),
                     "anticipation": _ver("anticipation"), "transformers": _ver("transformers"),
                     "fastapi": _ver("fastapi")},
    }


# ---------------------------------------------------------------- denoise
@app.post("/denoise")
async def denoise_ep(file: UploadFile = File(...), atten_lim_db: Optional[float] = Form(None)):
    """WAV/MP3 in -> cleaned WAV out (same sample rate / channel count; speech noise suppression)."""
    from . import denoise

    data = await _read_upload(file)
    t0 = time.perf_counter()
    try:
        with jobs.GPU_LOCK:
            wav, info = denoise.denoise(data, atten_lim_db=atten_lim_db)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    ms = int((time.perf_counter() - t0) * 1000)
    return Response(wav, media_type="audio/wav",
                    headers={"X-Elapsed-Ms": str(ms), "X-Audio-Info": json.dumps(info)})


# ---------------------------------------------------------------- jobs
def _job_urls(job):
    return job.file_urls()


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return {**job.public(), "files": _job_urls(job)}


@app.post("/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    jobs.cancel(job)
    return {**job.public(), "files": _job_urls(job)}


@app.get("/jobs/{job_id}/files/{name}")
def job_file(job_id: str, name: str):
    job = jobs.JOBS.get(job_id)
    if not job or name not in job.files or not job.files[name].exists():
        raise HTTPException(404, "No such file")
    return FileResponse(job.files[name], media_type="audio/wav", filename=name + ".wav")


@app.get("/cache/{key}")
def cache_meta(key: str):
    try:
        meta = separate.cached(key)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if not meta:
        raise HTTPException(404, "Unknown cache key")
    return meta


@app.get("/cache/{key}/{name}.wav")
def cache_file(key: str, name: str):
    try:
        return FileResponse(separate.stem_path(key, name), media_type="audio/wav", filename=name + ".wav")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, "No such stem") from e


def _respond(job, wait: bool):
    if not wait:
        return JSONResponse({**job.public(), "files": _job_urls(job), "poll": f"/jobs/{job.id}"}, status_code=202)
    jobs.wait(job)
    if job.status == "error":
        raise HTTPException(500, job.error)
    if job.status == "cancelled":
        raise HTTPException(409, "Job cancelled")
    return {**job.public(), "files": _job_urls(job)}


# ---------------------------------------------------------------- separate (Demucs: all models / modes)
def _publish_stems(job, meta: dict):
    key = meta["cache_key"]
    job.persist = True
    job.urls = {n: f"/cache/{key}/{n}.wav" for n in meta["stems"]}
    if meta.get("two_stems") == "vocals":
        job.urls["accompaniment"] = job.urls["no_vocals"]  # backwards-compatible alias
    job.files = {}


@app.get("/separate/models")
def separate_models():
    return {"models": separate.MODELS, "formats": sorted(separate.SUBTYPES), "default": config.DEMUCS_MODEL}


@app.post("/separate")
async def separate_ep(file: UploadFile = File(...), wait: bool = Form(True), model: str = Form("htdemucs"),
                      two_stems: Optional[str] = Form("vocals"), shifts: int = Form(0), overlap: float = Form(0.25),
                      segment: Optional[float] = Form(None), format: str = Form("pcm16")):
    """Song in -> stems (WAV only). two_stems: a stem name (-> `<stem>` + `no_<stem>`) or "all" (alias "none") for all stems of the model.
    models: htdemucs | htdemucs_ft | htdemucs_6s. shifts 0..10, overlap 0..0.95, segment seconds (optional),
    format pcm16|pcm24|float. wait=false -> 202 + poll /jobs/{id}; cancel with POST /jobs/{id}/cancel."""
    data = await _read_upload(file)
    try:
        audio_io.decode(data)
        if model not in separate.MODELS:
            raise ValueError(f"unknown model {model!r}; known: {sorted(separate.MODELS)}")
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    two = None if two_stems in ("", "all", "none") else two_stems

    def work(job: jobs.Job):
        meta = separate.separate(data, model=model, two_stems=two, shifts=shifts, overlap=overlap, segment=segment,
                                 fmt=format, job=job)
        _publish_stems(job, meta)
        return meta

    return _respond(jobs.submit("separate", work), wait)


# ---------------------------------------------------------------- "Invata din cantec" analysis
@app.post("/analyze/song")
async def analyze_song(file: Optional[UploadFile] = File(None), cache_key: Optional[str] = Form(None),
                       model: str = Form("htdemucs"), shifts: int = Form(0), chords: str = Form("auto"),
                       wait: bool = Form(False)):
    """Whole 'learn from song' pipeline: separate (all stems) -> drums rhythm (bpm, downbeats, groove), bass notes +
    chord roots, chord chart (Chordino if available), key, vocals hand-off URL. Returns a job (default wait=false)."""
    if cache_key:
        meta0 = separate.cached(cache_key)
        if not meta0:
            raise HTTPException(404, "Unknown cache_key (separate the song first)")
        data = None
    elif file is not None:
        meta0, data = None, await _read_upload(file)
        if model not in separate.MODELS:
            raise HTTPException(400, f"unknown model {model!r}")
    else:
        raise HTTPException(400, "Provide `file` or `cache_key`")

    def work(job: jobs.Job):
        meta = meta0 or separate.separate(data, model=model, two_stems=None, shifts=shifts, job=job)
        _publish_stems(job, meta)
        base = 0.0 if meta0 else 0.5
        res = learn.analyze_key(meta["cache_key"], meta,
                                progress=lambda p, s: setattr(job, "progress", min(0.99, base + (1 - base) * p)),
                                chord_method=chords)
        res["separation"] = {k: meta.get(k) for k in ("model", "residual_db", "model_ms", "stems", "cache_hit")}
        return res

    return _respond(jobs.submit("analyze", work), wait)


@app.post("/analyze/{kind}")
async def analyze_part(kind: str, cache_key: str = Form(...), beats_per_bar: Optional[int] = Form(None),
                       chords: str = Form("auto")):
    """kind = rhythm (drums) | bass | chords (harmonic stems) | key, from a cached separation."""
    if kind not in ("rhythm", "bass", "chords", "key"):
        raise HTTPException(404, "kind must be rhythm|bass|chords|key")
    meta = separate.cached(cache_key)
    if not meta:
        raise HTTPException(404, "Unknown cache_key")
    stems = meta["stems"]

    def run():
        sp = separate.stem_path
        if kind == "rhythm":
            return analysis.analyze_rhythm(sp(cache_key, "drums"), beats_per_bar)
        rh = analysis.analyze_rhythm(sp(cache_key, "drums"), beats_per_bar) if "drums" in stems else {}
        if kind == "bass":
            return analysis.analyze_bass(sp(cache_key, "bass"), downbeats=rh.get("downbeats"), beats=rh.get("beats"))
        names = [s for s in ("other", "bass", "piano", "guitar") if s in stems]
        h = analysis.harmonic_wav([sp(cache_key, s) for s in names], separate.cache_dir(cache_key) / "_harmonic.wav")
        if kind == "chords":
            return analysis.analyze_chords(h, beats=rh.get("beats"), method=chords)
        return analysis.estimate_key(h)

    try:
        return await asyncio.to_thread(run)
    except FileNotFoundError as e:
        raise HTTPException(400, f"stem missing in this separation: {e}") from e


# ---------------------------------------------------------------- practice (transpose / tempo)
@app.post("/practice")
async def practice_ep(cache_key: Optional[str] = Form(None), stems: str = Form("no_vocals"),
                      file: Optional[UploadFile] = File(None), semitones: float = Form(0.0), tempo: float = Form(1.0),
                      format: str = Form("pcm16")):
    """Transpose (-6..+6 semitones) and/or change tempo (0.70..1.20) of the sum of the chosen cached stems (comma list,
    e.g. "drums,bass,other" = minus din original) or of an uploaded file. Returns WAV. Own phase vocoder (BSD stack)."""
    if format not in separate.SUBTYPES:
        raise HTTPException(400, "bad format")

    def run(blob):
        if cache_key:
            x, sr = separate.mix_stems(cache_key, [s.strip() for s in stems.split(",") if s.strip()])
        else:
            x, sr = audio_io.decode(blob)
        t0 = time.perf_counter()
        y = practice.process(x, semitones, tempo)
        return audio_io.to_wav_bytes(y, sr, separate.SUBTYPES[format]), int((time.perf_counter() - t0) * 1000)

    blob = None
    if not cache_key:
        if file is None:
            raise HTTPException(400, "Provide `file` or `cache_key`")
        blob = await _read_upload(file)
    try:
        wav, ms = await asyncio.to_thread(run, blob)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e)) from e
    return Response(wav, media_type="audio/wav", headers={"X-Elapsed-Ms": str(ms)})


# ---------------------------------------------------------------- batch (statistics only)
@app.post("/batch")
async def batch_ep(folder: str = Form(...), model: str = Form("htdemucs"), shifts: int = Form(0),
                   wait: bool = Form(False)):
    """Separate + analyse every audio file in a local folder. Writes ONLY a statistics JSON (cache/batch/); the stems
    are deleted after each song and no file names are stored (hashes only)."""
    if model not in separate.MODELS:
        raise HTTPException(400, f"unknown model {model!r}")
    if not Path(folder).is_dir():
        raise HTTPException(400, "folder does not exist")
    return _respond(jobs.submit("batch", lambda job: learn.batch(folder, model, job, shifts)), wait)


@app.get("/separate/models")
def separate_models():
    return {"models": separate.MODELS, "formats": sorted(separate.SUBTYPES), "default": config.DEMUCS_MODEL}


# ---------------------------------------------------------------- accompany
@app.post("/accompany")
async def accompany_ep(melody: UploadFile = File(...), params: str = Form(...), wait: bool = Form(True)):
    """Melody MIDI + params JSON -> candidate accompaniment MIDI files (base64) conditioned on the melody.

    params: {key, mode, meter:"3/4", bpm (quarter-note), bars, chords:[...], style?, instruments?:[gm...],
             pickup_beats?, n_candidates?, top_p?, seed?, quantize?, include_melody?}
    """
    from . import accompany

    midi = await _read_upload(melody)
    try:
        req = _parse_accompany(json.loads(params))
        notes = accompany.read_melody(midi, req["bpm"])
        accompany.Grid(req["bpm"], req["meter"], req["bars"], req["pickup_beats"], req["chords"], req["key"],
                       req["mode"])  # validate chords/meter/key before queueing
    except (ValueError, KeyError, TypeError, EOFError, OSError) as e:
        raise HTTPException(400, f"Bad request: {type(e).__name__}: {e}") from e

    def work(job: jobs.Job):
        model = accompany.load()
        grid = accompany.Grid(req["bpm"], req["meter"], req["bars"], req["pickup_beats"], req["chords"], req["key"],
                              req["mode"])
        cands = []
        n = req["n_candidates"]
        for k in range(n):
            t0 = time.perf_counter()
            seed = None if req["seed"] is None else req["seed"] + k
            sk = accompany.build_skeleton(grid, req["skeleton"]) if req["skeleton"] is not None else []
            ev = accompany.generate(model, grid, notes, req["programs"], top_p=req["top_p"], seed=seed,
                                    progress=lambda x, k=k: setattr(job, "progress", (k + x) / n),
                                    temperature=req["temperature"], skeleton=sk)
            ev = sorted(ev + sk)
            mid, st = accompany.events_to_midi(ev, grid, notes, quantize=req["quantize"],
                                               include_melody=req["include_melody"])
            cands.append({"index": k, "seed": seed, "midi_base64": base64.b64encode(mid).decode(),
                          "notes": st["notes"], "programs": st["programs"],
                          "gen_ms": int((time.perf_counter() - t0) * 1000)})
        return {"candidates": cands, "bars": req["bars"], "bpm": req["bpm"], "meter": f"{grid.num}/{grid.den}",
                "programs": req["programs"], "skeleton": req["skeleton"], "total_seconds": round(grid.total_s, 2)}

    return _respond(jobs.submit("accompany", work), wait)


def _parse_accompany(p: dict) -> dict:
    from . import accompany

    bars = int(p["bars"])
    if not 1 <= bars <= 64:
        raise ValueError("bars must be 1..64")
    bpm = float(p["bpm"])
    if not 20 <= bpm <= 300:
        raise ValueError("bpm must be 20..300")
    style = str(p.get("style") or accompany.DEFAULT_STYLE).lower()
    if style not in accompany.STYLES:
        raise ValueError(f"unknown style {style!r}; known: {sorted(accompany.STYLES)}")
    skel, programs = accompany.STYLES[style]
    if p.get("instruments"):
        programs = [int(x) for x in p["instruments"]]
    if "skeleton" in p:  # explicit GM program, or false/null to disable the chord bed
        skel = int(p["skeleton"]) if p["skeleton"] not in (None, False) else None
    bad = [x for x in programs + ([skel] if skel is not None else []) if x not in accompany.INSTRUMENTS]
    if bad:
        raise ValueError(f"unsupported GM programs {bad}; supported: {sorted(accompany.INSTRUMENTS)}")
    n = int(p.get("n_candidates", 1))
    if not 1 <= n <= 8:
        raise ValueError("n_candidates must be 1..8")
    return {
        "key": str(p["key"]), "mode": str(p.get("mode", "major")), "meter": p.get("meter", "4/4"), "bpm": bpm,
        "bars": bars, "pickup_beats": float(p.get("pickup_beats", 0)), "chords": p["chords"], "programs": programs,
        "skeleton": skel,
        "n_candidates": n, "top_p": float(p.get("top_p", 0.95)), "temperature": float(p.get("temperature", 1.0)),
        "seed": None if p.get("seed") is None else int(p["seed"]),
        "quantize": bool(p.get("quantize", True)), "include_melody": bool(p.get("include_melody", False)),
    }


@app.get("/accompany/styles")
def styles():
    from . import accompany

    return {"styles": {k: {"skeleton": v[0], "generated": v[1]} for k, v in accompany.STYLES.items()}, "instruments": {k: {"role": v[0], "low": v[1], "high": v[2]}
                                                          for k, v in accompany.INSTRUMENTS.items()}}
