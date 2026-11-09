# Psalmist Studio — spec

Browser app: user sings a cappella per song section → app cleans, detects notes, corrects, then (later) writes chords,
arrangement and instrumental melody. **No AI/ML anywhere** — classic DSP + rule-based music theory only.
Personal use now, commercial later → **only permissive licenses** (MIT/BSD/Apache/ISC, samples CC0/CC-BY/MIT). No GPL/AGPL
(so no Essentia.js, no WebAudioFont).

UI language: **Romanian** (all strings in one `src/i18n/ro.ts` so more languages can be added later).
Primary genre focus: **Christian music** (worship modern, imn tradițional, cântare creștină în stil popular) + pop/baladă,
rock, popular moldovenesc/românesc.

## Decisions (from user)
1. Web app in browser (desktop Chrome/Edge first, must be usable on phone width).
2. Personal → future commercial (licenses above).
3. Genres: Worship modern, Imn tradițional, Cântare creștină populară, Pop/Baladă, Rock, Popular.
4. Emotions: Trist, Romantic, Vesel, Energic, Epic, Nostalgic, Liniștit, Dramatic + Christian-specific: Închinare (worship,
   intimate→building), Laudă (praise, joyful), Rugăciune (prayer, very soft), Biruință (triumph, epic major).
5. Recording with metronome in headphones (count-in).
6. Key detected from first recorded section, locked for the song, user can change manually.
7. MVP: correction only on detected notes (MIDI), no audio autotune yet (architecture ready for it).
8. Instruments: built-in permissive samples + MIDI export.
9. Time signatures: 4/4, 3/4, 6/8, 2/4 + folk: 7/8 (3+2+2 and 2+2+3), 5/8, 9/8 (2+2+2+3). Store grouping per signature.
10. Modes: Simplu + Pro (Pro = piano roll + per-bar chord editing).
11. Export: WAV mix + stems + MIDI + simple sheet music (melody + chord symbols).
12. UI Romanian.
13. One voice in MVP; data model must already support extra voices (backing vocals) later.
14. Intro/outro/bridge auto-generated from chorus material.
15. **Base structure = user records only ONE strofă + ONE refren.** The app builds the full song from them: further
    strofe/refrene are copies (generated: true, linked to the source section; later lyrics differ but melody/chords same),
    intro/outro/bridge/interludes are generated from the song's motif. Default structure the app proposes:
    Intro – Strofa 1 – Refren – Strofa 2 – Refren – Bridge – Refren – Outro; user can reorder/add/remove generated
    sections, but only the two source sections need recording (optionally re-record any copy to override it).

## Milestones
| M | Scope |
|---|---|
| **M1** | Project + structure, per-section recording w/ metronome, cleaning, pitch/note/pause analysis, piano roll |
| **M2** | Note correction (pitch snap, quantize, cleanup), key detection, playback of melody on piano |
| M3 | Chords (3 variants, Viterbi), voicing, bass line, chord editing per bar |
| M4 | Arrangement: instruments per genre, patterns, drums, dynamics per section, transitions |
| M5 | Emotions mapping, fills/answers in vocal pauses, instrumental melody, intro/outro/bridge |
| M6 | Mix (vocal FX, ducking), export WAV/stems/MIDI/sheet, polish |

**Current build: M1 + M2.** Architect so M3–M6 plug in without rewrites (pure-TS theory/analysis modules, typed song model).

## Tech
Vite + React + TypeScript (strict), Zustand state, IndexedDB (idb) for projects + audio blobs, Web Workers for DSP,
Tone.js (MIT) for transport/metronome/playback, `tonal` (MIT) for theory helpers, `fft.js` (MIT) or own FFT,
`@tonejs/midi` (MIT) for MIDI export, Vitest for tests. Piano samples: Salamander Grand (CC-BY 3.0 — add attribution in
an "Despre/Licențe" panel). Prefer bundling samples locally (public/samples) over remote CDN.

## Song model (typed, versioned, future-proof)
`Project { id, name, version, genre, emotion, timeSig {num, den, grouping[]}, bpm, key {tonic, mode} | null, keyLocked,
sections: Section[], voices: Voice[] /* MVP: one 'lead' */, chords?: [] /* M3 */, arrangement?: {} /* M4 */, createdAt, updatedAt }`
`Section { id, type: 'intro'|'strofa'|'prerefren'|'refren'|'bridge'|'outro', label, order, bars, takes: Take[], activeTakeId, generated: boolean }`
`Take { id, rawAudioId, cleanAudioId?, noiseProfile?, latencyMs, analysis?: Analysis, notesOriginal: Note[], notesCorrected: Note[], correction: CorrectionSettings }`
`Note { id, midi, startSec, durSec, velocity, centsDev, confidence, isChromaticIntent? }`
`Analysis { pitchTrack (Float32 hz + voicedProb, hop 10ms), notes, pauses[{startSec,durSec}], rangeMidi{lo,hi}, keyEstimate{tonic,mode,confidence, top3} }`

## Pipeline & acceptance criteria (M1 + M2)

### P0 Project
- Create project: name, genre, emotion, time signature (incl. folk ones), BPM (number + tap tempo), structure builder
  (add/reorder/delete sections; preset structures, e.g. "Strofă–Refren–Strofă–Refren–Bridge–Refren").
- AC: project autosaves to IndexedDB; reload page → project, takes and audio restore identically. Project list screen with
  open/rename/delete (delete asks confirmation).

