// Quick look at what the app's note detector hears in a synthetic vocal: node scripts/benchmarks/diag.mjs <wav>
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5174/#/');
await p.waitForFunction(() => !!window.__app, { timeout: 30000 });
const r = await p.evaluate(async (b64) => {
  const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buf = await new AudioContext().decodeAudioData(u8.buffer);
  const mono = buf.getChannelData(0);
  const { analyze } = await import('/src/dsp/analyze.ts');
  let m2 = mono; if (location.hash.includes('x')) m2 = mono; const { cleanAudio } = await import('/src/dsp/clean.ts'); const cl = cleanAudio(mono, buf.sampleRate, null); const an0 = analyze(mono, buf.sampleRate, 90); const an = analyze(cl.audio, buf.sampleRate, 90); window.__raw = an0.notes.slice(0, 8).map((n) => n.midi).join(' ');
  const { detectMeter, subdivisionFeel } = await import('/src/dsp/meter.ts'); const { mainBlockNotes } = await import('/src/dsp/formFromVocal.ts'); const bn = mainBlockNotes(an.notes); const m = detectMeter({ notes: bn }); const o = m?.options.map((x) => x.sig.num + '/' + x.sig.den + '@' + x.bpm + ' c' + x.confidence.toFixed(2) + ' fd' + x.firstDownbeatSec?.toFixed(2)); return { nClean: an.notes.length, nRaw: an0.notes.length, raw: window.__raw, first: an.notes.slice(0, 14).map((n) => n.midi + '@' + n.startSec.toFixed(2)).join(' '), opts: o, block: bn.length, n: an.notes.length };
}, readFileSync(process.argv[2]).toString('base64'));
console.log(JSON.stringify(r, null, 1));
await b.close();
