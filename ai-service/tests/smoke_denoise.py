"""Smoke: /denoise vs a classic spectral-subtraction cleaner (proxy of src/dsp/clean.ts) on a noisy fixture.

Fixture = test-audio/real/strofa-curat.wav (clean voice) + pink noise + 50 Hz hum + non-stationary noise bursts.
Metric = SNR (dB) of the output against the clean reference (best-gain aligned). AC: AI >= classic.
Run with the service up:  python tests/smoke_denoise.py [snr_in_db]
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

CLEAN = common.ROOT / "test-audio" / "real" / "strofa-curat.wav"


def pink(n, rng):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
    return np.fft.irfft(f, n)


def make_noisy(clean, sr, snr_db, seed=1):
    rng = np.random.default_rng(seed)
    n = len(clean)
    t = np.arange(n) / sr
    noise = pink(n, rng) + 0.35 * rng.standard_normal(n) * 0.2
    noise += 0.5 * np.sin(2 * np.pi * 50 * t) * noise.std() * 0.8  # mains hum
    # non-stationary part: slowly gated broadband bursts (keyboard / fan-like)
    env = (np.sin(2 * np.pi * 0.7 * t) > 0.6).astype(float)
    env = np.convolve(env, np.hanning(int(0.03 * sr)), "same")
    noise += env * rng.standard_normal(n) * noise.std() * 1.5
    gain = np.sqrt((clean**2).mean() / (10 ** (snr_db / 10) * (noise**2).mean()))
    return (clean + gain * noise).astype(np.float32)


def classic(x, sr, alpha=1.6, floor=0.1):
    """High-pass 80 Hz + spectral subtraction (noise profile = quietest 15 % frames), like src/dsp/clean.ts."""
    b, a = ss.butter(2, 80, "high", fs=sr)
    x = ss.lfilter(b, a, x)
    nper, hop = 2048, 512
    f, t, Z = ss.stft(x, sr, nperseg=nper, noverlap=nper - hop)
    mag = np.abs(Z)
    e = mag.mean(axis=0)
    prof = mag[:, e <= np.quantile(e, 0.15)].mean(axis=1, keepdims=True)
    g = np.maximum(1 - alpha * prof / np.maximum(mag, 1e-9), floor)
    _, y = ss.istft(Z * g, sr, nperseg=nper, noverlap=nper - hop)
    return y[: len(x)].astype(np.float32)


def snr(ref, est):
    n = min(len(ref), len(est))
    ref, est = ref[:n].astype(np.float64), est[:n].astype(np.float64)
    # tolerate a small delay (±64 samples) and a global gain
    best = -99.0
    for d in range(-64, 65, 8):
        r, e = (ref[d:], est[: n - d]) if d >= 0 else (ref[: n + d], est[-d:])
        g = (r @ e) / max(e @ e, 1e-12)
        best = max(best, 10 * np.log10((r @ r) / max(((r - g * e) ** 2).sum(), 1e-12)))
    return best


def main():
    snr_in = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
    clean, sr = sf.read(CLEAN, dtype="float32")
    if clean.ndim > 1:
        clean = clean.mean(axis=1)
    noisy = make_noisy(clean, sr, snr_in)
    buf = io.BytesIO()
    sf.write(buf, noisy, sr, format="WAV", subtype="PCM_16")
    common.wait_ready()
    common.post_multipart("/denoise", {}, {"file": ("w.wav", buf.getvalue(), "audio/wav")})  # warm-up
    t0 = time.perf_counter()
    st, hdr, body = common.post_multipart("/denoise", {}, {"file": ("noisy.wav", buf.getvalue(), "audio/wav")})
    wall = time.perf_counter() - t0
    if st != 200:
        common.fail(f"HTTP {st}: {body[:300]}")
    ai, sr2 = sf.read(io.BytesIO(body), dtype="float32")
    if ai.ndim > 1:
        ai = ai[:, 0]
    assert sr2 == sr, (sr2, sr)
    # give the classic cleaner its best shot: pick the best of a small parameter grid (oracle-tuned, so it is a fair bar)
    cl = max((classic(noisy, sr, a, f) for a in (0.6, 1.0, 1.6) for f in (0.1, 0.25, 0.4)), key=lambda y: snr(clean, y))
    s_in, s_cl, s_ai = snr(clean, noisy), snr(clean, cl), snr(clean, ai)
    print(f"SNR dB  noisy {s_in:.2f} | classic {s_cl:.2f} | AI(DeepFilterNet3) {s_ai:.2f}   "
          f"(audio {len(clean)/sr:.1f}s, server {hdr.get('x-elapsed-ms')} ms, wall {wall*1000:.0f} ms)")
    out = common.ROOT / "ai-service" / "tests" / "out"
    out.mkdir(exist_ok=True)
    sf.write(out / "denoise-noisy.wav", noisy, sr)
    sf.write(out / "denoise-ai.wav", ai, sr)
    sf.write(out / "denoise-classic.wav", cl, sr)
    ok = s_ai >= s_cl and s_ai > s_in
    print("DENOISE SMOKE:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