### P1 Recording per section
- Mic permission flow with clear Romanian messages (denied / no device). Input device selector. Live input level meter.
- Before first take: 2 s room-tone capture (prompt user to stay quiet) → noise profile.
- Count-in 1 bar + metronome (accent on beat 1, sub-accents per grouping for 7/8 etc.), "folosește căști" hint.
  Metronome audible to user only; recording must not depend on it.
- Record with `echoCancellation/noiseSuppression/autoGainControl = false` (we do our own cleaning).
- Multiple takes per section, play/compare, choose active take, delete take.
- Latency: manual offset slider (ms) + optional auto-calibration (play clicks, detect them through mic, median offset).
- Import audio file (WAV/MP3/M4A) as a take (needed for testing and for users with existing recordings).
- AC: take aligned to grid within ±10 ms after latency compensation; all sections share project BPM.

### P2 Cleaning (Web Worker / offline)
- High-pass 80 Hz (biquad, 12 dB/oct), spectral gating with noise profile (STFT 2048/512 hann, per-bin threshold =
  profile mean + k·std, soft mask with smoothing in time & freq to avoid musical noise), click removal, normalize to
  ~-16 LUFS (or RMS approximation), keep timing (no trimming).
- A/B toggle raw vs clean.
- AC: on test signal (voice-like + white/pink noise), noise floor drops ≥15 dB, voiced part SNR improves, no clipping.

### P3 Analysis (Web Worker)
- Pitch: pYIN-style (YIN CMNDF with multiple thresholds + probabilistic voicing + HMM/Viterbi smoothing) or robust YIN +
  median smoothing + octave-jump correction; hop 10 ms, range 65–1100 Hz.
- Note segmentation: onsets from energy/spectral flux + pitch stability; vibrato (≤ ±100 cents, 4–8 Hz) stays one note;
  glides excluded from pitch estimate; note pitch = median of stable middle part; velocity from RMS.
- Pauses: unvoiced ≥ ½ beat. Range lo/hi. Key: Krumhansl-Schmuckler (duration-weighted pitch-class histogram vs major/minor
  profiles), return top 3 with confidence.
- AC (Vitest, synthetic voice-like signals: harmonic tones with vibrato, glides, noise at 20 dB SNR, tempos 70–140):
  ≥90% notes correct pitch (±0 semitones) and onset within ±50 ms; no octave errors on held notes; key correct on ≥85% of
  test melodies (≥7 melodies incl. minor & harmonic minor). Analysis of 60 s audio < 3 s on a normal laptop.

### P4 Correction (M2)
- Pitch snap to key scale; keep out-of-scale note if held ≥ 1 beat and stable (chromatic intent) — flag it.
- Quantize start & duration to grid (1/4, 1/8, 1/16, triplets) with strength 0–100%; preserve swing option.
- Cleanup: delete/merge notes < 60 ms, merge fragmented same-pitch notes separated by < 40 ms.
- Non-destructive: notesOriginal kept; A/B original vs corrected; reset.
- Key: shown with confidence + alternatives; user can change key/mode; first section's key locks song key (unlockable).
- AC: corrections reversible (undo/redo ≥ 50 steps); after correction, piano playback of corrected melody aligns to
  metronome grid.

### P5 Piano roll (Pro mode) + playback
- Canvas-based piano roll: bars/beats grid from BPM & time signature (with grouping accents), keyboard on left with note
  names in Romanian solfège option (Do Re Mi) + letter option, scale degrees highlighted for current key, raw pitch contour
  overlay, waveform lane.
- Edit: select, move (time/pitch), resize, add, delete, split, merge, multi-select; zoom & scroll; snap toggle.
- Transport: play/pause/stop, loop section, playhead; mix sliders: voce (raw/clean) and pian (corrected melody), metronome.
- Simplu mode: hides piano roll editing, shows big friendly steps: Înregistrează → Curăță → Analizează → Corectează.
- AC: 60 fps scrolling with 500 notes; all edits undoable; works with mouse and touch.

### P6 Early export (M2)
- Export corrected melody MIDI per section and whole song; export clean vocal WAV.

## UX / design
- Deliberate, non-default look fitting a Christian worship studio: e.g. deep ink/night background, warm gold/candle accent,
  stained-glass-inspired subtle color for section types; distinctive display font for headings (Google Fonts, e.g. Fraunces
  or Cormorant) + clean UI sans (not Inter). Use the **impeccable** skill (`shape` before building UI, `polish`/`audit`
  at the end). Must never look unfinished: empty states, loading/progress states for worker jobs, error states.
- Accessible: keyboard shortcuts (Space play, R record, Ctrl+Z/Y), focus rings, contrast AA.
- Responsive: usable at 375 px width (piano roll scrolls; controls stack).

## Later milestones — rules to respect in architecture (summary)
- Chords: diatonic + borrowed (iv, ♭VI, ♭VII), secondary dominants, harmonic-minor V; scoring by melody coverage weighted
  by beat strength & duration, functional transitions T→S→D→T, cadences at phrase ends (V–I, IV–I "Amin", half cadence
  before chorus, deceptive V–vi), emotion/genre bias; Viterbi → top-3 variants. Hymn style = 4-part SATB voice leading
  (no parallel 5ths/8ves, common tones held, smallest motion).
- Voicing below vocal range; no close 3rds below ~C3; bass on root beat 1 + approach notes; inversions for melodic bass.
- Arrangement density per section (strofa sparse, refren full), fills only in vocal pauses, ducking under vocal.

---

# M3 — Chords, voicing, bass (current build)

Pure-TS `src/theory/harmony/*` (no React deps), run in the DSP worker or main thread (<200 ms per song), Vitest-tested.

