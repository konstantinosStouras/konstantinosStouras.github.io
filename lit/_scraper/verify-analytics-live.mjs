// Compare every served output with the exact committed bytes, including lazy files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../analytics');
const names = ['data.json', 'authors.json', 'rankings.json', 'disruption.json', 'citeflow.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = new Map(names.map(name => [name, sha(fs.readFileSync(path.join(dir, name)))]));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const attempts = Number(option('--attempts', 8));
const delay = Number(option('--delay-ms', 60000));
const base = option('--base', 'https://www.stouras.com/lit/analytics/');
let matched = false;
for (let attempt = 1; attempt <= attempts; attempt++) {
  const failed = [];
  for (const name of names) {
    try {
      const response = await fetch(base + name + '?snapshot=' + expected.get(name), { signal: AbortSignal.timeout(45000), cache: 'no-store' });
      if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== expected.get(name)) failed.push(name);
    } catch { failed.push(name); }
  }
  if (!failed.length) { matched = true; console.log('All five live analytics files match the committed snapshot.'); break; }
  console.log('Analytics verification attempt ' + attempt + ': stale or unavailable ' + failed.join(', '));
  if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delay));
}
if (!matched) process.exitCode = 1;
