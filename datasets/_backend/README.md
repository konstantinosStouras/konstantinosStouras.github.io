# Dataset Library membership

Project: `stouras-dataset-library` (Firestore database in `eur3`).

Firebase Authentication supports email/password and Google. Email accounts receive Firebase verification links; Google supplies a verified identity. Firestore rules require a verified email for source URLs, bookmarks, and submissions. Public metadata never includes dataset URLs. Browser API configuration is public; it does not grant database access.

Bookmarks are stored under each user's UID. New datasets and suggested edits enter the private `submissions` collection with status `pending`. Review them in the project's Firebase console before publication. Members cannot approve their own submissions or modify published source records.

This website controls access to its displayed links and exports. The underlying third-party public datasets and the original open GitHub collection remain available independently, subject to their owners' terms. No third-party datasets are copied into Firebase Storage.

## Maintenance

Run `node admin.mjs import` from this directory with the existing Firebase CLI account to refresh protected source records and regenerate `../catalog-public.json` from `../_tools/source.md` and `../_tools/research-additions.json`. Deploy the regenerated public catalog through the normal website publication process. Do not move source files out of the underscore directories: GitHub Pages excludes them from served content.

Run `node access-test.mjs` to check live rules with temporary test accounts. It checks anonymous and unverified denial, verified source access, bookmark isolation, private pending submissions, and rejection of self-approval. It deletes its test accounts and records; no test emails are sent.

The dataset fork runs the upstream sync and notification workflow, plus `publish-catalog.yml`, which refreshes protected Firebase source records and the public metadata feed hourly and when research additions change. The owner approved the GitHub–Firebase connection. It uses Workload Identity Federation, restricted to that workflow on the fork's main branch, with no long-lived service account key. The website reads the public feed with its bundled catalog as fallback. Keep the publisher's copies of `catalog.mjs`, `research.mjs`, and `admin.mjs` in `.github/catalog` aligned when changing import behavior.
