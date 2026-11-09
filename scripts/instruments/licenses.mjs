// Fetch + verify the upstream licence files and write public/instruments/LICENSES.md from the built manifests.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, REPOS } from './lib.mjs';

const lic = path.join(OUT, 'licenses'); fs.mkdirSync(lic, { recursive: true });
const files = {};
for (const [k, r] of Object.entries(REPOS)) {
  const res = await fetch(`https://raw.githubusercontent.com/${r.slug}/master/LICENSE`);
  const txt = await res.text();
  if (!/CC0 1\.0 Universal/i.test(txt)) throw new Error(`${r.slug}: LICENSE is not CC0 1.0 (verified by reading the file)`);
  fs.writeFileSync(path.join(lic, `LICENSE-${k}-CC0.txt`), txt); files[k] = `licenses/LICENSE-${k}-CC0.txt`;
}
const groove = fs.readFileSync(path.join(OUT, 'grooves', 'LICENSE-groove.txt'), 'utf8');
if (!/Creative Commons Attribution 4\.0/.test(groove)) throw new Error('groove licence is not CC BY 4.0');

const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
const by = {};
for (const id of Object.keys(idx)) {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, id, 'manifest.json'), 'utf8'));
  (by[m.source.library] ||= { url: m.source.url, license: m.license, items: [] }).items.push({ id, name: m.name, files: m.source.files, bytes: m.bytes });
}
let md = `# Licențe și atribuiri / Licences and attributions

Everything under \`public/instruments/\` is shipped with Psalmist Studio. Only permissive licences are used
(CC0 / CC BY); nothing copyleft and nothing restricted to non-commercial use. Commercial use is allowed for every group below.

## 1. Sampled instruments (CC0 1.0, public domain dedication)

Samples were selected, trimmed, levelled, loop-baked and re-encoded to mp3 by \`scripts/instruments/build.mjs\`.
CC0 requires no attribution; the sources are credited here as a courtesy.

`;
for (const [lib, g] of Object.entries(by)) {
  const key = lib.startsWith('VSCO') ? 'vsco' : 'vcsl';
  md += `### ${lib}\n- Source: ${g.url} (official repository, GitHub user sgossner)\n- Licence: **${g.license}** — verified by reading the repository's LICENSE file (copy: \`${files[key]}\`)\n- Used for: ${g.items.map((i) => `\`${i.id}\``).join(', ')}\n\n| Instrument id | Name | Source files used | Shipped size |\n|---|---|---|---|\n`;
  for (const i of g.items) md += `| ${i.id} | ${i.name} | ${i.files} | ${(i.bytes / 1e6).toFixed(2)} MB |\n`;
  md += '\n';
}
md += `## 2. Groove patterns (CC BY 4.0 — attribution required)

- File group: \`grooves/grooves.json\` (converted from MIDI to a compact pattern format; positions in quarter-note beats)
- Source: **Groove MIDI Dataset**, MIDI-only release (groove-v1.0.0-midionly.zip), https://magenta.tensorflow.org/datasets/groove
- Author: Google LLC (Magenta). Performances by drummers recorded on an electronic kit.
- Licence: **Creative Commons Attribution 4.0 International** (https://creativecommons.org/licenses/by/4.0/), copy: \`grooves/LICENSE-groove.txt\`
- Changes: filtered to styles that fit the app (rock, pop, gospel, soul, funk, country, reggae, ...), cut to 1-2 bar loops and fills,
  note numbers mapped to drum roles, tagged by tempo / meter / feel / energy.
- Required credit text (show in "Despre / Licențe"): "Drum patterns derived from the Groove MIDI Dataset by Google LLC / Magenta, CC BY 4.0."

## 3. Convolution reverb spaces (generated)

- File group: \`ir/*.wav\` — Studio, Capelă, Biserică, Catedrală, Sală.
- Generated procedurally by \`scripts/instruments/ir.mjs\` (seeded noise with frequency-dependent decay and early reflections). Original work, dedicated CC0 1.0.
- OpenAIR (https://www.openairlib.net) impulse responses were evaluated but **not used**: item licences vary and none was verified as CC0 / CC BY, so
  no third-party IR is shipped and no attribution is needed for this group.

## 4. Not in this folder but part of the app

- MuseScore General SoundFont (MIT): \`public/soundfonts/\` — see \`public/soundfonts/MuseScore_General_License.md\`.
- Salamander Grand Piano (CC BY 3.0, Alexander Holm): \`public/samples/\` — attribution in the app's "Despre / Licențe" panel.
- Synthesized instruments (pads, swells, vowel choir, synth bass, arp, bells, risers) are generated in code and use no assets.
`;
fs.writeFileSync(path.join(OUT, 'LICENSES.md'), md);
console.log('LICENSES.md written;', Object.keys(by).length, 'libraries');
