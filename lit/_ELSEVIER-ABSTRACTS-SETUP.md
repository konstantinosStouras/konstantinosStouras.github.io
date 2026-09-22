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
| `ELSEVIER_API_KEY` | The Elsevier Developer Portal API key the token was issued against | Free, at <https://dev.elsevier.com> |
| `ELSEVIER_INST_TOKEN` | The **institutional token** (`insttoken`) that pairs with that key | Issued by Elsevier support to the account holder, on request |

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
  token as request headers — the selftest pins the source (no credential is
  interpolated or concatenated into a URL or string, no log line names one,
  no catch prints an error message verbatim) AND runs sixteen whole scenarios
  with fake credentials, failing if the run's output ever carries them;
* a secret pasted with an embedded line break or control character is refused
  at startup by name only (`::error::…is not a valid header value`) and
  ignored for the run, so it can never reach a request or an error message;
* nothing browser-side ever sees it: the backfill is a Node script on a runner,
  and the site only serves the resulting `_api-abstracts.json` text;
* a revoked token shows as HTTP 401 on a run that used to work, and the run
  prints a `::warning::` saying exactly that.

**Never paste the token into a chat, a commit, an issue or a pull request.**
It goes into the secrets page and nowhere else.

## Which key does the token belong to?

Elsevier issues an institutional token **against one specific API key**. Hold
two keys and it is easy to lose track of which one you quoted to support, and
the developer portal does not show the pairing — the token is issued by support
and never listed there. Elsevier will tell you, though, in the text of a 401,
and `lit/_scraper-ft50/elsevier-check.mjs` asks it for you:

    ELSEVIER_API_KEY=<first key> \
    ELSEVIER_API_KEY_2=<second key> \
    ELSEVIER_INST_TOKEN=<the token> \
      node lit/_scraper-ft50/elsevier-check.mjs

Run it on a personal machine: this build sandbox cannot reach api.elsevier.com,
and a proxy that answers in Elsevier's place is reported as proving nothing
rather than as a working key. Either key may be omitted. Credentials are read
from the environment only, never from the command line, and no value is ever
printed — each key is identified by a short fingerprint you can match across
runs. What it reports per key:

| What Elsevier says | What it means |
|---|---|
| `Invalid API Key` | that key is not live: wrong, mistyped or revoked |
| `Institution Token is not associated with API Key` | that key IS live, but the token belongs to the other one |
| a 200 with abstract text | the matched pair, entitled. Use this one everywhere |
| a 200 without abstract text | pair accepted, no off-campus abstract entitlement |
| `AUTHORIZATION_ERROR` | valid pair, missing entitlement — ask support, do not rotate |

If the token pairs with neither key, go back to Elsevier support with the live
key (read its value off <https://dev.elsevier.com/apikey/manage>) and ask them
to issue the token against that key, quoting the refusal text the script
printed. Offline test: `node lit/_scraper-ft50/elsevier-check.mjs --selftest`.

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
headers say the week's quota is spent, and resume on the next run (a 429 that
arrives with quota left is Elsevier's per-second throttle: the leg waits a
moment and retries once). A miss records the credential it was checked with
(key only, or key + token), so the first run with the token re-checks every
DOI written off under a weaker credential, and later runs do not re-query DOIs
the token run has settled. Three safety rules on top: a record Scopus returns
without an abstract is settled without asking the per-DOI API again; a "not
found" on a paper from the last two years is only a 7-day miss, since Scopus
indexes new articles late; and the per-DOI leg's "no abstract" answers count
as full verdicts only once it has retrieved at least one abstract in the run,
because a token that does not carry the entitlement produces exactly the same
answer shape (until then they are re-checked next run, and 25 of them with no
find prints a `::warning::`).

