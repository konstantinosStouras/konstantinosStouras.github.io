# Point `lab/portfoliofit/` at a separate Firestore project

This guide moves the **dev copy** at `stouras.com/lab/portfoliofit/` onto a
brand-new, independent Firebase/Firestore project, so future edits and test
data never touch the **current production data**.

After this change:

| URL | Firebase project | Role |
| --- | --- | --- |
| `stouras.com/fun/portfoliofitgame/` | `stouras-portfoliofit` (existing) | **Current version, kept live.** Real participant data. **Do not change its config.** |
| `stouras.com/lab/portfoliofit/` | **new project** (e.g. `stouras-portfoliofit-dev`) | Where you make and test edits. Throwaway data. |

> The web Firebase config is **public by design** (it ships in the client JS),
> so committing it to the repo is expected and safe — access is controlled by
> the Firestore security rules, not by hiding the config.

> **The lab build runs the same fully anonymous flow as production.** Players sign
> in **anonymously** (no sign-up, no e-mail/password) and may **optionally** enter
> a session code to join an admin-created configuration snapshot — joining is **not**
> gated on a session. The admin still signs in as `admin@admin.com`. The new
> project's backend lives in its own folder, **`_portfoliofit-lab-firebase/`** —
> deploy *that* to the new project, not this one (`_portfoliofit-firebase/` stays
> for `fun/portfoliofitgame/`). Both backends now implement the same anonymous
> model; they are separated only so test data never touches production.

---

## What actually has to change in the code

Only the `FIREBASE_CONFIG = { … }` object, and only inside `lab/portfoliofit/`:

| File | What to edit | Leave alone |
| --- | --- | --- |
| `lab/portfoliofit/experiment.js` | `FIREBASE_CONFIG` near the top of the IIFE (~lines 22–30) → paste the **new** project's web config | keep the named app string `'portfoliofit'` |
| `lab/portfoliofit/admin.js` | `FIREBASE_CONFIG` near the top of the IIFE (~lines 17–24) → paste the **new** project's web config | keep the named app string `'portfoliofit'` |
| `lab/portfoliofit/index.html` | — | the `stouras-snake` config (~lines 2166–2175) is the shared "Account" login widget, **unrelated** to experiment data — leave it unless you also want to move that |
| `fun/portfoliofitgame/**` | — | **never touch** — it must keep the original `stouras-portfoliofit` config so the current version stays live |

The named Firebase app stays `'portfoliofit'`; only the config object changes.

---

## Step by step

### 1. Create the new Firebase project ("an entirely different Firestore account")
1. Open <https://console.firebase.google.com> signed in with the Google account
   you want to own it (a different account is fine — that is the point).
2. **Add project** → name it, e.g. `stouras-portfoliofit-dev`. Note the
   **Project ID** it generates.
3. Upgrade it to the **Blaze** (pay-as-you-go) plan — required for Cloud
   Functions. (Billing → Modify plan.)

### 2. Enable the products (match the originals)
- **Firestore Database** → *Create database* → start in **production mode** →
  location in the **`eur3` / europe-west** family (the callable functions run in
  `europe-west1`).
- **Authentication** → *Get started* → *Sign-in method* → enable
  **Anonymous** *and* **Email/Password** (participants sign in anonymously; the
  admin uses Email/Password).
- Cloud Functions are created on first deploy (step 6).

### 3. Create the admin user
**Authentication → Users → Add user** → email **`admin@admin.com`**, set a
password. The `?admin` panel and the security rules grant admin rights to this
exact email.

### 4. Register a Web App and copy its config
**Project settings (gear) → General → Your apps → Web (`</>`)** → register an app
(any nickname). Copy the `firebaseConfig` object it shows: `apiKey`,
`authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` (and
`measurementId` if present).

### 5. Authorize the live domain for Auth
**Authentication → Settings → Authorized domains** → add **`stouras.com`** and
**`www.stouras.com`** (keep `localhost` for local testing). Without this,
sign-in/registration from the live site is rejected.

### 6. Paste the new config into the two `lab/portfoliofit/` files
Replace the `FIREBASE_CONFIG = { … }` object in **both**
`lab/portfoliofit/experiment.js` and `lab/portfoliofit/admin.js` with the config
from step 4. Commit. (GitHub Pages deploys on push — no build step.)

### 7. Deploy rules / indexes / functions to the new project
From the **lab backend** folder (`_portfoliofit-lab-firebase/`, *not* this one):

```bash
cd ../_portfoliofit-lab-firebase
firebase login                 # the account that owns the new project
firebase use --add             # select the new project; give it an alias, e.g. "lab"
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions --project <new-project-id>
```

That folder's `firestore.rules` add the `sessions` collection (signed-in read,
admin write) and let any anonymous owner create their own `participants/{uid}`
doc (joining is not gated on a session). The `submitSurvey` / `registerParticipant`
callables are v1 in `europe-west1` (the anonymous flow uses `submitSurvey`; the
client writes the participant doc directly).

> **Avoid deploying to the wrong project.** `.firebaserc` currently defaults to
> `stouras-portfoliofit` (production). Either keep that default and always pass
> `--project <new-project-id>` explicitly, or add the new project as a named
> alias with `firebase use --add`. On a brand-new project the first functions
> deploy may need the default compute service account to have the Cloud Build /
> Artifact Registry / Storage Object Viewer roles — the CLI tells you if so.

### 8. (Optional) Seed content
The app falls back to the built-in defaults in `pf-defaults.js` when `config/app`
is missing, so it runs immediately on an empty project. To persist content, open
`lab/portfoliofit/?admin`, sign in as `admin@admin.com`, and use **Make this the
default** (and the Puzzles tab) to write `config/app` / `puzzleSets`. Participant
data is **not** copied — a fresh project starts empty; export from the old
project first if you need history.

### 9. Verify the split
- `lab/portfoliofit/?admin` → sign in as `admin@admin.com` → panel loads against
  the **new** (empty) project → **Sessions** tab → create a session and copy its ID.
- `lab/portfoliofit/` (incognito, bare URL) → press **Start** with **no** code →
  the game is immediately playable with **no** login/registration prompt → a
  `participants/{uid}` doc (anonymous) + `events` appear in the **new** project's
  Firestore, and **nothing new** appears in `stouras-portfoliofit`. Repeat with
  the session code entered to confirm the participant doc is tagged with `sessionId`.
- `fun/portfoliofitgame/` and `?admin` → still the same anonymous flow, still
  read/write the original `stouras-portfoliofit` project, untouched.

---

## Rollback
Revert the two `FIREBASE_CONFIG` edits in `lab/portfoliofit/experiment.js` and
`lab/portfoliofit/admin.js` back to the `stouras-portfoliofit` values (they are
in git history) and push. The new project can stay; it just goes unused.
