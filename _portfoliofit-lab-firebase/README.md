# PortfolioFit for Managers — Firebase backend (LAB / new project)

This folder is the deployable Firebase project for the **lab / dev build** at
`stouras.com/lab/portfoliofit/`. It is **separate** from `_portfoliofit-firebase/`
(which backs the production copy at `stouras.com/fun/portfoliofitgame/`). It is not
served by the website (the leading underscore keeps Jekyll from publishing it).

**Same flow as production, different project.** The lab build runs the **same
fully anonymous flow** as `fun/portfoliofitgame/`: players sign in **anonymously**
(no sign-up, no e-mail/password) and may **optionally** enter a session code to
join an admin-created configuration snapshot — joining is **not** gated on a
session. The only reason this is a separate project is so test data never touches
production. The admin still signs in as `admin@admin.com` (Email/Password).

- **Firebase project:** the new project you created (set its ID below)
- **Region:** `europe-west1`
- **Products:** Firestore, Authentication (**Anonymous** + **Email/Password**), Cloud Functions
- **Admin account:** `admin@admin.com`

## One-time setup (new project)

1. Create the project in the [Firebase console](https://console.firebase.google.com)
   and upgrade it to the **Blaze** plan (required for Cloud Functions).
2. **Authentication → Sign-in method:** enable **Anonymous** *and* **Email/Password**.
3. **Authentication → Users:** add `admin@admin.com` with a password.
4. **Authentication → Settings → Authorized domains:** add `stouras.com` and `www.stouras.com`.
5. Register a **Web app** and paste its config into `lab/portfoliofit/experiment.js`
   and `lab/portfoliofit/admin.js` (the `FIREBASE_CONFIG` object; keep the
   `'portfoliofit'` app name).
6. Install the CLI: `npm install -g firebase-tools` then `firebase login`.

## Deploy

From **this** folder (`_portfoliofit-lab-firebase/`):

```
firebase use --add                 # select the new project, alias e.g. "lab"
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions --project <new-project-id>
```

`firebase use --add` writes `.firebaserc` (currently a placeholder). Redeploy
only what changed, e.g. `firebase deploy --only firestore:rules --project <new-project-id>`.

## Data model

```
config/app                         editable content + registration/survey questions + settings + active puzzle ids
puzzleSets/{id}                    approved puzzle library (admin generates + freezes)
sessions/{code}                    admin config snapshot players join by code { name, label, status, texts, settings, questions }
counters/participants              { count }  legacy label source (unused in the anonymous flow)
participants/{uid}                 (uid = anonymous user)
  anonymous: true, anonymousLabel, sessionId (or null), status, puzzleOrder: [id, ...], mainIndex
  events/{autoId}                  one doc per action (place/move/rotate/flip/remove/calc/note/round-start/round-end)
  rounds/{roundId}                 per-round summary (net, coverage, fitness, time, placements)
  survey/answers                   { answers, completedAt }
```

## Player flow

`welcome (play anonymously; optional session code) → training → main → stats → survey → thank-you`

Anyone can play with **no sign-up**: the welcome screen signs the visitor in
anonymously and they may optionally type a session code (or arrive via
`?session=CODE`) to join a specific admin-created configuration; with no code the
default configuration (`config/app`, or the built-in defaults) is used. The admin
creates/opens/closes sessions in the **Sessions** tab of `lab/portfoliofit/?admin`.
The anonymous credential persists in the browser, so a reload on the same device
resumes a player's progress (there is no cross-device login by design). If
Anonymous Auth is disabled or Firebase is unreachable, the app falls back to
OFFLINE mode — the default game still plays, just unsaved.

## Local emulators (optional)

```
firebase emulators:start
```
