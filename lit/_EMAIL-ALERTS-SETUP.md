# The Lit — E-mail alerts

The **E-mail alerts** button (top nav on `lit/index.html`) lets a signed-in
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
  weekly / monthly), and a **recipient e-mail** (defaulting to the account e-mail, but the
  user can send to any address). The UI states clearly that the alert is sent
  *from* the user's own account e-mail.
- A **"Send me a test e-mail"** button next to *Create alert* delivers a one-off
  sample of the alert being composed to the recipient address, so the user can
  see how it looks in a real inbox before saving. The page can't send mail, so it
  **queues** the request (`users/{uid}/testEmails`) and the mailer delivers it —
  see *Test e-mails* below.
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
  frequency:  'immediate'|'daily'|'weekly'|'monthly',
  enabled:    boolean,                // paused alerts are kept but not sent
  criteria: {                         // mirrors the page's search filters
    features:    boolean,             // "New features & updates to the website"
    allPapers:   boolean,             // "Any new paper added to the database"
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
  updatedAt:  serverTimestamp,
  // written by the mailer (not the page): per-side high-water marks
  lastCheckedAt, lastSentAt, lastSentCount,          // paper digests
  lastFeatureCheckedAt, lastFeatureSentAt            // feature-update digests
}
```

An alert needs at least one **intent** to be saved: feature updates
(`features`), any-new-paper (`allPapers`), or a concrete filter. `features` is
independent of the paper side — an alert can be feature-only, paper-only, or
both.

The `criteria` object matches the `sel` filter state in `index.html` field for
field, so the same matching logic the page uses can be reused by the mailer.

A **test-e-mail request** (the "Send me a test e-mail" button) is a transient doc
under the same private subtree, so it is covered by the same rule:

```
users/{uid}/testEmails/{reqId} = {
  name:       string,       // subject-line name of the alert being previewed
  recipient:  string,       // where to send the test
  from:       string,       // the user's account e-mail (Reply-To)
  frequency:  string,       // informational
  criteria:   { … },        // same shape as an alert's criteria
  test:       true,
  createdAt:  serverTimestamp
}
```

The mailer delivers each request once and then **deletes** it (a failed send is
retried a couple of times, then dropped), so the collection stays empty between
tests.

## The backend mailer (shipped)

A static GitHub Pages site cannot send e-mail, so delivery is done by a
scheduled job that is intentionally decoupled from the page: the page only
writes subscriptions; the mailer reads them and sends. This is now implemented:

- **`lit/_scraper/alerts-mailer.mjs`** — the mailer. Each run it:
  1. Loads the papers **added recently** from the same files the "Recently added
     papers" view uses (`lit/data/recent.json` and
     `lit/data-ft50/recent.json`; each row carries a `Date Added`).
  2. Reads every user's alerts with the Admin SDK
     (`collectionGroup('alerts')`), which bypasses the Firestore rules.
  3. Matches new papers against each alert's `criteria`, reusing the page's exact
     filter semantics (journal-type expansion, `textMatch`/`authorMatch`,
     pre-print flag, AND/OR per field — the journal-list sets and matchers are
     vendored copies of the ones in `index.html`, kept in sync).
  4. For each alert that is **due** for its `frequency` and has new matches,
     sends one digest e-mail over SMTP (Nodemailer).
  5. **Also** reads the feature **changelog** (`lit/changelog.json`) and, for
     every alert opted into *New features & updates to the website*
     (`criteria.features`), sends a "what's new" digest of the changelog entries
     that fell in the subscriber's window — the same frequency windowing as
     papers (see *Feature updates* below). This side is fully automated: shipping
     a feature just means adding an entry to the changelog.
  6. Records per-alert high-water marks so nothing is sent twice —
     `lastCheckedAt` / `lastSentAt` for papers and `lastFeatureCheckedAt` /
     `lastFeatureSentAt` for feature updates. The two advance **independently**
     (each only when its own send succeeds), so a partial failure retries only
     the side that failed.
- **`.github/workflows/lit-alerts-mail.yml`** — runs it daily (08:30 UTC), after
  the daily data build has committed a fresh `recent.json`.

### Test e-mails ("Send me a test e-mail")

The one-off preview a user requests from the panel is delivered by the same
mailer, in a separate mode, on a separate (frequent) schedule:

- **`node alerts-mailer.mjs --test-emails`** flushes the `testEmails` queue: it
  reads every pending request with `collectionGroup('testEmails')`, renders a
  sample using the **exact same e-mail templates** as real alerts (so the preview
  is faithful) — with a `[Test]` subject prefix and a banner making clear it is a
  preview — sends it to the request's recipient, and deletes the request. The
  sample lists the real recently-added papers that match the criteria, falling
  back to a couple of built-in sample papers so the format always renders even
  when nothing matches yet. A **features-only** request shows the "what's new"
  announcement format instead. Add `--dry-run` to print instead of sending.
- **`.github/workflows/lit-alerts-test.yml`** — runs `--test-emails` every 15
  minutes (plus manual `workflow_dispatch`) so a requested test lands within a
  few minutes. It shares the same secrets and is likewise a no-op until they are
  set; lower the cron or disable the workflow if you prefer less frequent test
  delivery. It has its own `concurrency` group so it never overlaps the daily
  digest run.

**Frequency.** `immediate`, `daily`, `weekly` (≥ ~7 days since the last check),
`monthly` (≥ ~28 days). With the once-a-day cron, `immediate` and `daily` are
the same; run the cron more often to make `immediate` closer to real time. The
**same windowing applies to feature updates**: a daily subscriber gets each new
changelog entry the day it lands; a weekly/monthly subscriber gets one digest of
everything added to the changelog in that period.

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
   `smtp.gmail.com`), `SMTP_PORT` (default `465`), `SMTP_SECURE` (default: on
   when `SMTP_PORT` is `465`; set to the string `true` to force TLS on another
   port), `ALERTS_FROM` (default `SMTP_USER`), `ALERTS_FROM_NAME` (default
   `The Lit`). Any provider that
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

- `node lit/_scraper/alerts-mailer.mjs --selftest` — runs the matching /
  frequency / rendering self-tests (no network, no deps).
- `node lit/_scraper/alerts-mailer.mjs --scan --criteria='{"jtype":["ft50"],"preprintOnly":true}' --days=7`
  — previews, against the local `recent.json`, which papers an alert would match.
- `node lit/_scraper/alerts-mailer.mjs --dry-run` — a real run against
  Firestore that prints instead of sending (needs the Firebase secret).
- `node lit/_scraper/alerts-mailer.mjs --test-emails [--dry-run]` — flushes
  the "Send me a test e-mail" queue (needs the Firebase + SMTP secrets; `--dry-run`
  prints what it would send).
- `node lit/_scraper/alerts-mailer.mjs --rewind [--dry-run]` — one-off
  recovery: clears the `lastCheckedAt` / `lastFeatureCheckedAt` high-water marks on
  alerts **created in the last few days** so the next normal run re-checks them
  from their creation day (it never sends). Use it if a run advanced a mark past
  items it did not actually deliver. It is scoped to recently-created alerts so it
  can never re-blast a long-standing subscriber, and needs only the Firebase
  secret. From CI, dispatch the **lit — e-mail alerts mailer** workflow with the
  `rewind` input checked, then dispatch it again normally to deliver.

**Note on same-day items:** a paper's `Date Added` and a changelog entry's `date`
are calendar days (they parse to 00:00 UTC), while the alert marks are precise
timestamps. The window boundary is floored to a whole UTC day (`dayStart` /
`windowStartFor` in `alerts-mailer.mjs`) so an alert created today — or already
checked earlier today — still matches items dated today, instead of dropping them
because midnight is not `>` a mid-day mark.

### Feature updates (the changelog)

Subscribers can opt into **New features & updates to the website** (the first
toggle in the E-mail alerts form → `criteria.features`). This is now
**automated**: it is driven by a hand-maintained catalogue, so you never have to
compose a broadcast by hand.

**The catalogue** is `lit/changelog.json` — the single source of truth that
also powers the *What's new* list in the About modal and the alert **preview** on
the page, so what a subscriber sees on the site and what they receive by e-mail
never disagree. It is a plain, served JSON file (not build output). Shape:

```jsonc
{
  "version": 1,
  "updates": [                          // newest first
    {
      "id":      "citations",           // unique, stable
      "date":    "2026-05-20",          // YYYY-MM-DD (UTC) the feature went live
      "title":   "Papers now show their citation counts",
      "summary": "One sentence describing it.",
      "url":     "https://stouras.com/lit/"   // optional deep-link
    }
    // …
  ]
}
```

**To announce a feature, just add an entry** (newest first) with the date it
shipped. On the next daily mailer run, every feature subscriber whose window
covers that date is e-mailed it — a daily subscriber the day it lands, a
weekly/monthly subscriber batched with the rest of that period. The mailer reads
the file with `loadChangelog()`, windows it by `date` exactly like it windows
papers by `Date Added`, and tracks a separate `lastFeatureCheckedAt` high-water
mark so nothing is sent twice.

**No retroactive blast.** An entry dated *before* a subscriber's window is never
sent, and a brand-new subscriber's first window is capped at ~31 days (existing
subscribers fall back to their paper high-water mark), so seeding the changelog
with historical entries — as it ships — e-mails nobody. Only entries you add
going forward, dated around today, trigger e-mails. Feature-only subscriptions
still never trigger paper e-mails (the paper side gates on `hasPaperIntent`).

**Ad-hoc broadcast (optional).** For a one-off message that is *not* a changelog
entry (say, a maintenance notice), you can still e-mail feature subscribers
directly with a free-form body:

```
node lit/_scraper/alerts-mailer.mjs --announce \
  --subject="A quick note from The Lit" \
  --html-file=announce.html   # or --text="...", --text-file=...  ( add --dry-run to preview )
```

It reads every alert with `criteria.features === true`, de-dups by recipient,
and sends a "what's new" e-mail (same header/footnote as the automated digest).
It is a no-op without the Firebase + SMTP secrets, and `--dry-run` prints the
recipients instead of sending. It does **not** touch the changelog high-water
mark, so it is independent of the automated digests. For routine feature
launches, prefer adding a changelog entry — it also updates the on-site
*What's new* list and the alert preview.

### Coverage note

The mailer scans the eight native sources plus the FT50 catalog (the two
`recent.json` files in this repo) **and the ABS satellite shards**
(`lit-data-abs4`, `lit-data-abs3-omecon`, `lit-data-abs3-rest`). The shards live
in separate repos, so their `recent.json` and manifests are fetched over HTTP at
run time (`loadShards`) — each shard's `sources.json` also carries the journals'
ABS grades, so an `abs4`/`abs3` type alert matches shard journals too. A shard
that is offline or not yet deployed just 404s and is skipped. Also `recent.json`
is capped (newest ~1,000, last ~90 days), which is ample for a
daily/weekly/monthly digest but means a brand-new alert's first e-mail looks
back at most ~31 days.