### H1 Phrase & harmonic rhythm
- Phrases from vocal pauses ≥ 1 beat + 2/4/8-bar grouping; last bar of each phrase = cadence slot.
- Harmonic rhythm auto by genre/meter/tempo: default 1 chord/bar; slow (<75 BPM) hymn/ballad 2/bar; 3/4 & 6/8 1/bar;
  folk 7/8, 5/8, 9/8 → chord changes only on group starts (1/bar default). User override per section (½, 1, 2 per bar).

### H2 Harmonization (Viterbi, top-3)
- Candidates per slot: diatonic triads + 7ths; borrowed iv, ♭VI, ♭VII (major); harmonic-minor V/V7 and vii°7 (minor);
  secondary dominants V/V, V/vi, V/IV(iv); sus2/sus4/add9 as colour variants of the same function. Slash chords
  (inversions) chosen in voicing step, not here.
- Emission score: melody notes in slot weighted by metric strength (downbeat 1.0, beat 0.6, offbeat 0.3) × duration;
  chord tones +, avoid-notes (melody a semitone above a chord tone on a strong beat) strongly −, non-chord tones on weak
  beats tolerated (passing/neighbor).
- Transition score: functional flow T→S→D→T rewarded (ii→V, IV→V, V→I, vi→ii, I→IV…), weak/retrograde (V→IV, V→ii)
  penalized, same chord repeated >2 slots penalized, root motion by 4th/5th rewarded.
- Cadences: phrase end → authentic V(7)–I; strofă end followed by refren → half cadence on V; refren/song end →
  authentic, option "Amin" plagal IV–I for hymns; deceptive V–vi allowed mid-song for emotion. Refren starts preferably on I
  (or IV for worship), strofă may start on I or vi.
- Genre/emotion bias tables (data, not code): Worship modern (I V vi IV, IV first, sus2/add9, slash bass), Imn tradițional
  (triads + V7, strong cadences, plagal "Amin" option), Cântare creștină populară (harmonic minor, i iv V7, VI, V/iv),
  Pop/Baladă, Rock (♭VII, power-chord flag), Popular (harmonic minor, i–iv–V7–i). Emotion adjusts: Trist/Rugăciune → vi/iv/m7,
  Biruință/Laudă/Vesel → I IV V add9, Epic → i VI III VII, Nostalgic → borrowed iv, Liniștit → sus2/maj7.
- Output 3 variants: **A Simplă** (triads, primary chords), **B Pop/Worship** (genre bias), **C Bogată** (7ths, secondary
  dominants, borrowed). Variants must differ in ≥25% of slots.
- Locked chords: user-locked slots are hard constraints; re-harmonize the rest.
- Copies (generated sections) inherit the source section's chords; intro/bridge/outro placeholders stay empty in M3.

### H3 Voicing & voice leading
- Pad/piano voicing 3–4 notes kept **below the vocal melody's current note and under the section's vocal range lo where
  possible**; no close intervals (3rds) below C3; minimal total voice movement between chords, common tones held,
  no parallel 5ths/8ves between outer voices.
- Hymn style: full SATB 4-part — soprano doubles the vocal melody; A/T/B follow classic rules: ranges S C4–G5, A G3–D5, T C3–G4, B E2–C4; no voice crossing, spacing ≤ octave
  between upper voices, double root in root position, never double the leading tone, 7th resolves down).
- Inversions chosen for smooth bass (stepwise lines like C – G/B – Am), shown as slash chords.

### H4 Bass line
- Range E1–C3. Root (or inversion bass) on chord change; genre pattern: Imn = half/whole notes, Worship = 8th pulse
  root, Pop = root–5th, Popular = root–5th in folk grouping; diatonic/chromatic approach note on the last beat before a
  change (not in Imn).

### H5 UI
- Chord lane above the piano roll (Pro) and a simple chord strip in Simplu mode: symbols per slot (C, Am7, G/B),
  naming setting: letter (C, Am) or Romanian (Do, lam). Function colour/tag (T/S/D) subtle.
- Variant switcher A/B/C with instant playback; "Generează acorduri" button; per-slot click → popover with ranked
  alternatives (top 6 + all diatonic + borrowed), each with function label; lock/unlock slot; re-harmonize respecting
  locks; undo/redo for all chord edits.
- Playback: melody (piano) + chords (piano, simple block/arpeggio pattern by genre) + bass (Tone synth bass or low
  piano until M4 instruments); mixer sliders Voce / Melodie / Acorduri / Bas / Metronom.
- Export: song MIDI gets tracks Melodie, Acorduri, Bas + chord symbols as MIDI marker/text events.
- Empty/loading/error states (e.g. "Înregistrează și analizează strofa întâi").

### M3 acceptance criteria
- Tests on ≥10 test melodies (major, minor, harmonic minor, 4/4, 3/4, 6/8, 7/8): ≥80% of strong-beat melody notes are
  chord tones; every phrase end has a valid cadence; strofă→refren boundary is a half cadence; 3 variants differ in ≥25%
  of slots; no parallel 5ths/8ves between outer voices in Imn SATB; voicing top note never above the concurrent vocal note
  (Imn soprano doubling excepted); bass stays in E1–C3; locks respected after re-harmonize; harmonize < 200 ms per song.
- UI: generate → switch variants → edit a slot → lock → re-harmonize → undo/redo → play all layers → export MIDI with
  3 tracks + chord markers, all working with no console errors; usable at 375 px.
- `tsc --noEmit`, `npm test`, `npm run build` pass.

---

# M4 — Arrangement, real instruments, song transport (current build)

