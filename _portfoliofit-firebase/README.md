# PortfolioFit for Managers — Firebase backend

This folder is the deployable Firebase project for the experiment at
`stouras.com/lab/portfoliofit/`. It is **not** served by the website (the
leading underscore keeps Jekyll from publishing it); it only lives in the repo
so the backend is versioned next to the app.

- **Firebase project:** `stouras-portfoliofit`
- **Region:** `europe-west1`
- **Products:** Firestore, Authentication (**Anonymous** for players + Email/Password for the admin), Cloud Functions
- **Admin account:** `admin@admin.com`

> **Players are now fully anonymous.** The public flow signs players in with
> Firebase **Anonymous Authentication** — no e-mail/password registration. They
> may optionally enter a **session code** (an admin-created snapshot stored at
> `sessions/{code}`) to join a specific configuration; otherwise they play the
> default configuration (`config/app`, or the built-in defaults).

## Contents

| File | Purpose |
| --- | --- |
| `firebase.json` | Firestore + Functions + emulator config |
| `.firebaserc` | Default project = `stouras-portfoliofit` |
| `firestore.rules` | Security rules (admin = `admin@admin.com`) |
| `firestore.indexes.json` | Composite indexes |
| `functions/index.js` | `registerParticipant`, `submitSurvey` callables |

## One-time setup

1. Install Node.js (https://nodejs.org) and the Firebase CLI:
   ```
   npm install -g firebase-tools
   firebase login
   ```
2. The project must be on the **Blaze** plan (required for Cloud Functions).
3. **Enable Anonymous sign-in** (required for the public anonymous flow):
   Firebase console → **Authentication → Sign-in method → Anonymous → Enable**.
   Without this, players fall back to OFFLINE mode (the default game is still
   playable, but nothing is saved and session codes are ignored).
4. **Deploy the updated `firestore.rules`** (below) so anonymous players can read
   `config`/`sessions` and own their `participants/{uid}` subtree, and the admin
   can write `sessions/{code}`.

## Deploy

From **this** folder (`_portfoliofit-firebase/`):

```
firebase use stouras-portfoliofit
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions
```

Redeploy only what changed, e.g. `firebase deploy --only firestore:rules`.

## Data model

```
config/app                         editable content + registration/survey questions + settings + active puzzle ids
sessions/{code}                    admin-created config snapshot (label, texts, settings, questions); players join by code
puzzleSets/{id}                    approved puzzle library (admin generates + freezes)
counters/participants              { count }  legacy sequential label source (functions only; unused by anonymous flow)
participants/{uid}                 uid = Firebase Anonymous Auth uid
  anonymous: true, anonymousLabel (e.g. anon-1a2b3c), sessionId (or null),
  status, puzzleOrder: [id, ...]
  events/{autoId}                  one doc per action (place/move/rotate/flip/remove/calc/note/round-start/round-end)
  rounds/{roundId}                 per-round summary (net, coverage, fitness, time, placements)
  survey/answers                   { answers, completedAt }
```

The `registerParticipant` Cloud Function (e-mail/password registration + `p{n}`
labels) is no longer used by the anonymous flow; it is left in place for
reference. `submitSurvey` still works for anonymous players (it keys off the
caller's uid). Both remain deployed harmlessly.

## Local emulators (optional)

```
firebase emulators:start
```
