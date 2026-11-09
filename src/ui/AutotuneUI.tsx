import { useEffect, useRef, useState } from 'react';
import { autotune, DEFAULT_AUTOTUNE } from '../dsp/autotune';
import { encodeWav } from '../music/wav';
import { loadAudio } from '../store/audioCache';
import { makeTake } from '../store/rec';
import { activeTake, selectedSection, useApp } from '../store/store';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { Progress } from './common';

type Ab = 'orig' | 'tuned';

/** Voce › Autotune: pull the sung notes towards the key, with strength, speed, kept vibrato and humanize; A/B before saving a new take. */
export function AutotuneView() {
  const sec = useApp(selectedSection);
  const key = useApp((s) => s.project?.key ?? null);
  const take = sec ? activeTake(sec) : null;
  const [strength, setStrength] = useState(Math.round(DEFAULT_AUTOTUNE.strength * 100));
  const [speed, setSpeed] = useState(DEFAULT_AUTOTUNE.speedMs);
  const [vib, setVib] = useState(Math.round(DEFAULT_AUTOTUNE.keepVibrato * 100));
  const [human, setHuman] = useState(Math.round(DEFAULT_AUTOTUNE.humanize * 100));
  const [chromatic, setChromatic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ tuned: Float32Array; orig: Float32Array; sr: number; urls: Record<Ab, string>; meanShift: number } | null>(null);
  const [ab, setAb] = useState<Ab>('tuned');
  const [saved, setSaved] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  useEffect(() => () => { if (res) { URL.revokeObjectURL(res.urls.orig); URL.revokeObjectURL(res.urls.tuned); } }, [res]);
  useEffect(() => { setRes(null); setSaved(false); }, [take?.id]);

  if (!sec || !take) return <section className="panel"><p className="lede" data-testid="autotune-need">{t.autotune.need}</p></section>;

  const run = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try {
      const a = await loadAudio(take.cleanAudioId ?? take.rawAudioId);
      if (!a) throw new Error('audio');
      await new Promise((r) => setTimeout(r, 30)); // let the progress bar paint before the heavy loop
      const out = autotune(a.data, a.sr, { key: chromatic ? null : key, strength: strength / 100, speedMs: speed, keepVibrato: vib / 100, humanize: human / 100 });
      const voiced = Math.max(1, out.voicedFrames);
      const meanShift = Array.from(out.shiftCents).reduce((s, v) => s + Math.abs(v), 0) / voiced;
      const mk = (x: Float32Array) => URL.createObjectURL(new Blob([encodeWav(x, a.sr)], { type: 'audio/wav' }));
      setRes((old) => { if (old) { URL.revokeObjectURL(old.urls.orig); URL.revokeObjectURL(old.urls.tuned); } return { tuned: out.audio, orig: a.data, sr: a.sr, urls: { orig: mk(a.data), tuned: mk(out.audio) }, meanShift }; });
      setAb('tuned');
    } catch { setErr(t.autotune.fail); }
    setBusy(false);
  };
  const flip = (to: Ab) => {
    const el = player.current;
    const at = el?.currentTime ?? 0, was = el ? !el.paused : false;
    setAb(to);
    requestAnimationFrame(() => { const e = player.current; if (!e) return; e.currentTime = at; if (was) void e.play(); });
  };
  const save = async () => {
    if (!res) return;
    await makeTake(sec.id, res.tuned, res.sr, 'import', take.latencyMs, t.autotune.takeLabel);
    setSaved(true);
  };
  const Slider = ({ id, label, value, set, min, max, step, unit }: { id: string; label: string; value: number; set(v: number): void; min: number; max: number; step: number; unit: string }) => (
    <label className="field"><span className="label">{label}: {value}{unit}</span><input type="range" data-testid={id} min={min} max={max} step={step} value={value} onChange={(e) => set(+e.target.value)} aria-label={label} /></label>
  );

  return (
    <section className="panel big-step" data-testid="autotune-view">
      <h2>{t.autotune.title}</h2>
      <p className="lede">{key ? t.autotune.lede : t.autotune.ledeNoKey}</p>
      <div className="field-row">
        <Slider id="at-strength" label={t.autotune.strength} value={strength} set={setStrength} min={0} max={100} step={5} unit="%" />
        <Slider id="at-speed" label={t.autotune.speed} value={speed} set={setSpeed} min={0} max={200} step={5} unit=" ms" />
      </div>
      <div className="field-row">
        <Slider id="at-vibrato" label={t.autotune.vibrato} value={vib} set={setVib} min={0} max={100} step={5} unit="%" />
        <Slider id="at-human" label={t.autotune.humanize} value={human} set={setHuman} min={0} max={100} step={5} unit="%" />
      </div>
      <label className="check-row"><input type="checkbox" checked={chromatic || !key} disabled={!key} onChange={(e) => setChromatic(e.target.checked)} />{t.autotune.chromatic}</label>
      <p className="hint">{t.autotune.hint}</p>
      {busy ? <Progress label={t.autotune.working} /> : <div className="big-actions"><button className="btn btn-primary btn-lg" data-testid="at-run" onClick={() => void run()}><Icon name="wand" size={18} />{res ? t.autotune.again : t.autotune.run}</button></div>}
      {res && (
        <div className="ai-result" data-testid="at-result">
          <div className="seg" role="group" aria-label={t.ai.compare}>
            <button className={ab === 'orig' ? 'on' : ''} aria-pressed={ab === 'orig'} onClick={() => flip('orig')}>{t.autotune.orig}</button>
            <button className={ab === 'tuned' ? 'on' : ''} aria-pressed={ab === 'tuned'} data-testid="at-ab-tuned" onClick={() => flip('tuned')}>{t.autotune.tuned}</button>
          </div>
          <audio ref={player} src={res.urls[ab]} controls style={{ width: '100%' }} data-testid="at-audio" />
          <p className="hint">{t.autotune.stats(Math.round(res.meanShift))}</p>
          {saved ? <p className="hint ok-line"><Icon name="check" size={14} />{t.autotune.saved}</p> : <button className="btn btn-primary" data-testid="at-save" onClick={() => void save()}>{t.autotune.save}</button>}
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </section>
  );
}