### A0 Transport & listening (user request: "play, pauză, stop, să pot asculta în timp real și să aleg ce ascult")
- Sticky transport bar always visible in Studio: Play / Pauză / Stop, position readout, click/drag-to-seek on a song
  timeline with section markers, loop (section or song), scope toggle **Secțiune / Tot cântecul** (whole song plays all
  sections in order, generated ones included).
- Per-track mixer: Voce (brut/curat), Melodie, and each arrangement track (Pian/Rhodes, Pad, Chitară, Bas, Tobe, Orgă,
  Acordeon, Vioară, Corzi…), each with **volume + Mute (M) + Solo (S)**; changes apply live while playing (<50 ms, no
  clicks — use gain ramps). Quick presets: "Doar vocea", "Doar acompaniamentul", "Tot".
- Shortcuts: Space play/pause, Esc stop, Home to start, M/S on focused track.

### A1 Instruments (permissive only)
- Use a GM SoundFont player in the browser (e.g. **SpessaSynth** spessasynth_lib, Apache-2.0) + a permissively licensed
  SF2/SF3 (verify license before bundling: e.g. MuseScore General / MS Basic — MIT, or GeneralUser GS). Lazy-load with
  progress UI, cache (Cache Storage/IndexedDB) so it works offline after first load; Salamander piano stays for piano.
- Instrument ranges respected (GM practical ranges); drums on MIDI channel 10.

### A2 Genre presets (data tables)
- **Worship modern**: piano/Rhodes, ambient pad, acoustic guitar strum, electric guitar swells (refren), bass 8ths,
  drums (verse sparse kick/rim → refren full), big build in bridge.
- **Imn tradițional**: organ (or piano) SATB from M3 voicing, optional strings, no drums.
- **Cântare creștină populară**: accordion comping, violin long notes, bass root–5th, light percussion; 3/4 vals or folk
  meters.
- **Pop/Baladă**: piano, strings, soft drums, bass. **Rock**: power-chord electric guitars, bass, rock drums.
- **Popular**: accordion, dulcimer (ţambal ≈ GM 15), pan flute (nai ≈ GM 75), violin, bass, hora/folk drums.
- Emotion modifies: density, register, velocity, reverb send, instrument choice (e.g. Rugăciune → pad + piano only).

### A3 Patterns & meters
- Comping/strum/arpeggio/drum pattern library per meter: 4/4, 3/4, 6/8, 2/4, 5/8, 7/8 (3+2+2, 2+2+3), 9/8 (2+2+2+3);
  accents follow grouping. Patterns stay under the vocal range (from M3 voicing rules); no melodic lines over the singing
  (fills in pauses come in M5).

### A4 Song form & dynamics
- Energy level 1–5 per section, auto: Intro 2, Strofa 1 = 2, Refren 1 = 3, Strofa 2 = 3, Refren 2 = 4, Bridge 3→5 build,
  final Refren 5, Outro 2→1; user can change per section. Energy controls active instruments, pattern density, velocity,
  voicing register/width.
- Transitions: drum fill in the last bar before a refren (if drums), crash on refren downbeat, optional "drop" (1 bar
  silence before final refren), pad swell into bridge, final ritardando + held last chord in outro.
- Generated sections get harmony now (melody hooks in M5): Intro = last 4 bars of the refren's chords; Outro = refren's
  last phrase + final cadence (plagal "Amin" for Imn); Bridge = starts on IV or vi, ends on half cadence V before the
  final refren. Copies keep source chords.

### A5 Export
- Song MIDI: all tracks with GM program numbers, drums on channel 10, chord markers, tempo & time signature.

### M4 acceptance criteria
- Pure-TS arrangement generator (`src/theory/arrange/`) with Vitest: each of the 6 genres yields its distinct instrument set;
  refren note density ≥1.5× strofa and more active tracks; energy curve monotonic per A4 defaults; all notes inside
  instrument ranges; drum accents match the meter grouping for every supported meter; comping never above concurrent vocal
  note; nothing scheduled past song end; generated sections have valid harmony and cadences.
- Transport: play/pause/stop/seek, section vs whole-song, mute/solo/volume live while playing with no console errors;
  presets work; shortcuts work; usable at 375 px.
- SoundFont lazy-loads with progress, cached, license verified and credited in Despre/Licențe.
- `tsc --noEmit`, `npm test`, `npm run build` pass; e2e extended.

---

# M5 — Melodic layers: hook, fills in pauses, counter-melody, intro/bridge/outro melody

Pure-TS engine in `src/theory/melody/` (no React, no audio). API:
`generateMelodicLayers(input) → { tracks: { name, gmProgram, channel, notes: {midi,startSec,durSec,vel}[] }[], diagnostics }`
Input (define the interface in `src/theory/melody/types.ts`): song timeline of sections (type, startSec, bars, energy 1–5,
chord slots {startSec, durSec, chord pcs, root, function}), vocal notes in song time, vocal pauses, key, meter
(num/den/grouping), bpm, genre, emotion, vocal range, seed.

- **Hook/motif**: most characteristic 3–6-note pattern (interval + rhythm n-grams), preferring the refren's first phrase.
  Transformations: diatonic sequence, inversion, fragmentation, augmentation/diminution, light ornamentation.
- **Answers in pauses**: for every vocal pause ≥ 1 beat, start ≥ ⅛ beat after the sung note ends and end ≥ ¼ beat
  before the next sung onset; echo or vary the last vocal phrase or the hook; chord tones on strong beats, stepwise motion on
  weak beats; lead into the next sung note. Per genre: worship → piano or electric guitar; imn → minimal (only held phrase
  ends, organ); populară → violin, nai or accordion with ornaments (mordent, trill) in harmonic minor.
