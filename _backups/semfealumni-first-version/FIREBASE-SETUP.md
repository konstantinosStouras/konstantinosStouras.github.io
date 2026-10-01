# Sign-in with Google, Facebook, LinkedIn and e-mail: setup guide

This guide switches on member accounts for the SEMFE Alumni site
(https://www.stouras.com/semfealumni/). The code is already in place; what is
left happens in four web consoles (Firebase, Google, Meta, LinkedIn) and in two
small edits to `assets/js/config.js`.

Until you finish Part A, the site works exactly as now: the "Σύνδεση" button
says that registration opens soon, and the support page keeps the old Google
Form. You can do the parts one at a time. Each provider appears on the site
only after you add it.

Checked against the providers' own documentation on 30 September 2026. These
consoles get renamed often; if a button has moved, the words to look for are
given in quotes.

| Part | What it gives | Cost | Time |
|---|---|---|---|
| A. Firebase project | e-mail + password accounts, the member database | Free (Spark plan) | 20 min |
| B. Google | "Συνέχεια με Google" (every Gmail address) | Free | 5 min |
| C. Facebook | "Συνέχεια με Facebook" | Free | 30 min, plus Meta's review of your app if they ask for one |
| D. LinkedIn | "Συνέχεια με LinkedIn" | Needs the Blaze (pay-as-you-go) plan; at this size it costs nothing in practice | 45 min |

In every step below, `semfe-alumni` stands for your Firebase project ID. Use
yours if it is different.

---

## Part A. The Firebase project (needed for everything)

### A1. Create the project

1. Open https://console.firebase.google.com and sign in with the Google
   account that should own the project (for example the association's
   gradsemfe@gmail.com, so it does not depend on one person).
2. Click **"Create a new Firebase project"** (or "Add project").
3. Name it `SEMFE Alumni`. Under the name, Firebase suggests a **project ID**.
   Click the pencil and set it to something readable such as `semfe-alumni`.
   **Choose carefully: the ID can never be changed, and Google's sign-in
   window shows it to every member** ("to continue to semfe-alumni.firebaseapp.com").
4. Google Analytics and Gemini are optional. You can switch both off.
5. Click **Create project** and wait for it to finish.

### A2. Register the website and copy its settings

1. On the project's home page click the **Web** icon `</>` ("Add app" if an app
   already exists).
2. App nickname: `semfe-web`. Do **not** tick Firebase Hosting (GitHub Pages
   hosts the site). Click **Register app**.
3. Firebase shows a block like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "semfe-alumni.firebaseapp.com",
     projectId: "semfe-alumni",
     storageBucket: "semfe-alumni.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

4. Open `assets/js/config.js` in the repository and replace each `PASTE_...`
   value in `FIREBASE` with the matching value. Keep the quotes.

   These values are **not secrets**: every Firebase website sends them to the
   browser, and it is fine that the repository is public. What protects the
   data is the security rules (step A6). To find them again later: Project
   settings (gear icon) > General > "Your apps" > `semfe-web` > "Config".

5. Also open `.firebaserc` (at the top of the repository) and replace
   `PASTE_PROJECT_ID` with your project ID. It is used only when you deploy
   from the command line.

### A3. Switch on e-mail and password

