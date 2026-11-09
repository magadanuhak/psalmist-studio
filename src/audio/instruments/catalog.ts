import type { CatalogEntry, Family, Genre, Role, SourceRef, Tier } from './types';

type G = Genre; type R = Role;
const WI: G[] = ['worship', 'imn'];
function e(id: string, name: string, family: Family, tier: Tier, source: SourceRef, gm: number | null, range: [number, number],
  articulations: string[], genres: G[], roles: R[], pan: number, send: number, preview: number, gainDb = 0, mono = false): CatalogEntry {
  return { id, name, family, tier, source, gmFallback: gm, range, articulations, genres, roles, pan, send, gainDb, preview, mono };
}
const A = (id: string): SourceRef => ({ type: 'manifest', id });
const GM = (program: number): SourceRef => ({ type: 'gm', program });
const SY = (preset: string): SourceRef => ({ type: 'synth', preset });

/**
 * Full instrument catalog. Tier A ids equal the folder name under public/instruments/<id>/ (manifest.json).
 * `articulations` for tier A must equal the manifest keys (checked by the integrity test).
 */
export const CATALOG: CatalogEntry[] = [
  // ---- keys & organ
  e('piano', 'Pian (Salamander)', 'keys', 'A', { type: 'salamander' }, 0, [21, 108], ['sustain'], ['worship', 'pop', 'rock', 'cantare', 'imn', 'popular'], ['comp', 'melody', 'lead'], 0, 0.12, 60),
  e('upright_piano', 'Pian vertical', 'keys', 'A', A('upright_piano'), 0, [24, 103], ['hit'], ['worship', 'pop', 'cantare', 'popular'], ['comp', 'melody'], -0.1, 0.12, 60),
  e('e_piano', 'Pian electric', 'keys', 'B', GM(4), 4, [28, 100], ['sustain'], ['worship', 'pop', 'rock'], ['comp', 'pad'], 0.15, 0.18, 60),
  e('harpsichord', 'Clavecin', 'keys', 'A', A('harpsichord'), 6, [30, 83], ['hit'], ['imn', 'popular'], ['comp', 'melody'], 0.1, 0.15, 60),
  e('church_organ', 'Orgă de biserică', 'organ', 'A', A('church_organ'), 19, [24, 96], ['full', 'soft'], ['imn', 'worship', 'cantare'], ['comp', 'pad', 'bass'], 0, 0.3, 55),
  e('organ_pedal', 'Orgă – pedală', 'organ', 'A', A('organ_pedal'), 19, [24, 66], ['full', 'soft'], WI, ['bass'], 0, 0.2, 36, 0, true),
  e('positive_organ', 'Orgă pozitiv', 'organ', 'A', A('positive_organ'), 19, [36, 88], ['full', 'flute8'], ['imn', 'cantare', 'popular'], ['comp', 'pad', 'melody'], 0.1, 0.25, 60),
  e('harmonium', 'Armoniu', 'organ', 'B', GM(20), 20, [36, 91], ['sustain'], ['cantare', 'popular', 'imn'], ['comp', 'pad'], -0.1, 0.2, 60),
  e('accordion', 'Acordeon (butoane)', 'folk', 'A', A('accordion'), 21, [44, 82], ['sus'], ['popular', 'cantare', 'pop', 'worship'], ['comp', 'melody', 'lead'], -0.3, 0.15, 60),
  // ---- strings
  e('violins', 'Viori (ansamblu)', 'strings', 'A', A('violins'), 48, [55, 86], ['sus', 'pizz', 'trem', 'spic'], ['imn', 'worship', 'pop', 'cantare', 'popular'], ['pad', 'melody', 'counter'], -0.35, 0.28, 72),
  e('violas', 'Viole (ansamblu)', 'strings', 'A', A('violas'), 48, [48, 86], ['sus', 'pizz', 'trem', 'spic'], WI, ['pad', 'counter'], 0.2, 0.28, 64),
  e('cellos', 'Violoncele (ansamblu)', 'strings', 'A', A('cellos'), 48, [36, 77], ['sus', 'pizz', 'trem', 'spic'], ['imn', 'worship', 'pop', 'cantare'], ['pad', 'bass', 'counter', 'melody'], 0.35, 0.25, 55),
  e('violin_solo', 'Vioară solo', 'strings', 'A', A('violin_solo'), 40, [55, 96], ['sus', 'pizz', 'trem', 'spic'], ['cantare', 'popular', 'pop', 'worship'], ['lead', 'melody', 'counter'], -0.2, 0.22, 72),
  e('bigcat_cello', 'Violoncel solo (Bigcat)', 'strings', 'A', A('bigcat_cello'), 42, [36, 87], ['sus', 'stac', 'pizz'], ['worship', 'pop', 'cantare', 'popular', 'imn'], ['melody', 'counter', 'bass'], -0.2, 0.2, 60),
  e('string_ensemble', 'Corzi (ansamblu GM)', 'strings', 'B', GM(48), 48, [36, 96], ['sustain'], ['imn', 'worship', 'pop'], ['pad'], 0, 0.28, 60),
  e('fiddle', 'Scripcă populară', 'folk', 'B', GM(110), 110, [55, 96], ['sustain'], ['popular', 'cantare'], ['lead', 'melody'], -0.25, 0.18, 72),
  e('harp', 'Harfă', 'strings', 'A', A('harp'), 46, [28, 101], ['pluck'], ['imn', 'worship', 'cantare'], ['comp', 'counter', 'fx'], 0.3, 0.3, 64),
  e('folk_harp', 'Harfă populară', 'strings', 'A', A('folk_harp'), 46, [36, 92], ['pluck'], ['popular', 'cantare', 'worship'], ['comp', 'counter'], 0.25, 0.28, 64),
  e('contrabass', 'Contrabas', 'basses', 'A', A('contrabass'), 43, [28, 59], ['sus', 'pizz', 'trem', 'spic'], ['cantare', 'popular', 'imn', 'pop', 'worship'], ['bass'], 0, 0.04, 40, 0, true),
  // ---- woodwinds
  e('flute', 'Flaut', 'woodwinds', 'A', A('flute'), 73, [60, 96], ['sus', 'vib'], ['worship', 'cantare', 'imn', 'pop', 'popular'], ['melody', 'counter', 'lead'], 0.25, 0.22, 76),
  e('piccolo', 'Piccolo', 'woodwinds', 'A', A('piccolo'), 72, [79, 99], ['sus'], ['popular', 'imn'], ['melody', 'fx'], 0.3, 0.2, 86),
  e('clarinet', 'Clarinet', 'woodwinds', 'A', A('clarinet'), 71, [50, 86], ['sus'], ['cantare', 'popular', 'pop', 'worship'], ['melody', 'counter', 'lead'], 0.2, 0.2, 67),
  e('oboe', 'Oboi', 'woodwinds', 'A', A('oboe'), 68, [58, 89], ['sus', 'vib'], ['imn', 'worship', 'cantare'], ['melody', 'counter'], -0.15, 0.22, 72),
  e('bassoon', 'Fagot', 'woodwinds', 'A', A('bassoon'), 70, [34, 75], ['sus', 'vib', 'stac'], ['imn', 'popular'], ['counter', 'bass'], -0.25, 0.2, 48),
  e('recorder', 'Flaut dulce', 'woodwinds', 'A', A('recorder'), 74, [65, 88], ['sus', 'vib', 'stac'], ['popular', 'cantare', 'worship'], ['melody', 'counter'], 0.2, 0.2, 72),
  e('ocarina', 'Ocarină', 'woodwinds', 'A', A('ocarina'), 79, [69, 85], ['sus'], ['popular', 'cantare'], ['melody'], 0.15, 0.2, 74),
  e('pan_flute', 'Nai (flaut Pan)', 'folk', 'B', GM(75), 75, [60, 96], ['sustain'], ['popular', 'cantare', 'worship'], ['melody', 'lead', 'counter'], 0.2, 0.28, 72),
  e('whistle', 'Fluier', 'folk', 'B', GM(78), 78, [72, 84], ['sustain'], ['popular', 'cantare'], ['melody', 'fx'], 0.25, 0.2, 84),
  e('english_horn', 'Corn englez', 'woodwinds', 'B', GM(69), 69, [52, 81], ['sustain'], WI, ['melody', 'counter'], -0.2, 0.22, 64),
  e('harmonica', 'Muzicuță', 'folk', 'A', A('harmonica'), 22, [60, 96], ['sus'], ['popular', 'cantare', 'pop'], ['melody', 'comp'], -0.2, 0.1, 72),
  e('tenor_sax', 'Saxofon tenor', 'woodwinds', 'A', A('tenor_sax'), 66, [44, 88], ['sus', 'vib', 'stac'], ['pop', 'worship'], ['melody', 'lead'], 0.25, 0.15, 62),
  // ---- brass
  e('trumpet', 'Trompetă', 'brass', 'A', A('trumpet'), 56, [53, 84], ['sus', 'vib', 'stac', 'mute'], ['imn', 'worship', 'popular', 'pop'], ['melody', 'counter', 'fx'], 0.2, 0.2, 67),
  e('horn', 'Corn francez', 'brass', 'A', A('horn'), 60, [33, 77], ['sus', 'stac', 'mute'], WI, ['pad', 'counter', 'melody'], -0.2, 0.25, 55),
  e('trombone', 'Trombon', 'brass', 'A', A('trombone'), 57, [34, 65], ['sus', 'vib', 'stac'], ['imn', 'popular', 'worship'], ['pad', 'counter', 'bass'], -0.3, 0.2, 48),
  e('tuba', 'Tubă', 'brass', 'A', A('tuba'), 58, [29, 62], ['sus', 'stac'], ['imn', 'popular'], ['bass'], 0, 0.15, 36, 0, true),
  // ---- guitars & bass (GM)
  e('nylon_guitar', 'Chitară clasică', 'guitars', 'A', A('nylon_guitar'), 24, [34, 86], ['pick'], ['cantare', 'popular', 'worship', 'pop'], ['comp', 'melody'], -0.35, 0.14, 55),
  e('emily_guitar', 'Chitară acustică, ton cald (Emily)', 'guitars', 'A', A('emily_guitar'), 25, [40, 86], ['pick'], ['worship', 'pop', 'cantare', 'popular'], ['comp', 'melody'], -0.3, 0.14, 55),
  e('steel_guitar', 'Chitară acustică', 'guitars', 'B', GM(25), 25, [40, 88], ['strum', 'pick'], ['worship', 'pop', 'cantare', 'popular', 'rock'], ['comp', 'melody'], -0.3, 0.14, 55),
  e('clean_electric', 'Chitară electrică (clean)', 'guitars', 'B', GM(27), 27, [40, 88], ['strum', 'pick'], ['worship', 'pop', 'rock'], ['comp', 'melody', 'counter'], 0.3, 0.2, 60),
  e('ambient_electric', 'Chitară electrică ambientală', 'guitars', 'B', GM(28), 28, [40, 88], ['pick'], ['worship', 'pop'], ['pad', 'counter', 'fx'], 0.35, 0.35, 64),
  e('overdrive_guitar', 'Chitară overdrive', 'guitars', 'B', GM(29), 29, [40, 88], ['strum', 'pick'], ['rock', 'worship'], ['comp', 'lead'], 0.4, 0.15, 55),
  e('strumstick', 'Strumstick (chitară populară)', 'folk', 'A', A('strumstick'), 25, [50, 81], ['pluck'], ['popular', 'cantare', 'worship'], ['comp', 'melody'], -0.3, 0.14, 62),
  e('banjo', 'Banjo', 'folk', 'B', GM(105), 105, [48, 84], ['pluck'], ['popular'], ['comp', 'melody'], -0.25, 0.1, 62),
  e('acoustic_bass', 'Bas acustic', 'basses', 'B', GM(32), 32, [28, 60], ['sustain'], ['cantare', 'popular', 'pop', 'worship'], ['bass'], 0, 0.03, 40, 0, true),
  e('finger_bass', 'Bas electric (deget)', 'basses', 'B', GM(33), 33, [28, 60], ['sustain'], ['pop', 'rock', 'worship'], ['bass'], 0, 0.03, 40, 0, true),
  e('fretless_bass', 'Bas fretless', 'basses', 'B', GM(35), 35, [28, 60], ['sustain'], ['worship', 'pop'], ['bass'], 0, 0.04, 40, 0, true),
  // ---- choir
  e('choir_aahs', 'Cor – Aaa', 'choir', 'B', GM(52), 52, [48, 84], ['sustain'], ['imn', 'worship', 'cantare'], ['pad', 'counter'], 0, 0.35, 64),
  e('voice_oohs', 'Cor – Ooo', 'choir', 'B', GM(53), 53, [48, 84], ['sustain'], ['imn', 'worship'], ['pad'], 0, 0.35, 64),
  e('vowel_choir', 'Cor sintetic (vocale)', 'choir', 'C', SY('vowel_choir'), 52, [48, 84], ['aah', 'ooh', 'eeh'], ['worship', 'imn', 'cantare'], ['pad', 'fx'], 0, 0.4, 62),
  // ---- mallets & bells
  e('vibraphone', 'Vibrafon', 'mallets', 'A', A('vibraphone'), 11, [57, 88], ['soft', 'hard'], ['pop', 'worship'], ['comp', 'counter', 'melody'], 0.25, 0.25, 67),
  e('marimba', 'Marimba', 'mallets', 'A', A('marimba'), 12, [41, 84], ['hit'], ['pop', 'popular', 'worship'], ['comp', 'melody'], -0.2, 0.15, 60),
  e('glockenspiel', 'Clopoței (glockenspiel)', 'mallets', 'A', A('glockenspiel'), 9, [79, 108], ['hit'], ['worship', 'pop', 'imn'], ['fx', 'counter', 'melody'], 0.3, 0.3, 84),
  e('xylophone', 'Xilofon', 'mallets', 'A', A('xylophone'), 13, [67, 108], ['hit'], ['popular', 'pop'], ['melody', 'fx'], 0.25, 0.15, 79),
  e('tubular_bells', 'Clopote tubulare', 'mallets', 'A', A('tubular_bells'), 14, [67, 76], ['hit'], ['imn', 'worship', 'cantare'], ['fx'], 0, 0.35, 67),
  e('celesta', 'Celestă', 'mallets', 'B', GM(8), 8, [60, 96], ['hit'], ['worship', 'pop', 'imn'], ['fx', 'counter'], 0.3, 0.3, 84),
  e('music_box', 'Cutie muzicală', 'mallets', 'B', GM(10), 10, [60, 100], ['hit'], ['worship', 'pop'], ['fx'], 0.3, 0.3, 84),
  e('kalimba', 'Kalimba', 'mallets', 'A', A('kalimba'), 108, [59, 83], ['pluck'], ['pop', 'worship'], ['comp', 'fx'], 0.3, 0.25, 67),
  e('dulcimer', 'Țambal (aproximat)', 'folk', 'B', GM(15), 15, [48, 80], ['hit'], ['popular', 'cantare'], ['comp', 'melody', 'counter'], -0.2, 0.2, 67),
  e('psaltery', 'Psalterion', 'folk', 'A', A('psaltery'), 15, [70, 90], ['pluck', 'bow', 'spic'], ['popular', 'cantare', 'worship'], ['melody', 'counter'], 0.2, 0.25, 76),
  // ---- percussion (pitched + one-shot)
  e('timpani', 'Timpane', 'percussion', 'A', A('timpani'), 47, [35, 54], ['hit'], ['imn', 'worship', 'cantare'], ['perc', 'bass'], 0, 0.3, 43),
  e('frame_drum', 'Tobă pe ramă (daf)', 'percussion', 'A', A('frame_drum'), null, [60, 60], ['hit', 'muted', 'small'], ['popular', 'cantare', 'worship'], ['perc'], -0.2, 0.15, 60),
  e('cajon', 'Cajon', 'percussion', 'A', A('cajon'), null, [60, 60], ['bass', 'mid', 'slap'], ['worship', 'pop', 'cantare'], ['perc'], 0, 0.08, 60),
  e('darbuka', 'Darbuka', 'percussion', 'A', A('darbuka'), null, [60, 60], ['dum', 'tek', 'ka'], ['popular', 'cantare'], ['perc'], 0.2, 0.1, 60),
  e('conga', 'Conga', 'percussion', 'A', A('conga'), null, [60, 60], ['open', 'muted', 'tumba'], ['pop', 'worship'], ['perc'], 0.3, 0.1, 60),
  e('tambourine', 'Tamburină', 'percussion', 'A', A('tambourine'), null, [60, 60], ['hit', 'shake'], ['popular', 'cantare', 'pop', 'worship'], ['perc'], 0.35, 0.15, 60),
  e('shaker', 'Shaker', 'percussion', 'A', A('shaker'), null, [60, 60], ['down', 'up', 'slap'], ['pop', 'worship', 'popular'], ['perc'], -0.35, 0.1, 60),
  e('triangle', 'Triangel', 'percussion', 'A', A('triangle'), null, [60, 60], ['hit', 'muted'], ['imn', 'popular', 'worship'], ['perc', 'fx'], 0.4, 0.2, 60),
  e('sleigh_bells', 'Zurgălăi', 'percussion', 'A', A('sleigh_bells'), null, [60, 60], ['hit'], ['popular', 'worship'], ['perc', 'fx'], 0.4, 0.2, 60),
  e('cymbal', 'Talger suspendat', 'percussion', 'A', A('cymbal'), null, [60, 60], ['hit', 'bell'], ['worship', 'imn', 'pop'], ['perc', 'fx'], 0.1, 0.3, 60),
  e('concert_bass_drum', 'Toba mare', 'percussion', 'A', A('concert_bass_drum'), null, [60, 60], ['hit'], ['imn', 'worship'], ['perc'], 0, 0.3, 60),
  e('drum_kit', 'Tobe (set GM)', 'drums', 'B', { type: 'gm-drums' }, null, [35, 81], ['kit'], ['worship', 'pop', 'rock', 'cantare', 'popular'], ['perc'], 0, 0.1, 38),
  // ---- synthesized (Tone.js, zero assets; emotion-aware presets in synth.ts)
  e('warm_pad', 'Pad cald', 'synth', 'C', SY('warm_pad'), 89, [36, 96], ['pad'], ['worship', 'pop', 'imn', 'cantare'], ['pad'], 0, 0.4, 60),
  e('worship_swell', 'Pad cu creștere (swell)', 'synth', 'C', SY('worship_swell'), 94, [36, 96], ['swell'], ['worship'], ['pad', 'fx'], 0, 0.45, 60),
  e('ambient_texture', 'Textură ambientală', 'synth', 'C', SY('ambient_texture'), 99, [36, 96], ['texture'], ['worship', 'pop'], ['fx', 'pad'], 0, 0.5, 60),
  e('synth_bass', 'Bas sintetic', 'synth', 'C', SY('synth_bass'), 38, [24, 55], ['sub', 'saw'], ['pop', 'rock', 'worship'], ['bass'], 0, 0.02, 36, 0, true),
  e('arp_pluck', 'Arpegiator (pluck)', 'synth', 'C', SY('arp_pluck'), 98, [55, 96], ['pluck'], ['pop', 'worship'], ['comp', 'fx'], 0.3, 0.3, 72),
  e('bell_synth', 'Clopote sintetice', 'synth', 'C', SY('bell_synth'), 14, [60, 108], ['bell'], ['worship', 'pop', 'imn'], ['fx', 'counter'], 0.3, 0.4, 79),
  e('riser', 'Riser / tranziție', 'synth', 'C', SY('riser'), 95, [36, 96], ['riser', 'downlifter'], ['worship', 'pop', 'rock'], ['fx'], 0, 0.3, 60),
];

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
export const FAMILIES: Family[] = ['keys', 'organ', 'strings', 'woodwinds', 'brass', 'guitars', 'basses', 'folk', 'choir', 'synth', 'mallets', 'percussion', 'drums'];

