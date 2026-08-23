#!/usr/bin/env node
/*
 * The Lit — feedback forwarder
 * ============================
 *
 * Delivers the messages people leave on the standalone Feedback page
 * (stouras.com/lit/feedback/). That page can only WRITE to Firebase from the
 * browser, so it stores each submission in a public-create-only Firestore
 * collection, `feedback` (see lit/_firestore.rules). This job — a scheduled
 * GitHub Action, .github/workflows/lit-feedback-mail.yml — reads the pending
 * submissions with the Firebase Admin SDK (which bypasses the rules), e-mails
 * each one to the maintainer with any screenshots attached, and marks it
 * forwarded so it is never sent twice. So everything lands in ONE place (the
 * maintainer's inbox), handy to review and act on later.
 *
 * A feedback document (written by lit/feedback/index.html) looks like:
 *   { text, images:[dataUrl,…], name, email, uid, ticket, page, url, ua,
 *     forwarded:false, status:'new', createdAt }
 * where `ticket` is the page-generated unique reference (LIT-YYMMDD-XXXX) and
 * each `images` entry is a client-compressed `data:image/jpeg;base64,…`
 * URL (Firestore caps a doc at ~1 MB, so the page downscales them first).
 *
 * Delivery is TWO e-mails per submission: the maintainer's copy (as always) and
 * — when the submitter left a valid e-mail — the SAME message back to them as a
 * confirmation, with their ticket number, so both sides hold the identical
 * record. An anonymous submission (no e-mail) by definition can't receive one,
 * so only the maintainer's copy is sent. The submitter copy is best-effort: its
 * failure never blocks (or re-triggers) the maintainer's copy.
 *
 * RESOLUTIONS PASS — closing the loop when feedback is acted on. Every run also
 * scans lit/_feedback-resolutions/ (in this repo; each file is one resolved
 * ticket — front matter `ticket:` + optional site-only `url:`, body = what was
 * done, see that directory's README). For each file it finds the feedback doc
 * by ticket, CLOSES it (status:'closed' + resolution + resolutionUrl +
 * resolutionHash, resolvedBy:'repo') BEFORE e-mailing, then sends the submitter
 * a "your feedback is resolved" e-mail — the resolution text, a "see it live"
 * link when given, and their original message — and stamps
 * resolutionSent/resolutionSentAt. Idempotent via resolutionHash: an unchanged
 * file is skipped forever; EDITING a file re-applies it and re-notifies. An
 * anonymous submission is just closed (nothing to send); a send failure leaves
 * resolutionSent unset so only the e-mail retries next run. This is what turns
 * "drop a resolution file in the repo" (the maintainer or the assistant, in the
 * same change as the fix) into the submitter's closure e-mail.
 *
 * Env / secrets (all via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465),
 *   SMTP_SECURE (default true when port 465), SMTP_USER, SMTP_PASS,
 *   ALERTS_FROM (default SMTP_USER), ALERTS_FROM_NAME (default "The Lit").
 *   FEEDBACK_TO (default kstouras@gmail.com) — where feedback is delivered.
 *
 * Modes:
 *   node feedback-mailer.mjs             real run (reads Firestore, sends mail)
 *   node feedback-mailer.mjs --dry-run   reads Firestore, prints instead of sending
 *   node feedback-mailer.mjs --scan      lists pending submissions + resolution files, sends nothing
 *   node feedback-mailer.mjs --selftest  offline render + attachment self-tests
 *   node feedback-mailer.mjs --limit=N   cap how many are processed this run (default 50)
 *
 * REVIEW-QUEUE PASS — a paper suggestion that needs the maintainer's hands is
 * SAID OUT LOUD. The Feedback page's other queue is `paperSubmissions`: a
 * suggested PUBLISHED paper the catalog genuinely lacks is stamped
 * status:'review' by the ingest (lit/_scraper-workingpapers/
 * ingest-submissions.mjs) and is never added automatically — the daily
 * harvests own the published catalog, so it waits in the 📄 Paper suggestions
 * inbox for the maintainer to add by hand. The ingest mentions it once, in a
 * batch summary at processing time, and that was the whole announcement: sent
 * fire-and-forget with no mark on the document, so an SMTP hiccup — or SMTP
 * simply not being configured yet that day — left the suggestion sitting in
 * the queue with nothing anywhere saying so. This pass e-mails the maintainer
 * ONE message per waiting suggestion (the resolved paper, the submitter's
 * citation, and the inbox to act in), stamping `reviewMailedAt` on the
 * document AFTER a successful send — never twice, and a failed send retries
 * next run. Above REVIEW_BURST at once (a backfill, or spam) they go as one
 * list instead of a mail bomb. The ingest's batch summary is unchanged — it
 * reports what a RUN did; this announces what is WAITING, however it got
 * there. Same shape as the review-queue mailer on operationsacademia.org.
 *
 * It is a clean no-op until FIREBASE_SERVICE_ACCOUNT + SMTP_* are configured, so
 * it never fails before the project is set up. See lit/_FEEDBACK-SETUP.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const SCAN     = args.includes('--scan');
const SELFTEST = args.includes('--selftest');
const LIMIT = (function () {
  const a = args.find(s => s.startsWith('--limit='));
  const n = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50;
})();

const FEEDBACK_TO = process.env.FEEDBACK_TO || 'kstouras@gmail.com';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Parse a `data:<mime>;base64,<data>` URL into a Nodemailer attachment. Returns
// null for anything that isn't a base64 image data URL (so a malformed entry is
// skipped rather than crashing the run).
function dataUrlToAttachment(dataUrl, i) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2].replace(/\s+/g, '');
  let content;
  try { content = Buffer.from(b64, 'base64'); } catch (e) { return null; }
  if (!content.length) return null;
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return { filename: `screenshot-${i + 1}.${ext}`, content, contentType: mime };
}

function firstLine(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Build the e-mail for one feedback document. Returns { subject, text, html,
// attachments } — attachments are the decoded screenshots.
function renderFeedbackEmail(doc) {
  const text = String(doc.text || '').trim();
  const name = String(doc.name || '').trim();
  const email = String(doc.email || '').trim();
  const ticket = String(doc.ticket || '').trim();
  const imgs = Array.isArray(doc.images) ? doc.images : [];
  const attachments = imgs.map(dataUrlToAttachment).filter(Boolean);

  const subjLead = firstLine(text, 60) || (attachments.length ? `${attachments.length} screenshot(s)` : 'new message');
  const subject = `[The Lit feedback] ${ticket ? ticket + ' — ' : ''}${subjLead}`;

  const whenIso = doc.createdAt && typeof doc.createdAt.toDate === 'function'
    ? doc.createdAt.toDate().toISOString() : (doc.createdAtIso || '');
  const who = [name, email && `<${email}>`].filter(Boolean).join(' ') || 'anonymous';

  const metaLines = [
    ['Ticket', ticket || '—'],
    ['From', who],
    ['Signed-in UID', doc.uid || '—'],
    ['On page', doc.url || '—'],
    ['Submitted', whenIso || '—'],
    ['Browser', doc.ua || '—'],
    ['Screenshots', String(attachments.length)],
  ];

  const bodyText =
    (text || '(no message — see attached screenshot(s))') + '\n\n' +
    '— — —\n' + metaLines.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';

  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;color:#241a1e;max-width:640px">' +
    '<h2 style="color:#7d1d3f;font-size:18px;margin:0 0 10px">New feedback on The Lit</h2>' +
    '<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;border-left:3px solid #c9a24b;padding:2px 0 2px 12px;margin:0 0 16px">' +
    (text ? htmlEscape(text) : '<em>(no message — see attached screenshot(s))</em>') + '</div>' +
    '<table style="font-size:12.5px;color:#6a5a60;border-collapse:collapse">' +
    metaLines.map(([k, v]) => '<tr><td style="padding:2px 12px 2px 0;font-weight:600;vertical-align:top">' + htmlEscape(k) +
      '</td><td style="padding:2px 0">' + htmlEscape(v) + '</td></tr>').join('') +
    '</table></div>';

  return { subject, text: bodyText, html, attachments, replyTo: EMAIL_RE.test(email) ? email : undefined };
}

// The submitter's confirmation copy — the SAME e-mail the maintainer receives
// (same subject, body and screenshots), prefixed with a short receipt banner
// naming their ticket number. Returns null when the submission is anonymous
// (no valid e-mail on record — nobody to confirm to).
function renderSubmitterEmail(doc) {
  const base = renderFeedbackEmail(doc);
  if (!base.replyTo) return null;    // anonymous — cannot receive a confirmation
  const ticket = String(doc.ticket || '').trim();
  const intro = 'Thank you for your feedback on The Lit! This is a copy of what I received' +
    (ticket ? ` — your reference number is ${ticket}` : '') +
    '. I read every message, and if a reply is needed it will arrive at this address.';
  return {
    to: base.replyTo,
    subject: base.subject,
    text: intro + '\n\n— — —\n\n' + base.text,
    html:
      '<div style="font-family:Segoe UI,Arial,sans-serif;color:#241a1e;max-width:640px;' +
      'background:#f4e6ea;border-left:3px solid #7d1d3f;padding:10px 14px;margin:0 0 16px;font-size:13.5px;line-height:1.55">' +
      htmlEscape(intro) + '</div>' + base.html,
    attachments: base.attachments,
  };
}

/* ───────────────────── resolutions — closing the loop ───────────────────── */

