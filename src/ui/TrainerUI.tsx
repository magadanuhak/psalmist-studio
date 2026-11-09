import { useEffect, useRef } from 'react';
import { getMicSession, useRec } from '../store/rec';
import { useTrainer } from '../store/trainer';
import { activeTake, selectedSection, useApp } from '../store/store';
import { detectPitch, hzToMidi } from '../dsp/livePitch';
import { INTERVALS, PitchSmoother, type ExerciseKind, type Target } from '../music/trainer';
import { midiName } from '../music/theory';
import { t } from '../i18n/ro';
import { Icon } from './icons';

const KINDS: ExerciseKind[] = ['hold', 'scale', 'interval', 'song'];
const REGISTERS = [{ k: 'low', anchor: 48 }, { k: 'mid', anchor: 57 }, { k: 'high', anchor: 64 }] as const;
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
const css = (n: string, d: string) => (typeof document === 'undefined' ? d : getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);

const foldTo = (m: number, center: number) => m + 12 * Math.round((center - m) / 12);
const centsFrom = (m: number, target: number, free: boolean) => { let d = (m - target) * 100; if (free) d = ((((d + 600) % 1200) + 1200) % 1200) - 600; return d; };

/** Draws the lanes, the scrolling target bars and the singer's live pitch trail. Pure drawing; state comes from the trainer store. */
function draw(c: HTMLCanvasElement) {
  const st = useTrainer.getState();
  const ex = st.exercise ?? st.build();
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gold = css('--gold', '#f2b441'), paper = css('--paper', '#f4efe4'), mute = css('--paper-mute', '#9aa0b8');
  g.clearRect(0, 0, w, h);
  const targets: Target[] = ex?.targets ?? [];
  const mids = targets.length ? targets.map((x) => x.midi) : [st.holdMidi];
  const centre = Math.round((Math.min(...mids) + Math.max(...mids)) / 2);
  const span = Math.max(14, Math.max(...mids) - Math.min(...mids) + 8);
  const lo = centre - Math.floor(span / 2), hi = lo + span;
  const gutter = w < 480 ? 34 : 46, nowX = gutter + (w - gutter) * 0.24;
  const rowH = h / (hi - lo + 1);
  const yOf = (m: number) => h - (m - lo + 0.5) * rowH;
  const tNow = st.status === 'idle' || st.status === 'done' ? (st.status === 'done' && ex ? ex.totalSec : -3) : (performance.now() - st.t0) / 1000;
  const pps = (w - nowX) / 4.4;
  const xOf = (tt: number) => nowX + (tt - tNow) * pps;
  const fontPx = w < 480 ? 10 : 11;
  g.font = `600 ${fontPx}px ${css('--font-ui', 'system-ui')}`;
  g.textBaseline = 'middle';
  for (let m = lo; m <= hi; m++) {
    const y = yOf(m), nat = NATURAL.has(((m % 12) + 12) % 12);
    g.fillStyle = nat ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.015)';
    g.fillRect(gutter, y - rowH / 2 + 0.5, w - gutter, rowH - 1);
    if (nat) { g.fillStyle = m % 12 === 0 ? paper : mute; g.textAlign = 'right'; g.fillText(midiName(m, 'solfege'), gutter - 6, y); }
  }
  // targets
  const free = st.octaveFree;
  for (const tg of targets) {
    const x0 = xOf(tg.startSec), x1 = xOf(tg.startSec + tg.durSec);
    if (x1 < gutter || x0 > w) continue;
    const y = yOf(tg.midi), bh = Math.max(8, rowH * 0.72);
    const active = tNow >= tg.startSec && tNow < tg.startSec + tg.durSec;
    g.fillStyle = active ? gold : 'rgba(242,180,65,0.55)';
    g.beginPath(); g.roundRect(Math.max(gutter, x0), y - bh / 2, Math.max(4, x1 - Math.max(gutter, x0) - 2), bh, 5); g.fill();
  }
  // the singer's trail, green where it sits on the active target
  const trail = st.trail;
  if (trail.length > 1) {
    g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (a.midi == null || b.midi == null || b.t - a.t > 0.12) continue;
      const x0 = xOf(a.t), x1 = xOf(b.t);
      if (x1 < gutter) continue;
      const tg = targets.find((x) => b.t >= x.startSec && b.t < x.startSec + x.durSec);
      const ok = !!tg && Math.abs(centsFrom(b.midi, tg.midi, free)) <= 50;
      const dm = (m: number) => (free && tg ? foldTo(m, tg.midi) : m);
      g.strokeStyle = ok ? '#7fe0a6' : paper;
      g.beginPath(); g.moveTo(Math.max(gutter, x0), yOf(dm(a.midi))); g.lineTo(x1, yOf(dm(b.midi))); g.stroke();
    }
  }
  // now line + live dot
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(nowX, 0); g.lineTo(nowX, h); g.stroke(); g.setLineDash([]);
  if (st.live != null) {
    const tg = targets.find((x) => tNow >= x.startSec && tNow < x.startSec + x.durSec);
    const dm = free && tg ? foldTo(st.live, tg.midi) : st.live;
    const ok = !!tg && Math.abs(centsFrom(st.live, tg.midi, free)) <= 50;
    g.fillStyle = ok ? '#7fe0a6' : paper;
    g.shadowColor = ok ? '#7fe0a6' : gold; g.shadowBlur = 14;
    g.beginPath(); g.arc(nowX, yOf(Math.max(lo, Math.min(hi, dm))), 7, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
  if (st.status === 'countdown') {
    const left = Math.ceil(-tNow);
    g.fillStyle = paper; g.font = `800 ${Math.round(h * 0.34)}px ${css('--font-display', 'serif')}`; g.textAlign = 'center';
    g.globalAlpha = 0.85; g.fillText(String(Math.max(1, left)), w / 2 + gutter / 2, h / 2); g.globalAlpha = 1;
  }
}

/** Needle: how far the voice is from the nearest note (or the active target), in cents. */
function Tuner() {
  const live = useTrainer((s) => s.live);
  const kind = useTrainer((s) => s.kind);
  const holdMidi = useTrainer((s) => s.holdMidi);
  const free = useTrainer((s) => s.octaveFree);
  if (live == null) return <div className="tuner idle" data-testid="tuner" aria-live="off"><span className="tuner-note">–</span><span className="tuner-cents">{t.trainer.singNow}</span></div>;
  const target = kind === 'hold' ? holdMidi : Math.round(live);
  const c = Math.max(-100, Math.min(100, centsFrom(live, target, free)));
  const ok = Math.abs(c) <= 25;
  return (
    <div className={`tuner ${ok ? 'ok' : ''}`} data-testid="tuner" aria-live="off">
      <span className="tuner-note">{midiName(target, 'solfege')}</span>
      <span className="tuner-meter" role="img" aria-label={`${Math.round(c)} cents`}><i style={{ left: `${50 + c / 2}%` }} /></span>
      <span className="tuner-cents">{c > 0 ? '+' : ''}{Math.round(c)} ¢</span>
    </div>
  );
}

/** Voce › Antrenament voce */
export function TrainerView() {
  const s = useTrainer();
  const mic = useRec();
  const sec = useApp(selectedSection);
  const hasSong = !!sec && (activeTake(sec)?.notesCorrected.length ?? 0) > 0;
  const canvas = useRef<HTMLCanvasElement>(null);
  const smooth = useRef(new PitchSmoother(3));
  const busy = s.status === 'countdown' || s.status === 'running';

  // live loop: microphone frame -> pitch -> store; the canvas repaints every animation frame
  useEffect(() => {
    let raf = 0, last = 0, alive = true;
    const tick = (now: number) => {
      if (!alive) return;
      const st = useTrainer.getState();
      if (!st.external && now - last >= 20) {
        last = now;
        const ms = getMicSession();
        if (ms) {
          const f = ms.frame();
          const p = detectPitch(f.data, f.sr);
          const m = smooth.current.push(p && p.clarity > 0.8 ? hzToMidi(p.hz) : null);
          st.pushFrame((performance.now() - st.t0) / 1000, m);
        }
      }
      if (canvas.current) draw(canvas.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); useTrainer.getState().stop(); };
  }, []);

  const score = s.score;
  const label = (k: ExerciseKind) => t.trainer.kinds[k];
  return (
    <section className="panel trainer" data-testid="trainer-view" aria-label={t.trainer.title}>
      <div className="panel-head"><h2>{t.trainer.title}</h2></div>
      <div className="seg trainer-kinds" role="group" aria-label={t.trainer.kindsLabel}>
        {KINDS.map((k) => <button key={k} className={s.kind === k ? 'on' : ''} aria-pressed={s.kind === k} disabled={busy} data-testid={`tr-kind-${k}`} onClick={() => s.set({ kind: k })}>{label(k)}</button>)}
      </div>
      <p className="hint trainer-lede">{t.trainer.lede[s.kind]}</p>

      <div className="trainer-params">
        {s.kind === 'hold' && (
          <div className="stepper" role="group" aria-label={t.trainer.note}>
            <button className="icon-btn" disabled={busy} onClick={() => s.set({ holdMidi: s.holdMidi - 1 })} aria-label={t.trainer.lower}>−</button>
            <strong data-testid="tr-hold-note">{midiName(s.holdMidi, 'solfege')}</strong>
            <button className="icon-btn" disabled={busy} onClick={() => s.set({ holdMidi: s.holdMidi + 1 })} aria-label={t.trainer.higher}>+</button>
          </div>
        )}
        {(s.kind === 'scale' || s.kind === 'interval') && (
          <div className="seg" role="group" aria-label={t.trainer.register}>
            {REGISTERS.map((r) => <button key={r.k} className={s.anchor === r.anchor ? 'on' : ''} aria-pressed={s.anchor === r.anchor} disabled={busy} onClick={() => s.set({ anchor: r.anchor })}>{t.trainer.registers[r.k]}</button>)}
          </div>
        )}
        {s.kind === 'interval' && (
          <>
            <select aria-label={t.trainer.interval} disabled={busy} value={s.intervalIdx} data-testid="tr-interval" onChange={(e) => s.set({ intervalIdx: +e.target.value })}>
              {INTERVALS.map((iv, i) => <option key={iv.semis} value={i}>{iv.name}</option>)}
            </select>
            <div className="seg" role="group" aria-label={t.trainer.direction}>
              <button className={s.intervalDir === 1 ? 'on' : ''} aria-pressed={s.intervalDir === 1} disabled={busy} onClick={() => s.set({ intervalDir: 1 })}>{t.trainer.up}</button>
              <button className={s.intervalDir === -1 ? 'on' : ''} aria-pressed={s.intervalDir === -1} disabled={busy} onClick={() => s.set({ intervalDir: -1 })}>{t.trainer.down}</button>
            </div>
          </>
        )}
        {s.kind === 'song' && !hasSong && <p className="notice" data-testid="tr-song-empty">{t.trainer.songEmpty}</p>}
      </div>

      <div className="trainer-stage">
        <canvas ref={canvas} data-testid="trainer-canvas" role="img" aria-label={t.trainer.stageLabel} />
      </div>
      <Tuner />

      <div className="trainer-actions">
        {busy
          ? <button className="btn btn-primary btn-lg" data-testid="tr-stop" onClick={() => s.stop()}><Icon name="stop" size={18} />{t.trainer.stop}</button>
          : <button className="btn btn-primary btn-lg" data-testid="tr-start" disabled={s.kind === 'song' && !hasSong} onClick={() => void s.start()}><Icon name="mic" size={18} />{score ? t.trainer.again : t.trainer.start}</button>}
        <label className="check-row"><input type="checkbox" checked={s.guide} disabled={busy} onChange={(e) => s.set({ guide: e.target.checked })} />{t.trainer.guide}</label>
        <label className="check-row"><input type="checkbox" checked={s.octaveFree} disabled={busy} onChange={(e) => s.set({ octaveFree: e.target.checked })} />{t.trainer.octaveFree}</label>
      </div>
      {mic.error && <p className="form-error" role="alert">{mic.error}</p>}
      <p className="hint">{t.trainer.headphones}</p>

      {s.status === 'done' && score && (
        <div className="trainer-result" data-testid="tr-result" role="status">
          <div className="score-big"><strong data-testid="tr-score">{score.total}</strong><span>/ 100</span></div>
          <div className="stars" aria-label={t.trainer.stars(score.stars)}>{[0, 1, 2].map((i) => <svg key={i} viewBox="0 0 24 24" width="28" height="28" className={i < score.stars ? 'on' : ''} aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.2 1.2-6.5L2.5 9.5l6.6-.9z" /></svg>)}</div>
          <p className="hint">{score.meanAbsCents != null ? t.trainer.meanCents(Math.round(score.meanAbsCents)) : t.trainer.noVoice}</p>
          <div className="note-ribbon" aria-label={t.trainer.perNote}>{score.notes.map((n, i) => <i key={i} title={`${midiName(n.target.midi, 'solfege')}: ${n.score}%`} style={{ height: `${Math.max(6, n.score)}%`, opacity: 0.4 + n.score / 170 }} className={n.score >= 70 ? 'hit' : n.score >= 40 ? 'near' : 'miss'} />)}</div>
        </div>
      )}
    </section>
  );
}
