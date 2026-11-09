# src/ai - client for the local AI service

Typed, dependency-free browser client for `ai-service/` (http://127.0.0.1:5175). Start the service with
`ai-service\start-ai.cmd`. The app must keep working when it is offline: **every call rejects with `AiError`** (except
`health()` which resolves `null`), so UI code is `try/catch` + a Romanian message keyed on `err.code`.

```ts
import { createAiClient, AiError } from './ai';
const ai = createAiClient();                       // baseUrl defaults to http://127.0.0.1:5175

const st = await ai.status();                      // never throws
// st.state: 'offline' | 'loading' | 'ready' | 'error'; st.available.{denoise,separate,accompany}; st.health (GPU, versions)

const clean: Blob = await ai.denoise(wavBlobOrArrayBuffer, { attenLimDb: 12, signal, timeoutMs, onProgress });
const { vocals, accompaniment, seconds, modelMs } = await ai.separate(songFile, { onProgress: (p) => ... });
const { candidates } = await ai.accompany({
  melodyMidi, key: 'G', mode: 'major', meter: '3/4', bpm: 76, bars: 16, pickupBeats: 1,
  chords: ['G', 'G7', 'C', /* one per bar */], style: 'worship', nCandidates: 3, seed: 7,
});
candidates[0].midi;                                // Uint8Array (standard MIDI file) -> feed the rule filters
await ai.accompanyStyles();                        // styles + supported GM instruments
```

| Call | Returns | Default timeout | Progress |
|---|---|---|---|
| `health()` | `AiHealth \| null` | 2.5 s | - |
| `status()` | `AiStatus` | 2.5 s | - |
| `denoise(audio, {attenLimDb})` | `Blob` (audio/wav) | 120 s | 0 then 1 |
| `separate(audio)` | `{vocals, accompaniment: Blob(audio/wav 44.1k stereo), seconds, modelMs}` | 15 min | real (polled, 400 ms) |
| `accompany(req)` | `{candidates: {midi: Uint8Array, notes, programs, genMs, seed}[], totalSeconds, elapsedMs}` | 120 s | real |

All options accept `signal` (AbortSignal), `timeoutMs`, `onProgress(0..1)`.

`AiError.code`: `offline` (service not running -> show "Serviciul AI nu rulează", hide the AI buttons),
`timeout`, `aborted`, `not_ready` (models still loading), `bad_request` (unusable audio / chord chart; `message` has the
server detail), `server`. Put the Romanian strings in `src/i18n/ro.ts`.

Units: `bpm` is the **quarter-note** BPM (for 6/8 pass dotted-quarter bpm x 1.5); `bars` excludes the pickup; chord `bar`
indices are 0-based after the pickup; melody MIDI time 0 = start of the pickup.

### Demucs / "Invata din cantec" (A5)
```ts
const r = await ai.separate(file, { model: 'htdemucs_ft', twoStems: 'all', shifts: 1, format: 'pcm24', signal, onProgress });
r.stems.drums; r.cacheKey; r.residualDb; r.cacheHit;      // abort the signal => server-side cancel
ai.stemUrl(r.cacheKey, 'vocals');                         // stable URL for <audio>/fetch
const a = await ai.analyzeSong({ cacheKey: r.cacheKey });  // or { audio: file }: rhythm, bass, chords, key, vocals hand-off
const minus = await ai.practice({ cacheKey: r.cacheKey, stems: ['drums','bass','other'], semitones: -2, tempo: 0.85 });
const stats = await ai.batch('D:/songs');                  // statistics only
await ai.separateModels(); await ai.analyzePart('rhythm', key, { beatsPerBar: 4 }); await ai.cancelJob(id);
```
`practice` validates semitones -6..6 and tempo 0.70..1.20 locally (`bad_request`). A job cancelled on the server rejects
with `aborted`.

### A6
```ts
await ai.beats(file);                                  // { bpm, beats_per_bar, beats[], downbeats[], tempo_map[] }
await ai.structure(file, { minBars: 8 });              // segments[{start,end,label,section_type}] + grid
await ai.pitch(voiceWav, { model: 'full' });           // f0_hz[] / voiced[] at 10 ms (use instead of pYIN when online)
await ai.restore(voiceWav, { mode: 0 });               // Blob, offer A/B
const r = await ai.assistantPatch('vreau rock în La minor, 120', { current: project });  // r.patch is already validated
await ai.assistantAsk('coach', 'ce să exersez?', { context: voiceReport });
await ai.assistantStatus(); await ai.assistantUnload();
```
Assistant calls can take ~10 s the first time (model load). `r.patch` only contains known fields with allowed values.

Tests: `npx vitest run src/ai` (fetch is mocked; no service needed).