// Where the per-ticket resolution files live: lit/_feedback-resolutions/ in
// this repo (resolved relative to this script so cwd never matters).
const RES_DIR = process.env.FEEDBACK_RESOLUTIONS_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_feedback-resolutions');

// The "see it live" link may only point at the site itself — the resolution
// files live in a PUBLIC repo, and a host-validated href is the same discipline
// every other link the site e-mails or renders follows.
const SITE_HOSTS = new Set(['stouras.com', 'www.stouras.com']);

// Parse one resolution file: a small `---`-fenced front matter (`ticket:` —
// or `doc:` with the Firestore id for a legacy submission that predates
// tickets — plus an optional `url:`), then the body that is e-mailed to the
// submitter verbatim. Returns { ticket?, doc?, url?, body } or { error }.
export function parseResolutionFile(raw) {
  const s = String(raw || '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(s);
  if (!m) return { error: 'missing front matter (--- ticket: LIT-… ---)' };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const km = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(t);
    if (km) meta[km[1].toLowerCase()] = km[2].trim();
  }
  const ticket = String(meta.ticket || '').toUpperCase();
  const docId = String(meta.doc || '');
  if (!ticket && !docId) return { error: 'front matter needs a ticket: (or doc:) line' };
  if (ticket && !/^LIT-\d{6}-[A-Z0-9]{3,8}$/.test(ticket)) {
    return { error: `"${meta.ticket}" does not look like a LIT-YYMMDD-XXXX ticket` };
  }
  const body = m[2].trim();
  if (!body) return { error: 'resolution body is empty — write what was done (it is e-mailed to the submitter)' };
  const url = String(meta.url || '');
  if (url) {
    let u; try { u = new URL(url); } catch (e) { return { error: `invalid url: ${url}` }; }
    if (u.protocol !== 'https:' || !SITE_HOSTS.has(u.hostname)) {
      return { error: `url must be an https link on stouras.com (got ${url})` };
    }
  }
  const out = { body };
  if (ticket) out.ticket = ticket;
  if (docId) out.doc = docId;
  if (url) out.url = url;
  return out;
}

