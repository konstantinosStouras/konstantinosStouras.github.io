# The Lit, accounts setup (one time, ~5 minutes)

The Lit research paper browser (`lit/index.html`) supports optional
sign-in (email/password and Google; Apple, GitHub and Microsoft are supported too
but are off by default) — so a
logged-in visitor can:

- **Star** papers to save them for later
- Add a **private note** to any saved paper (only they can see it)
- Create **lists** (e.g. "Marketplaces") and add papers to them
- Add **user-defined tags** and browse their papers by tag
- **Search across their own notes** (and titles, authors, tags)
- Fill in a **profile** (first/last name, affiliation, website, email) when they
  register and **edit it any time** from the account menu → "Edit profile"
- Set **default filters** (a preferred subset of journals and/or journal types)
  from the account menu → "Default filters"; they are **pre-applied
  automatically on sign-in**, so the user lands on their subset instead of the
  full catalog (they can still change or clear the filters afterwards). This is
  separate from **E-mail alerts** (which saves filters to get *e-mailed* about
  new matching papers); default filters pre-apply to the *page* on entry.

All of this is **private per user** and uses its **own dedicated Firebase
project**, following the same
one-project-per-app pattern.

The feature is **inert until you complete the steps below**. Until then the page
looks and behaves exactly as before (no Sign in button, no stars). Nothing on the
live site changes until you paste the config in step 4 and commit.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it something like `lit-paper-browser`. Google Analytics is optional (you
   can skip it).

## 2. Enable the sign-in methods

In the project, open **Build -> Authentication -> Get started**, then under the
**Sign-in method** tab enable the methods you want. The page shows a button for
each provider listed in the `AUTH_PROVIDERS` array (next to `FB_CONFIG` in
`lit/index.html`, default `['google']`) — keep that list in sync with what you
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
   `FB_CONFIG` object near the bottom of **`lit/index.html`** (search for
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
**`lit/_firestore.rules`**. Deploy either way:

- **Console:** Firestore Database -> **Rules** tab, paste the contents of
  `_firestore.rules`, click **Publish**.
- **CLI:** copy `_firestore.rules` to your Firebase project's `firestore.rules`
  and run `firebase deploy --only firestore:rules`.

Without this step, reads/writes are denied and saving silently fails (the UI
shows "Permission denied. The Firestore security rules may not be deployed yet.").

## 7. Commit and you are done

Commit the `lit/index.html` change with your pasted config and push to
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
users/{uid}/profile/main     { firstName, lastName, affiliation, website, email,
                               defaultJournals[], defaultJTypes[],
                               autoApplyFilters, updatedAt }
registeredUsers/{uid}        { t }   ← PUBLIC, one contentless doc per account
```

The **default filters** live on the profile document: `defaultJournals` is an
array of journal keys, `defaultJTypes` an array of journal-type keys (`utd24` /
`ft50` / `abs4` / `abs3`), and `autoApplyFilters` (default `true`) decides
whether they are pre-applied on sign-in. They are plain arrays of strings
(Firestore's no-nested-arrays limit does not apply), written with
`{ merge: true }` so they never clobber the name/affiliation fields (and vice
versa). No security-rules change is needed — `users/{uid}/**` already covers
this document (the same subtree as the E-mail-alerts `alerts` subcollection).

`docId` is derived from the paper's DOI (or title + year when a DOI is missing),
so the same paper maps to one record per user — across every journal The Lit
covers.

### Registered-users tally (powers `lit/analytics/`)

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
