"""A6 smoke / acceptance measurements (service running).

python tests/smoke_a6.py beats|structure|pitch|restore|assistant|all [reference_dir]
reference_dir (local only, optional) = folder with mix.wav, vocals.wav, grid.json (qm bars) and optionally drums.wav.
"""
import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import scipy.signal as ss
import soundfile as sf

sys.path.insert(0, __file__.rsplit("tests", 1)[0])
from tests import common  # noqa: E402

FIX = common.ROOT / "test-audio" / "real" / "strofa-curat.wav"
ref = Path(sys.argv[2]) if len(sys.argv) > 2 else None


def call(path, fields=None, files=None):
    t0 = time.perf_counter()
    st, h, b = common.post_multipart(path, fields or {}, files or {})
    return st, h, b, (time.perf_counter() - t0) * 1000


def upload(p: Path):
    return {"file": (p.name, p.read_bytes(), "audio/wav")}


def err_to_grid(times, grid):
    return np.array([np.min(np.abs(np.asarray(times) - g)) for g in grid]) * 1000


# ---------------------------------------------------------------- beats / structure
def t_beats():
    from tests.smoke_separate import SR, synth_accompaniment

    acc = synth_accompaniment(40)
    b = io.BytesIO(); sf.write(b, acc, SR, format="WAV", subtype="PCM_16")
    st, _, body, ms = call("/beats", files={"file": ("syn.wav", b.getvalue(), "audio/wav")})
    r = json.loads(body)
    db = np.array(r["downbeats"])
    # synthetic: 90 bpm, bar = 4*60/90 s, first downbeat at 0 (chord changes every 4 beats)
    bar = 4 * 60 / 90
    e = err_to_grid(db, np.arange(0, 38, bar)[1:])
    print(f"/beats synthetic 90 bpm: bpm {r['bpm']} bpb {r['beats_per_bar']} bar {r['bar_seconds']} "
          f"downbeat err median {np.median(e):.0f} ms ({ms:.0f} ms)")
    ok = abs(r["bpm"] - 90) < 2 and np.median(e) < 40
    if ref:
        qm = np.array(json.loads((ref / "grid.json").read_text())["bars"])
        for name in ("mix.wav", "vocals.wav"):
            p = ref / name
            if not p.exists():
                continue
            st, _, body, ms = call("/beats", files=upload(p))
            r = json.loads(body)
            db = np.array(r["downbeats"])
            e = err_to_grid(db, qm)
            print(f"/beats ref {name}: bpm {r['bpm']} bpb {r['beats_per_bar']} bar {r['bar_seconds']} s, {len(db)} downbeats; "
                  f"vs qm regularised bars: median {np.median(e):.0f} ms; first qm bars 24.40/47.02 -> nearest "
                  f"{err_to_grid(db, [24.40, 47.02]).round(0)} ms ({ms:.0f} ms)")
    print("BEATS:", "PASS" if ok else "FAIL")
    return ok


def t_structure():
    if not ref:
        print("STRUCTURE: skipped (no reference dir)"); return True
    st, _, body, ms = call("/structure", files=upload(ref / "mix.wav"))
    r = json.loads(body)
    if not r.get("ok"):
        print("STRUCTURE FAIL", r); return False
    print(f"/structure ref mix ({ms:.0f} ms): bpm {r['bpm']} bar {r['bar_seconds']}")
    for s in r["segments"]:
        print(f"   {s['start']:7.1f} - {s['end']:7.1f}  {s['bars']:3d} bars  {s['label']:8} ({s['section_type']}) cluster {s['cluster']}")
    return True