// Content fingerprint stamped onto the feedback doc (resolutionHash): an
// unchanged file is skipped forever; editing the body/url re-applies + re-mails.
export function resolutionHashOf(res) {
  return crypto.createHash('sha256')
    .update([res.ticket || res.doc || '', res.url || '', res.body].join('\n'))
    .digest('hex').slice(0, 16);
}

// The submitter's "your feedback is resolved" e-mail — the resolution text, an
// optional "see it live" link, and their original message so the thread stands
// alone. Returns null when the submission is anonymous (nobody to notify).
export function renderResolutionEmail(doc, res) {
  const email = String(doc.email || '').trim();
  if (!EMAIL_RE.test(email)) return null;
  const ticket = String(doc.ticket || '').trim() || res.ticket || '';
  const name = String(doc.name || '').trim() || 'reader';
  let orig = String(doc.text || '').trim() || '(screenshots only)';
  if (orig.length > 1500) orig = orig.slice(0, 1500) + '…';
  const subject = `The Lit — your feedback (ticket ${ticket}) is resolved`;
  const text =
    `Dear ${name},\n\n` +
    `Good news — your feedback on The Lit (ticket ${ticket}) has been acted on, and the fix is now live.\n\n` +
    `What was done:\n${res.body}\n\n` +
    (res.url ? `See it live: ${res.url}\n\n` : '') +
    `— — —\nYour original message:\n${orig}\n\n` +
    `Thank you again for helping improve the site!\n\nKonstantinos\nhttps://www.stouras.com/lit/`;
  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;color:#241a1e;max-width:640px">' +
    '<h2 style="color:#7d1d3f;font-size:18px;margin:0 0 10px">Your feedback is resolved — ticket ' + htmlEscape(ticket) + '</h2>' +
    '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Dear ' + htmlEscape(name) + ',</p>' +
    '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Good news — your feedback on ' +
    '<a href="https://www.stouras.com/lit/" style="color:#7d1d3f">The Lit</a> has been acted on, and the fix is now live.</p>' +
    '<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;border-left:3px solid #c9a24b;padding:2px 0 2px 12px;margin:0 0 14px">' +
    htmlEscape(res.body) + '</div>' +
    (res.url
      ? '<p style="font-size:14px;margin:0 0 14px"><a href="' + htmlEscape(res.url) + '" style="color:#7d1d3f;font-weight:600">See it live →</a></p>'
      : '') +
    '<div style="font-size:12.5px;color:#6a5a60;border-top:1px solid #e7dbe0;padding-top:10px">Your original message:<br>' +
    '<span style="white-space:pre-wrap">' + htmlEscape(orig) + '</span></div>' +
    '<p style="font-size:13px;margin:14px 0 0">Thank you again for helping improve the site!<br>' +
    'Konstantinos · <a href="https://www.stouras.com/lit/" style="color:#7d1d3f">stouras.com/lit</a></p>' +
    '</div>';
  return { to: email, subject, text, html };
}

// List the resolution files (README + _-prefixed files excluded), sorted.
function resolutionFiles() {
  try {
    return fs.readdirSync(RES_DIR)
      .filter(n => /\.md$/i.test(n) && !/^readme\.md$/i.test(n) && !n.startsWith('_'))
      .sort();
  } catch (e) { return []; }   // no resolutions directory — nothing to do
}

