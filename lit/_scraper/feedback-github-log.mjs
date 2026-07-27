#!/usr/bin/env node
/*
 * The Lit — feedback → private GitHub log
 * =======================================
 *
 * Mirrors every Feedback submission (stouras.com/lit/feedback/) into a PRIVATE
 * GitHub repository, so the maintainer's assistant can read it directly from
 * GitHub — text AND attached screenshots — without needing the e-mail inbox.
 *
 * The static Feedback page can only WRITE to Firebase from the browser, so each
 * submission lands in the Firestore `feedback` collection (see lit/_firestore.rules).
 * This job — a scheduled GitHub Action, .github/workflows/lit-feedback-github-log.yml —
 * reads the submissions with the Firebase Admin SDK and writes one folder per
 * submission into a checked-out private "log" repo:
 *
 *   feedback/<id>/feedback.md     message + metadata, with the screenshots inlined
 *   feedback/<id>/feedback.json   the raw fields (minus the bulky image data URLs)
 *   feedback/<id>/screenshot-N.jpg   each attached screenshot, decoded
 *
 * plus a TICKET INDEX at the top of the tree, so a ticket is found instantly
 * (the maintainer refers to feedback by its LIT-YYMMDD-XXXX ticket, not by the
 * Firestore doc id the folders are named after):
 *
 *   feedback/INDEX.md    one table row per submission, newest first — ticket
 *                        (linked to its folder), date, submitter, status,
 *                        message + resolution excerpts
 *   feedback/index.json  the machine-readable copy of the same rows
 *
 * The workflow then commits + pushes that repo. It is **idempotent** — the log
 * repo itself is the record, no Firestore writes, no rules change — and it
 * SYNCS: a folder already mirrored gets its feedback.md/feedback.json REWRITTEN
 * whenever the doc changed (a ticket closed, a resolution recorded by the
 * feedback mailer's resolutions pass, a reopen), so the archive always shows
 * each ticket's current status; the decoded screenshots are immutable and are
 * never re-written. Nothing changed → nothing written → the workflow's
 * commit step is a no-op.
 *
 * WHY A SEPARATE PRIVATE REPO: this site's own repo is PUBLIC (GitHub Pages), and
 * feedback can contain the submitter's e-mail and screenshots of their screen —
 * that must not be committed publicly. The log repo is private; grant the
 * assistant's GitHub app read access to it so it can read the log on request.
 * Full setup: lit/_FEEDBACK-GITHUB-LOG-SETUP.md.
 *
 * Env (all via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or
 *                              GOOGLE_APPLICATION_CREDENTIALS = a file path).
 *   FEEDBACK_LOG_DIR           path to the checked-out private log repo.
 *
 * Modes:
 *   node feedback-github-log.mjs             real run (reads Firestore, writes files)
 *   node feedback-github-log.mjs --dry-run   reads Firestore, reports, writes nothing
 *   node feedback-github-log.mjs --selftest  offline render/decoge self-tests (no network)
 *
 * It is a clean no-op until FIREBASE_SERVICE_ACCOUNT + FEEDBACK_LOG_DIR are set,
 * so it never fails before the log repo is configured.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const SELFTEST = args.includes('--selftest');

// Decode a `data:<mime>;base64,<data>` URL into { ext, buf }. Returns null for
// anything that isn't a base64 image data URL (a malformed entry is skipped, not
// fatal). Mirrors dataUrlToAttachment in feedback-mailer.mjs.
export function dataUrlToImage(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
  let buf;
  try { buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64'); } catch (e) { return null; }
  if (!buf.length) return null;
  return { ext, buf };
}

// A Firestore Timestamp, a serialized {_seconds} shape, or an ISO string → ISO.
function isoOf(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v && typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return typeof v === 'string' ? v : '';
}

// One-line excerpt for the index (whitespace collapsed, capped).
export function excerptOf(text, n = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Human-readable Markdown for one submission (message + metadata + inlined
// screenshots + the recorded resolution, once the ticket is closed).
// `imageNames` are the files already written next to it.
export function renderMarkdown(doc, id, imageNames) {
  const s = v => String(v == null ? '' : v);
  const when = isoOf(doc.createdAt) || s(doc.createdAtIso);
  const from = [s(doc.name).trim(), doc.email ? `<${s(doc.email).trim()}>` : ''].filter(Boolean).join(' ') || 'anonymous';
  const out = [];
  out.push(`# Feedback — ${s(doc.ticket).trim() || id}`, '');
  out.push(s(doc.text).trim() || '_(no message — see the screenshot(s) below)_', '');
  out.push('---', '');
  out.push(`- **Ticket:** ${s(doc.ticket).trim() || '—'}`);
  out.push(`- **Status:** ${s(doc.status).trim() || 'new'}`);
  out.push(`- **From:** ${from}`);
  out.push(`- **Submitted:** ${when || '—'}`);
  out.push(`- **On page:** ${s(doc.url) || '—'}`);
  out.push(`- **Signed-in UID:** ${s(doc.uid) || '—'}`);
  out.push(`- **Browser:** ${s(doc.ua) || '—'}`);
  out.push(`- **Screenshots:** ${imageNames.length}`, '');
  imageNames.forEach(n => out.push(`![${n}](./${n})`, ''));
  if (s(doc.resolution).trim()) {
    out.push('## Resolution', '');
    out.push(s(doc.resolution).trim(), '');
    out.push(`- **Resolved:** ${isoOf(doc.resolvedAt) || isoOf(doc.closedAt) || '—'}`);
    if (doc.resolutionUrl) out.push(`- **See it live:** ${s(doc.resolutionUrl)}`);
    out.push(`- **Submitter e-mailed:** ${doc.resolutionSent ? 'yes' : 'no'}`, '');
  }
  return out.join('\n');
}

function withoutImages(doc) {
  const { images, ...rest } = doc;
  return { ...rest, imageCount: Array.isArray(images) ? images.length : 0 };
}

// Write one submission's folder under baseDir/feedback/<id>. Returns the number
// of files written, or 0 if it was already present (idempotent skip).
export function writeSubmission(baseDir, id, doc) {
  const dir = path.join(baseDir, 'feedback', id);
  if (fs.existsSync(dir)) return 0;      // already mirrored
  const imgs = Array.isArray(doc.images) ? doc.images : [];
  const names = [];
  const files = [];
  imgs.forEach((u, i) => {
    const im = dataUrlToImage(u);
    if (!im) return;
    const name = `screenshot-${i + 1}.${im.ext}`;
    names.push(name);
    files.push([name, im.buf]);
  });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, buf] of files) fs.writeFileSync(path.join(dir, name), buf);
  fs.writeFileSync(path.join(dir, 'feedback.md'), renderMarkdown(doc, id, names));
  fs.writeFileSync(path.join(dir, 'feedback.json'), JSON.stringify({ id, ...withoutImages(doc) }, null, 2));
  return files.length + 2;
}

// Mirror one submission, creating OR refreshing its folder: a new doc gets the
// full writeSubmission treatment (screenshots decoded); an already-mirrored one
// has its feedback.md/feedback.json rewritten when the doc changed (status
// closed, resolution recorded, reopened…) — the screenshots are immutable and
// never touched. Returns 'created' | 'updated' | 'unchanged'. With
// { dryRun: true } it reports what it WOULD do and writes nothing.
export function syncSubmission(baseDir, id, doc, opts = {}) {
  const dir = path.join(baseDir, 'feedback', id);
  if (!fs.existsSync(dir)) {
    if (opts.dryRun) return 'created';
    return writeSubmission(baseDir, id, doc) ? 'created' : 'unchanged';
  }
  const names = fs.readdirSync(dir)
    .filter(n => /^screenshot-\d+\.[a-z0-9]+$/i.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const md = renderMarkdown(doc, id, names);
  const json = JSON.stringify({ id, ...withoutImages(doc) }, null, 2);
  const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
  const mdPath = path.join(dir, 'feedback.md');
  const jsonPath = path.join(dir, 'feedback.json');
  let changed = false;
  if (read(mdPath) !== md) { changed = true; if (!opts.dryRun) fs.writeFileSync(mdPath, md); }
  if (read(jsonPath) !== json) { changed = true; if (!opts.dryRun) fs.writeFileSync(jsonPath, json); }
  return changed ? 'updated' : 'unchanged';
}

// One index row per submission — the ticket-first summary the maintainer (and
// the assistant) looks a ticket up by, without opening any folder.
export function indexEntry(id, doc) {
  const s = v => String(v == null ? '' : v);
  const name = s(doc.name).trim(), email = s(doc.email).trim();
  const e = {
    id,
    ticket: s(doc.ticket).trim() || id,   // older submissions predate tickets — fall back to the doc id
    date: isoOf(doc.createdAt) || s(doc.createdAtIso),
    from: [name, email && `<${email}>`].filter(Boolean).join(' ') || 'anonymous',
    status: s(doc.status).trim() || 'new',
    text: excerptOf(doc.text),
    images: Array.isArray(doc.images) ? doc.images.length : (doc.imageCount || 0),
    folder: `feedback/${id}`,
  };
  if (s(doc.resolution).trim()) e.resolution = excerptOf(doc.resolution);
  if (doc.resolutionSent) e.resolutionSent = true;
  return e;
}

// Build feedback/INDEX.md + feedback/index.json from the entries (newest
// first). Deterministic — no generated-at stamp — so an unchanged collection
// writes byte-identical files and the workflow's commit stays a no-op.
export function buildIndex(entries) {
  const sorted = entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cell = v => String(v == null ? '' : v).replace(/\|/g, '\\|');
  const md = [
    '# Feedback index',
    '',
    'One row per submission on stouras.com/lit/feedback/, newest first — the quick way',
    'to find a ticket. Open the linked `feedback/<id>/feedback.md` for the full message,',
    'metadata and screenshots; `index.json` beside this file is the machine-readable copy.',
    'Generated by `lit/_scraper/feedback-github-log.mjs` (site repo) — do not edit by hand.',
    '',
    '| Ticket | Date | From | Status | Message | Resolution |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sorted.map(e =>
      `| [${cell(e.ticket)}](./${e.id}/feedback.md) | ${String(e.date).slice(0, 10) || '—'} | ${cell(e.from)} ` +
      `| ${cell(e.status)}${e.resolutionSent ? ' ✉' : ''} | ${cell(e.text) || (e.images ? `(${e.images} screenshot(s) only)` : '—')} ` +
      `| ${cell(e.resolution) || '—'} |`),
    '',
  ].join('\n');
  return { md, json: JSON.stringify(sorted, null, 2) + '\n' };
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Feedback GitHub log: no Firebase credentials — nothing to do.');
    return;
  }
  const LOG_DIR = process.env.FEEDBACK_LOG_DIR || '';
  if (!LOG_DIR || !fs.existsSync(LOG_DIR)) {
    console.log('Feedback GitHub log: FEEDBACK_LOG_DIR not set / not checked out — nothing to do. Configure the private log repo (see lit/_FEEDBACK-GITHUB-LOG-SETUP.md).');
    return;
  }

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();

  let snap;
  try {
    snap = await db.collection('feedback').get();
  } catch (e) {
    console.error('Feedback GitHub log: could not read the feedback collection:', e && e.message);
    process.exitCode = 1; return;
  }
  const docs = snap.docs.slice().sort((a, b) => {
    const ta = a.get('createdAt'), tb = b.get('createdAt');
    return (ta && ta.toMillis ? ta.toMillis() : 0) - (tb && tb.toMillis ? tb.toMillis() : 0);
  });

  let added = 0, updated = 0;
  const entries = [];
  for (const d of docs) {
    const data = d.data();
    entries.push(indexEntry(d.id, data));
    const r = syncSubmission(LOG_DIR, d.id, data, { dryRun: DRY_RUN });
    if (r === 'created') { added++; console.log(`  ${DRY_RUN ? '[dry-run] would log' : '+ logged'} ${d.id}`); }
    else if (r === 'updated') { updated++; console.log(`  ${DRY_RUN ? '[dry-run] would refresh' : '~ refreshed'} ${d.id}`); }
  }

  // Ticket index — rewritten whole (deterministic), only when it changed.
  if (!DRY_RUN) {
    const { md, json } = buildIndex(entries);
    const idxDir = path.join(LOG_DIR, 'feedback');
    fs.mkdirSync(idxDir, { recursive: true });
    const write = (name, content) => {
      const p = path.join(idxDir, name);
      let cur = null; try { cur = fs.readFileSync(p, 'utf8'); } catch (e) {}
      if (cur !== content) { fs.writeFileSync(p, content); return true; }
      return false;
    };
    const idxChanged = [write('INDEX.md', md), write('index.json', json)].some(Boolean);
    if (idxChanged) console.log('  ~ ticket index refreshed');
  }
  console.log(`Feedback GitHub log: ${added} new, ${updated} refreshed, of ${docs.length} total.`);
}

/* ─────────────────────────── self-test (offline) ─────────────────────────── */
function selftest() {
  let fail = 0;
  const eq = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fail++; } };
  const os = require('node:os');

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const im = dataUrlToImage(png);
  eq(im && Buffer.isBuffer(im.buf) && im.buf.length > 0 && im.ext === 'png', 'PNG data URL decodes');
  eq(dataUrlToImage('data:image/jpeg;base64,/9j/').ext === 'jpg', 'jpeg → jpg ext');
  eq(dataUrlToImage('nope') === null, 'non-data-URL → null');

  const md = renderMarkdown({ text: 'Tooltip please', name: 'Jane', email: 'j@x.com', url: 'https://www.stouras.com/lit/', uid: 'u1', ticket: 'LIT-260717-A9K2', createdAtIso: '2026-07-17T10:00:00.000Z' }, 'abc123', ['screenshot-1.png']);
  eq(/^# Feedback — LIT-260717-A9K2/.test(md), 'markdown heading leads with the ticket');
  eq(md.includes('**Ticket:** LIT-260717-A9K2') && md.includes('**Status:** new'), 'markdown has ticket + status');
  eq(md.includes('Tooltip please') && md.includes('j@x.com') && md.includes('On page'), 'markdown has text + metadata');
  eq(md.includes('![screenshot-1.png](./screenshot-1.png)'), 'markdown inlines the screenshot');
  eq(/^# Feedback — legacy1/.test(renderMarkdown({ text: 'old' }, 'legacy1', [])), 'legacy doc without ticket falls back to the doc id');

  // resolution section — appears once the ticket is closed with a resolution
  const resDoc = {
    text: 'Dangling commas in titles', ticket: 'LIT-260725-YWTL', status: 'closed',
    resolution: 'Titles and affiliations are now trimmed at ingest.',
    resolutionUrl: 'https://www.stouras.com/lit/', resolutionSent: true,
    resolvedAt: { _seconds: 1785000000, _nanoseconds: 0 },
  };
  const rmd = renderMarkdown(resDoc, 'r1', []);
  eq(rmd.includes('## Resolution') && rmd.includes('trimmed at ingest'), 'markdown carries the resolution section');
  eq(rmd.includes('**See it live:** https://www.stouras.com/lit/'), 'resolution links the fixed area');
  eq(rmd.includes('**Submitter e-mailed:** yes') && rmd.includes('**Status:** closed'), 'resolution shows e-mailed + closed');
  eq(!renderMarkdown({ text: 'open' }, 'r2', []).includes('## Resolution'), 'no resolution section while open');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbglog-'));
  const n1 = writeSubmission(tmp, 'id1', { text: 'hi', images: [png, 'garbage', png] });
  eq(n1 === 4, 'writeSubmission wrote 2 images + md + json');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'screenshot-1.png')), 'image file written');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'feedback.md')), 'markdown written');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'feedback.json')), 'json written');
  eq(!('images' in JSON.parse(fs.readFileSync(path.join(tmp, 'feedback', 'id1', 'feedback.json'), 'utf8'))), 'json omits bulky image data URLs');
  eq(writeSubmission(tmp, 'id1', { text: 'hi' }) === 0, 'second write is an idempotent skip');

  // syncSubmission — create / unchanged / refresh-on-change, screenshots untouched
  eq(syncSubmission(tmp, 'id2', { text: 'new one', images: [png] }) === 'created', 'sync creates a missing folder');
  eq(syncSubmission(tmp, 'id2', { text: 'new one', images: [png] }) === 'unchanged', 'sync is a no-op when nothing changed');
  eq(syncSubmission(tmp, 'id2', { text: 'new one', status: 'closed', resolution: 'Fixed it.', images: [png] }, { dryRun: true }) === 'updated',
    'dry-run sync reports the pending refresh');
  eq(!fs.readFileSync(path.join(tmp, 'feedback', 'id2', 'feedback.md'), 'utf8').includes('Fixed it.'), 'dry-run sync wrote nothing');
  eq(syncSubmission(tmp, 'id2', { text: 'new one', status: 'closed', resolution: 'Fixed it.', images: [png] }) === 'updated',
    'sync refreshes when the doc changed');
  const smd = fs.readFileSync(path.join(tmp, 'feedback', 'id2', 'feedback.md'), 'utf8');
  eq(smd.includes('## Resolution') && smd.includes('Fixed it.'), 'refreshed markdown carries the resolution');
  eq(smd.includes('![screenshot-1.png](./screenshot-1.png)'), 'refresh keeps referencing the existing screenshot');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id2', 'screenshot-1.png')), 'refresh never touches the decoded screenshots');
  eq(syncSubmission(tmp, 'id3', { text: 'dry' }, { dryRun: true }) === 'created' && !fs.existsSync(path.join(tmp, 'feedback', 'id3')),
    'dry-run create writes nothing');
  fs.rmSync(tmp, { recursive: true, force: true });

  // ticket index — newest first, ticket links its folder, pipes escaped
  const idx = buildIndex([
    indexEntry('a1', { text: 'older | with pipe', ticket: 'LIT-260701-AAAA', createdAtIso: '2026-07-01T09:00:00.000Z', email: 'a@x.com' }),
    indexEntry('b2', { text: 'newer', ticket: 'LIT-260725-YWTL', createdAtIso: '2026-07-25T09:00:00.000Z', status: 'closed', resolution: 'Trimmed.', resolutionSent: true }),
    indexEntry('c3', { text: 'legacy, no ticket', createdAtIso: '2026-06-01T09:00:00.000Z' }),
  ]);
  eq(idx.md.indexOf('LIT-260725-YWTL') < idx.md.indexOf('LIT-260701-AAAA'), 'index is newest first');
  eq(idx.md.includes('[LIT-260725-YWTL](./b2/feedback.md)'), 'ticket cell links its folder');
  eq(idx.md.includes('older \\| with pipe'), 'pipes are escaped in table cells');
  eq(idx.md.includes('closed ✉') && idx.md.includes('Trimmed.'), 'index shows the resolution + e-mailed mark');
  eq(idx.md.includes('[c3](./c3/feedback.md)'), 'legacy doc without ticket indexes under its id');
  const rows = JSON.parse(idx.json);
  eq(rows.length === 3 && rows[0].ticket === 'LIT-260725-YWTL' && rows[0].folder === 'feedback/b2', 'index.json parses, newest first');
  eq(rows[0].resolutionSent === true && rows[2].from === 'anonymous', 'index.json carries sent-flag + anonymous fallback');

  if (fail) { console.error(`\nfeedback-github-log selftest: ${fail} failure(s)`); process.exit(1); }
  console.log('feedback-github-log selftest: OK');
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

if (SELFTEST) selftest();
else main().catch(e => { console.error('Feedback GitHub log error:', e && (e.stack || e.message || e)); process.exit(1); });

export { renderMarkdown as _renderMarkdown };
