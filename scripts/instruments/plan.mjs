// Selection logic shared by the dry-run and the build.
import { loadTree, base, parseNote, parseVel, parseRR } from './lib.mjs';
import { PITCHED, HITS } from './specs.mjs';

const AUDIO = /\.(wav|flac)$/i;
function pickLayers(ranks, layers) {
  const r = [...new Set(ranks)].sort((a, b) => a - b);
  if (r.length <= layers) return r;
  if (layers === 1) return [r[Math.floor((r.length - 1) / 2)]];
  if (layers === 2) return [r[0], r[r.length - 1]];
  return [r[0], r[Math.floor((r.length - 1) / 2)], r[r.length - 1]];
}
const nearest = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b));
const direct = (p, dir) => p.startsWith(dir + '/') && p.slice(dir.length + 1).indexOf('/') < 0;

export async function plan() {
  const trees = { vsco: await loadTree('vsco'), vcsl: await loadTree('vcsl') };
  const out = [];
  for (const s of PITCHED) {
    const arts = {};
    for (const [an, a] of Object.entries(s.arts)) {
      const files = trees[s.repo].filter(([p]) => direct(p, a.dir) && AUDIO.test(p) && (!a.re || a.re.test(base(p))) && !/_rel$|Blower/i.test(base(p)))
        .map(([p, size]) => ({ p, size, note: s.detectPitch ? 0 : (parseNote(base(p)) ?? NaN) + (a.shift ?? s.shift ?? 12), vel: parseVel(base(p)), rr: parseRR(base(p)), drum: /^[A-Za-z]+(\d)_/.exec(base(p))?.[1] }))
        .filter((f) => s.detectPitch || !Number.isNaN(f.note));
      if (!files.length) throw new Error(`no files for ${s.id}/${an} (${a.dir})`);
      const lay = pickLayers(files.map((f) => f.vel), s.layers);
      let notes;
      if (s.detectPitch) notes = [...new Set(files.map((f) => f.drum))];
      else {
        const all = [...new Set(files.map((f) => f.note))].sort((x, y) => x - y);
        notes = []; for (const n of all) if (!notes.length || n - notes[notes.length - 1] >= s.step) notes.push(n);
        if (notes[notes.length - 1] !== all[all.length - 1]) notes.push(all[all.length - 1]);
      }
      const chosen = [];
      for (const n of notes) {
        const mine = files.filter((f) => (s.detectPitch ? f.drum === n : f.note === n));
        const mv = [...new Set(mine.map((f) => f.vel))];
        lay.forEach((lv, li) => {
          const v = nearest(mv, lv);
          const f = mine.filter((x) => x.vel === v).sort((x, y) => x.rr - y.rr || x.p.localeCompare(y.p))[0];
          const prev = chosen.find((c) => c.f === f);
          if (prev) prev.layers.push(li); else chosen.push({ f, note: s.detectPitch ? null : n, layers: [li] });
        });
      }
      arts[an] = { ...a, chosen, nLayers: lay.length };
    }
    out.push({ kind: 'pitched', spec: s, arts });
  }
  for (const s of HITS) {
    const hits = {};
    for (const [hn, re] of Object.entries(s.hits)) {
      const files = trees[s.repo].filter(([p]) => direct(p, s.dir) && AUDIO.test(p) && !/_rel$/i.test(base(p)) && re.test(base(p)))
        .map(([p, size]) => ({ p, size, vel: parseVel(base(p)), rr: parseRR(base(p)) }));
      if (!files.length) throw new Error(`no files for ${s.id}/${hn}`);
      const lay = pickLayers(files.map((f) => f.vel), 3);
      const chosen = [];
      lay.forEach((lv, li) => {
        files.filter((f) => f.vel === lv).sort((x, y) => x.rr - y.rr || x.p.localeCompare(y.p)).slice(0, 2)
          .forEach((f) => chosen.push({ f, layer: li, hit: hn }));
      });
      hits[hn] = { chosen, nLayers: lay.length };
    }
    out.push({ kind: 'hits', spec: s, hits });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('plan.mjs')) {
  const pl = await plan(); let tot = 0, n = 0; const seen = new Set();
  for (const it of pl) {
    let b = 0, c = 0; const loc = new Set();
    const a2 = (f) => { if (!loc.has(f.p)) { loc.add(f.p); b += f.size; c++; } if (!seen.has(f.p)) { seen.add(f.p); tot += f.size; n++; } };
    if (it.kind === 'pitched') Object.values(it.arts).forEach((a) => a.chosen.forEach((x) => a2(x.f)));
    else Object.values(it.hits).forEach((h) => h.chosen.forEach((x) => a2(x.f)));
    console.log(it.spec.id.padEnd(18), String(c).padStart(4), 'files', (b / 1e6).toFixed(0).padStart(5), 'MB');
  }
  console.log('TOTAL', n, 'files', (tot / 1e6).toFixed(0), 'MB');
}