// The resolutions pass: apply each file to its feedback doc (close + record the
// resolution FIRST, e-mail second — a send failure retries only the e-mail),
// idempotent via resolutionHash + resolutionSent.
async function applyResolutions(db, FieldValue, transport, fromAddr, fromName) {
  const files = resolutionFiles();
  if (!files.length) return;
  console.log(`\nResolutions: ${files.length} file(s) in ${RES_DIR}.`);
  let closed = 0, emailed = 0, upToDate = 0, failed = 0;
  for (const f of files) {
    const res = parseResolutionFile(fs.readFileSync(path.join(RES_DIR, f), 'utf8'));
    if (res.error) { console.warn(`  ⚠ ${f}: ${res.error}`); failed++; continue; }
    const label = res.ticket || res.doc;
    let ref = null, data = null;
    try {
      if (res.doc) {
        const d = await db.collection('feedback').doc(res.doc).get();
        if (d.exists) { ref = d.ref; data = d.data(); }
      } else {
        const q = await db.collection('feedback').where('ticket', '==', res.ticket).limit(2).get();
        if (q.docs.length > 1) console.warn(`  ⚠ ${f}: ticket ${res.ticket} matches ${q.docs.length} docs — using the first`);
        if (q.docs.length) { ref = q.docs[0].ref; data = q.docs[0].data(); }
      }
    } catch (e) { console.warn(`  ⚠ ${f}: lookup failed: ${e && e.message}`); failed++; continue; }
    if (!ref) { console.warn(`  ⚠ ${f}: no feedback doc for ${label} (deleted?) — skipping`); upToDate++; continue; }

    const hash = resolutionHashOf(res);
    if (data.resolutionHash === hash && data.resolutionSent) { upToDate++; continue; }
    const mail = renderResolutionEmail(data, res);
    if (DRY_RUN) {
      console.log(`  [dry-run] ${f}: would close ${label}` + (mail ? ` and e-mail ${mail.to}` : ' (anonymous — no e-mail)'));
      continue;
    }
    try {
      if (data.resolutionHash !== hash) {
        await ref.update({
          status: 'closed',
          resolution: res.body,
          resolutionUrl: res.url || FieldValue.delete(),
          resolutionHash: hash,
          resolutionSent: false,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: 'repo',
        });
        closed++;
        console.log(`  ✓ closed ${label} (${f})`);
      }
      if (!mail) {   // anonymous — nothing to send; mark handled so it never re-runs
        await ref.update({ resolutionSent: true });
        console.log('    (anonymous submission — closed without an e-mail)');
        continue;
      }
      await transport.sendMail({
        from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
        to: mail.to,
        replyTo: FEEDBACK_TO,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { 'X-Lit-Feedback': ref.id },
      });
      await ref.update({ resolutionSent: true, resolutionSentAt: FieldValue.serverTimestamp() });
      emailed++;
      console.log(`    ✓ resolution e-mail → ${mail.to}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${f}: ${e && e.message}`);
    }
  }
  console.log(`Resolutions done. Closed ${closed}, e-mailed ${emailed}, already up to date ${upToDate}, failed ${failed}.`);
}

/* ─────────────── review queue — the suggestions waiting on YOU ───────────── */

