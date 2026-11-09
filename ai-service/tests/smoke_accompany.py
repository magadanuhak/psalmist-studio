"""Smoke: 16 bars of the Amazing Grace melody -> valid MIDI, < 10 s on GPU, 0 key/chord clashes after constraints.

Run with the service up:  python tests/smoke_accompany.py [song-id] [n_candidates]
"""
import base64
import io
import json
import sys
import time

import mido

sys.path.insert(0, __file__.rsplit("tests", 1)[0])
from tests import common  # noqa: E402
from app import theory  # noqa: E402

LIMIT_S = 10.0


def analyse(mid_bytes: bytes, params: dict):
    """Returns dict of counts: notes, out_of_key, strong_beat_non_chord (should both be 0)."""
    mid = mido.MidiFile(file=io.BytesIO(mid_bytes))
    tpb = mid.ticks_per_beat
    num, den = theory.parse_meter(params["meter"])
    bpb = num * 4.0 / den
    chords = theory.normalize_chords(params["chords"], params["bars"], bpb)
    pickup = params.get("pickup_beats", 0)
    scale = theory.scale_pcs(params["key"], params["mode"])
    strong = theory.strong_beats(num, den)
    n = bad_key = bad_chord = outside = 0
    for tr in mid.tracks:
        t = 0
        for m in tr:
            t += m.time
            if m.type == "note_on" and m.velocity > 0:
                n += 1
                beat = t / tpb
                ci = max([i for i, (b, _) in enumerate(chords) if pickup + b <= beat + 1e-3] or [0])
                ch = chords[ci][1]
                if beat < pickup - 0.05 or beat >= pickup + params["bars"] * bpb:
                    outside += 1
                if m.note % 12 not in scale and m.note % 12 not in ch["pcs"]:
                    bad_key += 1
                pos = (beat - pickup) % bpb
                if any(abs(pos - s) < 0.13 for s in strong) and m.note % 12 not in ch["pcs"]:
                    bad_chord += 1
    return {"notes": n, "out_of_key": bad_key, "strong_non_chord": bad_chord, "outside_range": outside,
            "length_s": round(mid.length, 1)}


def main():
    song = sys.argv[1] if len(sys.argv) > 1 else "amazing-grace"
    ncand = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    midi, params = common.song_melody_midi(song)
    common.wait_ready()
    params.update({"n_candidates": ncand, "seed": 7})
    # warm-up so that timings reflect a running service (first call compiles CUDA kernels)
    common.post_multipart("/accompany", {"params": json.dumps({**params, "n_candidates": 1, "bars": 2,
                                                              "chords": params["chords"][:2]})},
                          {"melody": ("melody.mid", midi, "audio/midi")})
    t0 = time.perf_counter()
    st, _, body = common.post_multipart("/accompany", {"params": json.dumps(params)},
                                        {"melody": ("melody.mid", midi, "audio/midi")})
    wall = time.perf_counter() - t0
    if st != 200:
        common.fail(f"HTTP {st}: {body[:300]}")
    res = json.loads(body)
    res_job = res
    res = res["result"]
    ok = True
    for c in res["candidates"]:
        mid = base64.b64decode(c["midi_base64"])
        a = analyse(mid, params)
        sec = c["gen_ms"] / 1000
        print(f"cand {c['index']}: {sec:.2f}s  {a}")
        if sec >= LIMIT_S:
            print("  FAIL time"); ok = False
        if a["notes"] < 20 or a["out_of_key"] or a["strong_non_chord"] or a["outside_range"]:
            print("  FAIL content"); ok = False
    print(f"total wall for {ncand} candidates: {wall:.2f}s (server job {res_job.get('elapsed_ms')} ms)")
    out = common.ROOT / "ai-service" / "tests" / "out"
    out.mkdir(exist_ok=True)
    for c in res["candidates"]:
        (out / f"{song}-cand{c['index']}.mid").write_bytes(base64.b64decode(c["midi_base64"]))
    print("ACCOMPANY SMOKE:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
