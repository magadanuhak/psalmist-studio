"""/assistant: local Qwen3-8B (Apache-2.0 weights, GGUF Q4_K_M) served by llama.cpp's llama-server (MIT), on demand.

Runtime + model live in %LOCALAPPDATA%\\PsalmistAI\\llm (no admin rights, no Ollama service). The server is started on
the first request, bound to 127.0.0.1:5177, and stopped after IDLE_S seconds of inactivity or when another GPU job
needs the VRAM (vram.ensure_free). Settings patches are produced with JSON-schema constrained decoding and then
re-validated by `validate()` - unknown fields/values are dropped and reported, never applied.
"""
import json
import os
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import config, vram

LLM_HOME = Path(os.environ.get("PSALMIST_LLM_HOME") or (config.CACHE.parent / "llm"))
MODEL = LLM_HOME / "models" / "Qwen3-8B-Q4_K_M.gguf"
EXE = LLM_HOME / "bin" / "llama-server.exe"
PORT = 5177
IDLE_S = 300
NEED_MB = 6500

_proc: Optional[subprocess.Popen] = None
_lock = threading.RLock()
_last = 0.0
_watch: Optional[threading.Thread] = None

SYSTEM_RO = ("Ești asistentul aplicației Psalmist Studio (muzică creștină: închinare, laudă, imnuri, pop, rock, popular). "
             "Răspunzi în limba română, scurt, clar, prietenos și corect muzical. Nu inventa funcții care nu există.")

# Known settings of the app (src/model/types.ts Project). Anything else is rejected.
DEFAULT_PATCH_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "genre": {"enum": ["worship", "imn", "cantare", "pop", "rock", "popular"]},
        "emotion": {"enum": ["trist", "romantic", "vesel", "energic", "epic", "nostalgic", "linistit", "dramatic",
                             "inchinare", "lauda", "rugaciune", "biruinta"]},
        "bpm": {"type": "integer", "minimum": 40, "maximum": 200},
        "timeSig": {"enum": ["4/4", "3/4", "6/8", "2/4", "7/8", "5/8", "9/8"]},
        "mode": {"enum": ["major", "minor"]},
        "tonic": {"enum": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]},
        "simplicity": {"enum": ["simplu", "normal", "bogat"]},
    },
}
PATCH_HELP = (
    "Câmpuri permise: genre (worship=închinare modernă, imn=imn tradițional, cantare=cântare creștină populară, pop, "
    "rock, popular), emotion (trist, romantic, vesel, energic, epic, nostalgic, linistit, dramatic, inchinare, lauda, "
    "rugaciune, biruinta), bpm (40-200), timeSig (4/4,3/4,6/8,2/4,7/8,5/8,9/8), mode (major/minor), tonic "
    "(C..B cu #), simplicity (simplu=armonie simplă, normal, bogat=armonie bogată). Pune în JSON DOAR câmpurile pe care "
    "utilizatorul le cere explicit sau implicit; nu adăuga altele.")


def available() -> bool:
    return EXE.exists() and MODEL.exists()


def _url(path: str) -> str:
    return f"http://127.0.0.1:{PORT}{path}"


def running() -> bool:
    return _proc is not None and _proc.poll() is None


