// sqlite-bench.mjs — measure real wire bytes + latency per query for the
// range-served lit.db, by driving db-preview/index.html in headless Chromium
// against an in-process Range-capable server (mimicking GitHub Pages/Fastly).
//
//   LIT_DB=/tmp/lit.db BROWSER=/path/to/chromium node fun/lit/_scraper/sqlite-bench.mjs
//
// If LIT_DB is unset, a DB is built into the OS temp dir first. BROWSER defaults
// to $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome if present.
// Requires the `playwright` package to be resolvable.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { createRequire } from 'node:module';
import { emitDb, membershipFromIndexHtml } from './emit-db.mjs';
import { chunkDb } from './chunk-db.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LIT = path.resolve(HERE, '..');
const REPO = path.resolve(LIT, '..', '..');
const require = createRequire(import.meta.url);

let DB = process.env.LIT_DB;
if (!DB) {
  DB = path.join(os.tmpdir(), 'lit-bench.db');
  process.stderr.write('LIT_DB unset — building test DB…\n');
  emitDb(path.join(LIT, 'data'), JSON.parse(fs.readFileSync(path.join(LIT, 'data', 'sources.json'), 'utf8')), DB, membershipFromIndexHtml(path.join(LIT, 'index.html')));
}
// Chunk the DB so the page exercises the same chunked path as production.
const CHUNK_DIR = path.join(os.tmpdir(), 'lit-bench-db');
chunkDb(DB, CHUNK_DIR);
let BROWSER = process.env.BROWSER || process.env.CHROMIUM;
if (!BROWSER && process.env.PLAYWRIGHT_BROWSERS_PATH) {
  try { const d = fs.readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH).find((x) => /^chromium-\d/.test(x)); if (d) BROWSER = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, d, 'chrome-linux', 'chrome'); } catch {}
}
// playwright may be installed globally; try the repo, then $PLAYWRIGHT_MODULE,
// then common global locations.
function loadPlaywright() {
  const tries = ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch {} }
  throw new Error('playwright not found — set PLAYWRIGHT_MODULE to its path (tried: ' + tries.join(', ') + ')');
}
const { chromium } = loadPlaywright();
const PORT = 8799;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.db': 'application/octet-stream' };
let dbBytes = 0, dbReqs = 0;
function resolveUrl(u) {
  if (u === '/fun/lit/data/lit.db') return DB;
  if (u === '/fun/lit/data/lit.db.length') return DB + '.length';
  if (u.startsWith('/fun/lit/data/db/')) return path.join(CHUNK_DIR, u.slice('/fun/lit/data/db/'.length));
  return path.join(REPO, u);
}
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/__reset') { dbBytes = 0; dbReqs = 0; return res.end('ok'); }
  if (u === '/__bytes') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ bytes: dbBytes, reqs: dbReqs })); }
  let file = resolveUrl(req.url), st;
  try { st = fs.statSync(file); } catch { res.statusCode = 404; return res.end('nf'); }
  if (st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch { res.statusCode = 404; return res.end('nf'); } }
  const isDb = file.startsWith(CHUNK_DIR) && /lit\.db\.\d+$/.test(file);
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('accept-ranges', 'bytes');
  if (req.method === 'HEAD') { res.setHeader('content-length', st.size); return res.end(); }
  const range = req.headers.range, onErr = () => { try { res.destroy(); } catch {} };
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range), s = +m[1], e = m[2] ? +m[2] : st.size - 1;
    res.statusCode = 206; res.setHeader('content-range', `bytes ${s}-${e}/${st.size}`); res.setHeader('content-length', e - s + 1);
    if (isDb) { dbBytes += e - s + 1; dbReqs++; }
    fs.createReadStream(file, { start: s, end: e }).on('error', onErr).pipe(res);
  } else {
    res.setHeader('content-length', st.size); if (isDb) { dbBytes += st.size; dbReqs++; }
    fs.createReadStream(file).on('error', onErr).pipe(res);
  }
});
await new Promise((r) => server.listen(PORT, r));

const CASES = [
  ['type ft50 (facet only)', { jtype: ['ft50'] }, {}],
  ['year 2024 (facet only)', { year: ['2024'] }, {}],
  ['title ~market', {}, { title: 'market' }],
  ['abstract ~quantum (rare)', {}, { abstract: 'quantum' }],
  ['abstract ~pricing', {}, { abstract: 'pricing' }],
  ['abstract "machine learning"', { abstract: ['"machine learning"'] }, {}],
  ['author ~bertsim', {}, { author: 'bertsim' }],
  ['ft50 + abstract pricing + 2024', { jtype: ['ft50'], year: ['2024'] }, { abstract: 'pricing' }],
  ['preprint only', { preprintOnly: true }, {}],
  ['affiliation ~mit', {}, { affiliation: 'mit' }],
];
const selObj = (o) => ({ journal: o.journal || [], jtype: o.jtype || [], year: o.year || [], title: o.title || [], author: o.author || [], authorIdentity: o.authorIdentity || {}, affiliation: o.affiliation || [], abstract: o.abstract || [], preprintOnly: !!o.preprintOnly });
const liveObj = (o) => ({ title: (o.title || '').toLowerCase(), author: (o.author || '').toLowerCase(), affiliation: (o.affiliation || '').toLowerCase(), abstract: (o.abstract || '').toLowerCase() });

const browser = await chromium.launch({ executablePath: BROWSER || undefined, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto('http://localhost:' + PORT + '/fun/lit/db-preview/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
console.log('PAGE: ' + (await page.evaluate(() => document.getElementById('status').innerText)).replace(/\s+/g, ' '));
const init = await page.evaluate(() => window.__initCost());
console.log(`\nInit (worker + first COUNT): ${(init.bytes / 1024).toFixed(0)} KB / ${init.reqs} reqs\n`);
console.log('query'.padEnd(38) + 'X'.padStart(7) + 'latency'.padStart(9) + 'COLD wire'.padStart(12) + 'reqs'.padStart(6));
console.log('-'.repeat(72));
const out = [];
for (const [name, s, l] of CASES) {
  const cold = await page.evaluate((a) => window.__freshRun(a[0], a[1]), [selObj(s), liveObj(l)]);
  out.push(cold);
  console.log(name.padEnd(38) + String(cold.X).padStart(7) + (cold.ms.toFixed(0) + 'ms').padStart(9) + ((cold.bytes / 1024).toFixed(0) + ' KB').padStart(12) + String(cold.reqs).padStart(6));
}
const avg = out.reduce((a, r) => a + r.bytes / 1024, 0) / out.length;
console.log('-'.repeat(72));
console.log(`\nmean ${avg.toFixed(0)} KB / cold query; warm queries ~free (page cache). DB on origin: ${(fs.statSync(DB).size / 1e6).toFixed(0)} MB (never downloaded whole).`);
await browser.close(); server.close(); process.exit(0);