1. Left menu: **Security > Authentication** (older screens say "Build >
   Authentication"). Click **Get started** if you see it.
2. Tab **Sign-in method** > **Email/Password** > switch on the first toggle
   ("Email/Password"). Leave "Email link (passwordless sign-in)" off. **Save**.

   Firebase allows at most **100 new e-mail accounts per hour from one
   network**. If you plan a registration drive at an event (everyone on the
   venue's Wi-Fi), ask Firebase for a temporary increase on the same tab
   beforehand, or let people register with Google, which has no such limit.

### A4. Authentication settings

Still in Security > Authentication, tab **Settings**:

1. **Authorized domains** > **Add domain**: add `stouras.com`, then add
   `www.stouras.com`. Only the host names matter (not `/semfealumni/`). Sign-in
   is refused on any site not in this list. (Projects made after April 2025 do
   not include `localhost`; add it only if you want to test on your own computer.)
2. **User account linking**: keep **"Link accounts that use the same email"**.
   This is what lets one person sign in with Google one day and Facebook the
   next and still have ONE account (the site handles the linking).
3. **User actions** > keep **"Email enumeration protection (recommended)"** on.
4. Optional: **Password policy** > require at least 8 characters (the site
   already asks for 8).

### A5. The e-mails members receive

Tab **Templates**:

1. Click the template language (pencil next to "Template language") and choose
   **Greek**. The site also asks for Greek, but some Firebase projects follow
   only this setting.
2. For "Email address verification" and "Password reset", set the **sender
   name** to `Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ`. You can also set a reply-to
   address (for example gradsemfe@gmail.com).
3. Project settings (gear) > General > **Public-facing name**: `SEMFE Alumni`.
   This is the name inside those e-mails.

The free plan sends up to 1,000 verification e-mails and 150 password-reset
e-mails a day, far more than the association needs.

### A6. The member database (Firestore)

1. Left menu: **Databases & Storage > Firestore** (older screens: "Build >
   Firestore Database") > **Create database**.
2. If asked for an edition, choose **Standard**, and leave the **Database ID**
   empty so it is the `(default)` database (the site connects to that one, and
   only one database per project is free).
3. **Location**: choose `eur3 (europe-west)` or `europe-west1 (Belgium)`.
   **This can never be changed.**
4. Start in **production mode** (everything locked until the next step).
   Click **Create**.
5. Open the **Rules** tab, delete what is there, paste the whole content of
   `firestore.rules` from the repository, and click **Publish**. It takes a few
   minutes to apply everywhere.

   Or from a terminal, in the repository folder (see "Command line" at the end):

   ```
   firebase deploy --only firestore:rules --project semfe-alumni
   ```

   The repository runs `check-project.mjs` before every deploy and refuses to
   publish into a project other than the one in `.firebaserc`.

### A7. Who can approve members

Two lists must name the same people:

* `ADMIN_EMAILS` in `assets/js/config.js` (decides who SEES the Διαχείριση page),
* `isAdmin()` in `firestore.rules` (decides who can actually READ and CHANGE
  applications).

Both currently say `kstouras@gmail.com` and `gradsemfe@gmail.com`. Change both,
run `node tools/check.mjs` (it fails if they differ), and publish the rules
again. An admin must sign in with a **verified** address: signing in with
Google does that automatically.

**Claim both admin addresses before you share the link.** As soon as sign-in
works (step A8), sign in once with each admin address (with Google once Part B
is done, or register with e-mail and click the confirmation link). An address
that already has an account cannot be registered by anyone else. This matters
because the admin addresses are visible in the site's files: without this
step, someone could register an admin address with a password of their own,
never confirm it, and attach their own Facebook or Google login to that
account, keeping a way in after you later take the address back. The account
page already refuses to attach a second login until the e-mail is confirmed,
but claiming the addresses first closes the door completely.

### A8. Publish and test

1. Run `node tools/check.mjs`, commit, and push. GitHub Pages republishes in
   about a minute.
2. Open https://www.stouras.com/semfealumni/account/, click **Εγγραφή**, and
   create an account with an admin e-mail (see A7: claim these first). You should receive a Greek e-mail with a
   confirmation link. Click it, go back, press **"Το επιβεβαίωσα"**, and fill in
   the membership application.
3. Sign in with an admin address and open **Διαχείριση μελών** from the
   account menu. Your application is there; press **Έγκριση**.

From here on, the support page asks new members to apply through their account
instead of the old Google Form.

---

## Part B. Google (Gmail)

1. Firebase: Security > Authentication > **Sign-in method** > **Add new
   provider** > **Google**.
2. Switch on **Enable**. **Public-facing name for project**: `SEMFE Alumni`.
   **Support email for project**: pick your address. **Save**.
3. In `assets/js/config.js`, make sure `AUTH_PROVIDERS` contains `'google'`
   (it does).

That is all. Test: sign out, click **Σύνδεση > Συνέχεια με Google**.

The Google window says "to continue to semfe-alumni.firebaseapp.com". Hiding
that needs a custom sign-in domain on Firebase Hosting (for example
`auth.stouras.com`); it is optional, adds DNS work, and every provider's
redirect address would change with it, so leave it for later.

Optional polish: the Google window shows the name and logo from Google Cloud
console > **Google Auth Platform > Branding** for this project. There you can
set the app name `SEMFE Alumni`, upload `assets/img/logos/app-icon-1024.png`,
add the authorized domain `stouras.com`, and set the home page
`https://www.stouras.com/semfealumni/`, privacy policy
`https://www.stouras.com/semfealumni/privacy/` and terms
`https://www.stouras.com/semfealumni/terms/`. (Uploading a logo can trigger a
short Google verification.)

---

## Part C. Facebook

You need a Facebook account. Everything happens at
https://developers.facebook.com.

### C1. Become a Meta developer (once)

Go to https://developers.facebook.com, click **Get started** (or open
https://developers.facebook.com/async/registration), accept the terms, and
confirm your phone number and e-mail.

### C2. Create the app

1. **My Apps > Create App**.
2. **App details**: App name `SEMFE Alumni` (it may not contain "Facebook" or
   "FB"), contact e-mail. **Next**.
3. **Use cases**: choose **"Authenticate and request data from users with
   Facebook Login"**. Use it for this app only (use cases cannot be removed
   later, so do not mix in Page management). **Next**.
4. **Business**: if the association has a Meta business portfolio, connect it;
   otherwise choose **"I don't want to connect a business portfolio yet"** (you
   can connect one later, see C6). **Next**, then **Go to dashboard**.

### C3. Ask for the e-mail address

1. Left menu **Use cases** > the Facebook Login use case > **Customize**.
2. **Permissions**: `public_profile` is already there. Next to **email** click
   **Add**. Without this, Facebook does not give the site the member's e-mail.

### C4. Connect Facebook and Firebase

1. Facebook: left menu **App settings > Basic**. Copy the **App ID**. Click
   **Show** next to **App secret** and copy it. **The secret goes ONLY into
   Firebase, never into the website's code.**
2. Firebase: Security > Authentication > Sign-in method > Add new provider >
   **Facebook**. Enable, paste the **App ID** and **App secret**, and copy the
   **OAuth redirect URI** Firebase shows. It looks like
   `https://semfe-alumni.firebaseapp.com/__/auth/handler`. **Save**.
3. Facebook: **Use cases** > Facebook Login > **Customize** > **Settings**:
   * **Client OAuth login**: On.
   * **Web OAuth login**: On. (Meta's checklist suggests switching it off if
     you do not use it. Firebase does use it; leave it on.)
   * **Enforce HTTPS**: On. **Use Strict Mode for redirect URIs**: On.
   * **Valid OAuth Redirect URIs**: paste the Firebase URI from step 2, exactly,
     with nothing added (not the site's address).
   * "Login with the JavaScript SDK" is not needed.
   * **Save changes**.

### C5. Fill in the app's details (required before going live)

Facebook: **App settings > Basic**:

| Field | Value |
|---|---|
| Display name | `SEMFE Alumni` |
| App domains | `stouras.com` |
| Contact email | the association's address |
| Privacy Policy URL | `https://www.stouras.com/semfealumni/privacy/` |
| Terms of Service URL | `https://www.stouras.com/semfealumni/terms/` |
| User data deletion | choose **"Data deletion instructions URL"**: `https://www.stouras.com/semfealumni/data-deletion/` |
| App icon | upload `assets/img/logos/app-icon-1024.png` from the repository |
| Category | Education (or Business and pages) |

At the bottom click **+ Add platform > Website**, Site URL
`https://www.stouras.com/semfealumni/`. **Save changes**.

(The site has no "data deletion callback": that needs a server. The
instructions page is the option Meta offers for sites like this one, and
members can also delete everything themselves from "Ο λογαριασμός μου".)

Facebook can sign someone in without giving an e-mail address (if they
decline it or have none). The site copes: the membership form then simply asks
for one.

### C6. Go live

1. Until the app is published, **only people with a role on the app** (you,
   and anyone you add under **App roles**) can sign in with Facebook. Test now
   with your own account: Σύνδεση > Συνέχεια με Facebook.
2. Before Meta lets you publish, an admin must complete the **Data Use
   Checkup** (a short questionnaire about what data the app uses: here only
   the name, e-mail and profile photo, for member sign-in). Then left menu
   **Publish** > **Go live**.
3. Test again with a Facebook account that has **no** role on the app (ask a
   friend). If it works, you are done.
4. If Facebook refuses non-role users, open Use cases > Facebook Login >
   Permissions and look for **Increase access** next to `public_profile` /
   `email`. Meta's documentation disagrees with itself here: its login pages
   say name and e-mail need no review, while other pages say an app used by
   the public goes through **App Review** and that **Business Verification**
   is needed for "advanced access". Be ready for both. For verification, the
   app must belong to a business portfolio (create one for the association at
   https://business.facebook.com, then connect it in App settings > Basic),
   and a business admin verifies it with the association's documents.
5. Add a second administrator (App roles > Roles), so the app does not depend
   on one person. The **Data Use Checkup** comes back every year; if it is
   missed, Facebook sign-in stops.
6. Meta may send "data deletion requests" for people who removed the app from
   their Facebook settings (App dashboard > Advanced settings > User Data
   Deletion Requests). Find the person in Firebase console > Authentication
   and delete them; their application and directory card are removed with
   them (if the functions from Part D are deployed; otherwise also delete their
   document in Firestore > members and directory).

Keep `'facebook'` in `AUTH_PROVIDERS` in `config.js` (it is there).

---

## Part D. LinkedIn

LinkedIn is not one of Firebase's built-in providers, and Firebase's generic
way of adding one ("OpenID Connect") has had a known problem with LinkedIn:
LinkedIn wants the app's secret inside the request, Firebase sends it in a
header, and sign-in fails at the last step with *"A required parameter
client_secret is missing"*. Firebase support confirmed this as a bug in 2024
and no fix has been announced.

So the site ships with a small **Cloud Function** (`functions/`) that does the
LinkedIn exchange itself, the way LinkedIn documents it, and then signs the
member in to Firebase. This is the reliable route (D2). The built-in route
(D3) is shorter and may work by now, but it needs Identity Platform and it
limits LinkedIn to 2 users a day on the free plan.

Both routes start with a LinkedIn app (D1) and both need the **Blaze**
(pay-as-you-go) plan. At an alumni association's size the function stays inside
the free allowance (2 million calls a month), so the bill is 0; the plan just
needs a card on file. Set a budget alert (D2 step 1) and you will be told long
before anything costs money.

### D1. Create the LinkedIn app

1. Go to https://www.linkedin.com/developers/apps and click **Create app**.
2. Fill in:
   * **App name**: `SEMFE Alumni`
   * **LinkedIn Page**: the association's page,
     `https://www.linkedin.com/company/semfealumni/`. **The app is bound to
     this page for ever** (it cannot be moved to another page later), so pick
     the association's page, not a personal or test one.
   * **Privacy policy URL**: `https://www.stouras.com/semfealumni/privacy/`
   * **App logo**: `assets/img/logos/app-icon-1024.png`
   * Tick the legal agreement and click **Create app**.
3. **Settings** tab > **Verify** > **Generate URL** > copy it and send it to a
   **super admin** of the SEMFE Alumni LinkedIn page. They open it, sign in,
   and approve (they have 30 days). LinkedIn does not say clearly whether sign-in
   needs this, so do it anyway; approval cannot be undone.
4. **Products** tab > **"Sign In with LinkedIn using OpenID Connect"** > **Request
   access** (it is self-service and switches on at once). Do NOT use the old
   "Sign In with LinkedIn" product; it was retired in 2023.
5. **Auth** tab: copy the **Client ID** and the **Primary Client Secret**. Keep
   the secret private.

### D2. The reliable route: the Cloud Function (recommended)

1. **Blaze plan.** Firebase console > the plan name at the bottom of the left
   menu (or Project settings > Usage and billing) > **Upgrade** > Blaze, and
   add a billing account. Then Google Cloud console > **Billing > Budgets &
   alerts** > **Create budget**, for example 5 EUR, alerts at 50% and 100%.
   (An alert warns you by e-mail; it does not stop spending. At this site's
   size there is nothing to stop: sign-ins, the database and the function all
   stay inside the free allowances.)
2. **LinkedIn redirect address.** LinkedIn **Auth** tab > "Authorized redirect
   URLs for your app" > pencil > **Add redirect URL**:

   ```
   https://www.stouras.com/semfealumni/auth/linkedin/
   ```

   Exactly this, with the final slash. **Update**.
3. **Command line tools** (once per computer): install Node.js 22 or newer from
   https://nodejs.org, then in a terminal:

   ```
   npm install -g firebase-tools
   firebase login
   ```

4. **Deploy the function.** In the repository folder (after A2 step 5 has put
   your project ID in `.firebaserc`):

   ```
   cd functions
   npm install
   cd ..
   firebase functions:secrets:set LINKEDIN_CLIENT_SECRET --project semfe-alumni
   ```

   Paste the LinkedIn **Primary Client Secret** when asked. It is stored in
   Google Secret Manager, never in the repository. Then:

   ```
   firebase deploy --only functions --project semfe-alumni
   ```

   The first time, the CLI asks for:
   * `LINKEDIN_CLIENT_ID`: paste the LinkedIn **Client ID**.
   * `ALLOWED_ORIGINS`: press Enter to keep `https://www.stouras.com,https://stouras.com`.
   * `LINKEDIN_REDIRECT_URIS`: press Enter to keep
     `https://www.stouras.com/semfealumni/auth/linkedin/`.

   It saves your answers in `functions/.env.semfe-alumni` (safe to commit: none
   of them is secret). At the end it prints a **Function URL** such as
   `https://linkedinsignin-abc123-ew.a.run.app`. Copy it.

   (On a Windows machine that has `FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH`
   set, this works as is: the function uses firebase-functions 7.4, which
   supports that setting.)

5. **Let the function sign people in.** It creates Firebase sign-in tokens,
   which needs one permission:
   * Google Cloud console (https://console.cloud.google.com), pick the project.
   * **APIs & Services > Library** > search **"IAM Service Account Credentials
     API"** > **Enable**.
   * **IAM & Admin > IAM** > find the account named
     `<project-number>-compute@developer.gserviceaccount.com` ("Default compute
     service account") > pencil > **Add another role** > **Service Account Token
     Creator** > **Save**.

   Without this, LinkedIn sign-in fails with a message about
   `iam.serviceAccounts.signBlob`.
6. **Tell the site.** In `assets/js/config.js`, in `LINKEDIN`:

   ```js
   LINKEDIN: {
     mode: 'function',
     clientId: '<the LinkedIn Client ID>',
     functionUrl: '<the Function URL from step 4>',
     providerId: 'oidc.linkedin'
   },
   ```

   The Client ID is not secret (it is in every LinkedIn sign-in link anyway).
   Commit and push. The **Συνέχεια με LinkedIn** button now appears.
7. Test: sign out, Σύνδεση > Συνέχεια με LinkedIn. LinkedIn asks for
   permission, then brings you back to the site signed in.

How it behaves:
* A member whose LinkedIn e-mail is verified and who already has an account
  with the same e-mail (for example via Google) lands in that same account.
* A member can also connect LinkedIn from **Ο λογαριασμός μου > Τρόποι
  σύνδεσης**.
* For safety, an existing account whose e-mail was never confirmed is not
  handed over to a LinkedIn sign-in; the site asks the person to sign in the
  usual way first and connect LinkedIn from their account page.

### D3. The built-in route (shorter, may not work)

Try this only if you prefer not to deploy the function. If it fails with
"client_secret is missing", use D2.

1. Firebase: Security > Authentication > **Settings** > **"Upgrade to Firebase
   Authentication with Identity Platform"**. On the free plan this limits
   Google/Facebook/e-mail sign-ins to 3,000 people a day and LinkedIn to **2
   a day** (and 50 a month); on Blaze the first 50 LinkedIn users a month are
   free, then 0.015 USD per user. Google says nothing about undoing the
   upgrade, so treat it as permanent.
2. Sign-in method > **Add new provider** > **OpenID Connect**:
   * Grant type: **Code flow**
   * Name: `linkedin` (check that the Provider ID reads exactly `oidc.linkedin`)
   * Client ID and Client secret: from LinkedIn's Auth tab
   * Issuer: `https://www.linkedin.com/oauth` (not `https://www.linkedin.com`;
     some LinkedIn pages still show the old value)
   * **Save**.
3. LinkedIn **Auth** tab > add the redirect URL
   `https://semfe-alumni.firebaseapp.com/__/auth/handler`.
4. `assets/js/config.js`: set `LINKEDIN.mode` to `'oidc'`.

---

## Checking it all works

1. `node tools/check.mjs` passes.
2. On a phone and on a computer: register with e-mail, confirm, apply; sign in
   with Google; sign in with Facebook; sign in with LinkedIn.
3. Sign in with Facebook using an e-mail you already used with Google: the site
   says you already have an account, you sign in with Google, and Facebook is
   then linked to the same account (Ο λογαριασμός μου > Τρόποι σύνδεσης shows both).
4. As an admin: approve the test application, mark the year's dues, open the
   Περιοχή μελών and see the directory.
5. Delete the test account from Ο λογαριασμός μου > Διαγραφή λογαριασμού.

## When something goes wrong

| What you see | Why | Fix |
|---|---|---|
| "Η σύνδεση μελών ανοίγει σύντομα" | `config.js` still has `PASTE_` values | A2 |
| "Η σύνδεση δεν έχει εγκριθεί ακόμα για αυτή τη διεύθυνση" (auth/unauthorized-domain) | the site's host is not in Authorized domains | A4 step 1 |
| "Αυτός ο τρόπος σύνδεσης δεν έχει ενεργοποιηθεί ακόμα" (auth/operation-not-allowed) | the provider is off in Firebase, or the OIDC provider ID is not exactly `oidc.linkedin` | B, C4, D3 |
| Facebook: "URL blocked" / "redirect URI is not whitelisted" | the Firebase handler URI is missing or mistyped in Facebook's Valid OAuth Redirect URIs | C4 step 3 |
| Facebook works for you but not for others | the app is not live, or needs Increase access / verification | C6 |
| LinkedIn: "Redirect_uri doesn't match" on LinkedIn's page | the redirect URL on LinkedIn's Auth tab differs by even one character | D2 step 2 |
| LinkedIn: back on the site with "Η σύνδεση με LinkedIn δεν ολοκληρώθηκε" | function not deployed, wrong `functionUrl`, or the IAM role is missing | D2 steps 4 to 6; Google Cloud console > Logging shows the reason |
| LinkedIn (D3): "client_secret is missing" | the Firebase OIDC bug | use D2 |
| "Δεν έχετε δικαίωμα για αυτή την ενέργεια" (permission-denied) | the rules are not published, or an admin address is missing from `isAdmin()` | A6, A7 |
| Google sign-in fails inside the Facebook/Instagram/LinkedIn app | Google blocks sign-in inside apps' built-in browsers | the site tells the member to open the page in Safari or Chrome |
| The Διαχείριση page says "no access" to an admin | the address is not verified, or not in `ADMIN_EMAILS` | sign in with Google; A7 |

## Command line (optional)

Everything above can be done in the web consoles except deploying the LinkedIn
function. From the repository folder:

    firebase deploy --only firestore:rules --project semfe-alumni    # publish firestore.rules
    firebase deploy --only functions --project semfe-alumni          # deploy the LinkedIn function
    node check-project.mjs                                           # shows which project this folder deploys to

Always name the project with `--project`. The CLI can remember a different
"active project" per folder, and without the flag it might publish these rules
into another of your Firebase projects. `check-project.mjs` runs before every
deploy and refuses when the target is not the project in `.firebaserc`.

## What is stored, and where

    members/{uid}        the membership application: name, e-mail, phone, years,
                         direction, work, city, LinkedIn, consents, status,
                         dues years. Readable by its owner and the admins.
    directory/{uid}      the members-only directory card (name, year, direction,
                         work, city, LinkedIn). Only for active members who
                         opted in; readable only by active members and admins.
    linkedinLinks/{sub}  which account a LinkedIn profile signs in to. Written
                         only by the Cloud Function; no browser can read it.

Nothing else is stored. The privacy policy (`/privacy/`) says the same in Greek;
if you change what the site collects, update it too.
