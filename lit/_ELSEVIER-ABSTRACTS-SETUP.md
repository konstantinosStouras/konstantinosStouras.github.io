# Elsevier abstracts for The Lit — setup and operation

The Lit's Elsevier journals (EJOR, JFE, AOS, OBHDP, JAE, Research Policy, JBV,
Ecological Economics, IJPE, DSS, …) mostly deposit no abstract to Crossref, and
OpenAlex / Semantic Scholar mirror that gap. Their abstracts therefore come from
Elsevier's own APIs, through the `abstracts-ci.mjs` backfill that runs four
times a day in each data repository. This page says what credentials that
needs, where to put them, how to start it and how to read its log.

## The two credentials

| Secret | What it is | Where it comes from |
|---|---|---|
| `ELSEVIER_API_KEY` | An Elsevier Developer Portal API key | Free, at <https://dev.elsevier.com> (any of the account's keys works) |
| `ELSEVIER_INST_TOKEN` | The **institutional token** (`insttoken`) that pairs with the key | Issued by Elsevier support to the account holder, on request |

A bare API key is entitled to abstract TEXT only from the institution's own IP
range. A GitHub Actions runner is off-campus, so with the key alone Elsevier
answers every request with metadata and **no abstract**, and the backfill
achieves nothing while looking healthy. The institutional token carries the
institution's entitlements with the request, which is what makes the runs work.

### The token's terms of use, and how the code keeps them

Elsevier grants the token under these conditions (their wording, condensed):
it must be kept secure server-side, never appear in browser-side code or in an
address bar, every request must go over https, the key travels in the
`X-ELS-APIKey` header and the token in the `X-ELS-Insttoken` header, it
represents full access to the customer account, and it may be revoked at any
time without notice.

How that is met here, and pinned by `node lit/_scraper-ft50/abstracts-selftest.mjs`:

* the token lives ONLY in GitHub Actions repository secrets and reaches the
  script as an environment variable; GitHub masks secret values in run logs;
* every Elsevier call is `https://api.elsevier.com/…` with the key and the
  token as request headers — the selftest fails if either credential is ever
  interpolated or concatenated into a URL, a string or a log line;
* nothing browser-side ever sees it: the backfill is a Node script on a runner,
  and the site only serves the resulting `_api-abstracts.json` text;
* a revoked token shows as HTTP 401 on a run that used to work, and the run
  prints a `::warning::` saying exactly that.

**Never paste the token into a chat, a commit, an issue or a pull request.**
It goes into the secrets page and nowhere else.

## Where to set them

GitHub → the repository → **Settings → Secrets and variables → Actions →
New repository secret**, in each repository that holds Elsevier journals:

| Repository | Elsevier DOIs still without an abstract (2026-09-16) |
|---|---|
| `konstantinosStouras/konstantinosStouras.github.io` (the FT50 catalog, `lit/data-ft50/`) | 39,503 — EJOR 22,918, Research Policy 4,433, JFE 4,159, AOS 2,123, OBHDP 1,810, JAE 1,742, JBV 1,574 |
| `konstantinosStouras/lit-data-abs3-omecon` | 118,449 — Economics Letters 14,331, IJPE 8,854, World Development 8,665, C&OR 7,713, Energy Economics 7,664, … |
| `konstantinosStouras/lit-data-abs4` | 24,928 — J. Econometrics 5,873, J. Public Economics 4,856, JET 4,657, TR-B 3,931, JME 3,696, … |
| `konstantinosStouras/lit-data-abs3-rest` | 14,468 — DSS 4,739, Technovation 3,520, IAM 3,475, GIQ 2,734 |

Secrets are per repository, so the pair has to be added in all four. The
Nature and Science shards carry the same vendored script but hold no Elsevier
DOIs, so they need neither secret. (`S2_API_KEY`, where set, is unrelated and
stays as it is.)

## Starting it

The backfills are scheduled (four ~40-minute slices a day per repository), so
nothing else is needed once the secrets are in place. To start at once:
**Actions → "lit — backfill FT50 abstracts (OpenAlex/S2)" → Run workflow** on
the site repository, and **Actions → "backfill abstracts (…)" → Run workflow**
on each shard. A run commits what it found and applies it to the served papers
files; the daily builds re-apply the cache, so a rebuild never loses an abstract.

## How the Elsevier legs work

1. **Scopus Search, batched** — 25 DOIs per request against Scopus's
   `COMPLETE` view (the only view that carries the abstract; subscriber-only,
   which is what the token provides). 20,000 requests a week per key, so a
   whole catalog's Elsevier backlog clears in days. It only ever ADDS finds.
2. **Abstract Retrieval, one DOI per request** — for whatever Scopus did not
   serve. 10,000 requests a week per key. This leg owns the verdict: a DOI
   Elsevier answers without an abstract is cached as a miss for 45 days.

Both drop out for the rest of a run on 401 / 403 / 429 or when the response
headers say the week's quota is spent, and resume on the next run. A miss
records the credential it was checked with (key only, or key + token), so the
first run with the token re-checks every DOI written off under a weaker
credential, and later runs do not re-query DOIs the token run has settled.

Quotas are per API key. If the same key is used in all four repositories, the
four backfills share its weekly quota; a second key from the same Developer
Portal account gives a second quota (the token pairs with any key of that
account).

## Reading a run's log

Lines to look for in the "Backfill … abstracts" step:

* `N papers need an abstract … ; M of them Elsevier DOIs, K unexpired misses
  re-eligible under this run's stronger credential` — the queue, newest first.
* `Scopus leg: Q queries (exact DOI form), F found, …` — the batched leg's
  tally. `dropped: HTTP 401/403` means the token does not carry a Scopus
  subscription for that account (or the key/token pair is wrong); the per-DOI
  leg still runs.
* `Elsevier per-DOI leg: F found, E 200-but-no-abstract, …` — mostly `E` with
  few `F` while the token is set means the token is not unlocking text; ask
  Elsevier support to confirm its entitlements.
* `Elsevier quota — Scopus Search: … requests left this week, resets …;
  Abstract Retrieval: …` — the live quota, from Elsevier's own headers.
* `::warning::` — the credentials were refused (401: bad key, or a revoked or
  mismatched token; 403: no entitlement). `::notice::` — a spent quota, which
  simply resumes after the reset.

`node lit/_scraper-ft50/abstracts-ci.mjs --dry-run` (with the two variables
set locally) prints the queue counts without fetching anything.

## Knobs

`FT50_ABS_SCOPUS=0` turns the Scopus leg off (per-DOI only);
`FT50_ABS_SCOPUS_PACE_MS` / `FT50_ABS_ELS_PACE_MS` pace the two legs (floors
250 ms; Elsevier allows 9 requests a second); `FT50_ABS_MISS_TTL_DAYS` is the
miss retry window (45). The same names apply in the shard workflows.
