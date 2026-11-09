import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent } from 'react';
import { activeTake, currentSection, selectedSection, useApp } from '../store/store';
import { DEFAULT_VOL, levelOf, selectedStart, timelineLength, usePlayer } from '../store/player';
import { arrangementFor, arrangementSettings, songLayout } from '../store/arrangeInput';
import { engine } from '../audio/engine';
import { t } from '../i18n/ro';
import { SECTION_COLOR } from '../model/presets';
import { barSec, beatSec } from '../music/timesig';
import { Icon } from './icons';

export const formatClock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

function useEngine<T>(get: () => T): T {
  // snapshot must be referentially stable: serialise primitives
  return useSyncExternalStore((cb) => engine.subscribe(cb), get);
}

/** requestAnimationFrame clock while playing */
function usePosition(): number {
  const [, force] = useState(0);
  const playing = useEngine(() => engine.playing);
  useEffect(() => {
    let id = 0;
    const tick = () => { force((n) => n + 1); if (engine.playing) id = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(id);
  }, [playing]);
  return engine.position();
}

function Timeline({ scope, total }: { scope: 'section' | 'song'; total: number }) {
  const project = useApp((s) => s.project)!;
  const sectionId = useApp((s) => s.sectionId);
  const playing = useEngine(() => engine.playing);
  const seek = usePlayer((s) => s.seek);
  const live = usePosition();
  const [scrub, setScrub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pos = scrub ?? live;
  const lay = useMemo(() => songLayout(project), [project]);
  const segs = scope === 'song'
    ? lay.sections
    : (() => { const s = lay.sections.find((x) => x.id === sectionId); return s ? [{ ...s, startSec: 0, durSec: total }] : []; })();
  const bar = barSec(project.bpm, project.timeSig);
  const pct = (sec: number) => `${total > 0 ? Math.max(0, Math.min(100, (sec / total) * 100)) : 0}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total));
  };
  const onKey = (e: RKeyboardEvent) => {
    const step = e.shiftKey ? bar * 4 : bar;
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(Math.min(total, pos + step)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(Math.max(0, pos - step)); }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); seek(0); }
  };
  return (
    <div
      ref={ref} className={`timeline ${playing ? 'is-playing' : ''}`} role="slider" tabIndex={0}
      aria-label={t.player.timeline} aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(pos)}
      aria-valuetext={`${formatClock(pos)} / ${formatClock(total)}`}
      onKeyDown={onKey}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setScrub(at(e.clientX)); }}
      onPointerMove={(e) => { if (scrub !== null) setScrub(at(e.clientX)); }}
      onPointerUp={(e) => { const v = at(e.clientX); setScrub(null); seek(v); }}
      onPointerCancel={() => setScrub(null)}
    >
      <div className="tl-segs" aria-hidden="true">
        {segs.map((s) => (
          <div key={s.id} className={`tl-seg ${s.id === sectionId && scope === 'song' ? 'cur' : ''}`}
            style={{ left: pct(s.startSec), width: pct(s.durSec), ['--glass' as string]: SECTION_COLOR[s.type] }}
            title={s.label}>
            <span>{s.label}</span>
          </div>
        ))}
        {scope === 'section' && total > 0 && Array.from({ length: Math.max(0, Math.floor(total / bar)) }, (_, i) => (
          <i key={i} className="tl-tick" style={{ left: pct((i + 1) * bar) }} />
        ))}
      </div>
      <div className="tl-fill" style={{ width: pct(pos) }} aria-hidden="true" />
      <div className="tl-head" style={{ left: pct(pos) }} aria-hidden="true" />
    </div>
  );
}

function Readout({ total }: { total: number }) {
  const project = useApp((s) => s.project)!;
  const scope = usePlayer((s) => s.scope);
  const live = usePosition();
  const local = scope === 'song' ? live - selectedStart() : live;
  const bar = barSec(project.bpm, project.timeSig), beat = beatSec(project.bpm);
  const p = scope === 'song' ? live : local;
  const b = Math.floor(Math.max(0, p) / bar) + 1;
  const bt = Math.floor((Math.max(0, p) % bar) / beat) + 1;
  return (
    <div className="time" aria-label={t.player.position}>
      <span className="num time-main">{formatClock(live)}<span className="time-total"> / {formatClock(total)}</span></span>
      <span className="num time-sub">{t.player.barBeat(b, bt)}</span>
    </div>
  );
}

function Strip({ id, label, hint, def, pan }: { id: string; label: string; hint?: string; def: number; pan?: { value: number; set(v: number): void } }) {
  const ctl = usePlayer((s) => s.ctl[id]);
  const all = usePlayer((s) => s.ctl);
  const vols = usePlayer((s) => s.vols);
  const setVol = usePlayer((s) => s.setVol);
  const mute = usePlayer((s) => s.toggleMute);
  const solo = usePlayer((s) => s.toggleSolo);
  const vol = ctl?.vol ?? vols[id] ?? def;
  const audible = levelOf(all, vols, id, def) > 0;
  const m = !!ctl?.mute, s = !!ctl?.solo;
  const onKey = (e: RKeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); mute(id); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); solo(id); }
  };
  return (
    <div className={`chan ${audible ? '' : 'silent'} ${m ? 'is-muted' : ''} ${s ? 'is-solo' : ''}`} role="group" aria-label={label} tabIndex={0} onKeyDown={onKey} title={hint}>
      <span className="chan-name">{label}</span>
      <input
        type="range" min={0} max={100} value={Math.round(vol * 100)} aria-label={`${label}: ${t.player.volume}`}
        style={{ ['--pct' as string]: `${Math.round(vol * 100)}%` }}
        onChange={(e) => setVol(id, Number(e.target.value) / 100)}
      />
      {pan && (
        <input className="pan" type="range" min={-100} max={100} step={5} value={Math.round(pan.value * 100)} aria-label={`${label}: ${t.mixer.pan}`} title={t.mixer.pan}
          onChange={(e) => pan.set(Number(e.target.value) / 100)} onDoubleClick={() => pan.set(0)} />
      )}
      <span className="chan-btns">
        <button className={`ms ${m ? 'on-m' : ''}`} aria-pressed={m} aria-label={`${t.player.mute} ${label}`} title={`${t.player.mute} (M)`} onClick={() => mute(id)}>M</button>
        <button className={`ms ${s ? 'on-s' : ''}`} aria-pressed={s} aria-label={`${t.player.solo} ${label}`} title={`${t.player.solo} (S)`} onClick={() => solo(id)}>S</button>
      </span>
    </div>
  );
}

function InstrumentStatus() {
  const state = useEngine(() => engine.sfState);
  const progress = useEngine(() => Math.round(engine.sfProgress * 100));
  const project = useApp((s) => s.project);
  const hasArr = !!arrangementFor(project);
  // lazy-load the SoundFont after the first user gesture (browsers keep the audio context suspended before that)
  useEffect(() => {
    if (!hasArr) return;
    const go = () => { void engine.loadInstruments().catch(() => undefined); };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, [hasArr]);
  // a fixed-size slot: the status appearing must never change the height of the (bottom-anchored) transport, or the first click on Play misses
  if (!hasArr || state === 'idle') return <span className="status-dot slot" aria-hidden="true">&nbsp;</span>;
  if (state === 'loading') return <span className="status-dot loading slot" role="status">{t.player.loadingInstruments(progress)}</span>;
  if (state === 'error') return <span className="status-dot error slot" role="alert">{t.player.instrumentsError}</span>;
  return <span className="status-dot ready slot" role="status">{t.player.instrumentsReady}</span>;
}

/** The mixer (presets, sources, auto-mix, one strip per track). Used by the transport drawer and by the Mix tab. */
export function MixerBody({ pro }: { pro: boolean }) {
  const player = usePlayer();
  const sampleState = useEngine(() => engine.sampleState);
  const project = useApp((s) => s.project)!;
  const sec = useApp(currentSection);
  const viewNotes = useApp((s) => s.viewNotes);
  const setView = useApp((s) => s.setViewNotes);
  const voiceSource = useApp((s) => s.voiceSource);
  const setVoiceSource = useApp((s) => s.setVoiceSource);
  const setPan = useApp((s) => s.setPan);
  const autoMix = useApp((s) => s.autoMix);
  const pans = arrangementSettings(project).pans ?? {};
  const take = activeTake(sec);
  const arr = arrangementFor(project);
  const hasClean = !!take?.cleanAudioId;
  const tracks = useMemo(() => [
    { id: 'voce', label: t.player.voice, def: DEFAULT_VOL.voce, hint: undefined as string | undefined },
    { id: 'melodie', label: t.player.piano, def: DEFAULT_VOL.melodie, hint: t.player.melodyHint },
    ...(arr?.tracks.map((x) => ({ id: x.id, label: x.name, def: x.level, hint: undefined })) ?? []),
  ], [arr]);
  const ids = tracks.map((x) => x.id);
  const preset = (() => {
    const lv = (id: string) => levelOf(player.ctl, player.vols, id, 0.6) > 0;
    const accOn = tracks.slice(2).every((x) => lv(x.id));
    const accOff = tracks.slice(2).every((x) => !lv(x.id));
    if (lv('voce') && lv('melodie') && accOn) return 'all';
    if (lv('voce') && !lv('melodie') && accOff) return 'voice';
    if (!lv('voce') && !lv('melodie') && accOn) return 'acc';
    return null;
  })();
  return (
        <div className="mixer" id="mixer">
            <div className="mixer-head">
              <div className="seg seg-sm" role="group" aria-label={t.player.presets}>
                <button className={preset === 'voice' ? 'on' : ''} aria-pressed={preset === 'voice'} onClick={() => player.preset('voice', ids)}>{t.player.onlyVoice}</button>
                <button className={preset === 'acc' ? 'on' : ''} aria-pressed={preset === 'acc'} onClick={() => player.preset('acc', ids)}>{t.player.onlyBacking}</button>
                <button className={preset === 'all' ? 'on' : ''} aria-pressed={preset === 'all'} onClick={() => player.preset('all', ids)}>{t.player.all}</button>
              </div>
              <div className="seg seg-sm" role="group" aria-label={t.player.voiceSource}>
                <button className={voiceSource === 'raw' || !hasClean ? 'on' : ''} aria-pressed={voiceSource === 'raw'} onClick={() => setVoiceSource('raw')}>{t.takes.raw}</button>
                <button className={voiceSource === 'clean' && hasClean ? 'on' : ''} disabled={!hasClean} aria-pressed={voiceSource === 'clean'} onClick={() => setVoiceSource('clean')}>{t.takes.clean}</button>
              </div>
              <div className="seg seg-sm" role="group" aria-label={t.player.noteSource}>
                <button className={viewNotes === 'original' ? 'on' : ''} aria-pressed={viewNotes === 'original'} onClick={() => setView('original')}>{t.corr.original}</button>
                <button className={viewNotes === 'corrected' ? 'on' : ''} aria-pressed={viewNotes === 'corrected'} onClick={() => setView('corrected')}>{t.corr.corrected}</button>
              </div>
              {arr && <button className="btn btn-quiet btn-sm" title={t.mixer.autoHint} onClick={() => { player.resetLevels(); autoMix(); }}><Icon name="wand" size={14} />{t.mixer.auto}</button>}
              <InstrumentStatus />
              {sampleState === 'loading' && <span className="status-dot loading" role="status">{t.player.loadingPiano}</span>}
              {sampleState === 'error' && (
                <span className="status-dot error" role="status">{engine.failure ?? t.player.pianoFallback}
                  <button className="btn btn-quiet btn-sm" onClick={() => void engine.retryPiano()}>{t.player.retry}</button></span>
              )}
              <span className="mixer-keys">{t.player.keysHint}</span>
            </div>
            <div className="chans">
              {tracks.map((x) => <Strip key={x.id} id={x.id} label={x.label} hint={x.hint} def={x.def}
                pan={arr?.tracks.some((a) => a.id === x.id) ? { value: pans[x.id] ?? arr.tracks.find((a) => a.id === x.id)!.pan, set: (v) => setPan(x.id, v) } : undefined} />)}
              {pro && <Strip id="metro" label={t.player.metro} def={DEFAULT_VOL.metro} />}
            </div>
            {!arr && <p className="hint mixer-note">{t.player.noArrangement}</p>}
          </div>
    );
}

export function Transport({ pro, hideMixer = false }: { pro: boolean; hideMixer?: boolean }) {
  const playing = useEngine(() => engine.playing);
  const player = usePlayer();
  const project = useApp((s) => s.project)!;
  const sec = useApp(currentSection);
  const real = useApp(selectedSection);
  const [open, setOpen] = useState(() => window.innerWidth > 700);
  const take = activeTake(sec);
  const arr = arrangementFor(project);
  const total = timelineLength(player.scope);
  const planHere = arr?.plan.find((x) => x.id === real?.id);
  const hasSomething = player.scope === 'song' ? total > 0 && (project.sections.some((s) => s.takes.length || s.sourceSectionId) || !!arr) : !!take || !!planHere?.active.length;
  const disabled = !hasSomething || total <= 0;
  return (
    <div className={`transport ${open ? 'open' : ''}`} role="region" aria-label={t.player.title}>
      <div className="transport-row">
        <div className="transport-main">
          <button className="btn btn-play" onClick={() => void player.toggle()} disabled={disabled || playing} aria-label={t.player.play} title={`${t.player.play} (Space)`}>
            <Icon name="play" size={20} />
          </button>
          <button className="icon-btn tbtn" onClick={() => engine.pause()} disabled={!playing} aria-label={t.player.pause} title={`${t.player.pause} (Space)`}><Icon name="pause" size={17} /></button>
          <button className="icon-btn tbtn" onClick={() => player.stop()} disabled={disabled || (!playing && engine.position() === 0)} aria-label={t.player.stop} title={`${t.player.stop} (Esc)`}><Icon name="stop" size={15} /></button>
        </div>
        <Readout total={total} />
        <Timeline scope={player.scope} total={total} />
        <div className="transport-opts">
          <div className="seg seg-sm" role="group" aria-label={t.player.scope}>
            <button className={player.scope === 'section' ? 'on' : ''} aria-pressed={player.scope === 'section'} onClick={() => player.setScope('section')}>{t.player.scopeSection}</button>
            <button className={player.scope === 'song' ? 'on' : ''} aria-pressed={player.scope === 'song'} onClick={() => player.setScope('song')}>{t.player.scopeSong}</button>
          </div>
          <button className="icon-btn" data-testid="flag-btn" aria-label={t.player.flag} title={t.player.flagHint} disabled={disabled} onClick={() => { const arr = arrangementFor(project); const at = engine.position(); const near = (arr?.tracks ?? []).filter((x) => !x.drums).flatMap((x) => x.notes.filter((n) => n.startSec <= at + 0.2 && n.startSec + n.durSec >= at - 0.2).map((n) => ({ track: x.id, midi: n.midi, start: n.startSec, dur: n.durSec }))); useApp.getState().flagMoment(at, near); }}><Icon name="flame" size={16} /></button>
          <button className={`icon-btn toggle ${player.loop ? 'on' : ''}`} onClick={() => player.setLoop(!player.loop)} aria-pressed={player.loop} aria-label={t.player.loop} title={t.player.loop}><Icon name="loop" size={16} /></button>
          <button className={`icon-btn toggle ${player.metronome ? 'on' : ''}`} onClick={() => player.setMetronome(!player.metronome)} aria-pressed={player.metronome} aria-label={t.player.metronome} title={t.player.metronome}><Icon name="metro" size={16} /></button>
          <button className={`btn btn-ghost btn-sm mixer-toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mixer">{t.player.mixer}<Icon name={open ? 'down' : 'up'} size={14} /></button>
        </div>
      </div>
      {open && !hideMixer && <MixerBody pro={pro} />}
    </div>
  );
}
