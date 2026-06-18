# PortfolioFit for Managers — Firebase backend (LAB / new project)

This folder is the deployable Firebase project for the **evolving lab build** at
`stouras.com/lab/portfoliofit/`. It is **separate** from `_portfoliofit-firebase/`
(which backs the frozen copy at `stouras.com/fun/portfoliofitgame/`). It is not
served by the website (the leading underscore keeps Jekyll from publishing it).

**What's different from `_portfoliofit-firebase/`:** participants sign in
**anonymously** and are gated by an admin-issued **Session ID** instead of
registering with e-mail/password. The admin still signs in as `admin@admin.com`
(Email/Password).

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
sessions/{id}                      named access session { name, active, participantCount, createdAt }  ← admin-managed
counters/participants              { count }  sequential label source (functions only)
participants/{uid}                 (uid = anonymous user)
  participantId, sessionId, anonymousLabel (p1, p2, ...),
  registration: { <questionId>: answer }, status, puzzleOrder: [id, ...]
  events/{autoId}                  one doc per action (place/move/rotate/flip/remove/calc/note/round-start/round-end)
  rounds/{roundId}                 per-round summary (net, coverage, fitness, time, placements)
  survey/answers                   { answers, completedAt }
```

## Participant flow

`welcome → training → enter Session ID + Participant ID + demographics → main → stats → survey → thank-you`

The admin creates/opens/closes sessions in the **Sessions** tab of
`lab/portfoliofit/?admin` and shares the Session ID with participants. The
anonymous credential persists in the browser, so a reload on the same device
resumes a participant's progress (there is no cross-device login by design).

## Local emulators (optional)

```
firebase emulators:start
```
