# Psalmist Studio - local AI service

Optional GPU helpers for the app (FastAPI, **127.0.0.1:5175**, CORS only for `http://localhost:5174`, Host header
checked). The app must keep working when this service is off.

| Endpoint | What | Model (code / weights licence) | RTX 3060 time |
|---|---|---|---|
| `GET /health` | models, GPU, versions | | ms |
| `POST /denoise` | WAV/MP3 -> cleaned WAV | DeepFilterNet3 (MIT/Apache-2.0 / same) | 12 s audio: ~0.15 s, 176 s: 1.8 s |
| `POST /separate` | song -> stems (htdemucs / _ft / _6s, two-stems) | Demucs (MIT / MIT) | 224 s song: htdemucs 9 s, _6s 6.6 s, _ft (shifts 1) 30 s |
| `/analyze/*`, `/practice`, `/batch` | learn from a song, transpose/tempo, folder statistics | librosa (ISC), own DSP | 224 s: rhythm 5 s, bass 7 s, chords 2 s |
| `POST /accompany` | melody MIDI + chords + meter/tempo + style + bars -> candidate MIDI | Anticipatory Music Transformer medium-800k (Apache-2.0 / Apache-2.0) | 16 bars of Amazing Grace (38.7 s): 1-2.6 s per candidate |

See `LICENSES.md` for the verification of every licence.

## Start
```
ai-service\start-ai.cmd        :: http://127.0.0.1:5175 ; models preload in the background (~20 s), /health shows status
ai-service\setup-ai.cmd        :: one-time: Python 3.11 venv (uv) + CUDA torch + models. Already done on this machine.
```
Locations (kept OUTSIDE the project; see `env.local.cmd`): venv `PSALMIST_AI_VENV`, model/wheel caches
`PSALMIST_AI_CACHE` (`HF_HOME`, `TORCH_HOME`, DeepFilterNet cache live there). Defaults: `%LOCALAPPDATA%\PsalmistAI\`.
Python 3.13 is not used: DeepFilterNet/Demucs/torch 2.5 wheels target 3.11, so uv provisions its own CPython 3.11.
Set `PSALMIST_AI_PRELOAD=0` to load models lazily; `PSALMIST_AMT_MODEL=stanford-crfm/music-small-800k` for a faster model.

## Smoke tests (service running)
```
python tests\smoke_denoise.py     # SNR vs classic spectral subtraction on strofa-curat.wav + noise   (AI >= classic)
python tests\smoke_separate.py    # synthetic mix: voice + generated accompaniment -> bleed < -20 dB
python tests\smoke_accompany.py   # 16 bars amazing-grace, 3 candidates, < 10 s each, 0 key/chord/range violations
python tests\smoke_all.py         # all three
python tests\smoke_a5.py         # every Demucs model, two-stems, cache, cancel, analysis, practice
python tests\eval_reference.py <dir> htdemucs,htdemucs_ft,htdemucs_6s   # local reference only
python -m pytest tests\test_theory.py   # pure unit tests
```
Outputs (noisy/clean/stems/MIDI) land in `tests/out/` for listening.

## API
All uploads are multipart. Errors: `{"detail": "..."}` with 400 (bad input), 413 (>200 MB), 500 (job failed).

### `POST /denoise`  (`file`, optional `atten_lim_db`)
Returns `audio/wav` (same rate and channel count; voice noise suppression). Headers `X-Elapsed-Ms`, `X-Audio-Info`.

### `POST /separate`  (`file`, `model`, `two_stems`, `shifts`, `overlap`, `segment`, `format`, `wait`)
Demucs, **WAV only**. `model`: `htdemucs` (default) | `htdemucs_ft` (best, ~4x slower) | `htdemucs_6s` (+guitar, piano).
`two_stems`: a stem name (default `vocals` -> `vocals` + `no_vocals`, alias `accompaniment`) or `all` (every stem).
`shifts` 0..10, `overlap` 0..0.95, `segment` seconds, `format` `pcm16|pcm24|float`. `wait=false` -> **202** and poll
`GET /jobs/{id}` (`progress` 0..1, `status` queued|running|done|error|cancelled); **cancel** with `POST /jobs/{id}/cancel`.
Stems are served from the **result cache** (`GET /cache/{key}/{stem}.wav`, `GET /cache/{key}` meta incl. `residual_db`),
keyed by SHA-256 of the file + all parameters (repeat = instant `cache_hit`; last 24 results kept). `GET /separate/models`.

### "Invata din cantec" (local analysis, numbers only)
- `POST /analyze/song` (`file` or `cache_key`, `model`, `shifts`, `chords=auto|chordino|templates`) -> job. Result:
  `rhythm` (drums stem: `pulse_bpm`, `beats_per_bar`, `bar_seconds`, `beats`, `downbeats`, `tempo_map`,
  `groove{pattern kick/snare/hat per 16th slot, micro_timing_ms, swing}`), `bass` (pYIN notes, per-bar/beat chord roots),
  `chords` (Chordino through Sonic Annotator when installed, else own chroma templates + Viterbi), `key`, `vocals`
  (hand-off URL of the vocals stem for "Din vocea completa"), `separation` (model, residual, timing).
- `POST /analyze/{rhythm|bass|chords|key}` (`cache_key`, `beats_per_bar?`) re-runs one part on a cached separation.
- `POST /practice` (`cache_key` + `stems` "drums,bass,other" **or** `file`; `semitones` -6..6; `tempo` 0.70..1.20;
  `format`) -> WAV. Own phase vocoder (identity phase locking); formants move with pitch. ~0.3 s per 12 s of audio.
- `POST /batch` (`folder`, `model`, `shifts`) -> job; separates + analyses each audio file, deletes the stems and
  returns/writes **statistics only** (`cache/batch/stats_<job>.json`: bpm, meter, swing, groove patterns, bass
  density, Roman-numeral chord histogram/bigrams; file names stored as hashes only).
- Meter detection prefers 4/4 among 2/3/4/6/8 pulses per bar; pass `beats_per_bar` to force it. One constant grid is
  fitted over the whole stem (see `tempo_map` for the local tempo if the song drifts).

### A6 endpoints (models load on demand; `GET /vram` shows free VRAM + what is resident)
- `POST /beats` (`file`) -> Beat This! `{bpm, beats_per_bar, bar_seconds, beats[], downbeats[], tempo_map[]}`. Works on
  mixes and drums stems; a cappella voice is unreliable (see accuracy below).
- `POST /structure` (`file`, `min_bars=8`) -> `segments[] {start,end,bars,label,section_type,cluster}` + Beat This! grid.
  Own segmentation (All-In-One rejected for licence/NATTEN reasons, see LICENSES.md).
- `POST /pitch` (`file`, `fmin`, `fmax`, `model=full|tiny`, `voicing_threshold`) -> torchcrepe 10 ms frames
  `f0_hz` (0 = unvoiced), `voicing`, `voiced`. ~1.3 s for 12 s on the 3060.
- `POST /restore` (`file`, `mode=0|1|2`) -> WAV (VoiceFixer). Offer with A/B: it helps strong room echo, not mild damage.
- `POST /assistant` (`task=patch|explain|coach|chords`, `prompt`, `context` JSON, optional `schema`) - local Qwen3-8B via
  llama-server on 127.0.0.1:5177, started on first call (~10 s), stopped after 5 min idle or when Demucs/AMT need VRAM
  (`POST /assistant/unload`, `GET /assistant/status`). `patch` returns `{patch, rejected[], explanation}`: JSON-schema
  constrained decoding, then server-side validation, then grounding (numbers, meters, keys, Romanian note names and
  genre/emotion keywords must appear in the request). Unknown fields / out-of-range values are dropped, never applied.
- Tests: `python tests\smoke_a6.py beats|structure|pitch|restore|assistant|all [reference_dir]`.

### `POST /accompany`  (`melody` = MIDI file, `params` = JSON string, `wait`)
```jsonc
{ "key": "G", "mode": "major", "meter": "3/4", "bpm": 76,      // bpm = quarter-note BPM
  "bars": 16, "pickup_beats": 1,                              // MIDI time 0 = start of the pickup
  "chords": ["G","G7","C", ...],                              // one per bar, or [{"bar":0,"beat":0,"symbol":"G"}]
  "style": "worship",                                         // see GET /accompany/styles
  "instruments": [0, 33],                                     // optional: GM programs the model may play
  "skeleton": 48,                                             // optional: GM program of the chord bed, false = off
  "n_candidates": 3, "top_p": 0.95, "temperature": 1.0, "seed": 7,
  "quantize": true, "include_melody": false }
