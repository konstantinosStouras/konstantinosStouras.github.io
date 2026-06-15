# PortfolioFit for Managers — Firebase backend

This folder is the deployable Firebase project for the experiment at
`stouras.com/lab/portfoliofit/`. It is **not** served by the website (the
leading underscore keeps Jekyll from publishing it); it only lives in the repo
so the backend is versioned next to the app.

- **Firebase project:** `stouras-portfoliofit`
- **Region:** `europe-west1`
- **Products:** Firestore, Authentication (Email/Password), Cloud Functions
- **Admin account:** `admin@admin.com`

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
puzzleSets/{id}                    approved puzzle library (admin generates + freezes)
counters/participants              { count }  sequential label source (functions only)
participants/{uid}
  participantId, email, anonymousLabel (p1, p2, ...),
  registration: { <questionId>: answer }, status, puzzleOrder: [id, ...]
  events/{autoId}                  one doc per action (place/move/rotate/flip/remove/calc/note/round-start/round-end)
  rounds/{roundId}                 per-round summary (net, coverage, fitness, time, placements)
  survey/answers                   { answers, completedAt }
```

## Local emulators (optional)

```
firebase emulators:start
```
