// Shared helpers for the instrument pipeline (Node >= 20, ffmpeg on PATH).
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const CACHE = process.env.INSTR_CACHE ||
  'C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/instr-cache';
export const OUT = path.join(ROOT, 'public', 'instruments');
export const REPOS = {
  vsco: { slug: 'sgossner/VSCO-2-CE', name: 'VSCO 2 Community Edition' },
  vcsl: { slug: 'sgossner/VCSL', name: 'Versilian Community Sample Library (VCSL)' },
};

export function sh(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { maxBuffer: 1 << 29, encoding: 'buffer', ...opts }, (e, so, se) =>
      e ? rej(new Error(`${cmd} ${args.slice(0, 4).join(' ')}: ${e.message}\n${se?.toString().slice(-400)}`)) : res(so));
  });
}

export async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function loadTree(repo) {
  const f = path.join(CACHE, `${repo}.tree.json`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://api.github.com/repos/${REPOS[repo].slug}/git/trees/master?recursive=1`);
    const j = await r.json();
    if (j.truncated) throw new Error('tree truncated');
    fs.writeFileSync(f, JSON.stringify(j.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.size])));
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function rawUrl(repo, p) {
  return `https://raw.githubusercontent.com/${REPOS[repo].slug}/master/${p.split('/').map(encodeURIComponent).join('/')}`;
}
export function cachePath(repo, p) { return path.join(CACHE, 'raw', repo, ...p.split('/')); }

export async function download(repo, p) {
  const dst = cachePath(repo, p);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) return dst;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(rawUrl(repo, p));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(dst + '.part', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(dst + '.part', dst);
      return dst;
    } catch (e) { if (a === 3) throw new Error(`download ${p}: ${e.message}`); await new Promise((r) => setTimeout(r, 800 * (a + 1))); }
  }
}

// ---- filename parsing -----------------------------------------------------
const NOTE_RE = /(?:^|[_\-\s])([A-G])([#b]?)(-?\d)(?=[_\-.\s]|$)/;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parseNote(name) {
  const m = NOTE_RE.exec(name);
  if (!m) return null;
  return (parseInt(m[3], 10) + 1) * 12 + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const DYN = { ppp: 0, pp: 1, p: 2, mp: 3, mf: 4, f: 5, ff: 6, fff: 7, soft: 2, med: 4, medium: 4, loud: 6 };
export function parseVel(name) {
  let m = /[_\-]vl?(\d+)(?=[_.\-]|$)/i.exec(name); if (m) return +m[1];
  m = /[_\-](ppp|pp|p|mp|mf|f|ff|fff|soft|medium|med|loud)\d*(?=[_.\-]|$)/.exec(name); if (m) return DYN[m[1]];
  m = /dyn(\d)/i.exec(name); if (m) return +m[1];
  return 0;
}
export function parseRR(name) {
  const m = /[_\-]rr(\d+)/i.exec(name) || /_(\d{1,2})(?:\.\w+)?$/.exec(name); return m ? +m[1] : 1;
}
export const base = (p) => p.split('/').pop().replace(/\.(wav|flac|ogg|mp3)$/i, '');

// ---- audio ---------------------------------------------------------------
export async function decode(file, sr, ch) {
  const buf = await sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(sr), '-ac', String(ch), '-']);
  const a = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
  return Float32Array.from(a); // copy (alignment safe)
}
export function encodeMp3(data, sr, ch, outFile, kbps) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', String(ch), '-i', '-',
      '-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-joint_stereo', '1', outFile], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c ? rej(new Error('ffmpeg encode ' + err)) : res(fs.statSync(outFile).size)));
    p.stdin.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });
}
