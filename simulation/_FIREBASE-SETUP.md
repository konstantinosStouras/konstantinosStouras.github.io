# Simulation Platform — Firebase setup (taking activations live)

While `firebase-config.js` holds the `PASTE_` placeholders the platform runs
in LOCAL mode: admin toggles apply only to the admin's own browser until the
downloaded `config.json` is committed, and there is no central roster. This
document takes it live: **Save in the admin panel publishes to every student
instantly**, and registrations flow into a **roster with CSV export**.

Everything fits the free **Spark plan** — no billing, no Cloud Functions.
Time: ~10 minutes. (Same recipe as the other sims' projects, e.g.
`search-with-ai-456d7`, `sustainable-supplychains`.)

## 1. Create the project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it e.g. `simulation-platform` (the name is free-form; the generated
   *project ID* below it is what ends up in the config — note it).
3. **Disable Google Analytics** (not needed) → Create project.

## 2. Enable Authentication (two providers)

1. Build → **Authentication** → Get started.
2. Sign-in method tab → enable **Anonymous** (students — they never see a
   login; this is what lets Firestore rules distinguish real page visitors
   from random internet writes).
3. Enable **Email/Password** (the admin sign-in). Leave "Email link" off.
4. Users tab → **Add user**: the admin e-mail + a password. If you want the
   one-credential-everywhere convenience with the other sims' admin panels,
   use the SAME e-mail/password you registered in their projects.
5. Settings tab → **Authorized domains** → add **stouras.com** (localhost and
   the firebaseapp.com domains are pre-authorized).

## 3. Create Firestore + deploy the rules

1. Build → **Firestore Database** → Create database → **Production mode** →
   region **europe-west1** (matches the other projects; any region works).
2. **Rules** tab → replace the default rules with the contents of
   `simulation/firestore.rules` from this repo.
3. **IMPORTANT:** in the pasted rules, edit the `isAdmin()` e-mail list to
   the admin e-mail you created in step 2.4 — the shipped placeholder is
   `admin@admin.com`. This list is the REAL security gate (the
   `SIMP_ADMIN_EMAILS` check in the page is only cosmetic).
4. **Publish.**

What the rules give you: the activation doc (`simPlatform/config`) is
world-readable but admin-only writable; each student (anonymous auth) can
write only their own `simPlatformStudents/{uid}` doc with a bounded field
set; only the admin can read the roster, delete rows, and set the
**`approved` flag** — the play gate: an unapproved student sees no
simulation cards, and a student can never approve themselves (their own
writes must leave `approved` exactly as it was).

**If you deployed the rules before the approval gate existed, re-paste and
Publish the current `simulation/firestore.rules`** — until then the admin's
Approve button is refused by the old rules and every student stays gated.

## 4. Register a web app and copy its config

1. Project settings (⚙ next to "Project Overview") → General → Your apps →
   **`</>`** (Web).
2. Nickname e.g. `simulation-platform-web`; do NOT tick Firebase Hosting →
   Register app.
3. From the shown `firebaseConfig` snippet copy: **apiKey**, **authDomain**,
   **projectId**, **appId**.

## 5. Wire it into the repo

Edit `simulation/firebase-config.js`:

```js
window.SIMP_FIREBASE_CONFIG = {
  apiKey: '…',                       // from step 4
  authDomain: '<project-id>.firebaseapp.com',
  projectId: '<project-id>',
  appId: '…'
};
window.SIMP_ADMIN_EMAILS = ['you@example.com'];   // = the rules' isAdmin() list
```

Commit + push to master. (The web config is PUBLIC by design — every visitor
downloads it; security lives entirely in the Firestore rules. This is the
same posture as the other sims' committed configs.)

## 6. Verify (2 minutes)

- `stouras.com/simulation/admin/` now shows a **FIREBASE** badge and an
  e-mail/password sign-in (the `?key=` gate no longer applies). Sign in.
- Toggle a simulation, **Save** → open `stouras.com/simulation/` in an
  incognito window / another device: the card is there without any commit.
- Register a test student in that incognito window → back in the admin
  panel, **Load roster** lists them; **Export CSV** works. (Students who
  registered while the platform was still in LOCAL mode join the roster
  automatically the next time they open the student page.)

## Troubleshooting

| Symptom | Cause |
|---|---|
| `auth/configuration-not-found` on the student page | Anonymous auth not enabled (step 2.2) |
| `auth/operation-not-allowed` at admin sign-in | Email/Password provider not enabled (step 2.3) |
| Save fails with `permission-denied` | Your e-mail is missing from the rules' `isAdmin()` list (step 3.3), or you edited `SIMP_ADMIN_EMAILS` but not the rules |
| Signed in but the panel says "not in SIMP_ADMIN_EMAILS" | `firebase-config.js`'s list doesn't include the e-mail you signed in with |
| Roster empty | Students haven't revisited the student page since the config went live; anonymous sign-in also requires step 2.2 |

## Rolling back

Restore the `PASTE_` placeholders in `firebase-config.js` and the platform is
back in LOCAL mode (committed `config.json` drives visibility again). Nothing
else to undo.