def start(timeout: float = 180.0) -> None:
    global _proc, _last, _watch
    with _lock:
        if running():
            _last = time.time()
            return
        if not available():
            raise RuntimeError(f"LLM not installed (need {EXE} and {MODEL})")
        vram.ensure_free(NEED_MB)
        env = dict(os.environ)
        torch_lib = Path(__file__).resolve()
        import torch

        env["PATH"] = str(Path(torch.__file__).parent / "lib") + os.pathsep + str(EXE.parent) + os.pathsep + env["PATH"]
        _proc = subprocess.Popen(
            [str(EXE), "-m", str(MODEL), "--host", "127.0.0.1", "--port", str(PORT), "-ngl", "99", "-c", "4096",
             "--jinja", "-fa", "on", "--no-webui"],
            env=env, stdout=open(LLM_HOME / "server.log", "wb"), stderr=subprocess.STDOUT,
            creationflags=0x08000000)  # CREATE_NO_WINDOW
        t0 = time.time()
        while time.time() - t0 < timeout:
            if _proc.poll() is not None:
                raise RuntimeError("llama-server exited; see " + str(LLM_HOME / "server.log"))
            try:
                with urllib.request.urlopen(_url("/health"), timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        else:
            stop()
            raise RuntimeError("llama-server did not become ready")
        _last = time.time()
        vram.register("llm", stop)
        if _watch is None or not _watch.is_alive():
            _watch = threading.Thread(target=_idle_loop, daemon=True)
            _watch.start()


def stop() -> None:
    global _proc
    with _lock:
        if _proc is not None and _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(10)
            except Exception:  # noqa: BLE001
                _proc.kill()
        _proc = None
        vram.unregister("llm")


def _idle_loop():
    while True:
        time.sleep(15)
        if not running():
            return
        if time.time() - _last > IDLE_S:
            stop()
            return


def _chat(messages: List[dict], max_tokens: int = 500, schema: Optional[dict] = None, temperature: float = 0.2) -> str:
    global _last
    start()
    body: Dict[str, Any] = {"model": "qwen3", "messages": messages, "max_tokens": max_tokens, "temperature": temperature,
                            "chat_template_kwargs": {"enable_thinking": False}}
    if schema:
        body["response_format"] = {"type": "json_object", "schema": schema}
    req = urllib.request.Request(_url("/v1/chat/completions"), data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.loads(r.read())
    _last = time.time()
    vram.touch("llm")
    return out["choices"][0]["message"]["content"].strip()


# ------------------------------------------------------------------ strict validation

def validate(obj: Any, schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Keep only fields allowed by `schema` (flat object schema); returns (clean_patch, rejected_reasons)."""
    rejected: List[str] = []
    if not isinstance(obj, dict):
        return {}, ["not an object"]
    props = schema.get("properties", {})
    clean: Dict[str, Any] = {}
    for k, v in obj.items():
        if k not in props:
            rejected.append(f"unknown field {k}")
            continue
        sp = props[k]
        if "enum" in sp:
            if v not in sp["enum"]:
                rejected.append(f"{k}: value {v!r} not allowed")
                continue
        else:
            t = sp.get("type")
            if t == "integer" and (not isinstance(v, int) or isinstance(v, bool)):
                rejected.append(f"{k}: not an integer"); continue
            if t == "number" and (not isinstance(v, (int, float)) or isinstance(v, bool)):
                rejected.append(f"{k}: not a number"); continue
            if t == "string" and not isinstance(v, str):
                rejected.append(f"{k}: not a string"); continue
            if t == "boolean" and not isinstance(v, bool):
                rejected.append(f"{k}: not a boolean"); continue
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                if "minimum" in sp and v < sp["minimum"] or "maximum" in sp and v > sp["maximum"]:
                    rejected.append(f"{k}: {v} out of range"); continue
        clean[k] = v
    return clean, rejected


def patch(prompt: str, current: Optional[dict] = None, schema: Optional[dict] = None) -> dict:
    schema = schema or DEFAULT_PATCH_SCHEMA
    wrapper = {"type": "object", "additionalProperties": False, "required": ["patch", "explanation"],
               "properties": {"patch": schema, "explanation": {"type": "string", "maxLength": 240}}}
    msgs = [{"role": "system", "content": SYSTEM_RO + " " + PATCH_HELP + " Răspunde STRICT cu JSON "
             '{"patch": {...}, "explanation": "o propoziție în română"}.'},
            {"role": "user", "content": (f"Setări curente: {json.dumps(current, ensure_ascii=False)}\n" if current else "")
             + f"Cerere: {prompt}"}]
    raw = _chat(msgs, 300, wrapper, 0.1)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return {"valid": False, "patch": {}, "rejected": ["model output was not JSON"], "explanation": "", "raw": raw}
    clean, rej = validate(obj.get("patch", {}), schema)
    clean, _ = validate(ground(prompt, clean, current, schema), schema)
    return {"valid": True, "patch": clean, "rejected": rej, "explanation": str(obj.get("explanation", ""))[:240]}


def answer(task: str, prompt: str, context: Optional[dict] = None) -> dict:
    extra = {"explain": "Explică teoria muzicală pe înțelesul unui cântăreț amator, cu exemple scurte.",
             "coach": "Ești profesor de canto: pe baza raportului vocal din context dă 3 sfaturi concrete, blânde și practice.",
             "chords": "Explică de ce au fost alese acordurile din context (funcție armonică, tonalitate, emoție)."}[task]
    msgs = [{"role": "system", "content": SYSTEM_RO + " " + extra},
            {"role": "user", "content": (f"Context (JSON): {json.dumps(context, ensure_ascii=False)}\n" if context else "")
             + prompt}]
    return {"text": _chat(msgs, 450, None, 0.4)}


# ------------------------------------------------------------------ deterministic grounding of the model's patch
import re as _re
import unicodedata as _ud

_NOTE_RO = {"do": 0, "re": 2, "mi": 4, "fa": 5, "sol": 7, "la": 9, "si": 11}
_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_GENRE_KW = [("cantare crestina", "cantare"), ("cantare", "cantare"), ("inchinare", "worship"), ("worship", "worship"),
             ("imn", "imn"), ("rock", "rock"), ("popular", "popular"), ("balada", "pop"), ("pop", "pop")]
_EMOTION_KW = [("rugaciune", "rugaciune"), ("biruinta", "biruinta"), ("lauda", "lauda"), ("nostalgic", "nostalgic"),
               ("romantic", "romantic"), ("dramatic", "dramatic"), ("epic", "epic"), ("vesel", "vesel"),
               ("energic", "energic"), ("trist", "trist"), ("linistit", "linistit"), ("calm", "linistit")]


def _fold(s: str) -> str:
    return "".join(c for c in _ud.normalize("NFD", s.lower()) if _ud.category(c) != "Mn")


def ground(prompt: str, patch: Dict[str, Any], current: Optional[dict], schema: Dict[str, Any]) -> Dict[str, Any]:
    """Make the patch trustworthy: numbers / keys / meters must be stated in the request (and are taken from it),
    keywords fill genre/emotion, unrequested or no-op fields are dropped."""
    p = _fold(prompt)
    out: Dict[str, Any] = {}
    props = schema.get("properties", {})
    # explicit meter
    m = _re.search(r"\b(\d)\s*/\s*(\d)\b", p)
    if m and "timeSig" in props and f"{m.group(1)}/{m.group(2)}" in props["timeSig"].get("enum", []):
        out["timeSig"] = f"{m.group(1)}/{m.group(2)}"
    # explicit tempo (not part of a meter)
    p_nometer = _re.sub(r"\b\d\s*/\s*\d\b", " ", p)
    for num in _re.findall(r"\b(\d{2,3})\b", p_nometer):
        n = int(num)
        if "bpm" in props and props["bpm"].get("minimum", 0) <= n <= props["bpm"].get("maximum", 999):
            out["bpm"] = n
            break
    # explicit key: "in/tonalitatea/schimba in <nota> [diez|bemol] [major|minor]"
    k = _re.search(r"\b(?:in|tonalitatea|tonalitate|schimba in)\s+(do|re|mi|fa|sol|la|si)\b(?:\s+(diez|bemol))?(?:\s+(major|minor|majora|minora))?", p)
    if k and "tonic" in props:
        pc = _NOTE_RO[k.group(1)] + {"diez": 1, "bemol": -1, None: 0}[k.group(2)]
        out["tonic"] = _NAMES[pc % 12]
        if k.group(3) and "mode" in props:
            out["mode"] = "minor" if k.group(3).startswith("minor") else "major"
    if "mode" in props and "mode" not in out:
        mm = _re.search(r"\b(major|minor)", p)
        if mm:
            out["mode"] = mm.group(1)
    # keywords
    if "genre" in props:
        for kw, v in _GENRE_KW:
            if kw in p:
                out["genre"] = v
                break
    if "emotion" in props:
        for kw, v in _EMOTION_KW:
            if kw in p:
                out["emotion"] = v
                break
    if "simplicity" in props:
        if _re.search(r"nici simpl", p) or "normala" in p:
            out["simplicity"] = "normal"
        elif _re.search(r"simpl|usoara", p):
            out["simplicity"] = "simplu"
        elif _re.search(r"bogat|jazz|complex", p):
            out["simplicity"] = "bogat"
    # anything the model added on its own is only kept for genre/emotion when the request has no keyword but a
    # paraphrase is plausible: allow it only if it differs from the current setting
    for f in ("genre", "emotion"):
        if f not in out and f in patch and (not current or current.get(f) != patch[f]) and f in props:
            out[f] = patch[f]
    return out
