"""Practice tools: transpose (+-6 semitones) and tempo (70-120 %) of stems/mixes.

Library choice (licences verified): own phase-vocoder with identity phase locking (Laroche & Dolson) built on
numpy/scipy (BSD-3). Rejected: Rubber Band (GPL/commercial), pytsmod (GPL-3.0, uninstalled), pyrubberband (GPL via
Rubber Band). Resampling uses scipy.signal.resample_poly (BSD) - not libsoxr (LGPL). Pitch shift = resample by the
pitch ratio, then time-stretch back to the target duration (formants move with pitch, fine for practice).
"""
from fractions import Fraction

import numpy as np
import scipy.signal as ss

N_FFT = 4096
HS = N_FFT // 4  # synthesis hop


def _peaks_assign(mag: np.ndarray) -> np.ndarray:
    """For every bin the index of its nearest spectral peak."""
    k = np.arange(len(mag))
    p = np.zeros(len(mag), dtype=bool)
    p[2:-2] = (mag[2:-2] > mag[1:-3]) & (mag[2:-2] > mag[3:-1]) & (mag[2:-2] >= mag[:-4]) & (mag[2:-2] >= mag[4:])
    pk = k[p]
    if len(pk) == 0:
        return k
    pos = np.searchsorted(pk, k)
    left = pk[np.clip(pos - 1, 0, len(pk) - 1)]
    right = pk[np.clip(pos, 0, len(pk) - 1)]
    return np.where(np.abs(k - left) <= np.abs(right - k), left, right)


def _stretch_channel(x: np.ndarray, rate: float) -> np.ndarray:
    """rate > 1 = faster (shorter). Phase vocoder with identity phase locking."""
    win = np.hanning(N_FFT + 1)[:-1].astype(np.float64)
    ha = HS * rate  # analysis hop (float)
    n_frames = int(np.ceil((len(x) + N_FFT) / ha)) + 1
    pad = np.concatenate([np.zeros(N_FFT), x, np.zeros(N_FFT * 2)]).astype(np.float64)
    omega = 2 * np.pi * np.arange(N_FFT // 2 + 1) / N_FFT
    out = np.zeros(int(n_frames * HS + N_FFT * 2))
    wsum = np.zeros_like(out)
    prev_phase = None
    out_phase = None
    for t in range(n_frames):
        s = int(round(t * ha))
        if s + N_FFT > len(pad):
            break
        spec = np.fft.rfft(pad[s:s + N_FFT] * win)
        mag, ph = np.abs(spec), np.angle(spec)
        if prev_phase is None:
            out_phase = ph.copy()
        else:
            ha_i = s - prev_s
            dphi = ph - prev_phase - omega * ha_i
            dphi -= 2 * np.pi * np.round(dphi / (2 * np.pi))
            inst = omega + dphi / max(ha_i, 1)
            adv = out_phase + HS * inst
            near = _peaks_assign(mag)
            out_phase = adv[near] + (ph - ph[near])  # identity phase locking
        prev_phase, prev_s = ph, s
        frame = np.fft.irfft(mag * np.exp(1j * out_phase), N_FFT) * win
        o = t * HS
        out[o:o + N_FFT] += frame
        wsum[o:o + N_FFT] += win**2
    out = out / np.maximum(wsum, 1e-3)
    n_out = int(round(len(x) / rate))
    return out[N_FFT:N_FFT + n_out].astype(np.float32)


def _resample_ratio(x: np.ndarray, ratio: float) -> np.ndarray:
    """New length = len/ratio (ratio>1 shortens, raises pitch when played at the same rate)."""
    fr = Fraction(ratio).limit_denominator(2000)
    return ss.resample_poly(x, fr.denominator, fr.numerator, axis=0).astype(np.float32)


def process(x: np.ndarray, semitones: float = 0.0, tempo: float = 1.0, progress=None) -> np.ndarray:
    """x: [frames, channels] float32. semitones in [-6, 6], tempo in [0.7, 1.2] (1.0 = original speed)."""
    if not -6.0 <= semitones <= 6.0:
        raise ValueError("semitones must be within -6..6")
    if not 0.7 <= tempo <= 1.2:
        raise ValueError("tempo must be within 0.70..1.20")
    if abs(semitones) < 1e-6 and abs(tempo - 1.0) < 1e-6:
        return x
    f = 2.0 ** (semitones / 12.0)
    rate = tempo / f  # stretch first (pitch unchanged), then resample by f: pitch x f, duration / f
    cols = []
    for c in range(x.shape[1]):
        y = _stretch_channel(x[:, c], rate) if abs(rate - 1.0) > 1e-6 else x[:, c]
        cols.append(_resample_ratio(y, f) if abs(semitones) > 1e-6 else y)
        if progress:
            progress((c + 1) / x.shape[1])
    n = min(len(c) for c in cols)
    return np.stack([c[:n] for c in cols], axis=1)