- **Counter-melody** (energy ≥ 4): long notes, contrary motion, register apart from the voice (above for low voices,
  below for high voices), 3rds/6ths/10ths on strong beats, no unisons, no parallel 5ths/8ves with the voice.
- **Intro**: hook stated by the lead instrument over the intro chords, ending with a lead-in to the strofa's first note.
  **Bridge**: hook developed by sequence and rising contour to a climax, ending on the dominant. **Outro**: last refren
  phrase, held tonic, ritardando flag.
- **Emotion table**: density, register, ornament amount, articulation, velocity.

### M5 acceptance criteria (Vitest)
- 0 fill/answer notes overlap sung notes (with the margins above); ≥90% of strong-beat melodic notes are chord tones; no
  m2, M7 or ♭9 against a concurrent sung note; no parallel 5ths/8ves with the voice; intro contains the hook (interval
  match ≥80%); bridge ends on V, outro on the tonic; all notes in instrument range; density increases with energy;
  deterministic for the same seed; < 100 ms per song.

---

# M6 — Mix, vocal FX, export, sheet music, polish (current build)

### X0 (TOP PRIORITY, user request) — Deep voice analysis + the backing track ("minus") for recording
- **Raport voce** per take and per song: range (lowest/highest stable note), tessitura (where 80% of sung time lies),
  voice type estimate (bas / bariton / tenor / alto / mezzo / sopran, from tessitura + range), intonation (mean |cents|
  per note, % notes within ±25 cents, notes most often flat/sharp), timing (mean/max onset deviation vs warped grid),
  stability (vibrato rate/extent, pitch drift on held notes), breath/pause map, dynamic range. Visual: piano-roll overlay
  with notes coloured by intonation (in tune / flat / sharp) + plain-Romanian tips ("ții nota Si puțin jos, ~-30 cenți").
