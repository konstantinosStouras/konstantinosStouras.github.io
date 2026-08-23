# Suggest-a-paper (published or working paper) — setup

Lets a **signed-in** user suggest, from the top of the Feedback page
(`/lit/feedback/`), either an unpublished **working paper** (SSRN / arXiv /
NBER / OSF) or a **published paper missing** from the catalog. A scheduled job
resolves the real metadata and: **adds a fitting working paper automatically**
to the Working Papers archive (an author already in the catalog, and the paper
not already present); for a **published** suggestion it answers "already
listed" automatically or — when the paper is genuinely missing — forwards the
resolved details to the maintainer to **review and add by hand** (status
`review`; the published catalog is only ever written by the daily harvests).

It reuses the existing accounts Firebase project (`lit-paper-browser`), so there
is **no new Firebase project**. Like every other back-end piece it is a **no-op
until its secret is set**, so nothing breaks pre-setup: the form still writes
suggestions to Firestore; they just sit `pending` until the ingest runs.

## How it works

1. **Form** (`lit/feedback/index.html`, the "Suggest a missing published Paper
   or a Working Paper" card). A signed-in user picks the kind:
   - **Working paper** — pastes an SSRN/arXiv/NBER/OSF link (optionally a
     title/authors/note);
   - **Published paper** — pastes the paper's DOI (or any link containing it)
     and/or its **full citation** (a `citation` textarea; the citation alone is
     enough — the ingest can resolve it bibliographically).
   The page writes a bounded doc to the Firestore **`paperSubmissions`**
   collection: `{ uid, email, name, url, title, authors, note, kind?,
   citation?, ticket, status:'pending', createdAt }` (`kind` is only sent as
   `'published'`; absent = the legacy working-paper shape). Signed-in only (so
   the outcome can be e-mailed back). **Pre-rules-deploy fallback:** until the
   updated rules are published, the old `hasOnly()` rejects the two new fields —
   the page then retries once in the legacy shape with the citation folded into
   the note as `"Citation: …"`, which the ingest also understands, so no
   submission is ever lost.

2. **Ingest** (`lit/_scraper-workingpapers/ingest-submissions.mjs`), run every
   ~10 min by `.github/workflows/lit-paper-submissions.yml`. For each `pending`
   submission it ROUTES by what the link/DOI actually is (`routeSubmission` —
   the form's kind choice is a hint only):
   - a recognised SSRN/arXiv/NBER/OSF link — or such a DOI anywhere in the
     link/citation/title/note (`urlToDoi`/`extractAnyDoi` → SSRN `10.2139`,
     arXiv `10.48550`, NBER `10.3386`, OSF `10.31219`) — takes the
     **working-paper path**; the submitter's typed title/authors are **only
     hints, never trusted into the dataset**;
   - **working-paper path:** resolves the **real** metadata itself (OpenAlex by
     DOI, Crossref fallback), builds a record with the SAME `wpRecordFromWork()`
     the daily crawler uses (so the row is byte-identical to a crawled one),
     applies the two gates — **not already in the catalog** (published, or
     already in the archive) and **at least one author already in the catalog**
     — and on success **upserts** into `lit/data-workingpapers/` (preserving
     every existing row, exactly like the crawler) and rewrites the small
     derived files, then commits — the paper appears under the page's
     **Working Papers** journal type with no page change;
   - any **other DOI** takes the **published-paper path**: resolves via
     Crossref first (journal/volume/issue for the review e-mail; OpenAlex
     fallback) and decides via the pure `decidePublishedSubmission()` — already
     listed (by DOI, or by the `matchPublished` title+authors probe that
     catches another registration of the same paper) → `duplicate`; genuinely
     missing → **`review`** (never auto-added; the maintainer gets the resolved
     title/journal/year + the submitter's citation to add by hand);
   - a published suggestion with **no DOI at all** is resolved by a
     conservative **Crossref bibliographic search** over the citation
     (`matchBibItem`: the hit's title AND one author surname must visibly
     appear in the citation text, so a wrong top hit is never adopted);
   - a non-archived pre-print host (bioRxiv/medRxiv) is rejected as before;
   - finally it stamps the submission (`added` / `duplicate` / `linked` /
     `review` / `rejected` + reason) and, when SMTP is configured, e-mails the
     submitter their outcome and the maintainer a summary.

   A `review` item is also announced INDIVIDUALLY, and reliably: the ingest's
   summary is fire-and-forget (sent once, at processing time, only if SMTP was
   up that minute), so the feedback mailer's review-queue pass
   (`lit/_scraper/feedback-mailer.mjs`, every 10 minutes) e-mails the
   maintainer one message per suggestion still waiting — stamping
   `reviewMailedAt` after a successful send, so nothing is announced twice and
   a failed send retries. See `lit/_FEEDBACK-SETUP.md` §5.

   It shares `lit/data-workingpapers/` (and the `lit-workingpapers-<ref>`
   concurrency group) with the crawler, so writes never race; both seed from the
   committed files and only add, so neither clobbers the other. `_authors.json`
   (the crawler's cursor) is left untouched.

## 1. Deploy the Firestore rule

`lit/_firestore.rules` gained a `paperSubmissions` block (signed-in bounded
create with `status` pinned to `'pending'`; submitter reads own; maintainer
reads/updates/deletes via the existing `isFeedbackAdmin()`), extended with the
published-paper form's two optional fields (`kind` in `['wp','published']`,
`citation` ≤ 4000 chars). Deploy from `lit/`:

```
cd lit
firebase deploy --only firestore:rules
```

(or paste `_firestore.rules` into Firebase console → Firestore → Rules →
Publish). Until this is deployed, the form's writes are rejected by the old
rules.

## 2. Add the workflow secret

The workflow `.github/workflows/lit-paper-submissions.yml` needs only:

- **`FIREBASE_SERVICE_ACCOUNT`** — the same service-account JSON already used by
  the feedback / alerts mailers. This is the **only** secret required to ingest.

Optional (reused from the feedback mailer — set them and the ingest also e-mails
the submitter + maintainer; leave them unset and it ingests silently):

- `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS`
- `ALERTS_FROM` `ALERTS_FROM_NAME` `FEEDBACK_TO` (maintainer summary recipient,
  default `kstouras@gmail.com`).

No new secret is needed if the feedback mailer is already configured.

## 3. Env knobs (optional, set in the workflow)

- `SUB_AUTHOR_MATCH` — `fuzzy` (default) matches an author by last name + first
  initial (the same predicate the crawler uses); `exact` requires the full
  (accent-folded) name. Fuzzy is more forgiving of a middle initial dropped by
  OpenAlex; a fuzzy-only match is flagged `[fuzzy]` in the admin view + e-mails.
- `SUB_MAILTO` — OpenAlex/Crossref polite-pool identity (default
  `kstouras+litsub@gmail.com`, a distinct quota identity).
- `SUB_MAX_AGE_DAYS` — keep retrying a not-yet-indexed posting for this many
  days before giving up (default 7). A freshly-posted SSRN paper can take a day
  or more to appear in Crossref/OpenAlex, so the retry window is time-based (not
  a fixed run count) to survive that lag.
- `SUB_DATA_DIR` / `SUB_CATALOG_DIRS` — override the archive / catalog dirs
  (default `lit/data-workingpapers` and `lit/data` + `lit/data-ft50`).

## 4. Admin view

When the maintainer (`kstouras@gmail.com`, verified) is signed in on the
Feedback page, a **📄 Paper suggestions** inbox renders on top (like the feedback
inbox): every suggestion with its status badge (pending / **review** / added /
duplicate / rejected — `review` = a missing published paper awaiting the
maintainer's hand-add, listed under the Pending tab), the resolved
DOI/title/journal, the submitted citation, which catalog author matched (with a
`[fuzzy]` flag when applicable), the rejection reason, and a Delete for spam.

## Published-paper pre-prints (attach + retire-on-publish)

A submitted link (or a crawled working paper) whose paper is **already published**
in the catalog is attached as that published paper's open-access **pre-print**
instead of being added as a standalone working paper:

- **Submission** → `decideSubmission` returns a **`linked`** outcome when
  `matchPublished()` connects it to a published paper (exact title + shared author
  surnames + plausible year). The ingest records it and e-mails the submitter that
  their link is now the paper's pre-print.
- **Retire-on-publish sweep** → the WP crawler (`build-data.mjs`) re-checks every
  archived working paper against the published catalog each build; a now-published
  one is dropped from the archive and recorded as the published paper's pre-print.

Both write a small **served** map `lit/data-workingpapers/submitted-preprints.json`
(`{bareDoi:{u,s}}`). The main page (`lit/index.html`) fetches it once and overlays
`Preprint`/`PreprintSrc` onto any matching paper (native / FT50 / shard) as it
loads — so the "Pre-print (Open Access)" link appears with **no build or
shard-repo change**. The file ships as an empty `{}` and fills in as links are
attached; a 404 (absent) is handled gracefully.

**Shard coverage:** detecting a paper published only in an ABS shard needs the
shard catalogs. The **daily** `lit-workingpapers-update-data.yml` checks the three
shards out read-only (like `lit-analytics.yml`) and sweeps against
native+FT50+shards (`WP_CATALOG_DIRS`); the 3-hourly backfill and the 10-min
ingest stay native+FT50 to avoid re-fetching the large shard repos frequently, so
a shard-only submission is reconciled by the daily sweep + the display overlay
rather than instantly.

## Testing

- Offline unit tests (link parser, author gate, the whole decision function,
  the writer): `node lit/_scraper-workingpapers/ingest-selftest.mjs`.
- Against real Firestore (needs `FIREBASE_SERVICE_ACCOUNT` locally): 
  - `node lit/_scraper-workingpapers/ingest-submissions.mjs --scan` — list
    pending suggestions, do nothing.
  - `node lit/_scraper-workingpapers/ingest-submissions.mjs --dry-run` — resolve
    + decide + print, but write/stamp/mail nothing.
- On a non-`master` branch the workflow runs with `--dry-run` automatically, so a
  feature-branch dispatch never mutates production data.

> NOTE: this build environment's egress blocks OpenAlex/Crossref (403), like all
> the other pipelines, so real metadata resolution only happens on the GitHub
> Actions runners. The offline selftest is fully self-contained.
