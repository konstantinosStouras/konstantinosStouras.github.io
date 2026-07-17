# The Lit — instant feedback forwarding (Cloud Function)

This deploys a **Firestore `onCreate` Cloud Function** that e-mails every new
Feedback submission (`stouras.com/lit/feedback/`) to the maintainer **within
seconds**, instead of waiting for the batch mailer's schedule.

- **Function:** `functions/index.js` → `forwardFeedbackOnCreate`, triggered on a
  new doc in the Firestore `feedback` collection. It sends the e-mail (same
  format as the batch mailer — see `functions/feedback-render.js`, kept in sync
  with `lit/_scraper/feedback-mailer.mjs`) and stamps the doc `forwarded: true`.
- **Still a fallback:** the every-10-min batch mailer
  (`.github/workflows/lit-feedback-mail.yml`) stays on. Both gate on the
  `forwarded` flag, so nothing is sent twice, and the batch covers anything the
  trigger ever misses. You can keep both running forever.
- **Firebase project:** `lit-paper-browser` (the same one used for accounts +
  feedback; set in `.firebaserc`).

Everything here lives under `lit/_functions/` — the leading `_` keeps Jekyll from
publishing it, exactly like `lit/_scraper/`.

---

## Part A — in your browser (Firebase / Firestore console)

1. **Note your Firestore location.** Open the
   [Firebase console](https://console.firebase.google.com/) → project
   **lit-paper-browser** → **Firestore Database**. The location is shown at the
   top of the Data tab (e.g. `nam5 (United States)` or `eur3 (Europe)`). You'll
   match the function's region to it in Part B, step 4.

2. **Upgrade the project to the Blaze plan.** Cloud Functions require it (the
   Spark/free plan can't deploy functions). In the console: bottom-left
   **⚙ → Usage and billing → Details & settings → Modify plan → Blaze**, and
   link a billing account. Blaze has a generous free tier — a handful of feedback
   e-mails a day costs essentially nothing.

That's all you do in the browser. The rest is two-ish minutes in a terminal.

## Part B — in a terminal (Firebase CLI)

> There is no browser-only way to deploy a Cloud Function — it needs the Firebase
> CLI once. After this first deploy you never have to touch it again.

1. **Install + sign in** (once per machine):
   ```sh
   npm install -g firebase-tools
   firebase login
   ```

2. **Install the function's dependencies:**
   ```sh
   cd lit/_functions/functions
   npm install
   cd ..            # back to lit/_functions (where firebase.json lives)
   ```

3. **Set the SMTP secrets** — use the **same** Gmail address + App Password you
   already put in the GitHub Actions secrets (so the "from" address matches):
   ```sh
   firebase functions:secrets:set SMTP_USER      # paste the Gmail address
   firebase functions:secrets:set SMTP_PASS      # paste the 16-char App Password
   ```
   (Optional non-secret overrides go in a `functions/.env` file, e.g.
   `FEEDBACK_TO=you@example.com` — the defaults already match the batch mailer.)

4. **Match the region to your Firestore location** (from Part A, step 1). Open
   `functions/index.js` and set the single `REGION` line:
   `nam5`/US → `us-central1` (the default); `eur3`/Europe → `europe-west1`.
   A mismatch is the one thing that makes the deploy fail.

5. **Deploy:**
   ```sh
   firebase deploy --only functions
   ```
   First deploy also enables the required Google Cloud APIs — just say yes.

## Verify

Submit a test message on `stouras.com/lit/feedback/`. The e-mail should land in
your inbox within a few seconds. In the console → **Functions → Logs** you'll see
`instant-forwarded feedback`. (If anything hiccups, the 10-min batch mailer still
delivers it — you won't lose feedback either way.)

## Test the rendering offline (no deploy needed)

```sh
cd functions && npm run selftest      # or: node selftest.js
```

## Notes / keep in sync

- `functions/feedback-render.js` is a deliberate copy of the render logic in
  `lit/_scraper/feedback-mailer.mjs` (a Cloud Function bundle can only include
  files in its own dir). **If you change the e-mail format in one, change both.**
- To turn instant delivery off again, just delete the function:
  `firebase functions:delete forwardFeedbackOnCreate`. The batch mailer keeps
  working on its own.
