// Download only the selected source files (raw.githubusercontent.com) into the cache outside the project.
import { plan } from './plan.mjs';
import { download, pool } from './lib.mjs';
const pl = await plan(); const files = new Map();
for (const it of pl) {
  const chosen = it.kind === 'pitched' ? Object.values(it.arts).flatMap((a) => a.chosen) : Object.values(it.hits).flatMap((h) => h.chosen);
  for (const c of chosen) files.set(c.f.p, it.spec.repo);
}
let done = 0; const total = files.size;
await pool([...files], 8, async ([p, repo]) => { await download(repo, p); if (++done % 100 === 0) console.log(done + '/' + total); });
console.log('fetched', done);
