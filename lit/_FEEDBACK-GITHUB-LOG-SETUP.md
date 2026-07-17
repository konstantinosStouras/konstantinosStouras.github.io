# Feedback → private GitHub log — setup

Mirrors every Feedback submission (`stouras.com/lit/feedback/`) into a **private
GitHub repository**, so it can be read straight from GitHub — message text **and**
attached screenshots — independent of the e-mail inbox. This is what lets the
maintainer's assistant, on request, read the actual feedback (including images)
and act on it.

**How it flows:** the static Feedback page writes each submission to the Firestore
`feedback` collection (unchanged). The scheduled Action
`.github/workflows/lit-feedback-github-log.yml` reads new submissions with the
Firebase Admin SDK (`lit/_scraper/feedback-github-log.mjs`) and writes, into the
private log repo, one folder per submission:

```
feedback/<id>/feedback.md       message + metadata, screenshots inlined
feedback/<id>/feedback.json     the raw fields (minus the bulky image data URLs)
feedback/<id>/screenshot-1.jpg  each attached screenshot, decoded
```

It is **idempotent** — a submission already present is skipped, so the log repo
itself is the record of what's mirrored (no Firestore writes, no rules change).
It runs alongside, and independent of, the e-mail forwarders.

### Why a **separate, private** repo (important)

This site's own repo (`konstantinosStouras.github.io`) is **public** — it's a
GitHub Pages site. Feedback can include the submitter's e-mail address and
screenshots of their screen, which must **not** be committed to a public repo.
So the log lives in a **private** repo you create just for this.

---

## One-time setup

1. **Create a private repo** for the log, e.g.
   `konstantinosStouras/lit-feedback-log` — **Private**, empty (a README is fine).

2. **Create a token that can push to it.** GitHub → *Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate new*:
   - **Repository access:** only the new `lit-feedback-log` repo.
   - **Permissions:** *Repository permissions → Contents → Read and write*.
   - Copy the token.

3. **On THIS site repo** (`konstantinosStouras.github.io`), *Settings → Secrets
   and variables → Actions*:
   - **Variables** tab → New variable **`FEEDBACK_LOG_REPO`** =
     `konstantinosStouras/lit-feedback-log` (the `owner/repo` of your private log repo).
   - **Secrets** tab → New secret **`FEEDBACK_LOG_TOKEN`** = the token from step 2.
   - `FIREBASE_SERVICE_ACCOUNT` is already set (the feedback mailer uses it). If not,
     add it per `lit/_FEEDBACK-SETUP.md`.

   The workflow stays a **clean no-op** until `FEEDBACK_LOG_REPO` is set, so
   nothing breaks before you finish.

4. **Let the assistant read the log repo.** So the assistant can read the
   mirrored feedback on request, grant the Claude GitHub app access to the private
   `lit-feedback-log` repo (Claude → *GitHub settings* →
   https://claude.ai/admin-settings — add the repo to the allowed repositories).

## Verify

Run the workflow once by hand: *Actions → "lit — feedback → private GitHub log"
→ Run workflow* (or wait for the schedule). Then check the private repo — every
submission so far should appear under `feedback/<id>/`. Submit a test on the
Feedback page and confirm a new folder shows up on the next run.

Then you can ask the assistant, e.g. "read my latest feedback and act on it" —
it reads `feedback/<id>/feedback.md` (text) and the `screenshot-*.jpg` images
directly from the private repo.

## Notes

- **Offline test** (no network): `node lit/_scraper/feedback-github-log.mjs --selftest`.
- **Dry run** on the runner: *Run workflow* with *dry_run* ticked — reports what
  it would log and writes nothing.
- To pause it, unset the `FEEDBACK_LOG_REPO` variable (the job goes back to a no-op).
- The e-mail forwarders (instant Cloud Function + batch mailer) are unaffected —
  this is an additional, parallel sink so feedback lands in GitHub too.
