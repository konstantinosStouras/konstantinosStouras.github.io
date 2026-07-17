'use strict';
/*
 * The Lit — instant feedback forwarder (Firebase Cloud Function, 2nd gen)
 * ======================================================================
 *
 * Fires the moment a visitor submits the Feedback form (stouras.com/lit/feedback/),
 * which writes a document to the Firestore `feedback` collection. This trigger
 * e-mails that submission to the maintainer within seconds and marks it
 * forwarded — so delivery is instant, not "within the next scheduled run".
 *
 * It COMPLEMENTS the batch fallback lit/_scraper/feedback-mailer.mjs
 * (.github/workflows/lit-feedback-mail.yml, every 10 min): both gate on the
 * `forwarded` flag, so nothing is sent twice, and the batch still delivers
 * anything this trigger missed (e.g. if it was momentarily down). Send first,
 * then mark — so a mark-write failure risks at most a later duplicate, never a
 * lost message.
 *
 * DEPLOY (see ../README.md for the full walkthrough, incl. the Firebase console
 * steps): needs the project on the Blaze plan; set the SMTP secrets with
 * `firebase functions:secrets:set SMTP_USER` / `SMTP_PASS` (the SAME Gmail +
 * App Password already in the GitHub Actions secrets), then
 * `firebase deploy --only functions` from lit/_functions/.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { renderFeedbackEmail } = require('./feedback-render');

admin.initializeApp();

// ── SMTP login (secret) — the SAME values already in the GitHub Actions secrets.
//    Set once:  firebase functions:secrets:set SMTP_USER
//               firebase functions:secrets:set SMTP_PASS
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');

// ── Non-secret settings. Defaults match the batch mailer; override per project
//    with a functions/.env file (e.g. `FEEDBACK_TO=you@example.com`) if needed.
const FEEDBACK_TO      = defineString('FEEDBACK_TO',      { default: 'kstouras@gmail.com' });
const SMTP_HOST        = defineString('SMTP_HOST',        { default: 'smtp.gmail.com' });
const SMTP_PORT        = defineString('SMTP_PORT',        { default: '465' });
const ALERTS_FROM      = defineString('ALERTS_FROM',      { default: '' });
const ALERTS_FROM_NAME = defineString('ALERTS_FROM_NAME', { default: 'The Lit' });

// ⚠️ REGION must match your Firestore database's location, or the trigger won't
//    deploy. Check it in the Firebase console → Firestore Database (the location
//    is shown at the top, e.g. "nam5 (United States)" or "eur3 (Europe)").
//    Map:  nam5 / us-*  → 'us-central1'    eur3 / europe-* → 'europe-west1'
//    (any single us/eu region in the same continent works). This project's
//    Firestore is in eur3 (Europe), so the default is europe-west1; change the
//    ONE line if your database is elsewhere (US nam5 → us-central1).
const REGION = 'europe-west1';

setGlobalOptions({ region: REGION, maxInstances: 5 });

exports.forwardFeedbackOnCreate = onDocumentCreated(
  { document: 'feedback/{docId}', secrets: [SMTP_USER, SMTP_PASS] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;                       // deletion / no data
    const doc = snap.data() || {};
    if (doc.forwarded === true) return;      // already delivered (batch, or a retry)

    const mail = renderFeedbackEmail(doc);
    const port = Number(SMTP_PORT.value() || 465);
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value() || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    });
    const fromAddr = ALERTS_FROM.value() || SMTP_USER.value();
    const fromName = ALERTS_FROM_NAME.value() || 'The Lit';

    try {
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
        to: FEEDBACK_TO.value(),
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
        headers: { 'X-Lit-Feedback': snap.id },
      });
    } catch (e) {
      // Don't rethrow: the doc is still forwarded:false, so the 10-min batch
      // mailer will retry it. Rethrowing here would risk a retry-storm and, with
      // Functions retries on, duplicate sends.
      logger.error('instant feedback send failed', { id: snap.id, err: e && e.message });
      return;
    }

    try {
      await snap.ref.update({
        forwarded: true,
        status: 'forwarded',
        forwardedAt: admin.firestore.FieldValue.serverTimestamp(),
        forwardedBy: 'onCreate',
      });
    } catch (e) {
      // Sent, but couldn't mark. Worst case: the batch mailer sends a duplicate
      // later. Prefer that to losing the message, so we do not rethrow.
      logger.warn('feedback sent but not marked forwarded', { id: snap.id, err: e && e.message });
    }

    logger.info('instant-forwarded feedback', { id: snap.id });
  }
);
