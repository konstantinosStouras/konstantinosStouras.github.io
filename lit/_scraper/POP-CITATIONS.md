# Management Science Google Scholar citation updates

This local workflow uses the free Publish or Perish CLI, downloaded from
https://harzing.com/resources/publish-or-perish/command-line. Its Windows binary
has a valid Tarma Software Research signature. The CLI is free for personal
non-profit use. It is not a Google Scholar API.

## Running and resuming

From the `lit` directory:

```
node _scraper/pop-citations.mjs status
node _scraper/pop-citations.mjs run
node _scraper/pop-citations-selftest.mjs
node _scraper/scholar-citations-selftest.mjs
node _scraper/publish-scholar-selftest.mjs
node _scraper/publish-scholar-citations.mjs --push
```

The daily Codex follow-up runs at 10:00 Europe/London in this chat. The computer
must be on with Codex running and the repository available. No Windows Task
Scheduler job or paid service is used. The user authorized automatic publication
on 13 October 2026. After each batch and validation, publish verified data using
the dedicated publisher above, including any pending valid data during cooldown.

The publisher fetches the latest `origin/master`, merges verified observations
by DOI and retrieval date, tests the actual publication snapshot, and performs
a normal fast-forward push to GitHub Pages. It uses an isolated Git index and
does not alter the checkout, local branch, or user's staged work. It never
force-pushes. Future normal runs can change only `lit/data/scholar-citations.json`.
The one-time `--install` option adds the renderer and explicitly listed workflow
files; do not use that option for daily updates. Publication conflicts are
reported rather than resolved by overwriting newer counts or different clusters.

After a push, verify the live data at
`https://www.stouras.com/lit/data/scholar-citations.json` and the GitHub Pages build.
Do not report a deployment as live based only on a successful Git push. Keep
unpublished data for retry if the network or deployment fails.

Tools, cache (including cookies), raw exports, logs, state and review reports
live under `.local-pop/`, which is ignored by Git. Never publish these files or
print cookie headers. Verified observations live in `data/scholar-citations.json`.
The card renderer prefers these observations and shows their source/check date.

`state.json` is the authoritative cursor. `coverage.json` records coverage by
catalog year. `exports/*.review.json` records unmatched or ambiguous results.
The earlier `_scraper/scholar-review-progress.json` retains manual review notes.

## Initial pacing policy

There is no published CAPTCHA-free optimum. These are conservative starting
settings to tune from observed results, not a promise of uninterrupted access:

- One batch per day, starting at 100 additional result positions.
- At least 60 seconds between requests, plus PoP's adaptive pacing.
- Reuse cached earlier pages while gradually extending a journal/year search.
- After seven clean runs, add 50 result positions, capped at 300 per daily batch.
- On CAPTCHA/rate limit, stop, halve the batch (minimum 20), double the delay
  (maximum 300 seconds), and wait at least 48 hours. Do not repeatedly retry.
- Preserve the current year and position when a request fails.
- On other source failures, preserve verified partial exports, halve the next
  batch, reset the clean-run streak, and wait at least 24 hours.

Start at 2026. A journal/year search extends to the source's 1,000-result cap or
the end of results, then title searches cover missing catalog papers before
moving to the preceding year. Year discrepancies in Scholar are handled by
these title searches, which have no year filter. Count only matches to catalog
DOIs. Up to one tenth of the batch size in title queries is allowed each day.

The 90-day PoP cache window is for resuming this initial sweep. It is not the
recommended refresh interval for a future maintenance service. Cached counts
retain their actual HTTP retrieval dates; rerunning an export does not make
them fresh. This workflow completes an initial sweep, then leaves unresolved
papers in the review queue. It does not declare missing records to have zero
citations or claim full coverage from reaching the last year alone.

## Matching and provenance

Automatic import requires a catalog DOI, a positive integer count, matching
string-valued Scholar cluster IDs in `uid` and `cites_url`, no conflicting DOI
in the article link, and a retrieval date for that exact cluster/count pair from
PoP's local HTTP cache. Duplicate
rows are collapsed. Conflicting clusters/counts are withheld for manual review.
Counts can decrease on a newer observation; counts from different clusters or
providers are never summed. An existing browser-verified observation is retained
over an equally dated export. Zero/missing counts need browser confirmation.

To import an existing export without making another network request:

```
node _scraper/pop-citations.mjs import .local-pop/pilot-2026.json
```

## CAPTCHA recovery

The CLI cannot display challenges. Official PoP guidance says to open its GUI,
perform a Google Scholar search, complete the CAPTCHA, close the GUI, then retry
the CLI. Use the same PoP data/cache location when configuring that recovery.
The user has explicitly requested assistance solving presented challenges.
Use the available computer-use/browser tools and their applicable instructions.
Do not assume a challenge solved in an unrelated Chrome session fixes PoP.
If the GUI is needed, obtain it from the official Windows download page and
verify its signature; only the CLI has been installed for this initial setup.
If native UI control is unavailable, the desktop is locked, or the challenge
cannot be completed, preserve state and report the concrete action needed.
Keep the cooldown after recovery. No proxy rotation or other block evasion.

A crash can leave `.local-pop/run.lock`. It contains the runner process ID.
Verify that the process has ended before deleting that one stale lock. Do not
run another instance alongside a live process or clear the cache to retry.

Sources: [PoP CLI](https://harzing.com/resources/publish-or-perish/command-line),
[PoP pacing and cache](https://harzing.com/resources/publish-or-perish/manual/reference/dialogs/preferences-google-scholar),
[local scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app).
