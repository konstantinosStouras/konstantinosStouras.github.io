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
 * The workflow then commits + pushes that repo. It is **idempotent**: a
 * submission whose folder already exists is skipped, so the log repo itself is
 * the record of what's been mirrored — no Firestore writes, no rules change.
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

// Human-readable Markdown for one submission (message + metadata + inlined
// screenshots). `imageNames` are the files already written next to it.
export function renderMarkdown(doc, id, imageNames) {
  const s = v => String(v == null ? '' : v);
  const when = doc.createdAt && typeof doc.createdAt.toDate === 'function'
    ? doc.createdAt.toDate().toISOString() : (doc.createdAtIso || '');
  const from = [s(doc.name).trim(), doc.email ? `<${s(doc.email).trim()}>` : ''].filter(Boolean).join(' ') || 'anonymous';
  const out = [];
  out.push(`# Feedback — ${id}`, '');
  out.push(s(doc.text).trim() || '_(no message — see the screenshot(s) below)_', '');
  out.push('---', '');
  out.push(`- **From:** ${from}`);
  out.push(`- **Submitted:** ${when || '—'}`);
  out.push(`- **On page:** ${s(doc.url) || '—'}`);
  out.push(`- **Signed-in UID:** ${s(doc.uid) || '—'}`);
  out.push(`- **Browser:** ${s(doc.ua) || '—'}`);
  out.push(`- **Screenshots:** ${imageNames.length}`, '');
  imageNames.forEach(n => out.push(`![${n}](./${n})`, ''));
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

  let added = 0;
  for (const d of docs) {
    const dir = path.join(LOG_DIR, 'feedback', d.id);
    if (fs.existsSync(dir)) continue;
    if (DRY_RUN) { console.log(`[dry-run] would log ${d.id}`); added++; continue; }
    if (writeSubmission(LOG_DIR, d.id, d.data())) { added++; console.log(`  + logged ${d.id}`); }
  }
  console.log(`Feedback GitHub log: ${added} new submission(s) of ${docs.length} total.`);
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

  const md = renderMarkdown({ text: 'Tooltip please', name: 'Jane', email: 'j@x.com', url: 'https://stouras.com/lit/', uid: 'u1', createdAtIso: '2026-07-17T10:00:00.000Z' }, 'abc123', ['screenshot-1.png']);
  eq(/^# Feedback — abc123/.test(md), 'markdown has heading');
  eq(md.includes('Tooltip please') && md.includes('j@x.com') && md.includes('On page'), 'markdown has text + metadata');
  eq(md.includes('![screenshot-1.png](./screenshot-1.png)'), 'markdown inlines the screenshot');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbglog-'));
  const n1 = writeSubmission(tmp, 'id1', { text: 'hi', images: [png, 'garbage', png] });
  eq(n1 === 4, 'writeSubmission wrote 2 images + md + json');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'screenshot-1.png')), 'image file written');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'feedback.md')), 'markdown written');
  eq(fs.existsSync(path.join(tmp, 'feedback', 'id1', 'feedback.json')), 'json written');
  eq(!('images' in JSON.parse(fs.readFileSync(path.join(tmp, 'feedback', 'id1', 'feedback.json'), 'utf8'))), 'json omits bulky image data URLs');
  eq(writeSubmission(tmp, 'id1', { text: 'hi' }) === 0, 'second write is an idempotent skip');
  fs.rmSync(tmp, { recursive: true, force: true });

  if (fail) { console.error(`\nfeedback-github-log selftest: ${fail} failure(s)`); process.exit(1); }
  console.log('feedback-github-log selftest: OK');
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

if (SELFTEST) selftest();
else main().catch(e => { console.error('Feedback GitHub log error:', e && (e.stack || e.message || e)); process.exit(1); });

export { renderMarkdown as _renderMarkdown };
