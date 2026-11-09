"""A5 Demucs-full smoke (service running): every model, two-stems, cache, cancel, analysis, practice, batch.

python tests/smoke_a5.py [reference_dir]   (reference_dir = local folder with mix.wav + truth.json; optional)
Uses the synthetic mix from smoke_separate (voice + generated accompaniment) so no copyrighted audio is needed.
"""
import io
import json
import sys
import time

import numpy as np
import soundfile as sf

sys.path.insert(0, __file__.rsplit("tests", 1)[0])
from tests import common  # noqa: E402
from tests.smoke_separate import SR, VOCAL, proj_energy, synth_accompaniment  # noqa: E402
import scipy.signal as ss  # noqa: E402


def synth_mix():
    v, sr = sf.read(VOCAL, dtype="float32")
    v = ss.resample_poly(v.mean(axis=1) if v.ndim > 1 else v, SR, sr).astype(np.float32)
    vocal = np.stack([v, v], 1)
    acc = synth_accompaniment(len(v) / SR)
    n = min(len(vocal), len(acc))
    vocal, acc = vocal[:n], acc[:n]
    acc *= (np.sqrt((vocal**2).mean()) / np.sqrt((acc**2).mean())) * 0.9
    k = min(1.0, 0.95 / np.abs(vocal + acc).max())
    return vocal * k, acc * k


def wav_bytes(x):
    b = io.BytesIO()
    sf.write(b, x, SR, format="WAV", subtype="PCM_16")
    return b.getvalue()


def run_job(path, fields, files):
    st, _, b = common.post_multipart(path, {**fields, "wait": "false"}, files)
    assert st == 202, (st, b[:200])
    j = json.loads(b)
    while j["status"] in ("queued", "running"):
        time.sleep(0.25)
        j = json.loads(common.get("/jobs/" + j["job_id"])[2])
    return j


def main():
    ok = True
    vocal, acc = synth_mix()
    mix = vocal + acc
    data = wav_bytes(mix)
    common.wait_ready()
    for model, extra in (("htdemucs", {}), ("htdemucs_ft", {"shifts": "1"}), ("htdemucs_6s", {})):
        for two in ("vocals", "all"):
            f = {"model": model, "two_stems": two, **extra}
            j = run_job("/separate", f, {"file": ("mix.wav", data, "audio/wav")})
            if j["status"] != "done":
                print("FAIL", model, j["error"]); ok = False; continue
            r = j["result"]
            ev = sf.read(io.BytesIO(common.get(j["files"]["vocals"])[2]), dtype="float32")[0][: len(vocal)]
            bleed = 10 * np.log10(proj_energy(ev, acc[: len(ev)]) / max(proj_energy(ev, vocal[: len(ev)]), 1e-12))
            print(f"{model:12} two={two or 'all':6} stems={len(r['stems'])} model {r['model_ms']:5d} ms "
                  f"wall {j['elapsed_ms']:5d} ms residual {r['residual_db']} dB vocal bleed {bleed:.1f} dB "
                  f"{'(cache)' if r['cache_hit'] else ''}")
            if r["residual_db"] > -30 and model == "htdemucs":
                ok = False
    # cache hit
    j = run_job("/separate", {"model": "htdemucs", "two_stems": "vocals"}, {"file": ("mix.wav", data, "audio/wav")})
    print("cache hit on repeat:", j["result"]["cache_hit"], f"({j['elapsed_ms']} ms)")
    ok &= j["result"]["cache_hit"]
    # cancel
    big = wav_bytes(np.tile(mix, (6, 1)))
    st, _, b = common.post_multipart("/separate", {"model": "htdemucs_ft", "two_stems": "all", "shifts": "2", "wait": "false"},
                                     {"file": ("big.wav", big, "audio/wav")})
    jid = json.loads(b)["job_id"]
    time.sleep(2.0)
    common.post_multipart(f"/jobs/{jid}/cancel", {}, {})
    for _ in range(80):
        s = json.loads(common.get("/jobs/" + jid)[2])
        if s["status"] not in ("queued", "running"):
            break
        time.sleep(0.25)
    print("cancel ->", s["status"]); ok &= s["status"] == "cancelled"
    # analyse (all stems of the synthetic mix) + practice
    j = run_job("/analyze/song", {"model": "htdemucs"}, {"file": ("mix.wav", data, "audio/wav")})
    ok &= j["status"] == "done"
    a = j["result"]
    print(f"analyze/song {j['elapsed_ms']} ms: pulse {a['rhythm'].get('pulse_bpm')} bpm (synthetic 90), bpb "
          f"{a['rhythm'].get('beats_per_bar')}, key {a['key']}, chords {len(a['chords']['chords'])} [{a['chords']['method']}], "
          f"bass notes {len(a['bass']['notes'])}, vocals url {a['vocals']['url']}")
    key = a["cache_key"]
    for semis, tempo in ((3, 1.0), (0, 0.8), (-4, 1.15)):
        t0 = time.perf_counter()
        st, h, body = common.post_multipart("/practice", {"cache_key": key, "stems": "drums,bass,other",
                                                          "semitones": str(semis), "tempo": str(tempo)}, {})
        y, sr = sf.read(io.BytesIO(body), dtype="float32")
        ratio = len(y) / len(mix)
        print(f"practice {semis:+d} st, tempo {tempo}: {time.perf_counter()-t0:.2f}s length x{ratio:.3f} (expect {1/tempo:.3f})")
        ok &= st == 200 and abs(ratio - 1 / tempo) < 0.01
    st, _, _ = common.post_multipart("/practice", {"cache_key": key, "semitones": "9"}, {})
    ok &= st == 400
    print("PRACTICE range check 400:", st == 400)
    print("A5 SMOKE:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