- **Tonalitate recomandată**: compute the transposition (±6 semitones) that puts the song's tessitura in the comfortable
  zone of the detected voice type (and keeps the highest note ≥1 semitone below the singer's max). One click
  "Transpune minusul" transposes the whole arrangement (chords, bass, melodic layers, sheet); vocal analysis stays.
- **Minus (negativ) export**: accompaniment only (no voice), in the chosen key, options: with/without guide melody
  (piano/lead playing the vocal line, quiet), with/without count-in bar, with/without metronome; full song WAV.
- **Înregistrare finală peste minus**: record the whole song (all strofe/refrene with lyrics) over the minus in headphones:
  multiple takes, punch-in per section, latency compensation, take comparison, pick best per section (comping), then the
  final mix (X1/X2) and export. Same Start/Pauză/Continuă/Stop controls as section recording.
- AC: report numbers verified on synthetic takes with known detune/timing errors (intonation error estimates within ±5 cents,
  timing within ±15 ms); on test-audio/real/strofa-curat.wav the report says low male voice (bariton/bas) and recommends a
  sensible key; transposed minus keeps all M3–M5 guarantees (above-voice voicing for low voices, no clashes); final
  recording over minus stays aligned within ±10 ms after latency compensation.

### X0b Asistent tempo & măsură (user request)
- "Nu știu tempoul / măsura" mode: the user records freely (no metronome) or taps the beat while singing (tap = Space or
  a big pad). The app estimates BPM (from taps, else vocal onsets), the meter (4/4, 3/4, 6/8, 2/4, plus 7/8 / 5/8 / 9/8
  groupings) from the accent pattern (onset strength + duration + pitch peaks autocorrelated at 2/3/4 beat periods,
  compound vs simple from the beat subdivision, and phrase lengths landing on 4- or 8-bar boundaries) and the bar count
  (= duration × BPM / 60 / beats per bar), and shows the top 2 options with confidence and a plain-Romanian explanation.
  It plays each option back with a metronome accent on "1" so the user can pick by ear. Then it sets the project
  BPM/meter/bars and aligns the take (first downbeat = first stressed note, adjustable).
- AC: on synthetic takes ≥90% correct meter for 4/4, 3/4, 6/8; BPM within ±2; bar count exact; works from taps alone.

### X1 Vocal chain (per emotion preset, editable in Pro)
HPF 80 Hz → EQ (cut ~300 Hz mud, presence +2–3 dB ~3 kHz, air shelf) → compressor (≈3:1, soft knee) → optional de-esser
→ sends: reverb (algorithmic/generated IR — no external IR files) + tempo-synced delay (1/8 or 1/4). Presets by emotion
(Rugăciune/Liniștit: big soft reverb; Laudă/Vesel: short room + slap; Epic/Biruință: hall + 1/4 delay; …).
Same chain in realtime playback and offline render.

### X2 Mix
- Accompaniment bus ducking under the voice: gain automation precomputed from the vocal envelope (−2…−4 dB when singing,
  smooth attack/release), works in playback and export.
- Master: gentle glue compressor + true-peak limiter (−1 dBTP); export loudness target ≈ −14 LUFS (integrated, measured).
- Mixer keeps per-track volume/M/S; add pan per track (sensible defaults per instrument) and a "Mix automat" reset.

### X3 Export (progress UI + cancel, Romanian file names)
- Song WAV (44.1 or 48 kHz, 24-bit) rendered offline with all FX, ducking, tuning, ritardando.
- Stems: one WAV per track (voice with FX, each instrument/melodic layer), same length, aligned at 0.
- MIDI (existing, all tracks). MusicXML (melody + chord symbols, key, meter, tempo, section rehearsal marks) — opens in
  MuseScore. **Partitură simplă**: in-app sheet view (melody + chord symbols, one system per phrase) rendered with a
  permissive lib (e.g. OpenSheetMusicDisplay BSD-3 or VexFlow MIT) + "Printează / Salvează PDF" (print stylesheet).

### X4 Polish & leftovers
- `impeccable` audit + polish on all screens; first-run onboarding (3 short steps), shortcut help (?), consistent
  empty/loading/error states.
- Previously unverified: project rename/delete with confirmation; undo/redo ≥50 steps; piano roll 60 fps with 500 notes
  (measure, optimize if needed); touch editing on piano roll.

### M6 acceptance criteria
- Offline render equals realtime mix structure (same tracks/levels/FX); exported song WAV peak ≤ −1 dBTP, integrated
  loudness −14 ± 1 LUFS; stems same length and sum ≈ mix (null test residual ≤ −30 dB without master limiter).
- Ducking: accompaniment bus 2–4 dB lower during sung notes than in pauses (measured).
- MusicXML validates (parses in OSMD/MusicXML schema basics) and contains all melody notes + chord symbols; sheet view
  renders without errors; print view fits A4.
- Export progress/cancel works; 3-minute song renders in < 60 s on a normal laptop.
- Rename/delete confirm, undo ≥50, piano roll ≥55 fps with 500 notes (measured) — PASS.
- tsc, npm test, npm run build, e2e green; no console errors; 375 px OK; screenshots/m6-*.png.

---

# M7 — Instrument diversity & realism

Goal: many more and better instruments, all with licenses that allow commercial use, lazy-loaded.

### I1 Sound sources (verify every file's license; write `public/instruments/LICENSES.md` with source, license, attribution)
- **VSCO 2 Community Edition** (CC0) and **Versilian Community Sample Library — VCSL** (CC0), from the official
  repositories: strings (ensemble, violin, viola, cello, double bass, pizzicato, tremolo), woodwinds (flute, clarinet,
  oboe, bassoon, recorder), brass (trumpet, French horn, trombone, tuba), keys (pipe/church organ, harmonium,
  celesta, glockenspiel, marimba, vibraphone, tubular/church bells), harp, timpani, orchestral and folk percussion,
  acoustic and folk guitars where available.
- Keep MuseScore General (MIT) for the full GM set: accordion, pan flute (nai), dulcimer (țambal approx.), mandolin,
  banjo, guitars, choir aahs/oohs, synths. Mark each catalog entry with its quality tier.
- **Synthesized in code** (Tone.js, zero assets): worship pads and swells, ambient textures, a vowel choir pad (formant
  synthesis), synth bass, arpeggiator, bells, risers. Each has emotion-aware presets.
- **Church reverb**: convolution impulse responses from OpenAIR (only CC-BY or CC0 items; credit each) or high-quality
  generated IRs. Spaces: "Studio", "Capelă", "Biserică", "Catedrală", "Sală". Used per project and per bus.
- **Groove MIDI Dataset** (Magenta, CC-BY 4.0): convert real drummers' grooves and fills to an internal pattern JSON
  tagged by tempo, meter and feel. Filter to styles that fit (worship/pop/rock/ballad), keep the attribution, and use
  them as drum patterns and fills instead of only synthetic ones.

### I2 Pipeline & format
- `scripts/instruments/` (Node + ffmpeg, already on PATH): fetch from official sources into a cache outside `public/`;
  choose note and velocity subsets (about every minor 3rd; 2–3 velocity layers; round-robin where it matters); trim,
  normalize, set loop points for sustained instruments where possible; encode (mp3 or ogg, with a size budget per
  instrument); write `public/instruments/<id>/manifest.json` (range, layers, release, loop, family, genres, license).
  Prefer generating SF2 (an own minimal SF2 writer) so SpessaSynth plays everything uniformly; a manifest-driven sampler
  is acceptable if SF2 is impractical.
- Total shipped size target ≤ 400 MB, lazy-loaded per instrument with progress, cached in Cache Storage.

### I3 Catalog & UI
- `src/audio/instruments/catalog.ts`: ≥ 45 instruments across families (keys, organ, strings, woodwinds, brass, guitars,
  basses, folk, choir, synth, mallets/bells, drums/percussion) with metadata (GM fallback, range, articulations,
  genres, tier).
- Instrument picker per mixer track (search, family tabs, preview note), shown "în cântec" vs "toate"; genre presets get
  richer, more varied defaults (e.g. Imn: organ + strings + choir pad + timpani on finals; Cântare: violin + clarinet +
  accordion + nai + țambal + contrabass; Worship: piano + pad + acoustic + ambient electric + cello in the bridge).

### I4 Realism (code)
- Humanization: seeded timing (±8–15 ms) and velocity jitter by instrument family; groove templates.
- Guitar strum engine (down/up strokes, 8–25 ms between strings, muted ghost strokes); piano sustain pedal
  logic (re-pedal at chord changes); string legato and swells; articulation choice (pizz/tremolo/long) by energy.
- Stereo pan defaults per instrument; send levels to the church reverb.

### I5 "Instrumentul tău"
- Record or import single notes of the user's own instrument (guided: "cântă Do, Mi, Sol… pe rând"). Our pitch tracker
  labels them; the app trims, normalizes and builds a playable sampler (stored in IndexedDB) usable in any track.

### I6 Reference library (local tool, not shipped)
- `scripts/reference-library.mjs <folder>`: runs Sonic Annotator (installed at
  `C:\Users\Admin\tools\sonic-annotator\sonic-annotator-win64\sonic-annotator.exe`) with Chordino, key and bar/beat on
  the user's songs and writes ONLY statistics (progressions per key-relative degree, harmonic rhythm, form lengths,
  tempo/meter) to `src/theory/harmony/reference-stats.json`, which feeds the bias tables. No audio or song-identifying
  data goes into the project.

