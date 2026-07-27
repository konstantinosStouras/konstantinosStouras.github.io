# Feedback resolutions — closing the loop

One file here = one **resolved feedback ticket** from `stouras.com/lit/feedback/`.
Dropping a file in this directory (in the same change as the fix itself) is what
closes the ticket and e-mails the submitter — the feedback mailer
(`lit/_scraper/feedback-mailer.mjs`, run every 10 minutes by
`.github/workflows/lit-feedback-mail.yml`) scans this directory on every pass:

1. finds the Firestore `feedback` doc by its ticket,
2. **closes it** (`status:'closed'`, `resolution`, `resolutionUrl`,
   `resolutionHash`, `resolvedBy:'repo'`) *before* sending anything,
3. e-mails the submitter that their feedback is resolved — the body of the file,
   a "see it live" link when `url:` is given, and their original message — and
   stamps `resolutionSent`. An anonymous submission is just closed.

The private feedback-log repo's mirror then picks the closure up on its next run
(the ticket's `feedback.md` gains a **Resolution** section, and the index row
flips to `closed ✉`).

## File format

Name the file after the ticket, `LIT-YYMMDD-XXXX.md`:

```markdown
---
ticket: LIT-260725-YWTL
url: https://www.stouras.com/lit/
---
What was done, in plain prose — this text is e-mailed to the submitter verbatim,
so write it for them, not for the repo.
```

- `ticket:` — required (or `doc: <firestore-id>` for a legacy submission that
  predates tickets).
- `url:` — optional "see it live" link; it MUST be an `https://` link on
  `stouras.com` (host-validated — anything else is rejected).
- The body (below the closing `---`) is required.

## Rules

- **This is a PUBLIC repo** — never put the submitter's name, e-mail address or
  screenshots in a resolution file. The mailer looks those up in Firestore by
  ticket; the file only needs the ticket and the fix description.
- Files are **left in place** after processing — they are the durable public
  record of what was fixed. Idempotency comes from the content hash stamped on
  the doc (`resolutionHash`): an unchanged file is skipped forever, and
  **editing a file re-applies it and re-notifies the submitter** (so only edit
  one to genuinely correct/extend the resolution).
- `README.md` and `_`-prefixed files are ignored by the scan.

Offline checks: `node lit/_scraper/feedback-mailer.mjs --selftest` (parsing +
rendering) and `--scan` (lists these files with their parse status, sends
nothing). See `lit/_FEEDBACK-SETUP.md` for the whole feedback pipeline.
