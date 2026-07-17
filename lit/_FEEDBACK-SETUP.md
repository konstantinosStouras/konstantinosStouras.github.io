# The Lit — Feedback page setup

The standalone **Feedback** page at `stouras.com/lit/feedback/` lets anyone send
a message and screenshots. Because a static GitHub Pages site can't run a server,
submissions are stored in the project's existing Firebase project
(`lit-paper-browser`) and forwarded to your inbox by a scheduled job.

## How it works

1. **`lit/feedback/index.html`** (the page) — no sign-in required. It compresses
   each screenshot in the browser (downscaled JPEG data URLs, ≤5 images, kept
   under Firestore's ~1 MB document limit) and writes one document to the
   **`feedback`** collection:
   `{ text, images:[dataUrl…], name, email, uid, page, url, ua, forwarded:false, status:'new', createdAt }`.
   It reuses the same `FB_CONFIG` as `lit/index.html`, and auto-fills the e-mail
   if the visitor happens to be signed in on the main page.

2. **`lit/_firestore.rules`** — a `feedback/{docId}` rule allows a bounded
   **create** from anyone, and **no** client read/update/delete. Only the Admin
   SDK (this job) can read or clear it. Deploy the rules after adding it:
   ```
   firebase deploy --only firestore:rules
   ```
   (or paste into Firebase console → Firestore Database → Rules → Publish).

3. **`lit/_scraper/feedback-mailer.mjs`** + **`.github/workflows/lit-feedback-mail.yml`**
   — every 15 minutes the job reads pending (`forwarded == false`) submissions,
   e-mails each to `FEEDBACK_TO` with the screenshots **attached** (Reply-To set
   to the submitter when they left an e-mail), and marks it `forwarded:true` so
   it's never sent twice. It is a **no-op** until the secrets are set.

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

Everything lands in **one place** — the `FEEDBACK_TO` inbox — one e-mail per
submission with the message, metadata (page, browser, signed-in UID, time) and
the screenshots attached. You can also read the raw collection in the Firebase
console (Firestore → `feedback`), or run `--scan` to list what's pending.