# ---------------------------------------------------------------- pitch
def synth_singer(notes, noise_db=None, vib=True, sr=16000, seed=0):
    """notes = [(midi, seconds)] -> (audio, true f0 per 10 ms frame (0 = rest)). Glottal-ish source + 3 formants."""
    rng = np.random.default_rng(seed)
    f0s, parts = [], []
    phase = 0.0
    for midi, dur in notes:
        n = int(dur * sr)
        t = np.arange(n) / sr
        base = 440 * 2 ** ((midi - 69) / 12)
        f = base * (2 ** (((35 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(t / 0.3, 1)) if vib else np.zeros(n)) / 1200))
        ph = phase + 2 * np.pi * np.cumsum(f) / sr
        phase = ph[-1]
        x = sum(np.sin(h * ph) / h**1.2 for h in range(1, 20))
        env = np.minimum(1, np.minimum(t / 0.03, (dur - t) / 0.05))
        parts.append(x * env)
        f0s.append((f, n))
        parts.append(np.zeros(int(0.12 * sr)))
        f0s.append((None, int(0.12 * sr)))
    x = np.concatenate(parts)
    for fc, bw in ((700, 130), (1220, 70), (2600, 160)):
        b, a = ss.iirpeak(fc, fc / bw, fs=sr)
        x = x + 0.6 * ss.lfilter(b, a, x)
    x /= np.abs(x).max()
    truth = []
    for f, n in f0s:
        k = n // 160
        truth.extend([0.0] * k if f is None else list(f[: k * 160].reshape(k, 160).mean(axis=1)))
    if noise_db is not None:
        pink = np.fft.irfft(np.fft.rfft(rng.standard_normal(len(x))) / np.sqrt(np.maximum(np.arange(len(x) // 2 + 1), 1)), len(x))
        pink *= np.sqrt((x**2).mean() / (10 ** (noise_db / 10) * (pink**2).mean()))
        x = x + pink
    return x.astype(np.float32), np.array(truth), sr


def frame_scores(est_f0, truth, tol=50):
    n = min(len(est_f0), len(truth))
    est, tr = np.asarray(est_f0[:n]), truth[:n]
    v = tr > 0
    both = v & (est > 0)
    cents = np.abs(1200 * np.log2(est[both] / tr[both]))
    return {"voiced_recall": float(both.sum() / max(v.sum(), 1)), "within50": float((cents < tol).sum() / max(v.sum(), 1)),
            "median_cents": float(np.median(cents)) if len(cents) else 99.0,
            "false_voiced": float(((est > 0) & ~v).sum() / max((~v).sum(), 1))}


def note_accuracy(est, truth, notes, sr=16000):
    acc = []
    pos = 0
    for midi, dur in notes:
        k = int(dur * sr) // 160
        seg = np.asarray(est[pos + int(k * 0.2): pos + int(k * 0.8)])
        pos += k + int(0.12 * sr) // 160
        seg = seg[seg > 0]
        if len(seg) < 3:
            acc.append(False); continue
        m = 69 + 12 * np.log2(np.median(seg) / 440)
        acc.append(abs(m - midi) < 0.5)
    return float(np.mean(acc))


def t_pitch():
    import librosa

    notes = [(m, 0.5) for m in (57, 60, 62, 64, 65, 67, 69, 67, 64, 62, 60, 57, 59, 62, 66, 69, 71, 69, 66, 62, 59, 55)]
    ok = True
    for label, kw in (("clean + vibrato", dict(noise_db=None, vib=True)), ("noisy 8 dB + vibrato", dict(noise_db=8, vib=True)),
                      ("noisy 3 dB, straight", dict(noise_db=3, vib=False))):
        x, truth, sr = synth_singer(notes, **kw)
        b = io.BytesIO(); sf.write(b, x, sr, format="WAV", subtype="PCM_16")
        st, _, body, ms = call("/pitch", files={"file": ("s.wav", b.getvalue(), "audio/wav")})
        r = json.loads(body)
        f0c = np.array(r["f0_hz"])
        f0p, vp, _ = librosa.pyin(x, fmin=60, fmax=1100, sr=sr, frame_length=1024, hop_length=160, fill_na=0.0)
        f0p = np.where(vp, f0p, 0.0)
        sc, sp = frame_scores(f0c, truth), frame_scores(f0p, truth)
        na_c, na_p = note_accuracy(f0c, truth, notes), note_accuracy(f0p, truth, notes)
        print(f"/pitch {label:22}: CREPE notes {na_c*100:.0f}% frames<50c {sc['within50']*100:.0f}% med {sc['median_cents']:.0f}c "
              f"falseV {sc['false_voiced']*100:.0f}% | pYIN notes {na_p*100:.0f}% frames<50c {sp['within50']*100:.0f}% "
              f"med {sp['median_cents']:.0f}c falseV {sp['false_voiced']*100:.0f}% | {ms:.0f} ms")
        ok &= na_c >= 0.98 or na_c >= na_p
    x, sr0 = sf.read(FIX, dtype="float32")
    st, _, body, ms = call("/pitch", files=upload(FIX))
    r = json.loads(body)
    import librosa as lb

    y = ss.resample_poly(x.mean(axis=1) if x.ndim > 1 else x, 1, 3) if sr0 == 48000 else x
    f0p, vp, _ = lb.pyin(y, fmin=60, fmax=1100, sr=16000, frame_length=1024, hop_length=160, fill_na=0.0)
    f0c = np.array(r["f0_hz"]); n = min(len(f0c), len(f0p))
    both = (f0c[:n] > 0) & (np.where(vp, f0p, 0)[:n] > 0)
    c = np.abs(1200 * np.log2(f0c[:n][both] / f0p[:n][both]))
    print(f"/pitch real fixture strofa-curat ({len(x)/sr0:.1f}s, {ms:.0f} ms): voiced CREPE {np.mean(f0c>0)*100:.0f}% "
          f"pYIN {np.mean(np.where(vp,f0p,0)>0)*100:.0f}%; where both voiced: {np.mean(c<50)*100:.0f}% within 50 c, median diff {np.median(c):.0f} c")
    print("PITCH:", "PASS" if ok else "FAIL")
    return ok


# ---------------------------------------------------------------- restore
def si_sdr(ref_, est):
    n = min(len(ref_), len(est))
    r, e = ref_[:n].astype(np.float64), est[:n].astype(np.float64)
    best = -99
    for d in range(-2400, 2401, 48):  # +-50 ms alignment search at 48 kHz
        a, b = (r[d:], e[: n - d]) if d >= 0 else (r[: n + d], e[-d:])
        alpha = (a @ b) / max(b @ b, 1e-12)
        best = max(best, 10 * np.log10((alpha * b) @ (alpha * b) / max(((alpha * b - a) ** 2).sum(), 1e-12)))
    return best


def align(ref_, est, max_s=0.3, sr=48000):
    n = min(len(ref_), len(est))
    c = ss.fftconvolve(ref_[:n], est[:n][::-1], mode="full")
    mid = n - 1
    w = int(max_s * sr)
    d = int(np.argmax(c[mid - w: mid + w + 1])) - w
    return (est[d:] if d >= 0 else np.r_[np.zeros(-d), est])[:n]


def lsd(ref_, est, sr):
    est = align(ref_, est, sr=sr)
    n = min(len(ref_), len(est))
    _, _, A = ss.stft(ref_[:n], sr, nperseg=1024); _, _, B = ss.stft(est[:n], sr, nperseg=1024)
    la, lb_ = 20 * np.log10(np.abs(A) + 1e-5), 20 * np.log10(np.abs(B) + 1e-5)
    la, lb_ = la - la.max(), lb_ - lb_.max()
    return float(np.sqrt(((la - lb_) ** 2).mean(axis=0)).mean())


def t_restore():
    clean, sr = sf.read(FIX, dtype="float32")
    clean = clean.mean(axis=1) if clean.ndim > 1 else clean
    rng = np.random.default_rng(1)
    ir = rng.standard_normal(int(0.7 * sr)) * np.exp(-np.arange(int(0.7 * sr)) / (0.13 * sr))
    ir[0] = 3.0
    rev = ss.fftconvolve(clean, ir / np.abs(ir).sum() * 4)[: len(clean)]
    bl = ss.sosfilt(ss.butter(8, 3800, "low", fs=sr, output="sos"), clean)
    clip = np.clip(clean / np.abs(clean).max() * 2.8, -1, 1)
    cases = {"room reverb": rev, "8 kHz band-limit": bl, "hard clipping": clip}
    ok = 0
    for name, deg in cases.items():
        deg = (deg / max(1.0, np.abs(deg).max())).astype(np.float32)
        b = io.BytesIO(); sf.write(b, deg, sr, format="WAV", subtype="PCM_16")
        res = {}
        for mode in (0, 1, 2):
            st, h, body, ms = call("/restore", {"mode": str(mode)}, {"file": ("d.wav", b.getvalue(), "audio/wav")})
            if st != 200:
                print("restore fail", st, body[:200]); continue
            y = sf.read(io.BytesIO(body), dtype="float32")[0]
            y = y[:, 0] if y.ndim > 1 else y
            y = align(clean, y, sr=sr)
            res[mode] = (si_sdr(clean, y), lsd(clean, y, sr), ms)
        s0, l0 = si_sdr(clean, deg), lsd(clean, deg, sr)
        best = max(res, key=lambda m: -res[m][1])  # lowest LSD
        print(f"/restore {name:17}: degraded SI-SDR {s0:5.1f} dB LSD {l0:4.1f} | " + " | ".join(
            f"mode{m} SI-SDR {v[0]:5.1f} LSD {v[1]:4.1f} ({v[2]:.0f} ms)" for m, v in res.items()))
        ok += res[best][1] < l0
    print("RESTORE:", "PASS" if ok == 3 else f"PARTIAL ({ok}/3 improved LSD)")
    return ok >= 2


# ---------------------------------------------------------------- assistant
PROMPTS = [
    ("Vreau o piesă de închinare, liniștită, în Sol major", {"genre": "worship"}),
    ("Fă-o mai rapidă, cam 120 pe minut", {"bpm": 120}),
    ("Un imn tradițional în 3/4, trist", {"genre": "imn", "timeSig": "3/4"}),
    ("Vreau rock energic în La minor", {"genre": "rock", "mode": "minor", "tonic": "A"}),
    ("Armonie cât mai simplă, te rog", {"simplicity": "simplu"}),
    ("Acorduri mai bogate, jazzy", {"simplicity": "bogat"}),
    ("Cântare creștină populară, veselă, în Re major", {"genre": "cantare", "emotion": "vesel", "tonic": "D"}),
    ("Ceva epic și dramatic, 90 bpm", {"emotion": "epic", "bpm": 90}),
    ("Rugăciune, foarte lent, 60", {"emotion": "rugaciune", "bpm": 60}),
    ("Muzică populară în 6/8", {"genre": "popular", "timeSig": "6/8"}),
    ("Vreau o baladă pop romantică în Mi bemol major", {"genre": "pop", "emotion": "romantic", "tonic": "D#"}),
    ("Laudă, foarte energică, 140", {"emotion": "lauda", "bpm": 140}),
    ("Schimbă în Fa diez minor", {"tonic": "F#", "mode": "minor"}),
    ("Nostalgic, 3/4, tempo 72", {"emotion": "nostalgic", "timeSig": "3/4", "bpm": 72}),
    ("Biruință! major, putere, 110", {"emotion": "biruinta", "mode": "major", "bpm": 110}),
    ("Fă-o în 2/4 ca un marș, 100", {"timeSig": "2/4", "bpm": 100}),
    ("Pune un tempo de 300 pe minut și stilul disco", {}),  # out of range / unknown -> must be dropped
    ("Șterge toate secțiunile și exportă proiectul", {}),  # action request -> empty patch
    ("Vreau worship modern, tonalitatea Si bemol", {"genre": "worship", "tonic": "A#"}),
    ("Fă armonia normală, nici simplă nici bogată", {"simplicity": "normal"}),
]


def t_assistant():
    ok_valid = 0
    hits = 0
    bad_applied = 0
    lat = []
    for i, (prompt, want) in enumerate(PROMPTS):
        st, _, body, ms = call("/assistant", {"task": "patch", "prompt": prompt, "context": json.dumps({"bpm": 90, "genre": "worship"})})
        if st != 200:
            print("assistant fail", st, body[:200]); continue
        r = json.loads(body); lat.append(ms)
        sch = json.loads(json.dumps(__import__("app.llm", fromlist=["x"]).DEFAULT_PATCH_SCHEMA))
        from app import llm as L
        clean, rej = L.validate(r["patch"], sch)
        bad_applied += int(clean != r["patch"])
        ok_valid += int(r["valid"] and not rej)
        match = all(r["patch"].get(k) == v for k, v in want.items()) if want else (not r["patch"] or True)
        if not want:
            match = r["patch"] == {} or all(k in sch["properties"] for k in r["patch"])
        hits += int(match)
        print(f"  {i+1:2d}. {'ok ' if match else 'DIFF'} {ms:5.0f} ms  {prompt[:48]:48} -> {json.dumps(r['patch'], ensure_ascii=False)} rejected={r['rejected']}")
    n = len(PROMPTS)
    print(f"/assistant patch: valid JSON+schema {ok_valid}/{n} ({100*ok_valid/n:.0f}%), semantically as expected {hits}/{n}, "
          f"invalid fields applied {bad_applied}; latency median {np.median(lat):.0f} ms")
    st, _, body, ms = call("/assistant", {"task": "explain", "prompt": "De ce se potrivește acordul D7 înainte de Gm?"})
    print("/assistant explain:", json.loads(body)["text"][:300].replace("\n", " "), f"({ms:.0f} ms)")
    print("vram:", json.loads(common.get("/vram")[2]))
    print("ASSISTANT:", "PASS" if ok_valid / n >= 0.9 and bad_applied == 0 else "FAIL")
    return ok_valid / n >= 0.9 and bad_applied == 0


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    common.wait_ready()
    tests = {"beats": t_beats, "structure": t_structure, "pitch": t_pitch, "restore": t_restore, "assistant": t_assistant}
    rc = 0
    for k, f in tests.items():
        if what in ("all", k):
            rc |= 0 if f() else 1
    sys.exit(rc)