```
Result (`job.result`): `candidates[]` = `{index, seed, midi_base64, notes, programs, gen_ms}`; MIDI is type 1, 480 tpb,
with tempo/time-signature/key meta and one track per GM program (named `AI <role> gm<N>`). Supported programs:
piano 0, e-piano 4, organ 19, nylon 24, steel 25, clean e-guitar 27, basses 32/33, harp 46, strings 48, choir 52, pad 89.

How it works (anticipation infilling): the melody and a rule-based chord bed (`skeleton`) are fed to the transformer
as *anticipated controls*; the model infills the other instruments around them. Sampling uses our own KV-cached
loop (the stock `generate` recomputes the context per token) with logit constraints: allowed instruments, register per
instrument, key scale, **chord tones on strong beats**, chord-boundary-clamped durations, min. duration 80 ms, max gap
half a bar. After quantisation to a 16th grid every note is re-checked and repaired (pitch nudged to the nearest allowed
one). Measured on 3 candidates: 0 out-of-key, 0 strong-beat non-chord, 0 out-of-range notes. The app still runs its own
rule filters (clash guard, density caps) afterwards. Bass lines come out sparse (model's choice); the chord bed carries
the harmony.

### `GET /health`
`{ok, api_version, device, gpu{name,vram_*}, models{denoise,separate,accompany: {name,status,license}}, versions}`;
`status` is `idle|loading|ready|error: ...`.

## Notes
- One GPU job at a time (lock); models stay resident (~3.2 GB VRAM of 12 GB).
- Input audio is decoded with libsndfile (WAV/FLAC/OGG/MP3). Mono vocals are denoised as mono.
- `src/ai/` has the typed browser client (`src/ai/README.md`).