Quotas and the 9-requests-a-second limit are per API key, across every
repository using it. If the same key is used in all four repositories, the four
backfills share its weekly quota and can throttle one another when two slices
overlap; the leg copes (waits and retries, then stops for that run). If one
key's quota turns out to be the limit, ask Elsevier support whether the token
may be paired with a further key or a higher quota granted, rather than
creating extra keys on your own: the terms of use forbid working around
per-key quotas, and the token can be revoked without notice.

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
* `::warning::Scopus Search refused the COMPLETE view` — the batched leg is
  off for good until Elsevier support sorts out the token's Scopus entitlement
  (or the key/token pair); the per-DOI leg still runs, just slower.
* `::warning::` — the credentials were refused. The line quotes Elsevier's own
  error code: `AUTHENTICATION_ERROR` is a bad, expired or revoked key or token;
  `AUTHORIZATION_ERROR` is a VALID pair that lacks entitlement for what was
  asked (do not rotate the credentials, ask Elsevier support which
  entitlements the token carries). Both can arrive as HTTP 401.
* `::warning::The institutional token is not unlocking abstract text` — every
  per-DOI answer came back without an abstract; nothing was written off (those
  DOIs are re-checked next run), and Elsevier support should confirm the
  token's entitlement for the Abstract Retrieval API.
* `::warning::ELSEVIER_INST_TOKEN is set but ELSEVIER_API_KEY is not` — the
  token does nothing without its key; add the key secret.
* `::notice::` — a spent weekly quota (resumes after the reset) or a
  per-second throttle that a retry did not clear (resumes next run).
* `::notice::N Elsevier DOIs were left uncached this run` — no Elsevier leg
  reached them, so nothing was written off and they come back next run. It is
  the cost of a refused credential stated plainly: until the key or token
  works, every run re-asks the free legs about the same DOIs and moves none of
  them. A run with working credentials does not print this line.

* `✓ Wrote …/_api-abstracts.json (+ 1 more part, through …-2.json)` — the
  cache has outgrown one file and is written in parts. Nothing to do; it is how
  the file stays under GitHub's push limit (below).

`node lit/_scraper-ft50/abstracts-ci.mjs --dry-run` (with the two variables
set locally) prints the queue counts without fetching anything.

## The cache is written in parts, and why

A working token makes the backfill fast enough to be its own problem. On
2026-09-20 and 21 `lit-data-abs3-omecon` failed three runs in a row — not on
Elsevier, on the push:

    remote: error: File data/_api-abstracts.json is 102.41 MB; this exceeds
    GitHub's file size limit of 100.00 MB
    ! [remote rejected] HEAD -> main (pre-receive hook declined)

Each of those runs spent its whole 40-minute slice, found its abstracts, and
threw them away. So the cache is now written through
`lit/_scraper/_chunked-json.mjs`: the first part keeps the plain name and later
parts insert `-N` (`_api-abstracts.json`, `_api-abstracts-2.json`, …), each
capped at 48 MiB, with stale parts deleted when a rewrite needs fewer. Nothing
about the served data changes — the cache is never served.

Two things follow, and both are already done in code: every reader reads
through **all** the parts (the backfill, each daily build's
`applyAbstractCaches`, `clean-junk-abstracts.mjs`), and each workflow's
push-retry replay copies **every** part into its temp directory before the
replay, since copying the first file alone would hand the replay only a
fraction of that run's finds. If you add a new reader of this cache, use
`readChunkedJson` — a plain `JSON.parse(readFileSync(...))` will look like it
works and silently lose every abstract in the later parts.

## Knobs

`FT50_ABS_SCOPUS=0` turns the Scopus leg off (per-DOI only);
`FT50_ABS_SCOPUS_FORM=exact|loose` pins the Scopus DOI query form (by default
the run starts on the exact `DOI({…})` form and falls back to the quoted one
if Scopus rejects it or matches nothing with it); `FT50_ABS_SCOPUS_PACE_MS` /
`FT50_ABS_ELS_PACE_MS` pace the two legs (floors 250 ms; Elsevier allows 9
requests a second per key); `FT50_ABS_MISS_TTL_DAYS` is the miss retry window
(45); `FT50_ABS_CHUNK_BYTES` overrides the cache's per-part byte cap (48 MiB —
the selftest uses it to force a split without writing tens of megabytes).
The same names apply in the shard workflows.
