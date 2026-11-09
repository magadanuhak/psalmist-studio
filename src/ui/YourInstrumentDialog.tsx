import { useEffect, useRef, useState } from 'react';
import { MicSession } from '../audio/recorder';
import { engine } from '../audio/engine';
import { analyzeNote, guidedNotes, type RecordedNote, type RejectReason } from '../audio/instruments/yourInstrument';
import { noteNameRo, YOURS_RO } from '../audio/instruments/strings.ro';
import { useUserInstruments } from '../store/userInstruments';
import { t } from '../i18n/ro';
import { Icon } from './icons';

const REASON_RO: Record<RejectReason, string> = { noPitch: YOURS_RO.noPitch, tooShort: YOURS_RO.tooShort, tooQuiet: YOURS_RO.tooQuiet, duplicate: YOURS_RO.duplicate };
const GUIDED = guidedNotes(48, 84, 4);

/** "Instrumentul tău": record the notes one by one (guided) or import single-note files; the notes become a playable sampler. */
export function YourInstrumentDialog({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(id: string | null): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const add = useUserInstruments((s) => s.add);
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const [name, setName] = useState(YOURS_RO.defaultName);
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const mic = useRef<MicSession | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => () => { mic.current?.close(); }, []);

  const reset = () => { setNotes([]); setStep(0); setMsg(''); setErr(''); setRecording(false); setName(YOURS_RO.defaultName); };
  const close = () => { mic.current?.close(); mic.current = null; reset(); onClose(); };

  const toggleRec = async () => {
    setErr('');
    if (recording) {
      const m = mic.current;
      if (!m) return;
      const cap = m.stopCapture();
      setRecording(false);
      setNotes((x) => [...x, { audio: cap.data, sampleRate: cap.sr }]);
      setStep((s) => Math.min(GUIDED.length, s + 1));
      return;
    }
    try {
      if (!mic.current) mic.current = await MicSession.open();
      mic.current.startCapture();
      setRecording(true);
    } catch { setErr(t.instr.yoursMic); }
  };

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setErr('');
    try {
      await engine.ensureContext();
      const out: RecordedNote[] = [];
      for (const f of files) {
        const buf = await engine.rawContext.decodeAudioData(await f.arrayBuffer());
        const mono = new Float32Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
        out.push({ audio: mono, sampleRate: buf.sampleRate });
      }
      setNotes((x) => [...x, ...out]);
      setMsg(t.instr.yoursImported(notes.length + out.length));
    } catch { setErr(t.instr.yoursMic); }
  };

  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    const r = await add(notes, name.trim() || YOURS_RO.defaultName);
    setSaving(false);
    if (!r.id) { setErr(r.report.rejected[0] ? REASON_RO[r.report.rejected[0].reason] : YOURS_RO.needMore(3)); return; }
    setMsg(t.instr.yoursDone(r.report.accepted.length));
    reset();
    onSaved(r.id);
  };

  const detected = notes.map((n) => { const a = analyzeNote(n.audio, n.sampleRate); return a ? t.instr.yoursNoteOk(noteNameRo(a.midi), a.cents) : '–'; });
  return (
    <dialog ref={ref} className="dialog dialog-wide" data-testid="yours-dialog" onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="dialog-body">
        <div className="panel-head"><h2>{YOURS_RO.title}</h2><button className="icon-btn" onClick={close} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <p className="lede">{YOURS_RO.intro}</p>
        {step < GUIDED.length && (
          <div className="yours-step">
            <strong>{YOURS_RO.step(step + 1, GUIDED.length)}</strong>
            <p>{YOURS_RO.prompt(noteNameRo(GUIDED[step]))}</p>
            <div className="yours-actions">
              <button className={`btn ${recording ? 'btn-rec recording' : 'btn-primary'}`} onClick={() => void toggleRec()} data-testid="yours-rec"><Icon name={recording ? 'stop' : 'rec'} size={16} />{recording ? YOURS_RO.stop : YOURS_RO.record}</button>
              <button className="btn btn-quiet" onClick={() => setStep((s) => s + 1)} disabled={recording}>{YOURS_RO.skip}</button>
            </div>
          </div>
        )}
        <label className="btn btn-ghost">
          <Icon name="import" size={16} />{t.instr.yoursImport}
          <input type="file" accept="audio/*,.wav,.mp3,.m4a" multiple hidden data-testid="yours-import" onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(picked); }} />
        </label>
        {notes.length > 0 && (
          <ul className="yours-notes" data-testid="yours-notes">
            {detected.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
        {notes.length < 3 && <p className="hint">{t.instr.yoursNeed}</p>}
        <label className="field"><span className="label">{YOURS_RO.name}</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="yours-name" /></label>
        {err && <p className="form-error" role="alert">{err}</p>}
        {msg && <p className="hint ok-line" role="status">{msg}</p>}
        <div className="dialog-actions">
          <button className="btn btn-quiet" onClick={close}>{t.common.close}</button>
          <button className="btn btn-primary" disabled={notes.length < 3 || saving} onClick={() => void save()} data-testid="yours-save">{saving ? t.common.saving : YOURS_RO.save}</button>
        </div>
      </div>
    </dialog>
  );
}
