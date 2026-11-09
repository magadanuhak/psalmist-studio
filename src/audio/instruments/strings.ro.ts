/** Romanian UI strings for the instrument layer (the integrator may merge these into src/i18n/ro.ts). */
import type { Family, Tier } from './types';

export const FAMILY_RO: Record<Family, string> = {
  keys: 'Claviaturi', organ: 'Orgă', strings: 'Coarde', woodwinds: 'Suflători (lemn)', brass: 'Alămuri', guitars: 'Chitări',
  basses: 'Bași', folk: 'Populare', choir: 'Cor', synth: 'Sintetizatoare', mallets: 'Clopoței și mallets', percussion: 'Percuție', drums: 'Tobe',
};

export const TIER_RO: Record<Tier, { label: string; hint: string }> = {
  A: { label: 'Înregistrări reale', hint: 'Mostre reale (licență liberă), se descarcă la prima folosire' },
  B: { label: 'SoundFont', hint: 'Sunet General MIDI, disponibil imediat' },
  C: { label: 'Sintetizat', hint: 'Generat în aplicație, fără descărcări' },
};

export const ARTICULATION_RO: Record<string, string> = {
  sus: 'Legato', sustain: 'Susținut', vib: 'Vibrato', pizz: 'Pizzicato', trem: 'Tremolo', spic: 'Spiccato', stac: 'Staccato', mute: 'Surdină',
  pluck: 'Ciupit', hit: 'Lovit', full: 'Plin', soft: 'Blând', hard: 'Tare', bow: 'Arcuș', flute8: 'Flaut 8\'', strum: 'Strumming', pick: 'Pană',
  bass: 'Bas', mid: 'Mijloc', slap: 'Palmă', open: 'Deschis', muted: 'Surdinizat', tumba: 'Tumba', shake: 'Scuturat', down: 'Jos', up: 'Sus',
  dum: 'Dum', tek: 'Tek', ka: 'Ka', small: 'Mică', bell: 'Clopoțel', kit: 'Set', pad: 'Pad', swell: 'Creștere', texture: 'Textură', sub: 'Sub', saw: 'Fierăstrău',
  aah: 'Aaa', ooh: 'Ooo', eeh: 'Eee', riser: 'Ridicare', downlifter: 'Coborâre',
};

export const SPACE_RO: Record<string, string> = { studio: 'Studio', capela: 'Capelă', biserica: 'Biserică', catedrala: 'Catedrală', sala: 'Sală' };

export const PICKER_RO = {
  title: 'Alege instrumentul', search: 'Caută instrument…', inSong: 'În cântec', all: 'Toate', preview: 'Ascultă', loading: 'Se încarcă…',
  loadFailed: 'Nu am putut încărca instrumentul. Folosesc varianta simplă.', yours: 'Instrumentul tău', favorites: 'Preferate',
  progress: (pct: number) => `Se descarcă… ${Math.round(pct)}%`,
};

export const YOURS_RO = {
  title: 'Instrumentul tău',
  intro: 'Înregistrează câteva note ale instrumentului tău, pe rând. Aplicația le taie, le egalizează și face din ele un instrument pe care îl poți folosi în orice piesă.',
  step: (i: number, n: number) => `Nota ${i} din ${n}`,
  prompt: (note: string) => `Cântă ${note}, o notă lungă și clară.`,
  record: 'Înregistrează', stop: 'Oprește', skip: 'Sari peste', import: 'Importă fișier', retake: 'Reia',
  detected: (note: string, cents: number) => `Am recunoscut ${note} (${cents >= 0 ? '+' : ''}${Math.round(cents)} cenți)`,
  tooShort: 'Nota e prea scurtă. Ține-o cel puțin o jumătate de secundă.',
  tooQuiet: 'Nota e prea încet. Apropie-te de microfon.',
  noPitch: 'Nu am recunoscut o notă clară. Încearcă o notă singură, fără zgomot.',
  duplicate: 'Ai deja această notă. Am păstrat varianta mai clară.',
  needMore: (n: number) => `Mai sunt necesare cel puțin ${n} note.`,
  name: 'Numele instrumentului', save: 'Salvează instrumentul', saved: 'Instrument salvat.', delete: 'Șterge instrumentul',
  confirmDelete: 'Ștergi acest instrument? Nu se poate anula.',
  defaultName: 'Instrumentul meu',
};

const NAMES_RO = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
/** Solfege name with octave, C4 = MIDI 60 (Do4). */
export function noteNameRo(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES_RO[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
