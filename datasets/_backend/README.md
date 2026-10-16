# Dataset Library membership

Project: `stouras-dataset-library` (Firestore database in `eur3`).

Firebase Authentication supports email/password and Google. Email accounts receive Firebase verification links; Google supplies a verified identity. Firestore rules require a verified email for source URLs, bookmarks, and submissions. Public metadata never includes dataset URLs. Browser API configuration is public; it does not grant database access.

Bookmarks are stored under each user's UID. New datasets and suggested edits enter the private `submissions` collection with status `pending`. Review them in the project's Firebase console before publication. Members cannot approve their own submissions or modify published source records.

This website controls access to its displayed links and exports. The underlying third-party public datasets and the original open GitHub collection remain available independently, subject to their owners' terms. No third-party datasets are copied into Firebase Storage.

## Maintenance

Run `node admin.mjs import` from this directory with the existing Firebase CLI account to refresh protected source records and regenerate `../catalog-public.json` from `../_tools/source.md` and `../_tools/research-additions.json`. Deploy the regenerated public catalog through the normal website publication process. Do not move source files out of the underscore directories: GitHub Pages excludes them from served content.

Run `node access-test.mjs` to check live rules with temporary test accounts. It checks anonymous and unverified denial, verified source access, bookmark isolation, private pending submissions, and rejection of self-approval. It deletes its test accounts and records; no test emails are sent.

The upstream GitHub sync and notification workflow remains in the dataset fork. Automatic publication of its protected link records needs a separately approved GitHub–Firebase publishing connection. Until that connection is approved and configured, import new upstream records manually with the command above.
