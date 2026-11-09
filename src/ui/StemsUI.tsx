import { useEffect, useRef, useState } from 'react';
import { fillDownbeats } from '../dsp/beatMap';
import { gridFromBars, type TapGrid } from '../dsp/tapGrid';
import type { SeparateResult, SongAnalysis } from '../ai/types';
import { ai, aiMessage } from '../store/ai';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { Progress } from './common';

const STEM_LABEL: Record<string, string> = { vocals: 'Voce', no_vocals: 'Minus (fără voce)', drums: 'Tobe', bass: 'Bas', other: 'Restul' };

/** After "Importă cântec întreg": stems player, "Minus din original", "Cântă peste original", practice (transpose / tempo / loop) and "Învață din cântec". */
export function SongPractice({ result, vocals, source, onVocals }: { result: SeparateResult; vocals: File; source: File; onVocals(f: File, grid?: TapGrid): void }) {
  const stemKeys = Object.keys(result.stems).filter((k) => k !== 'accompaniment');
  const [stems, setStems] = useState<string[]>(stemKeys.includes('no_vocals') ? ['no_vocals'] : stemKeys);
  const [semis, setSemis] = useState(0);
  const [tempo, setTempo] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [mine, setMine] = useState<File | null>(null);
  const [learn, setLearn] = useState<SongAnalysis | null>(null);
  const [learning, setLearning] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const mix = (list: string[]) => ai.practice({ cacheKey: result.cacheKey, stems: list, semitones: semis, tempo });
  const show = (b: Blob) => setUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(b); });
  const prepare = async () => {
    setBusy(true); setErr('');
    try { show(await mix(stems)); } catch (e) { setErr(aiMessage(e)); } finally { setBusy(false); }
  };
  const toggle = (k: string) => setStems((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const onTime = () => { const a = audio.current; if (a && loopA != null && loopB != null && loopB > loopA && a.currentTime >= loopB) a.currentTime = loopA; };

  const minus = async () => {
    setErr('');
    try {
      const b = await mix(['no_vocals']);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'minus-din-original.wav'; a.click();
    } catch (e) { setErr(aiMessage(e)); }
  };

  const singOver = async () => {
    if (rec) { rec.stop(); audio.current?.pause(); return; }
    setErr(''); setMine(null);
    try {
      setStems(['no_vocals']);
      setBusy(true);
      show(await mix(['no_vocals']));
      setBusy(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setMine(new File(chunks, 'cant-peste-original.webm', { type: mr.mimeType || 'audio/webm' })); setRec(null); };
      mr.start();
      setRec(mr);
      setTimeout(() => { const a = audio.current; if (a) { a.currentTime = 0; void a.play(); } }, 120);
    } catch (e) { setBusy(false); setErr(e instanceof DOMException ? t.ai.micDenied : aiMessage(e)); }
  };

  const learnIt = async () => {
    setLearning(true); setErr('');
    try { setLearn(await ai.analyzeSong({ audio: source })); } catch (e) { setErr(aiMessage(e)); } // a two-stem cache key cannot be analysed: the service needs all four stems
    setLearning(false);
  };
  const learnGrid = (): TapGrid | undefined => {
    const r = learn?.rhythm;
    if (!r?.ok || r.downbeats.length < 3) return undefined;
    return gridFromBars(fillDownbeats(r.downbeats), r.beats_per_bar) ?? undefined;
  };
  const chordText = learn?.chords.ok ? learn.chords.chords.slice(0, 12).map((c) => c.chord).join(' · ') : '';

  return (
    <div className="song-practice" data-testid="song-practice">
      <h3>{t.ai.practiceTitle}</h3>
      <div className="field"><span className="label">{t.ai.stems}</span>
        <div className="picker-scope" role="group" aria-label={t.ai.stems}>
          {stemKeys.map((k) => <button key={k} className={`chip-btn ${stems.includes(k) ? 'on' : ''}`} aria-pressed={stems.includes(k)} onClick={() => toggle(k)}>{STEM_LABEL[k] ?? k}</button>)}
        </div>
      </div>
      <div className="field-row">
        <label className="field"><span className="label">{t.ai.transpose}: {semis > 0 ? '+' : ''}{semis}</span><input type="range" min={-6} max={6} step={1} value={semis} onChange={(e) => setSemis(+e.target.value)} aria-label={t.ai.transpose} /></label>
        <label className="field"><span className="label">{t.ai.tempoLbl}: {Math.round(tempo * 100)}%</span><input type="range" min={0.7} max={1.2} step={0.05} value={tempo} onChange={(e) => setTempo(+e.target.value)} aria-label={t.ai.tempoLbl} /></label>
      </div>
      {busy ? <Progress label={t.ai.preparing} /> : (
        <div className="big-actions">
          <button className="btn btn-primary" data-testid="practice-make" disabled={!stems.length} onClick={() => void prepare()}><Icon name="play" size={16} />{t.ai.prepare}</button>
          <button className="btn btn-ghost" data-testid="minus-original" onClick={() => void minus()}><Icon name="download" size={16} />{t.ai.minusOriginal}</button>
          <button className={`btn ${rec ? 'btn-primary' : 'btn-ghost'}`} data-testid="sing-over" onClick={() => void singOver()}><Icon name={rec ? 'stop' : 'mic'} size={16} />{rec ? t.ai.stopRec : t.ai.singOver}</button>
        </div>
      )}
      {url && (
        <div className="field">
          <audio ref={audio} src={url} controls onTimeUpdate={onTime} data-testid="practice-audio" style={{ width: '100%' }} />
          <div className="big-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => setLoopA(audio.current?.currentTime ?? null)}>A: {loopA == null ? '–' : loopA.toFixed(1) + ' s'}</button>
            <button className="btn btn-quiet btn-sm" onClick={() => setLoopB(audio.current?.currentTime ?? null)}>B: {loopB == null ? '–' : loopB.toFixed(1) + ' s'}</button>
            <button className="btn btn-quiet btn-sm" onClick={() => { setLoopA(null); setLoopB(null); }}>{t.ai.loopOff}</button>
          </div>
        </div>
      )}
      {rec && <p className="notice" role="status">{t.ai.singHint}</p>}
      {mine && <div className="ai-result"><p className="hint ok-line">{t.ai.singDone}</p><button className="btn btn-primary" onClick={() => onVocals(mine)}>{t.ai.useMine}</button></div>}
      <h3>{t.ai.learnTitle}</h3>
      <p className="hint">{t.ai.learnBody}</p>
      {learning ? <Progress label={t.ai.learning} /> : <button className="btn btn-ghost" data-testid="learn-song" onClick={() => void learnIt()}><Icon name="wand" size={16} />{t.ai.learn}</button>}
      {learn && (
        <div className="ai-result" data-testid="learn-result">
          <p>{t.ai.learned(`${learn.key.key} ${learn.key.mode === 'minor' ? 'minor' : 'major'}`, Math.round(learn.rhythm.bpm), learn.rhythm.beats_per_bar)}</p>
          {chordText && <p className="hint">{chordText}</p>}
          <button className="btn btn-primary" onClick={() => onVocals(vocals, learnGrid())}>{t.ai.useVocalsGrid}</button>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

/** Batch import: a local folder of songs; the service keeps statistics only. */
export function BatchPanel() {
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await ai.batch(folder.trim());
      setMsg(t.ai.batchDone(r.songs.length, r.songs.filter((s) => s.error).length));
    } catch (e) { setMsg(aiMessage(e)); }
    setBusy(false);
  };
  return (
    <details className="batch" data-testid="batch">
      <summary>{t.ai.batchTitle}</summary>
      <p className="hint">{t.ai.batchBody}</p>
      <label className="field"><span className="label">{t.ai.batchFolder}</span><input type="text" value={folder} placeholder="D:\Muzica\cantari" onChange={(e) => setFolder(e.target.value)} /></label>
      {busy ? <Progress label={t.ai.batchRunning} /> : <button className="btn btn-ghost" disabled={!folder.trim()} onClick={() => void run()}>{t.ai.batchRun}</button>}
      {msg && <p className="hint" role="status">{msg}</p>}
    </details>
  );
}
