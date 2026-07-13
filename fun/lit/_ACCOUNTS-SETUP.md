# The Lit, accounts setup (one time, ~5 minutes)

The Lit research paper browser (`fun/lit/index.html`) supports optional
sign-in (email/password and Google; Apple, GitHub and Microsoft are supported too
but are off by default) — the same accounts feature as `/fun/ms/` — so a
logged-in visitor can:

- **Star** papers to save them for later
- Add a **private note** to any saved paper (only they can see it)
- Create **lists** (e.g. "Marketplaces") and add papers to them
- Add **user-defined tags** and browse their papers by tag
- **Search across their own notes** (and titles, authors, tags)
- Fill in a **profile** (first/last name, affiliation, website, email) when they
  register and **edit it any time** from the account menu → "Edit profile"

All of this is **private per user** and uses its **own dedicated Firebase
project** (separate from the ms-paper-browser project, following the same
one-project-per-app pattern).

The feature is **inert until you complete the steps below**. Until then the page
looks and behaves exactly as before (no Sign in button, no stars). Nothing on the
live site changes until you paste the config in step 4 and commit.

> **Shortcut (shared accounts):** because the saved-paper document IDs are
> derived from DOIs in both apps, you *could* instead paste the existing
> `ms-paper-browser` config from `fun/ms/index.html` into `fun/lit/index.html`
> and skip every console step — sign-in would work immediately and users would
> share one account and one library across `/fun/ms/` and `/fun/lit/`. The
> trade-off: papers saved from The Lit's non-MS journals would also show up in
> the MS-only browser's library. The steps below assume the cleaner dedicated
> project instead.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it something like `lit-paper-browser`. Google Analytics is optional (you
   can skip it).

## 2. Enable the sign-in methods

In the project, open **Build -> Authentication -> Get started**, then under the
**Sign-in method** tab enable the methods you want. The page shows a button for
each provider listed in the `AUTH_PROVIDERS` array (next to `FB_CONFIG` in
`fun/lit/index.html`, default `['google']`) — keep that list in sync with what you
actually enable, and add `'microsoft'` / `'apple'` / `'github'` there if you set
those up too.

- **Email/Password** (toggle on, Save) — powers the register/sign-in form.
- **Google** (toggle on, pick a support email, Save) — covers all Gmail /
  Google-account users. Nothing else needed.
- **Microsoft** (optional; **not enabled by default** — covers university & work
  Microsoft 365 accounts). To turn it on later: toggle it in Firebase (which
  shows a **redirect URI** like `https://<project>.firebaseapp.com/__/auth/handler`),
  register an app in **Microsoft Entra ID** (portal.azure.com -> App
  registrations -> New registration; supported account types: "Accounts in any
  organizational directory and personal Microsoft accounts"; paste the redirect
  URI as a **Web** redirect), copy the **Application (client) ID**, create a
  **client secret** (Certificates & secrets), paste both into the Firebase
  Microsoft provider form and Save, then add `'microsoft'` to `AUTH_PROVIDERS`.
- **Apple** (optional; requires a paid Apple Developer account). Create a
  Services ID + key at developer.apple.com per the form's instructions, then
  fill them into the Firebase Apple provider and add `'apple'` to
  `AUTH_PROVIDERS`.
- **GitHub** (optional). Create an OAuth app at github.com -> Settings ->
  Developer settings -> OAuth Apps with the same redirect URI, paste its Client
  ID/secret into the Firebase GitHub provider, and add `'github'` to
  `AUTH_PROVIDERS`.

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
   (e.g. `lit-web`), and **Register app**. You do **not** need Hosting.
3. Firebase shows a `firebaseConfig = { ... }` snippet. Copy those values into the
   `FB_CONFIG` object near the bottom of **`fun/lit/index.html`** (search for
   `PASTE_API_KEY`), replacing every `PASTE_...` placeholder:

   ```js
   var FB_CONFIG = {
     apiKey: "AIza...",
     authDomain: "lit-paper-browser.firebaseapp.com",
     projectId: "lit-paper-browser",
     storageBucket: "lit-paper-browser.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

   These web config values are **not secrets** (every Firebase web app ships them
   in the browser); access is controlled by the security rules in step 6.

## 5. Create the Firestore database

Open **Build -> Firestore Database -> Create database**. Choose a location close
to your users (e.g. `eur3` / `europe-west`). Start in **production mode** (the
rules in the next step lock it down correctly).

## 6. Deploy the security rules

The rules make each user's data private to them. They live in
**`fun/lit/_firestore.rules`**. Deploy either way:

- **Console:** Firestore Database -> **Rules** tab, paste the contents of
  `_firestore.rules`, click **Publish**.
- **CLI:** copy `_firestore.rules` to your Firebase project's `firestore.rules`
  and run `firebase deploy --only firestore:rules`.

Without this step, reads/writes are denied and saving silently fails (the UI
shows "Permission denied. The Firestore security rules may not be deployed yet.").

## 7. Commit and you are done

Commit the `fun/lit/index.html` change with your pasted config and push to
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
registeredUsers/{uid}        { t }   ← PUBLIC, one contentless doc per account
```

`docId` is derived from the paper's DOI (or title + year when a DOI is missing),
so the same paper maps to one record per user — across every journal The Lit
covers.

### Registered-users tally (powers `fun/lit/analytics/`)

`registeredUsers/{uid}` is a small **public** collection used only so the
[Data Analytics page](analytics/) can display how many people have signed up.
Each account owns exactly one doc, keyed by its uid, holding only a coarse
"last seen" server timestamp `t` — **no e-mail, name or any private data**. The
main page writes it once per signed-in session (`auth.onAuthStateChanged`), and
the analytics page runs a `count()` aggregation over the collection (one billed
read per visit, nothing else downloaded). Its rule in `_firestore.rules` is:
public `read`, owner-only `create/update` pinned to just the `t` field, no
`delete`.

> **Re-deploy the rules after this change.** If you set accounts up before this
> tally existed, re-publish `_firestore.rules` (step 6 above) so the public
> `read` on `registeredUsers` is live — otherwise the analytics page can't count
> it and just hides the figure (everything else keeps working). The count
> reflects accounts that have signed in since the tally launched, so it converges
> to the true total as returning users sign in again; the exact all-time total is
> always in **Firebase console → Authentication**.

## Notes

- Sign-in is **optional**: anonymous visitors use the browser exactly as before.
- To turn the feature off again, blank the `FB_CONFIG` values back to the
  `PASTE_...` placeholders (or just remove the pasted values); the page reverts to
  the no-accounts behaviour.
- Free tier (Spark plan) is plenty for this usage.
