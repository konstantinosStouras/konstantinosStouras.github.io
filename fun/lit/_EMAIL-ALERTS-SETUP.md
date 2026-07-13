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

## The one backend piece: the alert mailer

A static GitHub Pages site cannot send e-mail, so **delivery is done by a
scheduled backend job** (the "alert mailer"). It is intentionally decoupled from
the page: the page only writes subscriptions; the mailer reads them and sends.

Recommended shape (any of these works — pick what fits the deployment):

1. **Firebase Cloud Function on a schedule** (Cloud Scheduler / Pub-Sub), or a
   **GitHub Actions cron** using the Firebase Admin SDK with a service-account
   key stored as a secret.
2. Each run:
   - Loads the papers **added since the last run** — reuse the same signal the
     site's "Recently added papers" view uses (`getAddedDate` / `recent.json`
     produced by the daily `lit-update-data*` builds), across the native,
     FT50-catalog and shard datasets.
   - Uses the Admin SDK to read every `users/*/alerts/*` document with
     `enabled == true` (collection-group query on `alerts`).
   - For each alert, matches the new papers against `criteria` (port the page's
     `applyFilters` predicate — journal-scope union of `jtype`+`journal`,
     AND-chained text filters, pre-print flag).
   - Batches matches per alert according to `frequency` (`immediate` on every
     run, `daily`/`weekly` on the due cadence) and sends one digest e-mail.
3. **"Sent from the user's own e-mail."** Set the message's `From`/`Reply-To`
   to the alert's `from` address so replies reach the user, and send `To` the
   `recipient`. Two ways to originate it:
   - **Transactional service** (SendGrid / Amazon SES / Postmark / Resend) with
     the user's address as `From` + `Reply-To`. Deliverability is best when the
     address is verified; otherwise use a verified service address as `From` and
     keep the user's address as `Reply-To`.
   - **Gmail API** with the user's OAuth consent (`gmail.send` scope) to send
     genuinely as the user — only if you collect that consent.
4. Record a per-alert `lastSentAt` / high-water mark (e.g. under
   `users/{uid}/alerts/{alertId}` or a private `mailerState` doc) so papers are
   never e-mailed twice.

Nothing in the page needs to change to add the mailer — it is a pure consumer of
the `alerts` subcollections above. Until the mailer is deployed, subscriptions
are saved and visible to the user, but no e-mail is sent; the modal says as much
("delivery is handled by the alert mailer").
