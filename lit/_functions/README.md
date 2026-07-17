# The Lit — instant feedback forwarding (Cloud Function)

This deploys a **Firestore `onCreate` Cloud Function** that e-mails every new
Feedback submission (`stouras.com/lit/feedback/`) to the maintainer **within
seconds**, instead of waiting for the batch mailer's schedule.

- **Function:** `functions/index.js` → `forwardFeedbackOnCreate`, triggered on a
  new doc in the Firestore `feedback` collection. It sends the maintainer's
  e-mail (same format as the batch mailer — see `functions/feedback-render.js`,
  kept in sync with `lit/_scraper/feedback-mailer.mjs`), stamps the doc
  `forwarded: true`, and — when the submitter left a valid e-mail — sends them
  **the same message back** as a confirmation copy (receipt banner + their
  ticket number, stamped `ackSent` so the batch mailer never doubles it). An
  anonymous submission has no address, so only the maintainer's copy is sent.
- **Still a fallback:** the every-10-min batch mailer
  (`.github/workflows/lit-feedback-mail.yml`) stays on. Both gate on the
  `forwarded` flag, so nothing is sent twice, and the batch covers anything the
  trigger ever misses. You can keep both running forever.
- **Firebase project:** `lit-paper-browser` (the same one used for accounts +
  feedback; set in `lit/.firebaserc`).

The function's source lives under `lit/_functions/` — the leading `_` keeps
Jekyll from publishing it, exactly like `lit/_scraper/`. The Firebase CLI
config (`firebase.json` + `.firebaserc`) sits one level up, at **`lit/`**, so
the ONE config covers both this function and the Firestore rules deploy — the
CLI requires every referenced path (rules file, functions source) to sit inside
the directory that holds `firebase.json`, and `lit/` is their common parent.
Run all `firebase` commands below from `lit/` (or any folder under it — the CLI
walks up to find the config).

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
   cd ../..         # back up to lit/ (where firebase.json lives)
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
   `functions/index.js` and set the single `REGION` line: `eur3`/Europe →
   `europe-west1` (**the current default — this project's Firestore is in eur3**);
   `nam5`/US → `us-central1`. A mismatch is the one thing that makes the deploy fail.

5. **Deploy** (pin the project explicitly — it protects you if another Firebase
   project is the active one in your CLI state):
   ```sh
   firebase deploy --only functions --project lit-paper-browser
   ```
   First deploy also enables the required Google Cloud APIs — just say yes.

6. **Deploying the Firestore rules** works from the same `lit/` directory —
   its `firebase.json` points at `_firestore.rules`, so whenever the rules file
   changes:
   ```sh
   firebase deploy --only firestore:rules --project lit-paper-browser
   ```
   (equivalent to pasting the file into Firebase console → Firestore Database →
   Rules → Publish).

## Verify

Submit a test message on `stouras.com/lit/feedback/`. The e-mail should land in
your inbox within a few seconds. In the console → **Functions → Logs** you'll see
`instant-forwarded feedback`. (If anything hiccups, the 10-min batch mailer still
delivers it — you won't lose feedback either way.)

## Test the rendering offline (no deploy needed)

```sh
cd _functions/functions && npm run selftest      # or: node selftest.js
```

## Notes / keep in sync

- `functions/feedback-render.js` is a deliberate copy of the render logic in
  `lit/_scraper/feedback-mailer.mjs` (a Cloud Function bundle can only include
  files in its own dir). **If you change the e-mail format in one, change both.**
- To turn instant delivery off again, just delete the function:
  `firebase functions:delete forwardFeedbackOnCreate`. The batch mailer keeps
  working on its own.
