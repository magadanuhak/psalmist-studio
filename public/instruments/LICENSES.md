# Licențe și atribuiri / Licences and attributions

Everything under `public/instruments/` is shipped with Psalmist Studio. Only permissive licences are used
(CC0 / CC BY); nothing copyleft and nothing restricted to non-commercial use. Commercial use is allowed for every group below.

## 1. Sampled instruments (CC0 1.0, public domain dedication)

Samples were selected, trimmed, levelled, loop-baked and re-encoded to mp3 by `scripts/instruments/build.mjs`.
CC0 requires no attribution; the sources are credited here as a courtesy.

### VSCO 2 Community Edition
- Source: https://github.com/sgossner/VSCO-2-CE (official repository, GitHub user sgossner)
- Licence: **CC0-1.0** — verified by reading the repository's LICENSE file (copy: `licenses/LICENSE-vsco-CC0.txt`)
- Used for: `violins`, `timpani`, `violas`, `cellos`, `violin_solo`, `contrabass`, `harp`, `flute`, `piccolo`, `clarinet`, `oboe`, `bassoon`, `trumpet`, `horn`, `trombone`, `tuba`, `upright_piano`

| Instrument id | Name | Source files used | Shipped size |
|---|---|---|---|
| violins | Viori (ansamblu) | 79 | 3.55 MB |
| timpani | Timpane | 10 | 0.45 MB |
| violas | Viole (ansamblu) | 95 | 4.40 MB |
| cellos | Violoncele (ansamblu) | 102 | 5.06 MB |
| violin_solo | Vioară solo | 82 | 2.39 MB |
| contrabass | Contrabas | 61 | 1.95 MB |
| harp | Harfă | 22 | 1.20 MB |
| flute | Flaut | 45 | 1.38 MB |
| piccolo | Piccolo | 9 | 0.23 MB |
| clarinet | Clarinet | 44 | 1.09 MB |
| oboe | Oboi | 54 | 1.69 MB |
| bassoon | Fagot | 54 | 1.64 MB |
| trumpet | Trompetă | 72 | 2.47 MB |
| horn | Corn francez | 52 | 1.62 MB |
| trombone | Trombon | 39 | 1.25 MB |
| tuba | Tubă | 24 | 0.63 MB |
| upright_piano | Pian vertical | 42 | 4.58 MB |

### Versilian Community Sample Library (VCSL)
- Source: https://github.com/sgossner/VCSL (official repository, GitHub user sgossner)
- Licence: **CC0-1.0** — verified by reading the repository's LICENSE file (copy: `licenses/LICENSE-vcsl-CC0.txt`)
- Used for: `cajon`, `folk_harp`, `psaltery`, `strumstick`, `recorder`, `ocarina`, `harmonica`, `tenor_sax`, `church_organ`, `organ_pedal`, `positive_organ`, `harpsichord`, `vibraphone`, `marimba`, `glockenspiel`, `xylophone`, `tubular_bells`, `kalimba`, `frame_drum`, `darbuka`, `conga`, `tambourine`, `shaker`, `triangle`, `sleigh_bells`, `cymbal`, `concert_bass_drum`

| Instrument id | Name | Source files used | Shipped size |
|---|---|---|---|
| cajon | Cajon | 18 | 0.30 MB |
| folk_harp | Harfă populară | 30 | 1.52 MB |
| psaltery | Psalterion | 18 | 0.57 MB |
| strumstick | Strumstick (chitară populară) | 20 | 0.78 MB |
| recorder | Flaut dulce | 21 | 0.63 MB |
| ocarina | Ocarină | 6 | 0.25 MB |
| harmonica | Muzicuță | 7 | 0.29 MB |
| tenor_sax | Saxofon tenor | 55 | 1.61 MB |
| church_organ | Orgă de biserică | 42 | 3.42 MB |
| organ_pedal | Orgă – pedală | 22 | 1.08 MB |
| positive_organ | Orgă pozitiv | 28 | 2.28 MB |
| harpsichord | Clavecin | 17 | 0.83 MB |
| vibraphone | Vibrafon | 44 | 4.39 MB |
| marimba | Marimba | 20 | 0.67 MB |
| glockenspiel | Clopoței (glockenspiel) | 12 | 0.56 MB |
| xylophone | Xilofon | 16 | 0.32 MB |
| tubular_bells | Clopote tubulare | 10 | 0.73 MB |
| kalimba | Kalimba | 8 | 0.33 MB |
| frame_drum | Tobă pe ramă (daf) | 12 | 0.33 MB |
| darbuka | Darbuka | 12 | 0.12 MB |
| conga | Conga | 16 | 0.18 MB |
| tambourine | Tamburină | 4 | 0.08 MB |
| shaker | Shaker | 6 | 0.03 MB |
| triangle | Triangel | 6 | 0.16 MB |
| sleigh_bells | Zurgălăi | 2 | 0.06 MB |
| cymbal | Talger suspendat | 6 | 0.33 MB |
| concert_bass_drum | Toba mare | 5 | 0.27 MB |

