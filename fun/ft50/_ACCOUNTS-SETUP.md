# FT50 Paper Browser, accounts setup (one time, ~5 minutes)

The FT50 Paper Browser (`fun/ft50/index.html`) ships the same optional sign-in
system as `/fun/ms/` (email/password, Google, Microsoft, and optionally
Apple/GitHub), so a logged-in visitor can:

- **Star** papers to save them for later
- Add a **private note** to any saved paper (only they can see it)
- Create **lists** (e.g. "Job market") and add papers to them
- Add **user-defined tags** and browse their papers by tag
- **Search across their own notes** (and titles, authors, tags)

All of this is **private per user** and uses its **own dedicated Firebase
project** — a SEPARATE Firestore database from the one behind `/fun/ms/`
(project `ms-paper-browser`), and not connected to ideasearchlab either.

The feature is **inert until you complete the steps below**. Until then the page
looks and behaves exactly as before (no Sign in button, no stars). Nothing on the
live site changes until you paste the config in step 4 and commit.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it something like `ft50-paper-browser`. Google Analytics is optional
   (you can skip it). Do **not** reuse the `ms-paper-browser` project — a
   separate project is what keeps this a separate Firestore database with its
   own users, quotas and rules.

## 2. Enable the sign-in methods

In the project, open **Build -> Authentication -> Get started**, then under the
**Sign-in method** tab enable the methods you want. The page shows a button for
each provider listed in the `AUTH_PROVIDERS` array (next to `FB_CONFIG` in
`fun/ft50/index.html`, default `['google', 'microsoft']`) — keep that list in
sync with what you actually enable, and add `'apple'` / `'github'` there if you
set those up too.

- **Email/Password** (toggle on, Save) — powers the register/sign-in form.
- **Google** (toggle on, pick a support email, Save) — covers all Gmail /
  Google-account users. Nothing else needed.
- **Microsoft** (optional but recommended: covers university & work Microsoft
  365 accounts). Firebase shows a **redirect URI** like
  `https://<project>.firebaseapp.com/__/auth/handler` when you toggle it on.
  Register an app in **Microsoft Entra ID** (portal.azure.com -> App
  registrations -> New registration; supported account types: "Accounts in any
  organizational directory and personal Microsoft accounts"; paste the redirect
  URI as a **Web** redirect). Copy the **Application (client) ID** and create a
  **client secret** (Certificates & secrets), then paste both into the Firebase
  Microsoft provider form and Save.
- **Apple** / **GitHub** (optional) — same procedure as described in
  `fun/ms/_ACCOUNTS-SETUP.md`.

If a visitor clicks a provider button you have not enabled yet, the modal shows
"This sign-in method is not enabled in the Firebase console yet." — nothing
breaks.

## 3. Authorize the live domain

Still under **Authentication**, open **Settings -> Authorized domains** and add:

- `stouras.com`
- `www.stouras.com`

(`localhost` is already there for local testing.) Google sign-in will not work
on a domain that is not in this list.

## 4. Create a Web App and copy the config

1. Open **Project settings** (gear icon, top left) -> **General**.
2. Scroll to **Your apps**, click the **`</>` (Web)** icon, give it a nickname
   (e.g. `ft50-web`), and **Register app**. You do **not** need Hosting.
3. Firebase shows a `firebaseConfig = { ... }` snippet. Copy those values into the
   `FB_CONFIG` object near the bottom of **`fun/ft50/index.html`** (search for
   `PASTE_API_KEY`), replacing every `PASTE_...` placeholder.

   These web config values are **not secrets** (every Firebase web app ships them
   in the browser); access is controlled by the security rules in step 6.

## 5. Create the Firestore database

Open **Build -> Firestore Database -> Create database**. Choose a location close
to your users (e.g. `eur3` / `europe-west`). Start in **production mode** (the
rules in the next step lock it down correctly).

## 6. Deploy the security rules

The rules make each user's data private to them. They live in
**`fun/ft50/_firestore.rules`**. Deploy either way:

- **Console:** Firestore Database -> **Rules** tab, paste the contents of
  `_firestore.rules`, click **Publish**.
- **CLI:** copy `_firestore.rules` to your Firebase project's `firestore.rules`
  and run `firebase deploy --only firestore:rules`.

Without this step, reads/writes are denied and saving silently fails (the UI
shows "Permission denied. The Firestore security rules may not be deployed yet.").

## 7. Commit and you are done

Commit the `fun/ft50/index.html` change with your pasted config and push to
`master`. The **Sign in** button appears top-right, and the star / notes / lists
/ tags features light up.

---

## Data model (for reference)

Everything is stored under the signed-in user's own document, so it is private by
construction (see `_firestore.rules`):

```
users/{uid}/papers/{docId}   { doi, title, authors, year,
                               starred, note, tags[], lists[listId], updatedAt }
users/{uid}/lists/{listId}   { name, createdAt }
```

`docId` is derived from the paper's DOI (or title + year when a DOI is missing),
so the same paper maps to one record per user.

## Notes

- Sign-in is **optional**: anonymous visitors use the browser exactly as before.
- To turn the feature off again, blank the `FB_CONFIG` values back to the
  `PASTE_...` placeholders; the page reverts to the no-accounts behaviour.
- Free tier (Spark plan) is plenty for this usage.
- An `/fun/ms/` account does NOT carry over — this is deliberately a separate
  database, so users register (or Google-sign-in) again here.
