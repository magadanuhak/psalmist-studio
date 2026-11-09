import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeTake, currentSection, useApp } from '../store/store';
import { usePlayer, sectionLength, localPosition } from '../store/player';
import { loadAudio } from '../store/audioCache';
import { engine } from '../audio/engine';
import { barClicks, barSec, beatSec, gridSec } from '../music/timesig';
import { hzToMidiF, midiName, pcName, scaleDegree, scalePcs, isBlackKey } from '../music/theory';
import { uid } from '../model/id';
import type { Note } from '../model/types';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { renderFor } from '../store/harmonyInput';
import { chordName } from '../theory/harmony';
import { FUNC_COLOR } from './chordColors';

const MAXM = 96, MINM = 36;
const ROWH = 17;
const RULERH = 22;
const WAVEH = 44;
const CHORDH = 26;
const PEAKS_PER_SEC = 200;

const C = {
  bg: '#0b0e1d', rowIn: 'rgba(242,184,75,0.045)', rowTonic: 'rgba(242,184,75,0.11)', rowBlack: 'rgba(0,0,0,0.22)',
  beat: 'rgba(160,170,230,0.10)', group: 'rgba(160,170,230,0.20)', bar: 'rgba(200,205,245,0.38)',
  ruler: '#121631', keyW: '#e9e0cc', keyB: '#26294a', keyText: '#2a2438', keyTextB: '#b7b4cc',
  note: '#f2b84b', noteEdge: '#ffd98e', sel: '#fff4d6', chroma: '#ff9b54', ghost: 'rgba(110,160,255,0.65)',
  contour: 'rgba(243,234,215,0.42)', playhead: '#ff7a45', wave: 'rgba(120,150,230,0.75)', waveBg: '#0f1330', dim: 'rgba(5,6,14,0.5)',
  text: '#a9a6c0', textHi: '#f3ead7',
};

type Tool = 'select' | 'pen' | 'hand';

interface Drag {
  kind: 'move' | 'resize' | 'marquee' | 'pen' | 'pan' | 'seek';
  startX: number; startY: number;
  base: Note[];            // snapshot of all notes at drag start
  ids: string[];           // affected ids
  primary?: string;
  sx?: number; sy?: number;
  moved: boolean;
  additive?: boolean;
}

function computePeaks(data: Float32Array, sr: number): Float32Array {
  const n = Math.ceil((data.length / sr) * PEAKS_PER_SEC);
  const out = new Float32Array(n);
  const step = sr / PEAKS_PER_SEC;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), b = Math.min(data.length, Math.floor((i + 1) * step));
    for (let j = a; j < b; j++) { const v = Math.abs(data[j]); if (v > m) m = v; }
    out[i] = m;
  }
  return out;
}

