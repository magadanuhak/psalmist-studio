"""A5 evaluation on a LOCAL reference mix (never copied into the project). In-process, no server needed.

python tests/eval_reference.py <dir with mix.wav, truth.json, optional mix_..._barbeattracker_bars.csv or grid.json>
Reports: stems-sum residual per model + timings, drums-stem downbeats vs qm bars, bass-root agreement vs truth chords.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import analysis, config, separate  # noqa: E402

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def pc_of(name: str) -> int:
    n = name.split("/")[0]
    v = PC[n[0]]
    if len(n) > 1 and n[1] == "#":
        v += 1
    elif len(n) > 1 and n[1] == "b":
        v -= 1
    return v % 12


def main():
    d = Path(sys.argv[1])
    models = sys.argv[2].split(",") if len(sys.argv) > 2 else ["htdemucs"]
    data = (d / "mix.wav").read_bytes()
    truth = json.loads((d / "truth.json").read_text())
    grid = json.loads((d / "grid.json").read_text())
    qm = np.array(grid["bars"])
    for m in models:
        t0 = time.perf_counter()
        meta = separate.separate(data, model=m, shifts=1 if m == "htdemucs_ft" else 0)
        print(f"[{m}] stems {meta['stems']} model {meta['model_ms']} ms (wall {time.perf_counter()-t0:.1f}s) "
              f"residual {meta['residual_db']} dB audio {meta['seconds']}s")
        if m != "htdemucs":
            continue
        key = meta["cache_key"]
        t0 = time.perf_counter()
        rh = analysis.analyze_rhythm(separate.stem_path(key, "drums"))
        print(f"rhythm {time.perf_counter()-t0:.1f}s: bpm {rh['bpm']} bpb {rh['beats_per_bar']} "
              f"bar {rh['bar_seconds']} downbeats {len(rh['downbeats'])} swing {rh['groove']['swing']}")
        db = np.array(rh["downbeats"])
        # qm bars exist for every bar over the song; compare each qm bar to the nearest drums downbeat
        active = [(90, 140), (160, 224)]
        err = np.array([min(abs(db - q)) for q in qm if any(a + 3 <= q <= b - 3 for a, b in active)]) * 1000
        print(f"downbeat error vs qm bars: median {np.median(err):.1f} ms, p90 {np.percentile(err, 90):.1f} ms, "
              f"within 30 ms {np.mean(err <= 30)*100:.0f}% (n={len(err)})")
        import scipy.signal as ss
        ys = analysis.load_mono(separate.stem_path(key, "drums"))
        ek = analysis._band_env(ys, 35, 140)
        pk, _ = ss.find_peaks(ek, height=0.35, distance=int(0.15 * analysis.SR / analysis.HOP))
        kt = pk * analysis.HOP / analysis.SR
        g = db[((db > 92) & (db < 138)) | ((db > 162) & (db < 222))]
        ke = np.array([np.min(np.abs(kt - t)) for t in g]) * 1000
        print(f"downbeat -> nearest drums-stem kick onset (drum-active parts): median {np.median(ke):.1f} ms, "
              f"within 30 ms {np.mean(ke <= 30)*100:.0f}% (n={len(g)})")
        t0 = time.perf_counter()
        bs = analysis.analyze_bass(separate.stem_path(key, "bass"), downbeats=rh["downbeats"], beats=rh["beats"])
        print(f"bass {time.perf_counter()-t0:.1f}s: {len(bs['notes'])} notes")
        ok = tot = 0.0
        n_ok = n = n_tone = n_sil = 0
        for i, c in enumerate(truth):
            a = c["t"]
            b = truth[i + 1]["t"] if i + 1 < len(truth) else a + 4
            if b - a < 1.0:
                continue
            r = analysis.root_in(bs["notes"], a + 0.1, b - 0.1)
            n += 1
            ok_pcs = {pc_of(c["chord"]), pc_of(c["chord"].split("/")[-1])}
            hit = r is not None and pc_of(r) in ok_pcs
            from app import theory
            tone = r is not None and pc_of(r) in theory.parse_chord(c["chord"])["pcs"]
            n_tone += bool(tone)
            n_sil += r is None
            n_ok += bool(hit)
            ok += (b - a) * hit
            tot += b - a
        print(f"bass-root agreement vs truth: {n_ok}/{n} chords = {100*n_ok/n:.0f}% ; time-weighted {100*ok/tot:.0f}% ; bass note is a chord tone (inversions ok): {100*n_tone/n:.0f}% ; bass silent in {n_sil} interval(s)")
        harm = analysis.harmonic_wav([separate.stem_path(key, s) for s in ("other", "bass")], config.CACHE / "tmp_harm.wav")
        t0 = time.perf_counter()
        ch = analysis.analyze_chords(harm, beats=rh["beats"], method="auto")
        print(f"chords [{ch['method']}] {time.perf_counter()-t0:.1f}s: {len(ch['chords'])} segments; key {analysis.estimate_key(harm)}")
        t_ok = t_tot = 0.0
        for i, c in enumerate(truth):
            a = c["t"]; b = truth[i + 1]["t"] if i + 1 < len(truth) else a + 4
            for seg in ch["chords"]:
                o = min(b, seg["end"]) - max(a, seg["t"])
                if o > 0:
                    t_tot += o
                    t_ok += o * (seg["chord"].split("/")[0] == c["chord"].split("/")[0])
        print(f"chord-name agreement (exact, time-weighted) {100*t_ok/max(t_tot,1e-9):.0f}%")


if __name__ == "__main__":
    main()
