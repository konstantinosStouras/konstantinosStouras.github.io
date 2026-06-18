# Answer Arena - Firebase backend

This folder is the deployable Firebase project for the study at
`stouras.com/lab/answerarena/`. It is **not** served by the website (the leading
underscore keeps Jekyll/GitHub Pages from publishing it); it lives in the repo
only so the backend is versioned next to the app.

- **Firebase project (suggested id):** `stouras-answerarena`
- **Products:** Firestore, Authentication (**Anonymous** for participants +
  **Email/Password** for the admin). No Cloud Functions needed, so the free
  **Spark** plan is enough.
- **Admin account:** `admin@admin.com`
- **Participants:** take part **anonymously** - no e-mail, password or login.
  They sign in with a throwaway Firebase anonymous account, so each play still
  has its own `request.auth.uid` and the owner-based security rules apply
  unchanged. A session code is optional.

The web app talks to Firebase from the browser. Until you finish the steps
below and paste the web config into `lab/answerarena/arena-config.js`, the app runs in
**local test mode** (everything in the browser's localStorage) so you can click
through it offline.

---

## A. Create the dedicated Firebase project (one time)

1. **Sign in to the Firebase console:** https://console.firebase.google.com
   (use the Google account that should own this study's data).
2. **Add a project** -> name it e.g. `stouras-answerarena`. You can disable
   Google Analytics (not needed). Wait for it to finish provisioning.
3. **Enable Authentication** (two providers):
   - Left menu -> **Build -> Authentication -> Get started**.
   - **Sign-in method** tab -> enable **Anonymous** -> Save. *(This is what lets
     participants play without an account. If it is off, the app shows
     "Anonymous play is not enabled yet.")*
   - On the same tab -> enable **Email/Password** -> Save. *(Used only for the
     admin account.)*
4. **Create the admin user:**
   - Authentication -> **Users** tab -> **Add user**.
   - E-mail `admin@admin.com`, pick a strong password -> Add user.
   - (The security rules treat exactly this e-mail as the admin.)
5. **Create the Firestore database:**
   - Build -> **Firestore Database -> Create database**.
   - Start in **production mode** (we ship real rules below).
   - Location: choose the region closest to your participants.
6. **Register a Web app and copy its config:**
   - Project **Settings** (gear icon) -> **General** -> scroll to **Your apps**
     -> click the **</>** (Web) icon.
   - Nickname e.g. `answerarena-web`; you do **not** need Firebase Hosting.
   - Copy the `firebaseConfig` object it shows you.
7. **Paste the config into the app:**
   - Open `lab/answerarena/arena-config.js` and replace every `REPLACE_ME...` with the
     matching value from `firebaseConfig` (`apiKey`, `authDomain`, `projectId`,
     `storageBucket`, `messagingSenderId`, `appId`).
   - Commit. The app now uses Firebase instead of local test mode.
   - (The web config is **public by design** - it is safe to commit. Access is
     controlled by the security rules and Auth, not by hiding these values.)

After step 7 the app already has working **anonymous participation, content,
sessions, task-set uploads, responses and survey** - because those run under
the security rules. You just need to deploy the rules (next) so that writes
are actually allowed in production.

---

## B. Install the Firebase CLI (one time)

```
# Node.js 20+ must be installed first (https://nodejs.org)
npm install -g firebase-tools
firebase login
```

---

## C. Deploy the rules (required, and the only deploy step)

From **this** folder (`_lab-arena-firebase/`):

```
firebase use stouras-answerarena         # or: firebase use --add  and pick it
firebase deploy --only firestore:rules,firestore:indexes
```

Without this, every write is blocked by Firestore's default-deny rules and the
app will silently fail to save - so do this step. There are no Cloud Functions,
so nothing else to deploy.

---

## Data model

```
config/app                         texts, settings (twoByTwo, randomizeOrder,
                                   comparisonsPerUser, requireSessionCode),
                                   registrationQuestions, surveyQuestions, activeTaskSetId
taskSets/{id}                      { name, source, count, tasks:[{id,task,outputA,outputB}] }
sessions/{id}                      { code, name, status, taskSetId, condition, count }
participants/{uid}                 uid = Firebase anonymous UID
  participantId, email(null - anonymous), anonymous:true,
  registration:{ <questionId>: answer }, status, sessionId,
  condition:{ enabled, transparency, incentive }, order:[...], flips:[...], idx
  responses/{autoId}               { taskId, idx, choice('A'|'B'|'tie' as left/right/tie),
                                     chosenOutput, leftOutput, rightOutput, responseMs, condition }
  events/{autoId}                  optional action log
  survey/answers                   { answers, completedAt }
```

## Local emulators (optional)

```
firebase emulators:start
```

## Redeploying

Change only what you touched, e.g. after editing the rules:

```
firebase deploy --only firestore:rules
```