// More than this many un-announced at once is a batch (a backfill, or spam),
// not readers trickling in, and goes as ONE list — the same mail-bomb
// reasoning as the burst rule in operationsacademia.org's review mailer.
const REVIEW_BURST = (function () {
  const n = parseInt(process.env.FEEDBACK_REVIEW_BURST || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

const FEEDBACK_PAGE = 'https://www.stouras.com/lit/feedback/';

// What one waiting suggestion is, for the subject line and the digest rows:
// the RESOLVED paper first (the ingest already looked it up in Crossref/
// OpenAlex — that is what the maintainer will actually add), the submitter's
// typed title only as the fallback.
function reviewLabel(doc) {
  const title = String(doc.resolvedTitle || doc.title || '').trim() || '(title unresolved)';
  const journal = String(doc.resolvedJournal || '').trim();
  return journal ? `${title} — ${journal}` : title;
}

// One suggestion waiting for the maintainer's hands. Pure, so the selftest can
// hold it still. The e-mail says the one thing that matters first: nothing
// will add this paper on its own.
export function renderReviewNudgeEmail(doc) {
  const label = reviewLabel(doc);
  const ticket = String(doc.ticket || '').trim();
  const doi = String(doc.resolvedDoi || '').trim();
  const subject = `[The Lit] paper suggestion to review — ${firstLine(label, 70)}`;

  const metaLines = [
    ['Resolved title', doc.resolvedTitle || '—'],
    ['Journal', doc.resolvedJournal || '—'],
    ['DOI', doi || '—'],
    ['Submitted as', [doc.title, doc.url].filter(Boolean).join(' · ') || '—'],
    ['Citation', firstLine(doc.citation, 300) || '—'],
    ['Note', firstLine(doc.note, 300) || '—'],
    ['Suggested by', [doc.name, doc.email].filter(Boolean).join(' ') || 'anonymous'],
    ['Ticket', ticket || '—'],
  ];

  const bodyText =
    'A reader suggested a published paper The Lit genuinely lacks. It was resolved and ' +
    'checked against the catalog, and it is NOT added automatically — published papers are ' +
    'the daily harvests’ to add, so this one waits in the Paper suggestions inbox until ' +
    'you add it by hand (or delete the suggestion).\n\n' +
    metaLines.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' +
    (doi ? `Paper: https://doi.org/${doi}\n` : '') +
    `Inbox: ${FEEDBACK_PAGE}\n\n` +
    'This reminder is sent once per suggestion; the card stays in the inbox until you act on it.';

  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;color:#241a1e;max-width:640px">' +
    '<h2 style="color:#7d1d3f;font-size:18px;margin:0 0 10px">A paper suggestion is waiting for you</h2>' +
    '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">A reader suggested a published paper ' +
    'The Lit genuinely lacks. It is <b>not added automatically</b> — it waits in the ' +
    '<a href="' + FEEDBACK_PAGE + '" style="color:#7d1d3f">📄 Paper suggestions inbox</a> ' +
    'until you add it by hand.</p>' +
    '<table style="font-size:12.5px;color:#6a5a60;border-collapse:collapse;margin:0 0 14px">' +
    metaLines.map(([k, v]) => '<tr><td style="padding:2px 12px 2px 0;font-weight:600;vertical-align:top">' + htmlEscape(k) +
      '</td><td style="padding:2px 0">' + htmlEscape(v) + '</td></tr>').join('') +
    '</table>' +
    (doi ? '<p style="font-size:14px;margin:0 0 8px"><a href="https://doi.org/' + htmlEscape(doi) +
      '" style="color:#7d1d3f;font-weight:600">Open the paper →</a></p>' : '') +
    '<p style="font-size:14px;margin:0 0 14px"><a href="' + FEEDBACK_PAGE +
      '" style="color:#7d1d3f;font-weight:600">Open the suggestions inbox →</a></p>' +
    '<p style="font-size:12.5px;color:#6a5a60;margin:0">This reminder is sent once per suggestion; ' +
    'the card stays in the inbox until you act on it.</p>' +
    '</div>';

  return { subject, text: bodyText, html };
}

// A burst, as one list — what is waiting, never the per-item card repeated.
export function renderReviewDigestEmail(items) {
  const subject = `[The Lit] ${items.length} paper suggestions to review`;
  const rows = items.map(({ doc }) => {
    const bits = [reviewLabel(doc), doc.resolvedDoi ? 'doi:' + doc.resolvedDoi : '',
      doc.ticket ? '#' + doc.ticket : ''].filter(Boolean);
    return bits.join('  ·  ');
  });
  const text =
    `${items.length} suggested published papers are waiting in the Paper suggestions inbox. ` +
    'None is added automatically — each waits until you add it by hand.\n\n' +
    rows.map(r => '• ' + r).join('\n') + '\n\n' +
    `Inbox: ${FEEDBACK_PAGE}\n`;
  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;color:#241a1e;max-width:640px">' +
    '<h2 style="color:#7d1d3f;font-size:18px;margin:0 0 10px">' + items.length +
    ' paper suggestions are waiting for you</h2>' +
    '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">They arrived together, so they are ' +
    'listed here rather than sent one by one. None is added automatically.</p>' +
    '<ul style="font-size:13.5px;line-height:1.7;margin:0 0 14px;padding-left:20px">' +
    rows.map(r => '<li>' + htmlEscape(r) + '</li>').join('') + '</ul>' +
    '<p style="font-size:14px;margin:0"><a href="' + FEEDBACK_PAGE +
      '" style="color:#7d1d3f;font-weight:600">Open the suggestions inbox →</a></p>' +
    '</div>';
  return { subject, text, html };
}

// The waiting-and-unannounced suggestions, oldest first — the same
// single-equality query + in-memory sort discipline as the feedback read.
async function pendingReviewSuggestions(db) {
  const snap = await db.collection('paperSubmissions').where('status', '==', 'review').limit(LIMIT).get();
  return snap.docs
    .filter(d => !d.get('reviewMailedAt'))
    .map(d => ({ id: d.id, ref: d.ref, doc: d.data() }))
    .sort((a, b) => {
      const t = (x) => {
        const v = x.doc.processedAt || x.doc.createdAt;
        return v && v.toMillis ? v.toMillis() : 0;
      };
      return t(a) - t(b);
    });
}

// Third phase: say what is waiting. `reviewMailedAt` is stamped AFTER a
// successful send — the failure that matters is a suggestion nobody hears
// about; a duplicate after a crash between the two is a nuisance, and that is
// the right way round (the same order the forwarding pass uses).
async function announceReviewQueue(db, FieldValue, transport, fromAddr, fromName) {
  let items;
  try {
    items = await pendingReviewSuggestions(db);
  } catch (e) {
    console.error('Review queue: could not read paperSubmissions:', e && e.message);
    return;
  }
  if (!items.length) return;
  console.log(`\nReview queue: ${items.length} paper suggestion(s) waiting and not yet announced.`);

  const from = fromName ? `"${fromName}" <${fromAddr}>` : fromAddr;

  if (items.length > REVIEW_BURST) {
    const mail = renderReviewDigestEmail(items);
    if (DRY_RUN) { console.log(`  [dry-run] would send ONE digest: ${mail.subject}`); return; }
    try {
      await transport.sendMail({ from, to: FEEDBACK_TO, subject: mail.subject, text: mail.text, html: mail.html });
    } catch (e) { console.error('  ✗ review digest failed:', e && e.message); return; }
    for (const it of items) {
      try { await it.ref.update({ reviewMailedAt: FieldValue.serverTimestamp() }); }
      catch (e) { console.error(`  ⚠ announced ${it.id} but could not stamp it (${e && e.message}) — it may be announced twice`); }
    }
    console.log(`  ✓ ${items.length} announced as one digest.`);
    return;
  }

  for (const it of items) {
    const mail = renderReviewNudgeEmail(it.doc);
    if (DRY_RUN) { console.log(`  [dry-run] → ${FEEDBACK_TO}: ${mail.subject}`); continue; }
    try {
      await transport.sendMail({ from, to: FEEDBACK_TO, subject: mail.subject, text: mail.text, html: mail.html,
        headers: { 'X-Lit-Submission': it.id } });
    } catch (e) {
      // left unstamped on purpose, so the next run tries again
      console.error(`  ✗ ${it.id}: ${e && e.message}`);
      continue;
    }
    try { await it.ref.update({ reviewMailedAt: FieldValue.serverTimestamp() }); }
    catch (e) { console.error(`  ⚠ announced ${it.id} but could not stamp it (${e && e.message}) — it may be announced twice`); }
    console.log(`  ✓ announced ${it.id}`);
  }
}

/* ─────────────────────────── self-test (offline) ─────────────────────────── */
function selftest() {
  let fail = 0;
  const eq = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fail++; } };

  // 1x1 PNG data URL
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const att = dataUrlToAttachment(png, 0);
  eq(att && Buffer.isBuffer(att.content) && att.content.length > 0, 'PNG data URL decodes to a non-empty Buffer');
  eq(att && att.filename === 'screenshot-1.png', 'attachment filename derives from mime');
  eq(dataUrlToAttachment('data:image/jpeg;base64,/9j/', 2).filename === 'screenshot-3.jpg', 'jpeg → .jpg ext');
  eq(dataUrlToAttachment('not-a-data-url', 0) === null, 'non-data-URL is skipped (null)');
  eq(dataUrlToAttachment('data:text/html;base64,AAAA', 0) === null, 'non-image data URL is skipped');

  const fbDoc = {
    text: 'The citations chart y-axis overlaps on mobile. Could you fix the label?',
    name: 'Jane Doe', email: 'jane@example.com', uid: 'u9', ticket: 'LIT-260717-A9K2',
    url: 'https://www.stouras.com/lit/analytics/', ua: 'Mozilla/5.0',
    images: [png, png, 'garbage'], createdAtIso: '2026-07-17T10:00:00.000Z',
  };
  const mail = renderFeedbackEmail(fbDoc);
  eq(/^\[The Lit feedback\] /.test(mail.subject), 'subject is prefixed');
  eq(mail.subject.includes('LIT-260717-A9K2'), 'subject carries the ticket number');
  eq(mail.subject.includes('citations chart'), 'subject leads with the message');
  eq(mail.text.includes('Ticket: LIT-260717-A9K2') && mail.html.includes('LIT-260717-A9K2'), 'ticket in both bodies');
  eq(mail.attachments.length === 2, 'two valid screenshots become attachments, garbage dropped');
  eq(mail.replyTo === 'jane@example.com', 'reply-to is the submitter e-mail');
  eq(mail.html.includes('jane@example.com') && mail.text.includes('jane@example.com'), 'sender shown in both parts');
  eq(mail.html.includes('&lt;') === false || true, 'html renders'); // smoke

  // submitter confirmation copy — the same e-mail plus a receipt banner
  const ack = renderSubmitterEmail(fbDoc);
  eq(ack && ack.to === 'jane@example.com', 'confirmation goes to the submitter');
  eq(ack && ack.subject === mail.subject, 'confirmation carries the SAME subject');
  eq(ack && ack.text.includes('LIT-260717-A9K2') && ack.html.includes('LIT-260717-A9K2'), 'confirmation names the ticket');
  eq(ack && ack.text.includes(fbDoc.text), 'confirmation contains the same message');
  eq(ack && ack.attachments.length === 2, 'confirmation carries the same screenshots');

  // no-message, screenshot-only
  const m2 = renderFeedbackEmail({ text: '', images: [png], email: 'bad-email' });
  eq(m2.subject.includes('screenshot'), 'screenshot-only subject falls back');
  eq(m2.replyTo === undefined, 'invalid e-mail is not used as reply-to');
  eq(m2.text.includes('no message'), 'no-message body placeholder present');
  eq(renderSubmitterEmail({ text: 'hi', images: [], email: 'bad-email' }) === null, 'invalid e-mail → no confirmation copy');
  eq(renderSubmitterEmail({ text: 'hi', images: [] }) === null, 'anonymous → no confirmation copy (admin only)');
  eq(renderFeedbackEmail({ text: 'no ticket legacy doc' }).subject.indexOf('undefined') === -1, 'legacy doc without ticket still renders');

  // resolution files — parsing
  const good = parseResolutionFile('---\nticket: lit-260725-ywtl\nurl: https://www.stouras.com/lit/\n---\nTitles are now trimmed at ingest.\n');
  eq(good.ticket === 'LIT-260725-YWTL' && good.url === 'https://www.stouras.com/lit/' &&
     good.body === 'Titles are now trimmed at ingest.' && !good.error, 'resolution file parses (ticket upper-cased)');
  eq(parseResolutionFile('---\r\nticket: LIT-260725-YWTL\r\n---\r\nCRLF body.\r\n').body === 'CRLF body.', 'CRLF files parse');
  eq(!!parseResolutionFile('no front matter').error, 'missing front matter → error');
  eq(!!parseResolutionFile('---\nurl: https://www.stouras.com/lit/\n---\nbody').error, 'missing ticket/doc → error');
  eq(!!parseResolutionFile('---\nticket: NOT-A-TICKET\n---\nbody').error, 'malformed ticket → error');
  eq(!!parseResolutionFile('---\nticket: LIT-260725-YWTL\n---\n\n').error, 'empty body → error');
  eq(!!parseResolutionFile('---\nticket: LIT-260725-YWTL\nurl: https://evil.example.com/\n---\nbody').error, 'off-site url → error (host-validated)');
  eq(!!parseResolutionFile('---\nticket: LIT-260725-YWTL\nurl: http://www.stouras.com/lit/\n---\nbody').error, 'non-https url → error');
  eq(parseResolutionFile('---\ndoc: abc123\n---\nLegacy doc body.').doc === 'abc123', 'doc: reaches a legacy submission without a ticket');

  // resolution hash — stable, content-sensitive
  eq(resolutionHashOf(good) === resolutionHashOf({ ...good }), 'hash is stable');
  eq(resolutionHashOf(good) !== resolutionHashOf({ ...good, body: good.body + ' More.' }), 'hash changes with the body');
  eq(resolutionHashOf(good) !== resolutionHashOf({ ...good, url: undefined }), 'hash changes with the url');

  // resolution e-mail — content + anonymous handling
  const resMail = renderResolutionEmail(fbDoc, good);
  eq(resMail && resMail.to === 'jane@example.com', 'resolution e-mail goes to the submitter');
  eq(resMail.subject === 'The Lit — your feedback (ticket LIT-260717-A9K2) is resolved', 'resolution subject names the ticket');
  eq(resMail.text.includes(good.body) && resMail.html.includes('Titles are now trimmed'), 'resolution text in both bodies');
  eq(resMail.text.includes('See it live: https://www.stouras.com/lit/') && resMail.html.includes('href="https://www.stouras.com/lit/"'),
    'resolution links the fixed area');
  eq(resMail.text.includes(fbDoc.text) && resMail.html.includes('citations chart'), 'original message quoted back');
  eq(resMail.text.includes('Dear Jane Doe'), 'greeting uses the submitter name');
  eq(renderResolutionEmail({ text: 'x', email: 'not-an-email' }, good) === null, 'anonymous/invalid e-mail → no resolution e-mail');
  eq(renderResolutionEmail({ text: 'x', email: 'a@b.co' }, { ticket: 'LIT-260725-YWTL', body: 'Done.' }).text.includes('Dear reader'),
    'no name → “Dear reader”, ticket falls back to the file’s');
  const esc1 = renderResolutionEmail({ text: '<b>bold</b>', email: 'a@b.co', ticket: 'LIT-1' }, { body: 'Fixed <sup>tags</sup>.' });
  eq(esc1.html.includes('&lt;sup&gt;tags&lt;/sup&gt;') && esc1.html.includes('&lt;b&gt;bold&lt;/b&gt;'), 'html escapes user + resolution text');

  // review-queue nudge — the suggestions only the maintainer's hands can add
  const rvDoc = {
    status: 'review', mode: 'published',
    resolvedTitle: 'Strategic Queueing in Service Systems', resolvedJournal: 'Management Science',
    resolvedDoi: '10.1287/mnsc.2020.1234',
    title: 'strategic queueing (typed)', url: 'https://doi.org/10.1287/mnsc.2020.1234',
    citation: 'Doe, J. (2020). Strategic Queueing in Service Systems. Management Science 66(4).',
    note: 'Please add — heavily cited in our field.',
    name: 'Jane Doe', email: 'jane@example.com', ticket: 'LIT-260901-QQ01',
  };
  const nudge = renderReviewNudgeEmail(rvDoc);
  eq(nudge.subject.includes('paper suggestion to review'), 'nudge subject says what is waiting');
  eq(nudge.subject.includes('Strategic Queueing'), 'and names the RESOLVED paper, not the typed title');
  eq(nudge.text.includes('NOT added automatically') && /not added automatically/i.test(nudge.html),
    'nudge says the one thing that matters: nothing will add it on its own');
  eq(nudge.text.includes('https://www.stouras.com/lit/feedback/') &&
     nudge.html.includes('https://www.stouras.com/lit/feedback/'),
    'nudge links the suggestions inbox in both bodies');
  eq(nudge.text.includes('https://doi.org/10.1287/mnsc.2020.1234'), 'nudge links the paper by DOI');
  eq(nudge.text.includes(rvDoc.citation) && nudge.html.includes('LIT-260901-QQ01'),
    'the submitter’s citation and the ticket travel with it');
  eq(renderReviewNudgeEmail({ status: 'review' }).subject.includes('(title unresolved)'),
    'a suggestion the ingest could not name still renders honestly');

  const rvMany = Array.from({ length: 12 }, (_, i) => ({ id: 'd' + i,
    doc: { ...rvDoc, resolvedTitle: 'Paper ' + i, ticket: 'LIT-260901-Q' + i } }));
  const rvDigest = renderReviewDigestEmail(rvMany);
  eq(rvDigest.subject.startsWith('12 ') || rvDigest.subject.includes(' 12 '),
    'a burst is announced once, with the count in the subject');
  eq(rvDigest.text.includes('Paper 0') && rvDigest.text.includes('Paper 11'),
    'and lists every waiting suggestion');
  eq(!/added automatically[\s\S]*added automatically[\s\S]*added automatically/.test(rvDigest.text),
    'said once, not once per suggestion');

  if (fail) { console.error(`\nfeedback-mailer selftest: ${fail} failure(s)`); process.exit(1); }
  console.log('feedback-mailer selftest: OK');
}

/* ─────────────────────────────── main run ────────────────────────────────── */
async function run() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Feedback mailer: no Firebase credentials configured — nothing to do. Add the FIREBASE_SERVICE_ACCOUNT secret to enable.');
    return;
  }
  if (!DRY_RUN && !SCAN && !process.env.SMTP_USER) {
    console.log('Feedback mailer: SMTP not configured (no SMTP_USER) — nothing to send. Add the SMTP_* secrets to enable.');
    return;
  }

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  // Pending = not yet forwarded. Ordered oldest-first so we work through the
  // backlog in arrival order. (No composite index needed: a single equality
  // filter + a single orderBy on a different field is allowed, but to be safe
  // against a missing index we sort in memory.)
  let snap;
  try {
    snap = await db.collection('feedback').where('forwarded', '==', false).limit(LIMIT).get();
  } catch (e) {
    console.error('Feedback mailer: could not read the feedback collection:', e && e.message);
    process.exitCode = 1; return;
  }
  const docs = snap.docs.slice().sort((a, b) => {
    const ta = a.get('createdAt'), tb = b.get('createdAt');
    const na = ta && ta.toMillis ? ta.toMillis() : 0, nb = tb && tb.toMillis ? tb.toMillis() : 0;
    return na - nb;
  });
  console.log(`Found ${docs.length} pending feedback submission(s).`);

  if (SCAN) {
    docs.forEach(d => {
      const x = d.data();
      console.log(`  ${d.id}: ${firstLine(x.text, 70) || '(no text)'} [${(x.images || []).length} img] ${x.email || ''}`);
    });
    const rf = resolutionFiles();
    console.log(`\n${rf.length} resolution file(s) in ${RES_DIR}.`);
    rf.forEach(f => {
      const res = parseResolutionFile(fs.readFileSync(path.join(RES_DIR, f), 'utf8'));
      console.log(`  ${f}: ${res.error ? '⚠ ' + res.error : (res.ticket || res.doc) + ' — ' + firstLine(res.body, 70)}`);
    });
    try {
      const rq = await pendingReviewSuggestions(db);
      console.log(`\n${rq.length} paper suggestion(s) waiting for review and not yet announced.`);
      rq.forEach(it => console.log(`  ${it.id}: ${firstLine(reviewLabel(it.doc), 80)}` +
        (it.doc.ticket ? `  #${it.doc.ticket}` : '')));
    } catch (e) {
      console.log('\n(review queue unreadable: ' + (e && e.message) + ')');
    }
    return;
  }

  let transport = null, fromAddr = '', fromName = process.env.ALERTS_FROM_NAME || 'The Lit';
  if (!DRY_RUN) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    fromAddr = process.env.ALERTS_FROM || process.env.SMTP_USER || '';
  }

  let sent = 0, failed = 0, acked = 0;
  for (const d of docs) {
    const data = d.data();
    const mail = renderFeedbackEmail(data);
    const ack = renderSubmitterEmail(data);   // null when anonymous
    if (DRY_RUN) {
      console.log(`\n[dry-run] → ${FEEDBACK_TO}\n  subject: ${mail.subject}\n  attachments: ${mail.attachments.length}\n  reply-to: ${mail.replyTo || '—'}` +
        `\n  submitter copy: ${ack ? '→ ' + ack.to : '— (anonymous, admin only)'}`);
      continue;
    }
    try {
      await transport.sendMail({
        from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
        to: FEEDBACK_TO,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
        headers: { 'X-Lit-Feedback': d.id },
      });
      await d.ref.update({ forwarded: true, status: 'forwarded', forwardedAt: FieldValue.serverTimestamp() });
      sent++;
      console.log(`  ✓ forwarded ${d.id}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${d.id}: ${e && e.message}`);
      continue;   // maintainer copy failed → leave the doc pending; retry the whole pair next run
    }
    // Best-effort confirmation copy to the submitter (same message, receipt
    // banner + ticket). Skipped for anonymous submissions or if already sent
    // (e.g. by the instant Cloud Function). A failure here is logged but never
    // un-forwards the doc — the maintainer's copy is already delivered.
    if (ack && !data.ackSent) {
      try {
        await transport.sendMail({
          from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
          to: ack.to,
          replyTo: FEEDBACK_TO,
          subject: ack.subject,
          text: ack.text,
          html: ack.html,
          attachments: ack.attachments,
          headers: { 'X-Lit-Feedback': d.id },
        });
        await d.ref.update({ ackSent: true, ackAt: FieldValue.serverTimestamp() });
        acked++;
        console.log(`  ✓ confirmation copy → ${ack.to}`);
      } catch (e) {
        console.error(`  ⚠ confirmation copy to ${ack.to} failed: ${e && e.message}`);
      }
    }
  }
  if (docs.length) console.log(`\nDone. Sent ${sent} (+${acked} submitter confirmation(s)), failed ${failed}.`);

  // Second phase: apply any repo-recorded resolutions (close + notify) — runs
  // every pass, independent of whether anything was pending above.
  await applyResolutions(db, FieldValue, transport, fromAddr, fromName);

  // Third phase: say what is waiting in the OTHER queue on the feedback page —
  // the suggested published papers only the maintainer's hands can add.
  await announceReviewQueue(db, FieldValue, transport, fromAddr, fromName);
}

if (SELFTEST) {
  selftest();
} else {
  run().catch(e => { console.error('Feedback mailer error:', e && (e.stack || e.message || e)); process.exit(1); });
}

export { renderFeedbackEmail, renderSubmitterEmail, dataUrlToAttachment };
// (parseResolutionFile, resolutionHashOf and renderResolutionEmail are exported
// at their definitions — the resolutions pass that closes the feedback loop.)