### M7 acceptance criteria
- LICENSES.md lists every shipped file group with a verified permissive license; no GPL/AGPL/NC content.
- ≥ 45 catalog instruments; each manifest is valid and its files exist (Vitest integrity test); ranges respected by
  the arrangement.
- First play of a not-yet-loaded instrument < 3 s on localhost; total shipped ≤ 400 MB.
- Humanization deterministic per seed; strum spacing within spec; groove patterns fit meter/tempo (tests).
- "Instrumentul tău" flow works end to end (e2e with a synthetic note set).
- tsc, npm test, npm run build, e2e green; screenshots/m7-*.png.

---

# Q — Sound quality gate: realistic, beautiful, in tune (user's top goal)

### Q1 In tune ("pe note"), measured on rendered audio
- Per-instrument tuning audit: render every pitched catalog instrument across its range, pitch-track the result, and
  require |error| ≤ 5 cents and the correct octave. Fix the manifests where it fails. Limit sampler re-pitching to
  ±3 semitones from a real sample, otherwise add samples or fall back.
- Self-consistency: render the minus, run Chordino (Sonic Annotator) on it, and compare with the app's chord chart:
  ≥ 95% bar agreement. Solo-render the melodic tracks and pitch-track them against their MIDI: ≥ 98% of notes correct.
- Tuning follows the voice (offset) for every source: SoundFont, samplers and synths.

### Q2 Realistic
- Humanization on all tracks (family-specific), velocity layers + round-robin, natural releases and tails, real-drummer
  grooves, strum and pedal engines, legato strings, articulations by energy, no machine-gun repeats (same note +
  same velocity + same sample twice in a row is forbidden on percussion and keys).
- Per-instrument mix EQ: high-pass every non-bass track, tame 200–400 Hz build-up, carve the 1–4 kHz vocal band in the
  accompaniment bus; tasteful stereo image (bass/kick centre, pads wide, guitars/keys spread); church reverb sends by family.

### Q3 Beautiful (arrangement taste rules, data-driven)
- Fewer, better parts: at most 4–5 simultaneously active melodic/harmonic tracks; register separation (bass < ~200 Hz;
  keys/guitar mid; pads wide/above; lead lines above a low voice and below a high voice); one featured instrument per
  section; contrast between sections (instrument entries, drop-outs, builds); the counter-melody stays sparse.
- Dynamic arc over the song; transitions (fills, swells, risers) only at section boundaries; the ending resolves.

### Q4 Objective audits on every export (reported in the export view and in benchmark summary.json)
- Loudness/true-peak (existing), clipping 0, spectral balance compared with a genre target curve (derived from the
  reference library when available; else defaults), vocal-band masking index, simultaneous-track count, note density per
  section, and Q1 self-consistency scores. Fail → visible warning with a plain-Romanian explanation.

### Q acceptance criteria
- Q1 audits pass for all tier-A/B instruments in the default presets; minus self-consistency ≥ 95%; melodic pitch ≥ 98%.
- Q4 audits run on export and in song-from-vocal.mjs; the benchmark renders (worship/pop/cantare, --full) pass them.

---

# M8 — Local AI helpers, autotune, vocal trainer, artifact hunt

Decisions (user-approved): add local AI as optional helpers; the rule engine stays the backbone (key, chords, clash guard,
real instruments). The app must keep working without the AI service (graceful fallback, clear Romanian status).

### A1 Local AI service (`ai-service/`, Python, GPU RTX 3060 12 GB, localhost only)
- FastAPI on http://127.0.0.1:5175, CORS only for the dev origin; health endpoint reports models + GPU.
- **DeepFilterNet** (verify MIT/Apache) → `/denoise`: voice cleaning option "Curățare AI" next to the classic one; A/B.
- **Demucs htdemucs** (verify MIT incl. weights) → `/separate`: import a whole song → vocals + accompaniment stems; the
  vocals feed "Din vocea completă"; the original accompaniment can be used as a reference (key/tempo/chords via
  Chordino-like analysis already available), never shipped.
- **Anticipatory Music Transformer** (Stanford; verify code AND weights licence permit commercial use) → `/accompany`:
  input = melody MIDI + chord chart + meter/tempo + style; output = candidate accompaniment/answer/fill MIDI. The app
  passes it through the rule filters (key, chords, clash guard, ranges, density caps) and plays it with real instruments.
  Offered as "Variantă AI" per layer next to the rule-based one.
- Env: an isolated venv (uv + Python 3.11 if 3.13 is incompatible), CUDA PyTorch; `ai-service/README.md` with one-command
  start (`start-ai.cmd`); models cached outside the project.
- AC: each endpoint has a CLI smoke test; denoise improves SNR on the noisy fixture ≥ classic; separation of a test mix
  gives vocals with < −20 dB accompaniment bleed (SDR proxy); accompany returns valid MIDI in < 10 s for 16 bars on GPU;
  after rule filtering 0 clashes; licences recorded in `ai-service/LICENSES.md`.

### A2 Autotune (no AI needed)
- Per-note pitch correction of the vocal take toward the corrected notes / key scale with controls: Putere (0–100%),
  Viteză (retune speed, natural → robotic), Păstrează vibrato, Umanizare; preserve formants; permissive pitch shifter
  only (e.g. signalsmith-stretch MIT or WORLD/pyworld BSD/MIT; never Rubber Band GPL). Works offline on takes and in the
  final mix; A/B. AC: after 100% correction, measured pitch error of held notes ≤ 10 cents; no audible artefacts proxy
  (no clicks, spectral flux spikes); timing unchanged (±5 ms).

