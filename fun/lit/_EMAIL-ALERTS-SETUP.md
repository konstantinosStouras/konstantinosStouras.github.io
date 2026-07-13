# The Lit — E-mail alerts

The **E-mail alerts** button (top nav on `fun/lit/index.html`) lets a signed-in
user subscribe to an e-mail when new papers matching a set of filters are added
to the database. This document covers what ships in the page today and the one
backend piece needed to actually deliver the e-mails.

## What is in the page (no backend needed)

Everything the user sees and does is implemented client-side and needs nothing
beyond the Firebase project that already powers accounts (`FB_CONFIG` in
`index.html`, see `_ACCOUNTS-SETUP.md`):

- The **E-mail alerts** modal reuses the account modal shell. It requires
  sign-in (it shows a sign-in prompt otherwise).
- On open it **pre-fills the alert criteria from the page's current search
  filters** — journal types, journals, authors, title / abstract / affiliation
  terms, years, MS editors/areas, ISR/MkSc senior/associate editors, and the
  pre-print-only toggle. The user can edit those inside the modal (add/remove
  journals and types, add text terms, toggle pre-prints) or click **"↻ Use
  current page filters"** to re-copy the live filters.
- Delivery settings: an **alert name**, a **frequency** (immediate / daily /
  weekly), and a **recipient e-mail** (defaulting to the account e-mail, but the
  user can send to any address). The UI states clearly that the alert is sent
  *from* the user's own account e-mail.
- Alerts are listed with an enable/pause switch, Edit and Delete, and are stored
  privately per user in Firestore.

### Firestore data model

Each alert is a document under the signed-in user's own subtree, so it is
covered by the existing security rule (`users/{userId}/{document=**}` in
`_firestore.rules` — a user reads/writes only their own data):

```
users/{uid}/alerts/{alertId} = {
  name:       string,                 // display name for the alert
  recipient:  string,                 // where to send it (any e-mail)
  from:       string,                 // the user's account e-mail (informational)
  frequency:  'immediate'|'daily'|'weekly',
  enabled:    boolean,                // paused alerts are kept but not sent
  criteria: {                         // mirrors the page's search filters
    jtype:       string[],            // 'utd24' | 'ft50' | 'abs4' | 'abs3'
    journal:     string[],            // journal keys (JOURNAL_LABEL keys)
    author:      string[],            // author name substrings (lower-cased)
    title:       string[],            // title terms
    abstract:    string[],            // abstract terms
    affiliation: string[],            // affiliation terms
    year:        string[],            // years, as strings
    editor:      string[],            // MS accepting editors
    area:        string[],            // MS areas
    se:          string[],            // ISR/MkSc senior editors
    ae:          string[],            // ISR associate editors
    preprintOnly: boolean             // only papers with a free pre-print
  },
  createdAt:  serverTimestamp,
  updatedAt:  serverTimestamp
}
```

The `criteria` object matches the `sel` filter state in `index.html` field for
field, so the same matching logic the page uses can be reused by the mailer.

## The backend mailer (shipped)

A static GitHub Pages site cannot send e-mail, so delivery is done by a
scheduled job that is intentionally decoupled from the page: the page only
writes subscriptions; the mailer reads them and sends. This is now implemented:

- **`fun/lit/_scraper/alerts-mailer.mjs`** — the mailer. Each run it:
  1. Loads the papers **added recently** from the same files the "Recently added
     papers" view uses (`fun/lit/data/recent.json` and
     `fun/lit/data-ft50/recent.json`; each row carries a `Date Added`).
  2. Reads every user's alerts with the Admin SDK
     (`collectionGroup('alerts')`), which bypasses the Firestore rules.
  3. Matches new papers against each alert's `criteria`, reusing the page's exact
     filter semantics (journal-type expansion, `textMatch`/`authorMatch`,
     pre-print flag, AND/OR per field — the journal-list sets and matchers are
     vendored copies of the ones in `index.html`, kept in sync).
  4. For each alert that is **due** for its `frequency` and has new matches,
     sends one digest e-mail over SMTP (Nodemailer).
  5. Records a per-alert high-water mark (`lastCheckedAt` / `lastSentAt`) so a
     paper is never e-mailed twice.
