# MS Paper Browser, accounts setup (one time, ~5 minutes)

The Management Science Paper Browser (`fun/ms/index.html`) now supports optional
sign-in (email/password and Google), so a logged-in visitor can:

- **Star** papers to save them for later
- Add a **private note** to any saved paper (only they can see it)
- Create **lists** (e.g. "Marketplaces") and add papers to them
- Add **user-defined tags** and browse their papers by tag
- **Search across their own notes** (and titles, authors, tags)

All of this is **private per user** and uses its **own dedicated Firebase
project** (it is not connected to ideasearchlab in any way).

The feature is **inert until you complete the steps below**. Until then the page
looks and behaves exactly as before (no Sign in button, no stars). Nothing on the
live site changes until you paste the config in step 4 and commit.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it something like `ms-paper-browser`. Google Analytics is optional (you
   can skip it).

## 2. Enable the two sign-in methods

In the project, open **Build -> Authentication -> Get started**, then under the
**Sign-in method** tab enable:

- **Email/Password** (toggle on, Save).
- **Google** (toggle on, pick a support email, Save).

## 3. Authorize the live domain

Still under **Authentication**, open **Settings -> Authorized domains** and add:

- `stouras.com`
- `www.stouras.com`

(`localhost` is already there for local testing.) Google sign-in will not work
on a domain that is not in this list.

## 4. Create a Web App and copy the config

1. Open **Project settings** (gear icon, top left) -> **General**.
2. Scroll to **Your apps**, click the **`</>` (Web)** icon, give it a nickname
   (e.g. `ms-web`), and **Register app**. You do **not** need Hosting.
3. Firebase shows a `firebaseConfig = { ... }` snippet. Copy those values into the
   `FB_CONFIG` object near the bottom of **`fun/ms/index.html`** (search for
   `PASTE_API_KEY`), replacing every `PASTE_...` placeholder:

   ```js
   var FB_CONFIG = {
     apiKey: "AIza...",
     authDomain: "ms-paper-browser.firebaseapp.com",
     projectId: "ms-paper-browser",
     storageBucket: "ms-paper-browser.appspot.com",
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
**`fun/ms/_firestore.rules`**. Deploy either way:

- **Console:** Firestore Database -> **Rules** tab, paste the contents of
  `_firestore.rules`, click **Publish**.
- **CLI:** copy `_firestore.rules` to your Firebase project's `firestore.rules`
  and run `firebase deploy --only firestore:rules`.

Without this step, reads/writes are denied and saving silently fails (the UI
shows "Permission denied. The Firestore security rules may not be deployed yet.").

## 7. Commit and you are done

Commit the `fun/ms/index.html` change with your pasted config and push to
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
  `PASTE_...` placeholders (or just remove the pasted values); the page reverts to
  the no-accounts behaviour.
- Free tier (Spark plan) is plenty for this usage.