### A3 Vocal trainer ("Antrenament voce")
- Live pitch from the mic (AudioWorklet YIN/pYIN, ≤ 40 ms latency), drawn as a moving line over target note lanes
  (cents deviation colour: green ±15, yellow ±35, red beyond), note name, cents readout.
- Exercises: Ține nota (hold a target for N seconds: accuracy %, stability, time in tune), Scări & arpegii in the singer's
  comfortable range (from the voice report), Intervale, and **Cântă melodia cântecului** (karaoke-style scrolling notes of
  the user's own song, section by section, with the minus playing). Scores + history per day (IndexedDB), gentle tips.
- Game-like but tasteful UI fitting the app (impeccable skill).
- AC: synthetic tests: a known sung tone ±20 cents is reported within ±5 cents; latency measured ≤ 40 ms; scoring
  deterministic; works at 375 px; e2e with fake mic.

### A4 Random-artifact hunt ("chestii random")
- Anomaly detector on every render/arrangement: isolated very short notes, velocity outliers, notes out of key and not
  in the chord on strong beats, answers/hook placed in odd spots (over singing, mid-phrase), leaps > octave in lines,
  sample-clarity < threshold, out-of-range notes, sudden density spikes. Report by time + track; fix causes; target 0 on
  the 5 benchmark songs. Plus a "Semnalează aici" button in the player that stores (time, track, note) so the user can
  mark weird moments; these marks are listed for review.

### A5 Demucs — full functionality (user request)
- Models: htdemucs (4 stems: voce, tobe, bas, altele), htdemucs_ft (best quality, slower), htdemucs_6s (6 stems: + chitară,
  pian; weaker on those), two-stems mode (voce / fără voce). Quality controls: shifts (test-time augmentation), overlap,
  segment; output WAV 16/24-bit/float (no MP3 via LGPL lameenc). Job queue with progress/cancel; cache results per file hash.
- **Stems player**: every separated stem as a track in the mixer (volume/M/S/pan, waveform), A/B with the original.
- **Minus din original** (vocals removed) for personal practice; **Cântă peste original** = final recording over it.
- **Învață din cântec** (local analysis only, nothing copyrighted saved in the project): drums stem → tempo map, downbeats,
  groove template; bass stem → chord roots/bass line; harmonic stems → chord chart (Chordino-like) and voicing style; vocals →
  melody + form. Feeds the "Din vocea completă" flow (exact grid from drums instead of guessing) and the reference library
  (statistics only).
- **Practice tools** on stems: transpose ±6 semitones and tempo 70–120% (permissive time/pitch library only, e.g.
  signalsmith-stretch MIT), loop a section.
- Batch: separate + analyse a folder of songs for the reference library (statistics only).
- UI note in Romanian: separation of commercial songs is for personal study/practice; don't publish the stems.
- AC: per-model smoke tests (bleed/SDR proxies on synthetic mixes), drums-stem downbeat accuracy on the reference song vs
  qm bars (≤ 30 ms median), bass-stem chord-root agreement ≥ 85% on the reference, stems sum ≈ original (≤ −30 dB residual
  for htdemucs), UI e2e with a synthetic mix.

### A6 More local AI (user-chosen): Beat This! + All-In-One, CREPE/RMVPE, VoiceFixer, local LLM (Qwen)
- Verify code AND weight licences for each; anything non-commercial (e.g. madmom's CC BY-NC-SA models) must not be used —
  replace with a permissive path and say so.
- **Beat This!** → `/beats`: beats + downbeats (+ tempo map) from any audio (vocal, mix, drums stem). **All-In-One** →
  `/structure`: segments with labels (intro/verse/chorus/bridge/outro) + beats/downbeats. Used by: Din vocea completă,
  Învață din cântec, meter assistant (suggest grid), form detection. AC: on the reference mix downbeats ≤ 30 ms median vs qm
  bars (24.40 / 47.02 s, bar ≈ 2.824 s); on the reference vocal alone, report the downbeat error (goal ≤ 80 ms) and whether
  it beats our current fit (~0.8 s late).
- **CREPE (torchcrepe) / RMVPE** → `/pitch`: frame pitch + voicing for vocals; the app can use it instead of pYIN when the
  service is up (setting "Detecție note: AI / clasic"). AC: on the synthetic benchmark singers, note accuracy ≥ current
  (98% synthetic) and better on noisy/vibrato cases; report on the real fixture too.
- **VoiceFixer** → `/restore`: restore poor recordings (phone, room echo, clipping, low bandwidth); option in Voce ›
  Curățare ("Restaurare AI"), A/B. AC: on degraded versions of a clean take (reverb, 8 kHz band-limit, clipping) objective
  improvement (e.g. SI-SDR/log-spectral distance) reported.
- **Local LLM (Qwen, Apache-2.0 weights, size that fits RTX 3060 12 GB e.g. ~7–8B Q4)** via a permissive runtime (Ollama
  MIT or llama.cpp MIT) → `/assistant`: Romanian assistant in the app. Uses: natural-language style requests → validated
  JSON settings patch (strict schema, only known fields/values; never free-form actions), theory explanations, coaching
  from the voice report, explaining chord choices. Must run fully offline; loaded on demand; unloaded to free VRAM for
  Demucs/AMT. AC: 20 Romanian test prompts → valid patches ≥ 90%, 0 invalid fields applied.
