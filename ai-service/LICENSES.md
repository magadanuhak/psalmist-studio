# Licences (verified 2026-11-09 by reading the actual files / model cards)

Goal: future commercial use of the app and of its output. Verdict: **all three models, code AND weights, are permissive.
No non-commercial weight is used.** The service runs locally and is never shipped with the app.

| Component | Used for | Code licence | Weights licence | Evidence |
|---|---|---|---|---|
| DeepFilterNet 0.5.6 (`deepfilternet`, `deepfilterlib`) | `/denoise` (DeepFilterNet3) | MIT OR Apache-2.0 | MIT OR Apache-2.0 (same) | PyPI metadata `License: MIT`, wheel ships LICENSE-MIT + LICENSE-APACHE; upstream README "License": *"All code and model weights in this repository are dual-licensed under either MIT or Apache-2.0"*. The DeepFilterNet3 checkpoint is downloaded from the upstream repo release. |
| Demucs 4.1.0 (`htdemucs`) | `/separate` | MIT (Meta Platforms) | MIT (no separate weights licence exists; the repo README says the project is MIT and the weights are the project's released models, fetched from `dl.fbaipublicfiles.com/demucs/`) | `LICENSE` in the wheel is the MIT text; README section "License". |
| Anticipatory Music Transformer, `anticipation` (commit af37397) | `/accompany` (sampling code, tokeniser) | Apache-2.0 | **Apache-2.0** for `stanford-crfm/music-medium-800k` (also small/large-800k) | GitHub `LICENSE.txt` = Apache License 2.0 + README "licensed under the terms of the Apache License, Version 2.0"; Hugging Face model card front-matter `license: apache-2.0` (queried through the HF API for small/medium/large). |

Chosen weights: `stanford-crfm/music-medium-800k` (360 M params, Apache-2.0). Alternatives if ever needed (same licence):
`music-small-800k` (faster), `music-large-800k` (better, ~3x slower; set `PSALMIST_AMT_MODEL`).

## A5 additions (verified 2026-11-09)
- Extra Demucs weights `htdemucs_ft` (bag of 4 fine-tuned htdemucs) and `htdemucs_6s` (6 sources): same repository,
  same MIT `LICENSE` (Meta Platforms); the repo ships no separate or non-commercial weights licence, and the model
  definitions (`demucs/remote/htdemucs_ft.yaml`, `htdemucs_6s.yaml`) point to the same `dl.fbaipublicfiles.com/demucs/`
  host. Used. (`mdx*` / `hdemucs_mmi` models are not enabled.)
- Time-stretch / pitch-shift (`/practice`): own phase vocoder on numpy/scipy (BSD-3). **Rejected:** Rubber Band
  (GPL/commercial), `pytsmod` (GPL-3.0; installed for evaluation and uninstalled), `pyrubberband` (wraps Rubber Band).
  `signalsmith-stretch` has no PyPI package, so the permissive vocoder above is used.
- Analysis: `librosa` 0.11 (ISC) + scipy. librosa hard-depends on `soxr` (libsoxr, LGPL-2.1, dynamically linked); our
  code never calls librosa's resampler (scipy `resample_poly` is used), so nothing LGPL is exercised.
- **Optional external tool:** Sonic Annotator + Chordino/NNLS-Chroma (C:/Users/Admin/tools/sonic-annotator). The
  NNLS-Chroma and QM Vamp plugins are GPL-2.0+; they run as a separate local process (no linking, nothing bundled or
  shipped). `/analyze/*` uses them only when present and falls back to our own chroma-template + Viterbi estimator
  (permissive). A commercial product that ships the analyser must rely on the permissive fallback.
- No MP3 output anywhere (WAV only), so `lameenc` (LGPL) is never used.

## A6 additions (verified 2026-11-09)
| Component | Used for | Code | Weights | Verdict |
|---|---|---|---|---|
| Beat This! 1.1.0 (CPJKU) | `/beats`, grid of `/structure` | MIT | MIT ("The code and the published model weights are released under the MIT license" - README; GitHub API licence MIT) | used (`final0` checkpoint). Training data includes files under limited licences - caveat is the authors'. |
| All-In-One (mir-aidj) | requested for `/structure` | MIT | no licence stated for its checkpoints; needs madmom (code BSD, but madmom's bundled models are CC BY-NC-SA) and NATTEN (no Windows wheels) | **NOT used.** Replaced by own bar-synchronous self-similarity segmentation (permissive, numpy/scipy/librosa) on the Beat This! grid; labels from repetition/energy/position. |
| torchcrepe 0.0.24 (CREPE) | `/pitch` | MIT | MIT (weights shipped in the package) | used. RMVPE not added (CREPE meets the criteria; its weights come from a third-party Hugging Face repo with no clear licence). |
| VoiceFixer 0.1.3 | `/restore` | MIT | CC-BY-4.0 (Zenodo record 5600188 `license: cc-by-4.0`) - attribution required if shipped | used, **attribution: "VoiceFixer (Liu et al.), checkpoints CC-BY-4.0"**. Caches kept in PsalmistAI/cache/vf_home. |
| llama.cpp b12223 (ggml-org) | `/assistant` runtime (`llama-server.exe`, CUDA 12.4 build, unzipped in %LOCALAPPDATA%/PsalmistAI/llm/bin, no admin) | MIT | - | used; chosen over Ollama (needs a service/installer). |
| Qwen3-8B (Qwen/Qwen3-8B-GGUF, Q4_K_M, 5.0 GB) | `/assistant` | Apache-2.0 | Apache-2.0 (HF card `license: apache-2.0`, LICENSE file in the repo) | used. (Qwen2.5-3B/72B have non-Apache "Qwen"/research licences - avoided; 7B/8B are Apache-2.0.) |
Other new Python deps: librosa (ISC), matplotlib (PSF-style), resampy (BSD), rotary-embedding-torch (MIT), torchlibrosa (Apache-2.0?
per PyPI metadata MIT-style - dev-only), einops (MIT). beat_this lists `soxr` (LGPL-2.1, dynamic, already present).

## Residual risks (not licence problems of the weights themselves, but worth knowing before shipping a product)
- AMT was trained on the Lakh MIDI dataset (scraped MIDI files of unknown individual copyright). The *model weights* are
  Apache-2.0 as published; the training-data provenance is the usual open-model caveat. Our service only uses the model
  as a generator, the app additionally filters its output through key/chord/range rules.
- Demucs was trained on MUSDB18-HQ plus ~800 additional songs (Meta); same caveat. Its outputs are derived from the
  user's own input audio.
- Never ship the separated *original accompaniment* of a third-party song (spec: "used as reference, never shipped").

## Python dependencies (runtime, local venv only; not redistributed)
torch / torchaudio (BSD-3), transformers (Apache-2.0), huggingface-hub (Apache-2.0), fastapi (MIT), uvicorn (BSD-3),
python-multipart (Apache-2.0), mido (MIT), soundfile (BSD-3; bundles libsndfile, LGPL-2.1, dynamically loaded), scipy /
numpy (BSD-3), einops, julius, pyyaml (MIT), deepfilterlib (MIT/Apache).
**`lameenc` (LGPL-3.0-or-later) is pulled in by Demucs for MP3 *export*; this service never calls it** (we write WAV
with soundfile). If a strict no-LGPL policy applies to the dev environment, `pip uninstall lameenc` is safe for us.
Nothing here is GPL/AGPL.