export function PianoRoll({ editable, height = 380, chordLane = false, selectedChord = null, onChordClick }: {
  editable: boolean; height?: number; chordLane?: boolean; selectedChord?: number | null;
  onChordClick?: (idx: number, at: { x: number; y: number }) => void;
}) {
  const project = useApp((s) => s.project);
  const sec = useApp(currentSection);
  const take = activeTake(sec);
  const viewNotes = useApp((s) => s.viewNotes);
  const voiceSource = useApp((s) => s.voiceSource);
  const noteStyle = useApp((s) => s.noteStyle);
  const setNoteStyle = useApp((s) => s.setNoteStyle);
  const editNotes = useApp((s) => s.editNotes);
  const chordNaming = useApp((s) => s.chordNaming);
  const rend = useMemo(() => (project && sec ? renderFor(project, sec) : null), [project, sec, sec?.harmony]);
  const showChords = chordLane && !!rend && rend.slots.length > 0;
  const chordH = showChords ? CHORDH : 0;
  const TOP = RULERH + chordH + WAVEH;

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pps, setPps] = useState(90);
  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Note[] | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [size, setSize] = useState({ w: 600, h: height });
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);
  const state = useRef({ pps, selection, draft, marquee, peaks, tool, snap });
  state.current = { pps, selection, draft, marquee, peaks, tool, snap };

  const bpm = project?.bpm ?? 90;
  const sig = project?.timeSig;
  const key = project?.key ?? null;
  const editableNow = editable && viewNotes === 'corrected' && !!take;
  const notes = useMemo<Note[]>(
    () => (take ? (viewNotes === 'original' ? take.notesOriginal : take.notesCorrected) : []),
    [take, viewNotes],
  );
  const shown = draft ?? notes;
  const keyW = size.w < 520 ? 46 : 62;
  const total = Math.max(sectionLength() + 1.5, sig ? barSec(bpm, sig) * 2 : 4);
  const contentW = keyW + total * pps + 60;
  const contentH = TOP + (MAXM - MINM + 1) * ROWH;
  const gSec = sig ? gridSec(bpm, sig, take?.correction.grid ?? '1/8') : 0.25;

  // waveform peaks
  useEffect(() => {
    let live = true;
    setPeaks(null);
    if (!take) return;
    const id = voiceSource === 'clean' && take.cleanAudioId ? take.cleanAudioId : take.rawAudioId;
    void loadAudio(id).then((a) => { if (live && a) setPeaks(computePeaks(a.data, a.sr)); });
    return () => { live = false; };
  }, [take?.id, take?.cleanAudioId, voiceSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // size observer
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // initial vertical position: centre on the melody
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const src = take?.notesCorrected.length ? take.notesCorrected : take?.notesOriginal ?? [];
    const mid = src.length ? src.reduce((s, n) => s + n.midi, 0) / src.length : 64;
    el.scrollTop = Math.max(0, TOP + (MAXM - mid) * ROWH - (size.h - TOP) / 2);
    el.scrollLeft = 0;
  }, [take?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const cv = canvasRef.current, el = scrollRef.current;
    if (!cv || !el || !sig) return;
    const dpr = window.devicePixelRatio || 1;
    const W = el.clientWidth, H = el.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = state.current;
    const sx = el.scrollLeft, sy = el.scrollTop;
    const P = st.pps;
    const tx = (tt: number) => keyW + tt * P - sx;
    const ny = (m: number) => TOP + (MAXM - m) * ROWH - sy;
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

    const t0 = Math.max(0, (sx - 10) / P), t1 = (sx + W) / P + 0.1;
    const pcs = key ? scalePcs(key) : null;

    // ---- note area (clipped)
    g.save();
    g.beginPath(); g.rect(keyW, TOP, W - keyW, H - TOP); g.clip();
    for (let m = MINM; m <= MAXM; m++) {
      const y = ny(m);
      if (y > H || y + ROWH < TOP) continue;
      const pc = ((m % 12) + 12) % 12;
      if (isBlackKey(m)) { g.fillStyle = C.rowBlack; g.fillRect(keyW, y, W - keyW, ROWH); }
      if (key && pcs?.has(pc)) { g.fillStyle = pc === key.tonic ? C.rowTonic : C.rowIn; g.fillRect(keyW, y, W - keyW, ROWH); }
      if (pc === 0) { g.fillStyle = 'rgba(200,205,245,0.18)'; g.fillRect(keyW, y + ROWH - 1, W - keyW, 1); }
    }
    // beat grid
    const beat = beatSec(bpm);
    const pattern = barClicks(sig);
    const firstBeat = Math.floor(t0 / beat), lastBeat = Math.ceil(t1 / beat);
    for (let i = firstBeat; i <= lastBeat; i++) {
      const x = Math.round(tx(i * beat)) + 0.5;
      const kind = pattern[((i % sig.num) + sig.num) % sig.num];
      g.strokeStyle = kind === 'accent' ? C.bar : kind === 'sub' ? C.group : C.beat;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, TOP); g.lineTo(x, H); g.stroke();
    }
    // beyond section end shading
    const secEnd = sec ? sec.bars * barSec(bpm, sig) : 0;
    if (secEnd > 0 && tx(secEnd) < W) { g.fillStyle = C.dim; g.fillRect(Math.max(keyW, tx(secEnd)), TOP, W, H - TOP); }

    // pitch contour
    const pt = take?.analysis?.pitchTrack;
    if (pt) {
      g.strokeStyle = C.contour; g.lineWidth = 1.5; g.lineJoin = 'round';
      const a = Math.max(0, Math.floor(t0 / pt.hopSec)), b = Math.min(pt.hz.length, Math.ceil(t1 / pt.hopSec));
      g.beginPath();
      let pen = false;
      for (let i = a; i < b; i++) {
        const hz = pt.hz[i];
        if (hz <= 0) { pen = false; continue; }
        const x = tx(i * pt.hopSec), y = ny(hzToMidiF(hz)) + ROWH / 2;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    // ghost of original
    if (viewNotes === 'corrected' && take && take.notesOriginal.length) {
      g.strokeStyle = C.ghost; g.lineWidth = 1; g.setLineDash([3, 3]);
      for (const n of take.notesOriginal) {
        const x = tx(n.startSec), w = n.durSec * P;
        if (x > W || x + w < keyW) continue;
        g.strokeRect(x + 0.5, ny(n.midi) + 2.5, Math.max(2, w - 1), ROWH - 5);
      }
      g.setLineDash([]);
    }
    // notes
    g.font = '600 10px "Bricolage Grotesque", system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const n of shown) {
      const x = tx(n.startSec), w = Math.max(3, n.durSec * P - 1);
      if (x > W || x + w < keyW) continue;
      const y = ny(n.midi);
      if (y > H || y + ROWH < TOP) continue;
      const selected = st.selection.has(n.id);
      g.globalAlpha = 0.62 + n.velocity * 0.38;
      g.fillStyle = viewNotes === 'original' ? '#7fa6ee' : C.note;
      const r = 3;
      g.beginPath(); g.roundRect(x, y + 1.5, w, ROWH - 3, r); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = selected ? C.sel : n.isChromaticIntent ? C.chroma : C.noteEdge;
      g.lineWidth = selected ? 2 : n.isChromaticIntent ? 1.5 : 0.75;
      if (n.isChromaticIntent) g.setLineDash([3, 2]);
      g.stroke(); g.setLineDash([]);
      if (w > 30) {
        g.fillStyle = '#2a1d05';
        g.fillText(midiName(n.midi, noteStyle), x + 5, y + ROWH / 2 + 0.5);
      }
      if (editableNow && selected && w > 12) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + w - 4, y + 4, 2, ROWH - 8); }
    }
    // marquee
    if (st.marquee) {
      const m = st.marquee;
      g.fillStyle = 'rgba(242,184,75,0.12)'; g.strokeStyle = 'rgba(242,184,75,0.8)'; g.lineWidth = 1;
      const x = Math.min(m.x0, m.x1) - sx, y = Math.min(m.y0, m.y1) - sy;
      g.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    g.restore();

    // ---- waveform lane
    const WY = RULERH + chordH;
    g.fillStyle = C.waveBg; g.fillRect(keyW, WY, W - keyW, WAVEH);
    if (st.peaks) {
      g.fillStyle = C.wave;
      const mid = WY + WAVEH / 2;
      for (let x = keyW; x < W; x++) {
        const tt = (x + sx - keyW) / P;
        const i0 = Math.floor(tt * PEAKS_PER_SEC), i1 = Math.max(i0 + 1, Math.floor((tt + 1 / P) * PEAKS_PER_SEC));
        let m = 0;
        for (let i = i0; i < i1 && i < st.peaks.length; i++) if (st.peaks[i] > m) m = st.peaks[i];
        if (m <= 0) continue;
        const h = Math.max(1, Math.min(1, m * 1.6) * (WAVEH / 2 - 3));
        g.fillRect(x, mid - h, 1, h * 2);
      }
    } else {
      g.fillStyle = C.text; g.font = '11px "Bricolage Grotesque", system-ui, sans-serif'; g.textBaseline = 'middle';
      g.fillText(take ? t.roll.noWave : t.roll.noTake, keyW + 12, WY + WAVEH / 2);
    }

    // ---- ruler
    g.fillStyle = C.ruler; g.fillRect(keyW, 0, W - keyW, RULERH);
    g.font = '500 10px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
    for (let i = firstBeat; i <= lastBeat; i++) {
      if (i < 0) continue;
      const x = Math.round(tx(i * beat)) + 0.5;
      const isBar = i % sig.num === 0;
      g.strokeStyle = isBar ? C.bar : C.beat;
      g.beginPath(); g.moveTo(x, isBar ? 4 : RULERH - 7); g.lineTo(x, RULERH); g.stroke();
      if (isBar && x > keyW) { g.fillStyle = C.textHi; g.fillText(String(i / sig.num + 1), x + 4, 11); }
    }

    // ---- chord lane
    if (showChords && rend && key) {
      g.fillStyle = '#0e1230'; g.fillRect(keyW, RULERH, W - keyW, CHORDH);
      g.font = '600 12px "Bricolage Grotesque", system-ui, sans-serif'; g.textBaseline = 'middle';
      for (const { slot, chord, voiced } of rend.slots) {
        const x1 = tx(slot.startSec), x2 = tx(slot.startSec + slot.durSec);
        if (x2 < keyW || x1 > W) continue;
        const col = FUNC_COLOR[chord.func];
        g.fillStyle = col + '26'; g.fillRect(x1 + 1, RULERH + 2, Math.max(2, x2 - x1 - 2), CHORDH - 4);
        g.fillStyle = col; g.fillRect(x1 + 1, RULERH + 2, 2, CHORDH - 4);
        if (selectedChord === slot.idx) { g.strokeStyle = '#fff4d6'; g.lineWidth = 1.5; g.strokeRect(x1 + 1.5, RULERH + 2.5, Math.max(2, x2 - x1 - 3), CHORDH - 5); }
        g.save(); g.beginPath(); g.rect(Math.max(x1, keyW), RULERH, x2 - Math.max(x1, keyW), CHORDH); g.clip();
        g.fillStyle = C.textHi;
        g.fillText(chordName(chord, chordNaming, key, voiced.bassPc), x1 + 8, RULERH + CHORDH / 2 + 0.5);
        const hh = sec?.harmony;
        if (hh && hh.locks[hh.active][slot.idx]) { g.fillStyle = C.note; g.fillRect(x2 - 12, RULERH + 8, 7, 6); g.strokeStyle = C.note; g.lineWidth = 1.2; g.beginPath(); g.arc(x2 - 8.5, RULERH + 8, 2.4, Math.PI, 0); g.stroke(); }
        g.restore();
      }
    }

    // ---- playhead
    const pos = localPosition();
    const px = tx(pos);
    if (px >= keyW && px <= W) {
      g.strokeStyle = C.playhead; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
      g.fillStyle = C.playhead;
      g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.fill();
    }

    // ---- keyboard (left strip)
    g.save();
    g.beginPath(); g.rect(0, TOP, keyW, H - TOP); g.clip();
    g.font = '600 10px "Bricolage Grotesque", system-ui, sans-serif'; g.textBaseline = 'middle';
    for (let m = MINM; m <= MAXM; m++) {
      const y = ny(m);
      if (y > H || y + ROWH < TOP) continue;
      const black = isBlackKey(m);
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = black ? C.keyB : C.keyW; g.fillRect(0, y, keyW - 1, ROWH);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + ROWH - 1, keyW - 1, 1);
      const inKey = key && pcs?.has(pc);
      if (inKey) {
        g.fillStyle = pc === key!.tonic ? '#f2b84b' : 'rgba(242,184,75,0.75)';
        g.beginPath(); g.arc(keyW - 8, y + ROWH / 2, pc === key!.tonic ? 3 : 2, 0, Math.PI * 2); g.fill();
      }
      if (!black || pc === key?.tonic || inKey) {
        g.fillStyle = black ? C.keyTextB : C.keyText;
        const deg = key ? scaleDegree(m, key) : null;
        const label = (pc === 0 || !black ? midiName(m, noteStyle) : pcName(m, noteStyle));
        g.fillText(label, 5, y + ROWH / 2 + 0.5);
        if (deg && keyW > 56 && !black) { g.fillStyle = 'rgba(120,80,10,0.8)'; g.fillText(String(deg), keyW - 22, y + ROWH / 2 + 0.5); }
      }
    }
    g.restore();
    g.fillStyle = C.ruler; g.fillRect(0, 0, keyW, TOP);
    g.fillStyle = C.text; g.font = '10px "Bricolage Grotesque", system-ui, sans-serif'; g.textBaseline = 'middle';
    g.fillText(t.roll.wave, 6, RULERH + chordH + WAVEH / 2);
    if (showChords) g.fillText(t.chords.lane, 6, RULERH + CHORDH / 2);
    g.fillStyle = '#2b3260'; g.fillRect(keyW - 1, 0, 1, H); g.fillRect(0, TOP - 1, W, 1);
  }, [keyW, sig, bpm, key, sec, take, viewNotes, shown, noteStyle, editableNow, rend, showChords, chordH, TOP, chordNaming, selectedChord]);

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const request = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; drawRef.current(); });
  }, []);

  // redraw on any visual state change
  useEffect(() => { request(); }, [request, pps, selection, draft, marquee, peaks, shown, size, key, noteStyle, viewNotes, tool, draw]);

  // playback animation loop + follow
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const el = scrollRef.current;
      if (engine.playing && el) {
        const x = keyW + localPosition() * state.current.pps;
        if (x - el.scrollLeft > el.clientWidth - 40 || x - el.scrollLeft < keyW) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.3);
        drawRef.current();
        id = requestAnimationFrame(tick);
      }
    };
    const unsub = engine.subscribe(() => { cancelAnimationFrame(id); request(); if (engine.playing) id = requestAnimationFrame(tick); });
    if (engine.playing) id = requestAnimationFrame(tick);
    return () => { unsub(); cancelAnimationFrame(id); };
  }, [keyW, request]);

  // ctrl+wheel zoom (non-passive)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorT = (e.clientX - rect.left + el.scrollLeft - keyW) / state.current.pps;
      const np = Math.max(20, Math.min(480, state.current.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setPps(np);
      requestAnimationFrame(() => { el.scrollLeft = keyW + anchorT * np - (e.clientX - rect.left); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [keyW]);

  const zoom = (f: number) => {
    const el = scrollRef.current;
    const np = Math.max(20, Math.min(480, pps * f));
    if (el) {
      const centerT = (el.scrollLeft + (el.clientWidth + keyW) / 2 - keyW) / pps;
      setPps(np);
      requestAnimationFrame(() => { el.scrollLeft = keyW + centerT * np - (el.clientWidth + keyW) / 2; });
    } else setPps(np);
  };

  // ---------- pointer interaction ----------
  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const el = scrollRef.current!;
    return { x: e.clientX - r.left, y: e.clientY - r.top, sx: el.scrollLeft, sy: el.scrollTop };
  };
  const toTime = (cx: number) => (cx - keyW) / pps;
  const toMidi = (cy: number) => MAXM - Math.floor((cy - TOP) / ROWH);
  const snapT = (tt: number) => (snap && gSec > 0 ? Math.round(tt / gSec) * gSec : tt);
  const hit = (cx: number, cy: number): { n: Note; edge: boolean } | null => {
    const list = state.current.draft ?? notes;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      const x1 = keyW + n.startSec * pps, x2 = x1 + Math.max(4, n.durSec * pps);
      const y1 = TOP + (MAXM - n.midi) * ROWH;
      if (cx >= x1 - 2 && cx <= x2 + 2 && cy >= y1 && cy <= y1 + ROWH) return { n, edge: cx >= x2 - 7 && x2 - x1 > 14 };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!take) return;
    const { x, y, sx, sy } = local(e);
    canvasRef.current!.setPointerCapture(e.pointerId);
    const cx = x + sx, cy = y + sy;
    if (showChords && x >= keyW && y >= RULERH && y < RULERH + CHORDH && rend) {
      const tt = toTime(cx);
      const hit = rend.slots.find((s) => tt >= s.slot.startSec && tt < s.slot.startSec + s.slot.durSec);
      if (hit) onChordClick?.(hit.slot.idx, { x: e.clientX, y: e.clientY });
      return;
    }
    // ruler / wave lane / keyboard: seek or audition
    if (y < TOP && x >= keyW) {
      drag.current = { kind: 'seek', startX: x, startY: y, base: [], ids: [], moved: false };
      usePlayer.getState().seekLocal(Math.max(0, toTime(cx)));
      return;
    }
    if (x < keyW) {
      if (y >= TOP) { void engine.ensure().then(() => engine.preview(toMidi(cy))); }
      return;
    }
    if (tool === 'hand') {
      drag.current = { kind: 'pan', startX: x, startY: y, sx, sy, base: [], ids: [], moved: false };
      return;
    }
    if (!editableNow) return;
    const h = hit(cx, cy);
    if (tool === 'pen' && !h) {
      const st = Math.max(0, snapT(toTime(cx)));
      const n: Note = { id: uid(), midi: Math.max(MINM, Math.min(MAXM, toMidi(cy))), startSec: st, durSec: gSec || 0.25, velocity: 0.8, centsDev: 0, confidence: 1 };
      const base = [...notes, n];
      drag.current = { kind: 'pen', startX: x, startY: y, base, ids: [n.id], primary: n.id, moved: false };
      setDraft(base); setSelection(new Set([n.id]));
      return;
    }
    if (h) {
      let sel = new Set(selection);
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (sel.has(h.n.id)) sel.delete(h.n.id); else sel.add(h.n.id); }
      else if (!sel.has(h.n.id)) sel = new Set([h.n.id]);
      setSelection(sel);
      drag.current = {
        kind: h.edge ? 'resize' : 'move', startX: x, startY: y, base: notes.map((n) => ({ ...n })),
        ids: h.edge ? [h.n.id] : [...sel], primary: h.n.id, moved: false,
      };
      return;
    }
    // empty area: marquee
    drag.current = { kind: 'marquee', startX: x, startY: y, sx, sy, base: [], ids: [], moved: false, additive: e.shiftKey };
    if (!e.shiftKey) setSelection(new Set());
    setMarquee({ x0: cx, y0: cy, x1: cx, y1: cy });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const { x, y, sx, sy } = local(e);
    const cv = canvasRef.current!;
    if (!d) {
      if (editableNow && x >= keyW && y >= TOP) {
        const h = hit(x + sx, y + sy);
        cv.style.cursor = tool === 'hand' ? 'grab' : h ? (h.edge ? 'ew-resize' : 'grab') : tool === 'pen' ? 'crosshair' : 'default';
      } else cv.style.cursor = tool === 'hand' ? 'grab' : x < keyW && y >= TOP ? 'pointer' : y < TOP ? 'col-resize' : 'default';
      return;
    }
    const dx = x - d.startX, dy = y - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const el = scrollRef.current!;
    if (d.kind === 'pan') { el.scrollLeft = (d.sx ?? 0) - dx; el.scrollTop = (d.sy ?? 0) - dy; return; }
    if (d.kind === 'seek') { usePlayer.getState().seekLocal(Math.max(0, toTime(x + sx))); return; }
    if (d.kind === 'marquee') {
      const m = { x0: d.startX + (d.sx ?? 0), y0: d.startY + (d.sy ?? 0), x1: x + sx, y1: y + sy };
      setMarquee(m);
      const a = Math.min(m.x0, m.x1), b = Math.max(m.x0, m.x1), c = Math.min(m.y0, m.y1), dd = Math.max(m.y0, m.y1);
      const ids = new Set(d.additive ? selection : []);
      for (const n of notes) {
        const x1 = keyW + n.startSec * pps, x2 = x1 + n.durSec * pps, y1 = TOP + (MAXM - n.midi) * ROWH;
        if (x2 >= a && x1 <= b && y1 + ROWH >= c && y1 <= dd) ids.add(n.id);
      }
      setSelection(ids);
      return;
    }
    if (d.kind === 'move') {
      const prim = d.base.find((n) => n.id === d.primary)!;
      const dtRaw = dx / pps;
      const dt = snap ? snapT(prim.startSec + dtRaw) - prim.startSec : dtRaw;
      const dm = -Math.round(dy / ROWH);
      const minStart = Math.min(...d.base.filter((n) => d.ids.includes(n.id)).map((n) => n.startSec));
      const dtc = Math.max(dt, -minStart);
      setDraft(d.base.map((n) => d.ids.includes(n.id)
        ? { ...n, startSec: n.startSec + dtc, midi: Math.max(MINM, Math.min(MAXM, n.midi + dm)), centsDev: 0, isChromaticIntent: false }
        : n));
    } else if (d.kind === 'resize') {
      const prim = d.base.find((n) => n.id === d.primary)!;
      const end = snapT(prim.startSec + prim.durSec + dx / pps);
      const dur = Math.max(0.05, end - prim.startSec);
      setDraft(d.base.map((n) => (n.id === prim.id ? { ...n, durSec: dur } : n)));
    } else if (d.kind === 'pen') {
      const prim = d.base.find((n) => n.id === d.primary)!;
      const end = snapT(prim.startSec + (gSec || 0.25) + dx / pps);
      setDraft(d.base.map((n) => (n.id === prim.id ? { ...n, durSec: Math.max(0.05, end - prim.startSec) } : n)));
    }
  };

  const commit = (list: Note[]) => {
    if (!sec || !take) return;
    editNotes(sec.id, take.id, [...list].sort((a, b) => a.startSec - b.startSec));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (d.kind === 'marquee') { setMarquee(null); return; }
    if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'pen') {
      const dr = state.current.draft;
      setDraft(null);
      if (dr && (d.moved || d.kind === 'pen')) {
        commit(dr);
        const moved = dr.find((n) => n.id === d.primary);
        if (moved && d.kind !== 'resize') void engine.ensure().then(() => engine.preview(moved.midi));
      }
    }
  };

  // ---------- edit actions ----------
  const selected = notes.filter((n) => selection.has(n.id));
  const doDelete = () => { if (selected.length) { commit(notes.filter((n) => !selection.has(n.id))); setSelection(new Set()); } };
  const doSplit = () => {
    const pos = localPosition();
    const targets = selected.length ? selected : notes.filter((n) => pos > n.startSec + 0.05 && pos < n.startSec + n.durSec - 0.05);
    const out: Note[] = [];
    let did = false;
    const ids = new Set<string>();
    for (const n of notes) {
      const at = pos > n.startSec + 0.05 && pos < n.startSec + n.durSec - 0.05;
      if (targets.includes(n) && at) {
        const a = { ...n, durSec: pos - n.startSec };
        const b = { ...n, id: uid(), startSec: pos, durSec: n.startSec + n.durSec - pos };
        out.push(a, b); ids.add(a.id); ids.add(b.id); did = true;
      } else out.push(n);
    }
    if (did) { commit(out); setSelection(ids); } else useApp.getState().notify('info', t.roll.splitHint);
  };
  const doMerge = () => {
    if (selected.length < 2) { useApp.getState().notify('info', t.roll.mergeHint); return; }
    const sorted = [...selected].sort((a, b) => a.startSec - b.startSec);
    const first = sorted[0];
    const end = Math.max(...sorted.map((n) => n.startSec + n.durSec));
    const merged = { ...first, durSec: end - first.startSec, velocity: Math.max(...sorted.map((n) => n.velocity)) };
    const rest = notes.filter((n) => !selection.has(n.id));
    commit([...rest, merged]);
    setSelection(new Set([merged.id]));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editableNow) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
    else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doSplit(); }
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) { e.preventDefault(); doMerge(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(new Set(notes.map((n) => n.id))); }
    else if (e.key === 'Escape') setSelection(new Set());
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!selected.length) return;
      e.preventDefault();
      const dm = e.key === 'ArrowUp' ? 1 : -1;
      commit(notes.map((n) => (selection.has(n.id) ? { ...n, midi: Math.max(MINM, Math.min(MAXM, n.midi + dm)), centsDev: 0 } : n)));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!selected.length) return;
      e.preventDefault();
      const dt = (e.key === 'ArrowRight' ? 1 : -1) * (gSec || 0.1);
      commit(notes.map((n) => (selection.has(n.id) ? { ...n, startSec: Math.max(0, n.startSec + dt) } : n)));
    }
  };

  // drop stale selection ids after undo/redo
  useEffect(() => {
    if (!selection.size) return;
    const ids = new Set(notes.map((n) => n.id));
    const next = new Set([...selection].filter((i) => ids.has(i)));
    if (next.size !== selection.size) setSelection(next);
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const touchAction = tool === 'hand' || !editable ? 'pan-x pan-y' : 'none';

  if (!project || !sig) return null;
  return (
    <div className="roll">
      <div className="roll-toolbar" role="toolbar" aria-label={t.roll.title}>
        {editable && (
          <div className="seg" role="group" aria-label={t.roll.tools}>
            <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title={t.roll.toolSelect} aria-pressed={tool === 'select'}><Icon name="cursor" size={16} /><span>{t.roll.toolSelect}</span></button>
            <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title={t.roll.toolPen} aria-pressed={tool === 'pen'}><Icon name="pen" size={16} /><span>{t.roll.toolPen}</span></button>
            <button className={tool === 'hand' ? 'on' : ''} onClick={() => setTool('hand')} title={t.roll.toolHand} aria-pressed={tool === 'hand'}><Icon name="hand" size={16} /><span>{t.roll.toolHand}</span></button>
          </div>
        )}
        {editable && (
          <div className="tool-actions">
            <button className="chip-btn" disabled={!editableNow || !selected.length} onClick={doDelete} title={`${t.roll.delete} (Del)`}><Icon name="trash" size={15} /><span>{t.roll.delete}</span></button>
            <button className="chip-btn" disabled={!editableNow} onClick={doSplit} title={`${t.roll.split} (S)`}><Icon name="split" size={15} /><span>{t.roll.split}</span></button>
            <button className="chip-btn" disabled={!editableNow || selected.length < 2} onClick={doMerge} title={`${t.roll.merge} (M)`}><Icon name="merge" size={15} /><span>{t.roll.merge}</span></button>
            <label className="chip-toggle"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /><span>{t.roll.snap}</span></label>
          </div>
        )}
        <div className="tool-spacer" />
        <div className="seg" role="group" aria-label={t.roll.names}>
          <button className={noteStyle === 'solfege' ? 'on' : ''} onClick={() => setNoteStyle('solfege')} aria-pressed={noteStyle === 'solfege'}>Do Re Mi</button>
          <button className={noteStyle === 'letter' ? 'on' : ''} onClick={() => setNoteStyle('letter')} aria-pressed={noteStyle === 'letter'}>C D E</button>
        </div>
        <div className="seg" role="group" aria-label={t.roll.zoom}>
          <button onClick={() => zoom(1 / 1.25)} aria-label={t.roll.zoomOut} title={t.roll.zoomOut}>&minus;</button>
          <button onClick={() => zoom(1.25)} aria-label={t.roll.zoomIn} title={t.roll.zoomIn}>+</button>
        </div>
      </div>
      <div
        className="roll-scroll" ref={scrollRef} style={{ height }} tabIndex={0} onKeyDown={onKeyDown}
        onScroll={request} aria-label={t.roll.aria}
      >
        <div className="roll-spacer" style={{ width: contentW, height: contentH }} />
        <canvas
          ref={canvasRef} className="roll-canvas" style={{ touchAction }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if (!editableNow || tool === 'hand') return;
            const r = canvasRef.current!.getBoundingClientRect();
            const el = scrollRef.current!;
            const cx = e.clientX - r.left + el.scrollLeft, cy = e.clientY - r.top + el.scrollTop;
            if (cx < keyW || cy < TOP || hit(cx, cy)) return;
            const n: Note = { id: uid(), midi: toMidi(cy), startSec: Math.max(0, snapT(toTime(cx))), durSec: gSec || 0.25, velocity: 0.8, centsDev: 0, confidence: 1 };
            commit([...notes, n]); setSelection(new Set([n.id]));
          }}
        />
        {!take && <div className="roll-empty">{t.roll.noTake}</div>}
        {take && !notes.length && <div className="roll-empty">{viewNotes === 'original' ? t.roll.noNotesOriginal : t.roll.noNotes}</div>}
      </div>
      <p className="roll-legend">
        <span className="lg lg-note" />{t.roll.legendNote}
        <span className="lg lg-ghost" />{t.roll.legendGhost}
        <span className="lg lg-contour" />{t.roll.legendContour}
        <span className="lg lg-chroma" />{t.roll.legendChroma}
      </p>
    </div>
  );
}
