"""Smoke: /separate on a synthetic mix = real vocal (test-audio) + generated accompaniment.

Mix = test-audio/real/strofa-curat.wav (voice) + synthesised chords/bass/hats. Metric (SDR proxy):
  bleed_dB = 10 log10( |component of the separated vocals explained by the TRUE accompaniment|^2 /
                       |component explained by the TRUE vocal|^2 )         (AC: < -20 dB)
also reports vocal SDR. Run with the service up:  python tests/smoke_separate.py
"""
import io
import json
import sys
import time

import numpy as np
import scipy.signal as ss
import soundfile as sf

sys.path.insert(0, __file__.rsplit("tests", 1)[0])
from tests import common  # noqa: E402

SR = 44100
VOCAL = common.ROOT / "test-audio" / "real" / "strofa-curat.wav"


def synth_accompaniment(seconds, sr=SR, bpm=90, seed=3):
    """Piano-ish arpeggios + sustained pad + bass + hi-hat/kick over G - D - Em - C, stereo."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    out = np.zeros((n, 2))
    beat = 60 / bpm
    prog = [[55, 59, 62, 67], [50, 57, 62, 66], [52, 55, 59, 64], [48, 55, 60, 64]]  # bass-ish voicings
    midi = lambda m: 440 * 2 ** ((m - 69) / 12)
    nbeats = int(seconds / beat) + 1
    for b in range(nbeats):
        chord = prog[(b // 4) % 4]
        # arpeggio: one tone per beat, cycling through the chord
        m = chord[1 + (b % 3)] + 12
        st = int(b * beat * sr)
        L = int(beat * 1.6 * sr)
        tt = np.arange(L) / sr
        env = np.exp(-tt * 3.0)
        tone = sum(np.sin(2 * np.pi * midi(m) * h * tt) / h**1.3 for h in range(1, 7)) * env * 0.22
        seg = out[st: st + L, 0].shape[0]
        out[st: st + seg, 0] += tone[:seg] * 0.9
        out[st: st + seg, 1] += tone[:seg] * 1.1
        if b % 4 == 0:  # bass note per bar (saw-ish)
            L = int(beat * 3.8 * sr)
            tt = np.arange(L) / sr
            bass = sum(np.sin(2 * np.pi * midi(chord[0] - 12) * h * tt) / h for h in range(1, 5)) * np.exp(-tt * 0.6) * 0.30
            seg = out[st: st + L, 0].shape[0]
            out[st: st + seg] += bass[:seg, None]
            pad = sum(np.sin(2 * np.pi * midi(m2) * tt) for m2 in chord[1:]) * 0.07 * np.minimum(tt * 4, 1) * np.exp(-tt * 0.3)
            out[st: st + seg] += pad[:seg, None]
        # kick on 1 and 3, hat every half beat
        for hb in (0, 0.5):
            hs = int((b + hb) * beat * sr)
            hl = int(0.05 * sr)
            if hs + hl < n:
                hat = rng.standard_normal(hl) * np.exp(-np.arange(hl) / (0.012 * sr)) * 0.10
                hat = ss.lfilter(*ss.butter(2, 6000, "high", fs=sr), hat)
                out[hs: hs + hl] += hat[:, None]
        if b % 2 == 0:
            kl = int(0.18 * sr)
            ks = int(b * beat * sr)
            if ks + kl < n:
                kt = np.arange(kl) / sr
                kick = np.sin(2 * np.pi * (45 + 90 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 18) * 0.5
                out[ks: ks + kl] += kick[:, None]
    return out.astype(np.float32)


def proj_energy(est, ref):
    """Energy of est explained by ref (least squares, mono-summed channels jointly)."""
    e, r = est.ravel().astype(np.float64), ref.ravel().astype(np.float64)
    return ((e @ r) ** 2) / max(r @ r, 1e-12)


def main():
    v, sr = sf.read(VOCAL, dtype="float32")
    if v.ndim > 1:
        v = v.mean(axis=1)
    v = ss.resample_poly(v, SR, sr).astype(np.float32)
    vocal = np.stack([v, v], axis=1)
    acc = synth_accompaniment(len(v) / SR)
    n = min(len(vocal), len(acc))
    vocal, acc = vocal[:n], acc[:n]
    acc *= (np.sqrt((vocal**2).mean()) / np.sqrt((acc**2).mean())) * 0.9  # accompaniment ~ -1 dB vs voice
    mix = vocal + acc
    k = min(1.0, 0.95 / np.abs(mix).max())
    vocal, acc, mix = vocal * k, acc * k, mix * k
    buf = io.BytesIO()
    sf.write(buf, mix, SR, format="WAV", subtype="PCM_16")
    common.wait_ready()
    common.post_multipart("/separate", {}, {"file": ("mix.wav", buf.getvalue(), "audio/wav")})  # warm-up
    t0 = time.perf_counter()
    st, _, body = common.post_multipart("/separate", {}, {"file": ("mix.wav", buf.getvalue(), "audio/wav")})
    wall = time.perf_counter() - t0
    if st != 200:
        common.fail(f"HTTP {st}: {body[:300]}")
    res = json.loads(body)
    got = {}
    for name, url in res["files"].items():
        _, _, wav = common.get(url)
        got[name] = sf.read(io.BytesIO(wav), dtype="float32")[0]
    ev, ea = got["vocals"][:n], got["accompaniment"][:n]
    bleed = 10 * np.log10(proj_energy(ev, acc) / max(proj_energy(ev, vocal), 1e-12))
    # accompaniment-side leakage of the vocal, and SDR of vocals
    leak = 10 * np.log10(proj_energy(ea, vocal) / max(proj_energy(ea, acc), 1e-12))
    sdr = 10 * np.log10((vocal.astype(np.float64) ** 2).sum() / max(((vocal - ev) ** 2).sum(), 1e-12))
    print(f"vocals: accompaniment bleed {bleed:.1f} dB (AC < -20) | vocal SDR {sdr:.1f} dB | "
          f"accomp-stem vocal leak {leak:.1f} dB | audio {n/SR:.1f}s, model {res['result']['model_ms']} ms, "
          f"wall {wall*1000:.0f} ms")
    out = common.ROOT / "ai-service" / "tests" / "out"
    out.mkdir(exist_ok=True)
    sf.write(out / "separate-mix.wav", mix, SR)
    sf.write(out / "separate-vocals.wav", ev, SR)
    sf.write(out / "separate-accompaniment.wav", ea, SR)
    ok = bleed < -20
    print("SEPARATE SMOKE:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
