import { t } from '../i18n/ro';
import { Brand } from './icons';

const DEPS: { name: string; license: string; url: string }[] = [
  { name: 'React', license: 'MIT', url: 'https://react.dev' },
  { name: 'Zustand', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Tone.js', license: 'MIT', url: 'https://tonejs.github.io' },
  { name: 'SpessaSynth (spessasynth_lib / spessasynth_core)', license: 'Apache 2.0', url: 'https://github.com/spessasus/spessasynth_lib' },
  { name: 'standardized-audio-context', license: 'MIT', url: 'https://github.com/chrisguttandin/standardized-audio-context' },
  { name: 'MuseScore General SoundFont', license: 'MIT', url: 'https://musescore.org/en/handbook/3/soundfonts-and-sfz-files#general' },
  { name: 'OpenSheetMusicDisplay (partitura)', license: 'BSD-3-Clause', url: 'https://github.com/opensheetmusicdisplay/opensheetmusicdisplay' },
  { name: 'VexFlow (folosit de OpenSheetMusicDisplay)', license: 'MIT', url: 'https://github.com/vexflow/vexflow' },
  { name: 'tonal', license: 'MIT', url: 'https://github.com/tonaljs/tonal' },
  { name: '@tonejs/midi', license: 'MIT', url: 'https://github.com/Tonejs/Midi' },
  { name: 'fft.js', license: 'MIT', url: 'https://github.com/indutny/fft.js' },
  { name: 'idb', license: 'ISC', url: 'https://github.com/jakearchibald/idb' },
  { name: 'Vite', license: 'MIT', url: 'https://vitejs.dev' },
  { name: 'Vitest', license: 'MIT', url: 'https://vitest.dev' },
  { name: 'Fraunces', license: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Fraunces' },
  { name: 'Bricolage Grotesque', license: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Bricolage+Grotesque' },
  { name: 'VoiceFixer (Restaurare AI, serviciul local) — Haohe Liu et al.', license: 'CC-BY-4.0', url: 'https://github.com/haoheliu/voicefixer' },
  { name: 'VSCO 2 Community Edition — Versilian Studios', license: 'CC0-1.0', url: 'https://github.com/sgossner/VSCO-2-CE' },
  { name: 'Versilian Community Sample Library (VCSL)', license: 'CC0-1.0', url: 'https://github.com/sgossner/VCSL' },
  { name: 'Groove MIDI Dataset — Gillick, Roberts, Engel, Eck, Bamman (Google Magenta)', license: 'CC-BY-4.0', url: 'https://magenta.tensorflow.org/datasets/groove' },
  { name: 'FreePats — Button Accordion HN, Spanish Classical Guitar', license: 'CC0-1.0', url: 'https://freepats.zenvoid.org' },
  { name: 'Karoryfer Samples — Emilyguitar, Karoryfer x Bigcat Cello', license: 'CC0-1.0', url: 'https://github.com/sfzinstruments' },
  { name: 'JetBrains Mono', license: 'SIL OFL 1.1', url: 'https://www.jetbrains.com/lp/mono/' },
];

export function About() {
  return (
    <div className="page about">
      <div className="page-head">
        <a className="back" href="#/">{t.nav.projects}</a>
        <h1 className="about-title"><Brand size={34} />{t.about.title}</h1>
        <p className="lede">{t.about.lede}</p>
      </div>

      <section className="form-block">
        <h2>{t.about.noAiTitle}</h2>
        <p>{t.about.noAiBody}</p>
      </section>

      <section className="form-block">
        <h2>{t.about.samplesTitle}</h2>
        <p>{t.about.samplesBody}</p>
        <p className="attribution">
          Salamander Grand Piano by Alexander Holm, licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>.
          Samples as distributed with Tone.js (<a href="https://tonejs.github.io/audio/salamander/" target="_blank" rel="noreferrer">tonejs.github.io/audio/salamander</a>),
          reduced to every minor third (A1 – C6) and played back with pitch-shifting.
        </p>
      </section>

      <section className="form-block">
        <h2>{t.about.sfTitle}</h2>
        <p>{t.about.sfBody}</p>
        <p className="attribution">
          MuseScore_General.sf3 (v0.2) — Copyright (c) 2018-2020 S. Christian Collins; based on FluidR3Mono, Copyright (c) 2014-17 Michael Cowgill,
          and FluidR3, Copyright (c) 2000-2002, 2008 Frank Wen. Temple Blocks by Ethan Winer (c) 2002; Drumline Cymbals by Michael Schorsch (c) 2016.
          Shared under the <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT license</a>:
          permission is granted to use, copy, modify, merge, publish, distribute, sublicense and/or sell copies, provided the copyright notice and
          the permission notice are included in all copies. The software is provided “as is”, without warranty of any kind.
          Full text: <a href="soundfonts/MuseScore_General_License.md" target="_blank" rel="noreferrer">MuseScore_General_License.md</a>.
        </p>
      </section>

      <section className="form-block">
        <h2>{t.about.libsTitle}</h2>
        <p className="hint">{t.about.libsBody}</p>
        <table className="licenses">
          <thead><tr><th scope="col">{t.about.colName}</th><th scope="col">{t.about.colLicense}</th></tr></thead>
          <tbody>
            {DEPS.map((d) => (
              <tr key={d.name}><td><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></td><td>{d.license}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="form-block">
        <h2>{t.about.privacyTitle}</h2>
        <p>{t.about.privacyBody}</p>
      </section>
    </div>
  );
}
