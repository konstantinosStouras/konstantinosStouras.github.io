'use strict';
/*
 * E-mail rendering for the instant feedback-forwarding Cloud Function.
 *
 * KEEP IN SYNC with renderFeedbackEmail / renderSubmitterEmail /
 * dataUrlToAttachment in
 * lit/_scraper/feedback-mailer.mjs (the every-10-min batch fallback). The logic
 * is duplicated here — not imported — because a deployed Cloud Function bundle
 * only includes files inside its own source directory, so it must be
 * self-contained. Both render the identical subject/body/attachments so a
 * message looks the same whether the instant trigger or the batch delivers it.
 */

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
// attachments, replyTo } — attachments are the decoded screenshots.
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

module.exports = { renderFeedbackEmail, renderSubmitterEmail, dataUrlToAttachment };
