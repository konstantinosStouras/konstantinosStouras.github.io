# The Lit — Feedback page setup

The standalone **Feedback** page at `stouras.com/lit/feedback/` lets anyone send
a message and screenshots. Because a static GitHub Pages site can't run a server,
submissions are stored in the project's existing Firebase project
(`lit-paper-browser`) and forwarded to your inbox by a scheduled job.

## How it works

1. **`lit/feedback/index.html`** (the page) — no sign-in required. It generates
   a unique **ticket number** for the submission (`LIT-YYMMDD-XXXX`, shown on
   the thank-you panel and used in every e-mail about it), compresses each
   screenshot in the browser (downscaled JPEG data URLs, ≤5 images, kept
   under Firestore's ~1 MB document limit) and writes one document to the
   **`feedback`** collection:
   `{ text, images:[dataUrl…], name, email, uid, ticket, page, url, ua, forwarded:false, status:'new', createdAt }`.
   It reuses the same `FB_CONFIG` as `lit/index.html`, and auto-fills the e-mail
   if the visitor happens to be signed in on the main page.

   **Admin dashboard (maintainer only):** when the maintainer account
   (`kstouras@gmail.com`) is signed in, the same page shows a **📥 Feedback
   inbox** section on top — every submission received so far, newest first and
   grouped by day, each with its ticket, status badge, submitter, screenshots
   on top (click a thumbnail to enlarge it in a lightbox) and the message
   below. Per-ticket actions: **✓ Mark complete & reply** (prompts for how the
   feedback was acted on, saves it + closes the ticket, then opens a
   pre-composed reply e-mail to the submitter — ticket number, "now closed",
   and the resolution; an anonymous ticket is just closed, since there is no
   address to reply to) and **🗑 Delete**. Other visitors never see the section
   (and the Firestore rules — not the UI — are what deny them the data).

2. **`lit/_firestore.rules`** — the `feedback/{docId}` rule allows a bounded
   **create** from anyone; **read/update/delete** are allowed ONLY to the
   signed-in maintainer account (`isFeedbackAdmin()` — that's what powers the
   admin dashboard above). The Admin SDK jobs bypass rules as always. Deploy
   the rules after changing them — from `lit/`, whose `firebase.json` points at
   `_firestore.rules` (the CLI requires the rules file to sit INSIDE the
   directory holding `firebase.json`, so it cannot live at `lit/_functions/`):
   ```
   cd lit
   firebase deploy --only firestore:rules --project lit-paper-browser
   ```
   (or paste the file into Firebase console → Firestore Database → Rules →
   Publish).

3. **`lit/_scraper/feedback-mailer.mjs`** + **`.github/workflows/lit-feedback-mail.yml`**
   — every 10 minutes the job reads pending (`forwarded == false`) submissions
   and sends **two e-mails** per submission: the maintainer's copy to
   `FEEDBACK_TO` with the screenshots **attached** (Reply-To set to the
   submitter when they left an e-mail), and — when the submitter left a valid
   e-mail — **the same message back to them** as a confirmation (receipt banner
   + their ticket number, `ackSent:true` so it's never doubled). An anonymous
   submission has no address, so only the maintainer's copy is sent. It marks
   each `forwarded:true` so nothing is sent twice, and is a **no-op** until the
   secrets are set. The optional instant Cloud Function (`lit/_functions/`)
   does exactly the same pair within seconds of submission.

## Secrets (GitHub → repo Settings → Secrets and variables → Actions)

Same secrets the e-mail-alerts mailer uses — if that already works, feedback
forwarding works with no extra setup beyond deploying the rule:

| Secret | Required | Default | Notes |
| --- | --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | yes | — | JSON of a Firebase service-account key |
| `SMTP_USER`, `SMTP_PASS` | yes | — | SMTP login (e.g. a Gmail address + App Password) |
| `SMTP_HOST` | no | `smtp.gmail.com` | |
| `SMTP_PORT` | no | `465` | |
| `ALERTS_FROM`, `ALERTS_FROM_NAME` | no | `SMTP_USER` / "The Lit" | visible From |
| `FEEDBACK_TO` | no | `kstouras@gmail.com` | where feedback is delivered |

## Testing

```
node lit/_scraper/feedback-mailer.mjs --selftest   # offline: render + attachment tests
node lit/_scraper/feedback-mailer.mjs --scan        # list pending submissions (needs creds)
node lit/_scraper/feedback-mailer.mjs --dry-run     # render + print, send nothing (needs creds)
```

Trigger a real pass on demand from the Actions tab
(**lit — feedback forwarder** → Run workflow).

## Reviewing / acting on feedback later

The primary place is now the **admin dashboard on the Feedback page itself**:
sign in as the maintainer account on `stouras.com/lit/feedback/` and the 📥
inbox appears on top — filter Open / Closed / All, enlarge screenshots, mark a
ticket complete (which also opens the reply e-mail to the submitter) or delete
it. Everything ALSO lands in the `FEEDBACK_TO` inbox — one e-mail per
submission with the ticket in the subject, the metadata (page, browser,
signed-in UID, time) and the screenshots attached. And you can still read the
raw collection in the Firebase console (Firestore → `feedback`), or run
`--scan` to list what's pending.
