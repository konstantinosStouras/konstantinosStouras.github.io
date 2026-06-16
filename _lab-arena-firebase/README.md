# Answer Arena - Firebase backend

This folder is the deployable Firebase project for the study at
`stouras.com/lab/answerarena/`. It is **not** served by the website (the leading
underscore keeps Jekyll/GitHub Pages from publishing it); it lives in the repo
only so the backend is versioned next to the app.

- **Firebase project (suggested id):** `stouras-answerarena`
- **Region:** `europe-west1`
- **Products:** Firestore, Authentication (Email/Password), Cloud Functions
- **Admin account:** `admin@admin.com`

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
3. **Enable Authentication:**
   - Left menu -> **Build -> Authentication -> Get started**.
   - **Sign-in method** tab -> enable **Email/Password** -> Save.
4. **Create the admin user:**
   - Authentication -> **Users** tab -> **Add user**.
   - E-mail `admin@admin.com`, pick a strong password -> Add user.
   - (The security rules treat exactly this e-mail as the admin.)
5. **Create the Firestore database:**
   - Build -> **Firestore Database -> Create database**.
   - Start in **production mode** (we ship real rules below).
   - Location: choose **europe-west1** (or the closest region; keep it
     consistent with the Functions region).
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

After step 7 the app already has working **login/registration, content,
sessions, task-set uploads, responses and survey** - because those run under
the security rules. The rules and the optional Cloud Function still need to be
deployed (steps below) so that writes are actually allowed in production and the
anonymous labels (p1, p2, ...) are handed out.

---

## B. Install the Firebase CLI (one time)

```
# Node.js 20+ must be installed first (https://nodejs.org)
npm install -g firebase-tools
firebase login
```

---

## C. Deploy the rules (required)

From **this** folder (`_lab-arena-firebase/`):

```
firebase use stouras-answerarena         # or: firebase use --add  and pick it
firebase deploy --only firestore:rules,firestore:indexes
```

Without this, every write is blocked by Firestore's default-deny rules and the
app will silently fail to save - so do this step.

## D. Deploy the Cloud Function (optional but recommended)

The `nextLabel` function hands out sequential anonymous labels atomically. It
needs the **Blaze** (pay-as-you-go) plan, which Cloud Functions requires.

```
# Upgrade the project to Blaze in the console first (Settings -> Usage and billing).
cd functions && npm install && cd ..
firebase deploy --only functions
```

If you skip this, the app still works; participants just get a `null`
`anonymousLabel` (the client handles that).

> First-time Functions deploys sometimes need the default compute service
> account to have the **Cloud Build**, **Artifact Registry** and **Storage
> Object Viewer** roles. The console will prompt/link you if so.

---

## Data model

```
config/app                         texts, settings (twoByTwo, randomizeOrder,
                                   comparisonsPerUser, requireSessionCode),
                                   registrationQuestions, surveyQuestions, activeTaskSetId
taskSets/{id}                      { name, source, count, tasks:[{id,task,outputA,outputB}] }
counters/participants              { count }  sequential-label source (Functions only)
sessions/{id}                      { code, name, status, taskSetId, condition, count }
participants/{uid}
  participantId, email, anonymousLabel (p1, p2, ...),
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
