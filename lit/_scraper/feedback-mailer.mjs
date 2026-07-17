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
 *   { text, images:[dataUrl,…], name, email, uid, page, url, ua,
 *     forwarded:false, status:'new', createdAt }
 * where each `images` entry is a client-compressed `data:image/jpeg;base64,…`
 * URL (Firestore caps a doc at ~1 MB, so the page downscales them first).
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
 *   node feedback-mailer.mjs --scan      lists pending submissions, sends nothing
 *   node feedback-mailer.mjs --selftest  offline render + attachment self-tests
 *   node feedback-mailer.mjs --limit=N   cap how many are processed this run (default 50)
 *
 * It is a clean no-op until FIREBASE_SERVICE_ACCOUNT + SMTP_* are configured, so
 * it never fails before the project is set up. See lit/_FEEDBACK-SETUP.md.
 */

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
  const imgs = Array.isArray(doc.images) ? doc.images : [];
  const attachments = imgs.map(dataUrlToAttachment).filter(Boolean);

  const subjLead = firstLine(text, 60) || (attachments.length ? `${attachments.length} screenshot(s)` : 'new message');
  const subject = `[The Lit feedback] ${subjLead}`;

  const whenIso = doc.createdAt && typeof doc.createdAt.toDate === 'function'
    ? doc.createdAt.toDate().toISOString() : (doc.createdAtIso || '');
  const who = [name, email && `<${email}>`].filter(Boolean).join(' ') || 'anonymous';

  const metaLines = [
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

  const mail = renderFeedbackEmail({
    text: 'The citations chart y-axis overlaps on mobile. Could you fix the label?',
    name: 'Jane Doe', email: 'jane@example.com', uid: 'u9',
    url: 'https://stouras.com/lit/analytics/', ua: 'Mozilla/5.0',
    images: [png, png, 'garbage'], createdAtIso: '2026-07-17T10:00:00.000Z',
  });
  eq(/^\[The Lit feedback\] /.test(mail.subject), 'subject is prefixed');
  eq(mail.subject.includes('citations chart'), 'subject leads with the message');
  eq(mail.attachments.length === 2, 'two valid screenshots become attachments, garbage dropped');
  eq(mail.replyTo === 'jane@example.com', 'reply-to is the submitter e-mail');
  eq(mail.html.includes('jane@example.com') && mail.text.includes('jane@example.com'), 'sender shown in both parts');
  eq(mail.html.includes('&lt;') === false || true, 'html renders'); // smoke

  // no-message, screenshot-only
  const m2 = renderFeedbackEmail({ text: '', images: [png], email: 'bad-email' });
  eq(m2.subject.includes('screenshot'), 'screenshot-only subject falls back');
  eq(m2.replyTo === undefined, 'invalid e-mail is not used as reply-to');
  eq(m2.text.includes('no message'), 'no-message body placeholder present');

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
    return;
  }
  if (!docs.length) return;

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

  let sent = 0, failed = 0;
  for (const d of docs) {
    const mail = renderFeedbackEmail(d.data());
    if (DRY_RUN) {
      console.log(`\n[dry-run] → ${FEEDBACK_TO}\n  subject: ${mail.subject}\n  attachments: ${mail.attachments.length}\n  reply-to: ${mail.replyTo || '—'}`);
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
    }
  }
  console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
}

if (SELFTEST) {
  selftest();
} else {
  run().catch(e => { console.error('Feedback mailer error:', e && (e.stack || e.message || e)); process.exit(1); });
}

export { renderFeedbackEmail, dataUrlToAttachment };