- **`.github/workflows/lit-alerts-mail.yml`** — runs it daily (08:30 UTC), after
  the daily data build has committed a fresh `recent.json`.

**Frequency.** `immediate`, `daily`, `weekly` (≥ ~7 days since the last check),
`monthly` (≥ ~28 days). With the once-a-day cron, `immediate` and `daily` are
the same; run the cron more often to make `immediate` closer to real time.

**"Sent from the user's e-mail."** The message is addressed `To` the alert's
`recipient`, its `Reply-To` is set to the subscriber's own e-mail (`from`), and
the visible `From` is the sending SMTP account (`ALERTS_FROM` / `SMTP_USER`).
When that account is **your own address**, the alert is literally sent from your
e-mail. You cannot send *as* an arbitrary other user without their credentials,
so for other people's alerts the honest setup is `From:` your address with
`Reply-To:` theirs. (True per-user "send as them" would need each user's Gmail
OAuth consent — a bigger project.)

### Deploy it (one-time)

The workflow is a clean **no-op until the secrets exist** (it logs "not
configured" and exits 0), so it never fails before you set up. To turn it on:

1. **Firebase service-account key.** Firebase console → Project Settings →
   Service accounts → *Generate new private key*. Add the downloaded JSON as the
   GitHub Actions secret **`FIREBASE_SERVICE_ACCOUNT`** (paste the whole JSON).
2. **SMTP sender.** For truly *from your own address*, create a Gmail **App
   Password** (Google Account → Security → 2-Step Verification → App passwords)
   and add secrets **`SMTP_USER`** (e.g. `kstouras@gmail.com`) and
   **`SMTP_PASS`** (the app password). Optional: `SMTP_HOST` (default
   `smtp.gmail.com`), `SMTP_PORT` (default `465`), `ALERTS_FROM` (default
   `SMTP_USER`), `ALERTS_FROM_NAME` (default `The Lit`). Any provider that
   offers SMTP (Resend / SendGrid / Amazon SES / Postmark) works too — just set
   `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` accordingly.
3. **Test.** Run the workflow from the Actions tab with **dry-run** checked
   (reads alerts and prints what it *would* send, sends nothing). When it looks
   right, let the daily schedule take over, or run it without dry-run.

**No Firestore rule changes are needed** — the existing `users/{uid}/{document=**}`
wildcard already covers the `alerts` subcollection, and the mailer's Admin SDK
bypasses rules regardless. The `collectionGroup('alerts')` query is unfiltered,
so it needs no custom index either.

### Local / offline helpers

- `node fun/lit/_scraper/alerts-mailer.mjs --selftest` — runs the matching /
  frequency / rendering self-tests (no network, no deps).
- `node fun/lit/_scraper/alerts-mailer.mjs --scan --criteria='{"jtype":["ft50"],"preprintOnly":true}' --days=7`
  — previews, against the local `recent.json`, which papers an alert would match.
- `node fun/lit/_scraper/alerts-mailer.mjs --dry-run` — a real run against
  Firestore that prints instead of sending (needs the Firebase secret).

### Announcing a new feature

Subscribers can opt into **feature updates** (the first toggle in the E-mail
alerts form → `criteria.features`). When you ship something worth announcing,
e-mail those subscribers with:

```
node fun/lit/_scraper/alerts-mailer.mjs --announce \
  --subject="New on The Lit: the Working Papers archive" \
  --html-file=announce.html   # or --text="...", --text-file=...  ( add --dry-run to preview )
```

It reads every alert with `criteria.features === true`, de-dups by recipient,
and sends a "what's new" e-mail (same header/footnote as paper alerts). It is a
no-op without the Firebase + SMTP secrets, and `--dry-run` prints the recipients
instead of sending. Feature-only subscriptions never trigger paper e-mails (the
daily run gates on `hasPaperIntent`).

### Coverage note

The mailer scans the eight native sources plus the FT50 catalog (the two
`recent.json` files in this repo). The ABS satellite shards (`lit-data-abs4`,
`lit-data-abs3-omecon`, `lit-data-abs3-rest`) are separate repos and are not
scanned yet; extending coverage means pulling their `recent.json` too. Also
`recent.json` is capped (newest ~1,000, last ~90 days), which is ample for a
daily/weekly/monthly digest but means a brand-new alert's first e-mail looks
back at most ~31 days.
