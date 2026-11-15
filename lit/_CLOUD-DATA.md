# Literature data in the cloud

The website repository contains page code, scraper code and workflow definitions. Generated datasets are published separately:

| Dataset | Repository | Public data URL |
|---|---|---|
| Native journals | `konstantinosStouras/lit-data-core` | `https://www.stouras.com/lit-data-core/data/` |
| FT50 catalog | `konstantinosStouras/lit-data-ft50` | `https://www.stouras.com/lit-data-ft50/data/` |
| Citation graph | `konstantinosStouras/lit-data-refs` | `https://www.stouras.com/lit-data-refs/data/` |
| Working papers | `konstantinosStouras/lit-data-workingpapers` | `https://www.stouras.com/lit-data-workingpapers/data/` |
| Generated analytics | `konstantinosStouras/lit-data-analytics` | `https://www.stouras.com/lit-data-analytics/data/` |

`data-storage.json` is the machine-readable map. GitHub Actions checks out the needed data onto an ephemeral runner, mounts it at the existing scraper paths, runs the scraper and publishes only to its designated data repository. The laptop does not need the datasets. Use `tools/new-website-worktree.mjs` for new code tasks; it also excludes data when starting from older commits.

Existing API, mail and Firebase secrets remain in the website repository. Each data repository has one separate write-enabled deploy key. Its private key is stored only in the matching `LIT_DATA_<ID>_DEPLOY_KEY` Actions secret in the website repository. No private key belongs in source control or Dropbox. A feature-branch job can read public data but must not publish.

## Running crawlers

Open the website repository's Actions tab and run the existing workflow, or use:

```powershell
gh workflow run lit-check-new.yml --repo konstantinosStouras/konstantinosStouras.github.io
gh workflow run lit-ft50-check-new.yml --repo konstantinosStouras/konstantinosStouras.github.io
gh workflow run lit-workingpapers-update-data.yml --repo konstantinosStouras/konstantinosStouras.github.io
gh workflow run lit-references-backfill.yml --repo konstantinosStouras/konstantinosStouras.github.io
```

Legacy laptop loop launchers stop with an explanation instead of pausing CI or recreating local datasets. Specialist browser harvesting still needs an interactive browser; use a temporary dataset workspace for that exceptional task, or transfer verified evidence to a cloud job. Ordinary crawler schedules need no laptop.

All jobs writing the same dataset share a concurrency group. Publication is fast-forward only. A concurrent external data edit causes a visible failure, never a stale-directory overwrite; failed jobs upload their output as a 14-day recovery artifact. Rerun from current data or reconcile the artifact deliberately. No force-push or automatic history expiration is used.

Each published snapshot includes SHA-256 hashes and source provenance. The publisher rejects malformed JSON, empty datasets, individual files over 99 MiB and datasets over 950 MiB. The latter leaves room under GitHub Pages' 1 GB published-site limit; split a dataset before raising that budget.

## Recovery and history

The migration must seed and verify public endpoints before removing generated files from the website's current tree. Keep the old files available until cutover verification passes. If a new endpoint fails before removal, restore the former website URLs. After removal, restore data from a known good data-repository commit and republish it before rolling back URLs; do not point users to missing files.

Deleting current-tree files does not erase old Git objects. Existing local histories and unfinished work are backed up separately and verified against Dropbox content hashes before local cleanup. Mark completed backup archives online-only using Dropbox; deleting the files would delete the cloud backup as well. Keep recovery archives out of source control. Do not prune reflogs, delete pack files or rewrite shared Git history to reclaim space.

The data repositories remain in the cloud. Their histories can grow without filling the laptop, provided ordinary code tasks do not clone them. Do not use Git LFS for these Pages-served JSON files.
