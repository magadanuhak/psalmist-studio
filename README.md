# Psalmist Studio

**RO** · Cântă a cappella, iar Psalmist Studio îți face acompaniamentul („minusul”): curăță vocea, găsește notele,
scrie acordurile, aranjează cu instrumente reale și exportă minusul, mixul, MIDI și partitura. Totul rulează în browser,
pe calculatorul tău. Gândit pentru muzica creștină (worship, imn, cântare) și pentru muzica populară.

**EN** · Sing a cappella and Psalmist Studio builds your backing track: it cleans the voice, detects the notes, writes
the chords, arranges them with real sampled instruments and exports the minus, the mix, MIDI and sheet music. Everything
runs locally in the browser. Built for Christian music (worship, hymns) and Romanian/Moldovan folk styles.

## Funcții / Features
- **Voce:** asistent de înregistrare cu metronom în căști (tempo, măsură, verificare de căști), curățare clasică sau AI,
  detecție de note (clasic sau AI), piano roll, autotune, raport voce, antrenament de voce cu linie de ton în timp real.
- **Acorduri:** tonalitate, armonizare cu reguli de teoria muzicii (funcții, cadențe, voice leading), variante
  Simplu / Normal / Bogat, editare pe măsură.
- **Aranjament:** formă rapidă (intro · strofă · refren · final), stiluri Acustic / Vesel / Clasic, 70+ instrumente
  reale (CC0), ritmuri de toboșari reali, răspunsuri și contra-melodii, reverb de biserică.
- **Mix și export:** mixer cu Mute/Solo, efecte pe voce, minus, mix, piste separate, MIDI, MusicXML, partitură.
- **AI local opțional** (`ai-service/`, GPU NVIDIA): curățare (DeepFilterNet), separare de piste (Demucs),
  bătăi și structură (Beat This!), note (CREPE), restaurare (VoiceFixer), variante de acompaniament
  (Anticipatory Music Transformer) și un asistent în română (Qwen, local).

## Pornire / Getting started
```bash
npm install
npm run dev
```
Deschide / open http://localhost:5174 (Chrome sau Edge).

Serviciul AI (opțional, Windows + NVIDIA): `ai-service\setup-ai.cmd` o singură dată, apoi `ai-service\start-ai.cmd`.
Vezi [ai-service/README.md](ai-service/README.md).

## Teste / Tests
```bash
npm test          # unit tests (Vitest)
npm run build
node scripts/e2e.mjs   # end-to-end (needs the dev server and Chrome)
```
Benchmark pe cântece libere de drepturi / public-domain benchmark: `node scripts/benchmarks/run.mjs`.

## Licență / License
Codul: [Apache-2.0](LICENSE). Sunetele și modelele au licențele lor (CC0, CC BY, MIT, Apache-2.0); vezi [NOTICE](NOTICE)
și [public/instruments/LICENSES.md](public/instruments/LICENSES.md). Separarea cântecelor comerciale e doar pentru
studiu personal; nu publica pistele separate.

## Susține / Support
Proiectul e gratuit și open source. Donațiile ajută la dezvoltare.
