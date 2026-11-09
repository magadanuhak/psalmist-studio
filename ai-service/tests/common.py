"""Shared helpers for the smoke tests (HTTP client against a running service)."""
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import mido

ROOT = Path(__file__).resolve().parents[2]  # project root
BASE = "http://127.0.0.1:5175"
NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_to_midi(name: str) -> int:
    m = re.match(r"^([A-G])([#b]?)(-?\d)$", name)
    pc = NOTE_PC[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + pc


def song_melody_midi(song_id: str = "amazing-grace"):
    """songs.json (read-only) -> (midi_bytes, params_dict) for the accompany endpoint."""
    d = json.loads((ROOT / "scripts" / "benchmarks" / "songs.json").read_text(encoding="utf8"))[song_id]
    tpb = 480
    eighth = tpb // 2
    mid = mido.MidiFile(type=0, ticks_per_beat=tpb)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(d["bpm"]), time=0))
    tr.append(mido.Message("program_change", program=73, time=0))
    t_prev = 0
    t = 0
    for name, n8 in d["melody"]:
        dur = n8 * eighth
        if name != "R":
            tr.append(mido.Message("note_on", note=note_to_midi(name), velocity=90, time=t - t_prev))
            tr.append(mido.Message("note_off", note=note_to_midi(name), velocity=0, time=dur))
            t_prev = t + dur
        t += dur
    buf = io.BytesIO()
    mid.save(file=buf)
    num = int(d["sig"].split("/")[0])
    params = {"key": d["key"], "mode": d["mode"], "meter": d["sig"], "bpm": d["bpm"], "bars": len(d["chords"]),
              "pickup_beats": d["pickup"] * 0.5, "chords": d["chords"], "style": "worship"}
    return buf.getvalue(), params


def post_multipart(path: str, fields: dict, files: dict, timeout=900):
    """fields: name->str; files: name->(filename, bytes, content_type). Returns (status, headers, body)."""
    b = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (fn, data, ct) in files.items():
        out.write(f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{fn}"\r\n'
                  f"Content-Type: {ct}\r\n\r\n".encode() + data + b"\r\n")
    out.write(f"--{b}--\r\n".encode())
    req = urllib.request.Request(BASE + path, data=out.getvalue(), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def get(path: str, timeout=60):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()


def wait_ready(timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            _, _, b = get("/health")
            h = json.loads(b)
            if all(m["status"] == "ready" for m in h["models"].values()):
                return h
            if any(m["status"].startswith("error") for m in h["models"].values()):
                raise SystemExit(f"model load error: {h['models']}")
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(1)
    raise SystemExit("service not ready")


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)
