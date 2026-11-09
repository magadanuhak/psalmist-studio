# M7 instrument layer (`src/audio/instruments`)

Everything is exported from `index.ts`. Nothing here touches the engine, store or UI; the integrator wires it in.
Assets live in `public/instruments/` (62 MB, `LICENSES.md` inside). Rebuild with the scripts in `scripts/instruments/`.

## Tiers
`A` real samples (CC0, lazy-loaded mp3) · `B` MuseScore General SoundFont (GM program in `gmFallback`) · `C` synthesized (Tone.js).
Every catalog entry has `gmFallback` (use it while a tier A set downloads or if loading fails).

## Catalog (`catalog.ts`)
`CATALOG` (76 entries), `getInstrument(id)`, `byFamily`, `forGenre`, `forRole`, `searchInstruments(q, list?)`,
`clampToRange(entry, midi)`, `inRange`, `tierCounts()`. Entry fields: `source` (`manifest | gm | gm-drums | synth | salamander | user`),
`range`, `articulations` (first = default), `genres`, `roles`, `pan`, `send` (church reverb), `gainDb`, `preview` (picker note).
Romanian labels: `strings.ro.ts` (`FAMILY_RO`, `TIER_RO`, `ARTICULATION_RO`, `SPACE_RO`, `PICKER_RO`, `YOURS_RO`, `noteNameRo`).

## Playing tier A (`sampler.ts`)
```ts
const ctx = Tone.getContext().rawContext;           // any BaseAudioContext, OfflineAudioContext works for export
const inst = await loadInstrument(ctx, 'violins', { onProgress: (n, total) => ..., articulations: ['sus'] });
inst.output = someGainNode;                          // default: ctx.destination
inst.play(midi, when, durSec, vel01, { articulation: 'sus', pan, gain, attack, detune });
await inst.ensureArticulations(['pizz', 'trem']);    // lazy extra articulations
```
First play only downloads the default articulation (about 0.3-1 MB). Files go through Cache Storage (`psalmist-instruments-v1`).
Pure helpers: `pickSample`, `layerFor`, `velocityGain`, `attackFor`. Hits (percussion): `articulation` = hit name, round-robin automatic.
Pitched percussion: timpani keys were measured from the audio.

## Realism (all pure, seeded)
* `humanize(notes, { seed, family, amount, bpm, beatsPerBar })` timing 6-15 ms, velocity, duration; `applyGroove(notes, bpm, GROOVES.laidback)`.
* `guitarVoicing(midis)`, `strumChord(strings, { time, dur, vel, dir: 'D'|'U'|'x', energy, seed })`, `strumBar(...)` (8-25 ms between strings).
* `pedalEvents(chordChanges, endTime)`, `applyPedal(notes, events)`, `pedalToCC64(events)` (re-pedal at each chord change).
* `chooseArticulation(entry, { energy, durSec, role, soft })`, `legato(notes)`, `swellAttack`, `applySwell`, `swellNotes`.
* `mixDefaults(entry, spaceId)`, `spreadPans(entries)`.
Note type: `NoteEv { midi, time(sec), dur, vel(0..1), art?, attack?, gain? }`.

## Drums (`groove.ts`)
`const data = await loadGrooves()`; `pickGroove(data, { sig, bpm, genre, energy, feel, type: 'beat'|'fill', seed })` (null for 5/8, 7/8, 9/8:
use synthetic patterns there; 2/4 is derived from 4/4); `grooveToHits(pattern, data.roles, { startSec, bpm, velScale, repeat })` gives
`{ time, role, vel, note(GM) }`. Show the CC BY 4.0 credit in the licences panel (text in `LICENSES.md`).

## Reverb (`reverb.ts`)
`loadReverbManifest()`, `loadImpulse(ctx, space)`, `createChurchReverb(ctx, buffer, preDelay)` returns `{ input, output, setSpace, setLevel }`
(send/return; `sendLevel(entrySend, spaceId, trim)`). `DEFAULT_SPACE[genre]`. Spaces: studio, capela, biserica, catedrala, sala.

## Synth (`synth.ts`, tier C)
`createSynth(preset, { emotion })` -> `{ output, note(midi, dur, time, vel), setEmotion, setVowel?, dispose }`. Presets: `warm_pad`, `worship_swell`,
`ambient_texture`, `vowel_choir`, `synth_bass`, `arp_pluck`, `bell_synth`, `riser` (note >= 60 rises, below falls; `dur` = sweep length).
`synthParams.ts`: `emotionParams`, `arpeggiate(chord, pattern, start, step, steps)` (pure).

## Instrumentul tau (`yourInstrument.ts`)
`guidedNotes()` prompts -> record -> `buildUserInstrument(recordedNotes, { name })` returns `{ instrument, report }` (rejections:
noPitch / tooShort / tooQuiet / duplicate) -> `idbStore().put(instrument)` -> `userInstrumentToSampler(ctx, instrument)` (same `play` API),
`userCatalogEntry(instrument)` for the picker (`id = user:<id>`). `analyzeNote` uses `src/dsp/pitch` read-only. `memoryStore()` for tests.

## Pipeline (`scripts/instruments`)
`fetch.mjs` (selected source files only, cache outside the project) -> `build.mjs [id...]` -> `licenses.mjs`; `groove.mjs`; `ir.mjs`;
`pitchcheck.mjs` (sanity check of the note labels). `scripts/reference-library.mjs <folder> [out.json]` for the local reference statistics.

## Integration (M7 wired into the app)
* Arrangement: every `TrackDef` has `inst` (catalog id); the user's choice lives in `ArrangementSettings.instruments` (`setInstrument`), the church reverb in `space` / `spaceLevel` (`setSpace`).
  `theory/arrange/realize.ts` (after the melodic layers) folds notes into the instrument range, humanizes by family, strums guitars, re-pedals keys, legato strings, picks articulations by energy, avoids machine-gun repeats and keeps at most `MAX_ACTIVE` (5) non-drum tracks sounding together per section (`tasteAudit` reports it).
* Realtime: `engine.ts` plays `kind: 'ext'` tracks (tier A, C and user instruments) through `loadSampled` / `createSynth`, church reverb send per track, and turns a track into its `gmFallback` SoundFont program when loading fails (`engine.fallbackNames`, toast). `engine.previewInstrument` is the picker audition.
* Export: `exportSong` renders ext tracks with `audio/external.ts` (`renderExternalBus`: dry per track with Tone.Offline, one church reverb for all, abortable between tracks), the rest through SpessaSynth; `renderSong({ extra, balanceTarget })` adds them to the accompaniment bus, match-EQs it toward the genre curve and ducks it. `audio/audit.ts` produces the Q4 audit shown in the export view.
* UI: `ui/InstrumentPicker.tsx` (search, family tabs, "în cântec / toate", preview), `ui/YourInstrumentDialog.tsx` ("Instrumentul tău": guided mic notes or imported note files), space selector in the Arrangement panel. User instruments: `store/userInstruments.ts` (IndexedDB).
* Tuning: `scripts/instruments/tune-samples.mjs --apply` measures every shipped sample (comb-based `pitchcheck.ts`) and writes the residual `cents` into the manifests (octave errors are relabelled or dropped); `scripts/audit-tuning.mjs` renders every pitched instrument across its range and checks cents and octave.