export function getInstrument(id: string): CatalogEntry | undefined { return CATALOG_BY_ID[id]; }
export function byFamily(f: Family): CatalogEntry[] { return CATALOG.filter((c) => c.family === f); }
export function forGenre(g: Genre): CatalogEntry[] { return CATALOG.filter((c) => c.genres.includes(g)); }
export function forRole(r: Role): CatalogEntry[] { return CATALOG.filter((c) => c.roles.includes(r)); }
export function tierCounts(): Record<Tier, number> {
  const o: Record<Tier, number> = { A: 0, B: 0, C: 0 };
  for (const c of CATALOG) o[c.tier]++;
  return o;
}

/** Search by Romanian name, id or family (case and diacritics insensitive) for the picker. */
export function searchInstruments(q: string, list: CatalogEntry[] = CATALOG): CatalogEntry[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(q.trim());
  if (!n) return list;
  return list.filter((c) => norm(c.name).includes(n) || norm(c.id).includes(n) || c.family.includes(n));
}

/** Fold a MIDI note by octaves into the instrument range. */
export function clampToRange(entry: Pick<CatalogEntry, 'range'>, midi: number): number {
  const [lo, hi] = entry.range;
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return Math.min(hi, Math.max(lo, m));
}
export function inRange(entry: Pick<CatalogEntry, 'range'>, midi: number): boolean { return midi >= entry.range[0] && midi <= entry.range[1]; }
