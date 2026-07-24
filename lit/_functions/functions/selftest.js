'use strict';
/*
 * Offline self-test for the instant feedback forwarder's e-mail rendering.
 * No network, no Firebase — just checks feedback-render.js the same way
 * lit/_scraper/feedback-mailer.mjs --selftest checks its own copy, so the two
 * stay in sync. Run:  node selftest.js   (or: npm run selftest)
 */
const { renderFeedbackEmail, renderSubmitterEmail, dataUrlToAttachment } = require('./feedback-render');

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

// submitter confirmation copy — the same e-mail plus a receipt banner
const ack = renderSubmitterEmail(fbDoc);
eq(ack && ack.to === 'jane@example.com', 'confirmation goes to the submitter');
eq(ack && ack.subject === mail.subject, 'confirmation carries the SAME subject');
eq(ack && ack.text.includes('LIT-260717-A9K2') && ack.html.includes('LIT-260717-A9K2'), 'confirmation names the ticket');
eq(ack && ack.text.includes(fbDoc.text), 'confirmation contains the same message');
eq(ack && ack.attachments.length === 2, 'confirmation carries the same screenshots');

const m2 = renderFeedbackEmail({ text: '', images: [png], email: 'bad-email' });
eq(m2.subject.includes('screenshot'), 'screenshot-only subject falls back');
eq(m2.replyTo === undefined, 'invalid e-mail is not used as reply-to');
eq(m2.text.includes('no message'), 'no-message body placeholder present');
eq(renderSubmitterEmail({ text: 'hi', images: [], email: 'bad-email' }) === null, 'invalid e-mail → no confirmation copy');
eq(renderSubmitterEmail({ text: 'hi', images: [] }) === null, 'anonymous → no confirmation copy (admin only)');
eq(renderFeedbackEmail({ text: 'no ticket legacy doc' }).subject.indexOf('undefined') === -1, 'legacy doc without ticket still renders');

if (fail) { console.error(`\nfeedback-function selftest: ${fail} failure(s)`); process.exit(1); }
console.log('feedback-function selftest: OK');
