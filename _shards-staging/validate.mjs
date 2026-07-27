// validate.mjs — post-build assertion for a staged shard (validate-shards.yml).
// Usage: node validate.mjs <shard-dir> <doi> [<doi>...]
// Verifies each required DOI is present in some papers-*.json, and prints the
// dataset's vital signs (per-journal counts, scope sizes, meta.json).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...requiredDois] = process.argv.slice(2);
const dataDir = join(dir, 'data');
const files = readdirSync(dataDir).filter(f => f.startsWith('papers-') && f.endsWith('.json'));
if (!files.length) { console.error('FAIL: no papers files were built'); process.exit(1); }

const byDoi = new Map();
for (const f of files.sort()) {
  const rows = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
  console.log(`  ${f}: ${rows.length} papers`);
  for (const r of rows) {
    const d = String(r.DOI || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
    if (d && !byDoi.has(d)) byDoi.set(d, { file: f, title: r.Title, abs: (r.Abstract || '').length });
  }
}
const scope = JSON.parse(readFileSync(join(dataDir, '_scope.json'), 'utf8'));
for (const k of Object.keys(scope)) console.log(`  scope[${k}]: ${Object.keys(scope[k]).length} DOIs`);
console.log('  meta:', readFileSync(join(dataDir, 'meta.json'), 'utf8'));

let missing = 0;
for (const doi of requiredDois) {
  const hit = byDoi.get(doi.toLowerCase());
  if (hit) console.log(`  ok  ${doi} -> ${hit.file} ("${String(hit.title).slice(0, 60)}…", abstract ${hit.abs} chars)`);
  else { console.error(`  FAIL missing required paper: ${doi}`); missing++; }
}
if (missing) process.exit(1);
console.log('validate.mjs: all required papers present.');
