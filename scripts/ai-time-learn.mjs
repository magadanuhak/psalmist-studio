// Times POST /analyze/song on the service (diagnostic): node scripts/ai-time-learn.mjs <audio> [cache_key]
import { readFileSync } from 'node:fs';
const base = 'http://127.0.0.1:5175';
const file = process.argv[2];
const fd = new FormData();
if (process.argv[3]) fd.append('cache_key', process.argv[3]);
else fd.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'song.wav');
fd.append('model', 'htdemucs'); fd.append('chords', 'auto'); fd.append('wait', 'false');
const t0 = Date.now();
let job = await (await fetch(base + '/analyze/song', { method: 'POST', body: fd })).json();
console.log('submitted', JSON.stringify(job).slice(0, 300));
let last = '';
while (job.status === 'queued' || job.status === 'running') {
  await new Promise((r) => setTimeout(r, 1000));
  job = await (await fetch(base + '/jobs/' + job.job_id)).json();
  const line = `${job.status} ${job.progress ?? ''} ${job.stage ?? job.message ?? ''}`;
  if (line !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', line); last = line; }
  if (Date.now() - t0 > 300000) { console.log('gave up'); break; }
}
console.log('done', ((Date.now() - t0) / 1000).toFixed(1) + 's', job.status, job.error ?? '');