## 2. Groove patterns (CC BY 4.0 — attribution required)

- File group: `grooves/grooves.json` (converted from MIDI to a compact pattern format; positions in quarter-note beats)
- Source: **Groove MIDI Dataset**, MIDI-only release (groove-v1.0.0-midionly.zip), https://magenta.tensorflow.org/datasets/groove
- Author: Google LLC (Magenta). Performances by drummers recorded on an electronic kit.
- Licence: **Creative Commons Attribution 4.0 International** (https://creativecommons.org/licenses/by/4.0/), copy: `grooves/LICENSE-groove.txt`
- Changes: filtered to styles that fit the app (rock, pop, gospel, soul, funk, country, reggae, ...), cut to 1-2 bar loops and fills,
  note numbers mapped to drum roles, tagged by tempo / meter / feel / energy.
- Required credit text (show in "Despre / Licențe"): "Drum patterns derived from the Groove MIDI Dataset by Google LLC / Magenta, CC BY 4.0."

## 3. Convolution reverb spaces (generated)

- File group: `ir/*.wav` — Studio, Capelă, Biserică, Catedrală, Sală.
- Generated procedurally by `scripts/instruments/ir.mjs` (seeded noise with frequency-dependent decay and early reflections). Original work, dedicated CC0 1.0.
- OpenAIR (https://www.openairlib.net) impulse responses were evaluated but **not used**: item licences vary and none was verified as CC0 / CC BY, so
  no third-party IR is shipped and no attribution is needed for this group.

## 4. Not in this folder but part of the app

- MuseScore General SoundFont (MIT): `public/soundfonts/` — see `public/soundfonts/MuseScore_General_License.md`.
- Salamander Grand Piano (CC BY 3.0, Alexander Holm): `public/samples/` — attribution in the app's "Despre / Licențe" panel.
- Synthesized instruments (pads, swells, vowel choir, synth bass, arp, bells, risers) are generated in code and use no assets.

### FreePats and Karoryfer Samples (added later; CC0 1.0, public domain dedication)
Built by `scripts/instruments/build-extra.mjs` (trim, level, loop, encode). Each source ships the full "Creative Commons Legal Code CC0 1.0 Universal" text (copies in `licenses/`).

- **FreePats "Button Accordion HN"** (Hohner accordion recorded by Jeff Stauffer, November 2023). Source: https://freepats.zenvoid.org/Organ/accordion.html , https://github.com/freepats/button-accordion-HN . Licence statement: "Published under the terms of the Creative Commons CC0 1.0 public domain dedication." Copy: `licenses/LICENSE-freepats-accordion-CC0.txt`.
- **FreePats "Spanish Classical Guitar"** (roberto@zenvoid.org, 2008). Source: https://freepats.zenvoid.org/Guitar/acoustic-guitar.html . Licence statement: "Published under the terms of the Creative Commons CC0 1.0 public domain dedication." Copy: `licenses/LICENSE-freepats-nylon-CC0.txt`.
- **Karoryfer Samples "Emilyguitar"** (Copyright 2014 Karoryfer Lecolds; CC0-1.0, README: royalty-free for commercial and non-commercial use). Source: https://github.com/sfzinstruments/karoryfer.emilyguitar . Copy: `licenses/LICENSE-karoryfer-emilyguitar-CC0.txt`.
- **Karoryfer Samples x bigcat "cello"** (CC0-1.0; README: "This instrument is open source, and you can do whatever you want with it."). Source: https://github.com/sfzinstruments/karoryfer-bigcat.cello . Copy: `licenses/LICENSE-karoryfer-bigcat-cello-CC0.txt`.

| Instrument id | Name | Source files used | Shipped size |
|---|---|---|---|
| accordion | Acordeon (butoane) | 17 | 0.07 MB |
| nylon_guitar | Chitară clasică | 48 | 0.50 MB |
| emily_guitar | Chitară acustică, ton cald (Emily) | 54 | 0.70 MB |
| bigcat_cello | Violoncel solo (Bigcat) | 94 | 0.80 MB |

### VoiceFixer (local AI service, "Restaurare AI"; CC-BY-4.0)
Speech restoration model by Haohe Liu et al. (https://github.com/haoheliu/voicefixer), licensed CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/). Attribution: "VoiceFixer, (c) Haohe Liu, Ke Chen, Qiuqiang Kong, Qiao Tian, Yuping Wang, Mark D. Plumbley, Wenwu Wang; CC-BY-4.0". It runs only in the optional local AI service; no model files are shipped in this app. Changes: none to the model; audio is resampled for processing.
