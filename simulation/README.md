# Simulation Platform — `stouras.com/simulation`

One front door for the class simulations hosted on this site. Students
**register once**; the instructor **activates** the simulations for today's
class from an **admin panel**; only active simulations appear to students, as
cards; launching a card asks for the **Session ID** (or ships it
automatically) and hands the student's saved details to the simulation.
**No hosted simulation was modified** — each app keeps working standalone
exactly as before; the platform only *drives* them from the outside.

Vanilla HTML/CSS/JS, no build step, no external CDN (the Firebase SDK is
lazy-imported only when configured). Unlisted (`noindex`) until launch.
Offline test: `node simulation/tools/smoke.mjs` (Playwright; drives the whole
flow against a local static server, no network), plus
**`node simulation/tools/handoff-guard.mjs`** — the one that protects the
research data: it runs each simulation's OWN handoff mapper (its id/label
tables and validation rules, read from its source) over a canonical platform
profile and requires FULL coverage — every field of every default registration
form answered, in-list, from the platform alone. The sims deliberately DROP an
answer their form would not accept and show the field instead, which is safe
but silent: one drifted option list, or a new question the platform cannot
answer, quietly turns the silent registration back into a form and the export
comes back with holes. It also pins that a field a sim leaves OPTIONAL (Gender,
in both) is compulsory on the platform — otherwise a missing answer is exported
blank with nothing asked. And
`node simulation/tools/roster-width-guard.mjs`, which pins that the roster's
per-row **Delete** button stays fully visible (it is the last of a dozen columns
and used to be clipped into `.roster-wrap`'s horizontal scroll).

The admin page is laid out with `.wrap wide` — the window width, capped at
1680px — rather than the student page's 1060px reading column, because the
roster carries one column per active simulation on top of its six base columns.
Keep new admin markup inside a `.wrap wide` container; the student page keeps
plain `.wrap`.

## Files

| File | Role |
|---|---|
| `index.html` | Student page: one-time registration → card grid of active sims → launch dialog |
| `admin/` | Admin panel: activation toggles, pinned Session IDs, embedded per-sim admin consoles, roster |
| `catalog.js` | **The one place that knows each simulation** — launch URL, session mechanism, admin panel, notes |
| `platform.js` | Shared engine: profile store, activation config, launch handoff, optional Firebase backend |
| `prefill.js` | Optional drop-in a simulation can include to auto-fill its own forms from the handoff |
| `config.json` | Committed activation list — what students see while in LOCAL mode |
| `firebase-config.js` | `PASTE_` placeholders → LOCAL mode (same convention as `sustainable-supply-chains/`) |
| `firestore.rules` | Rules for the platform's own Firebase project (when you create one) |

## Two modes

**LOCAL mode (current state — placeholders in `firebase-config.js`):**

- What students see comes from the committed **`config.json`**. To publish a
  change: open `admin/?key=…` (the usual lab maintainer key), toggle sims,
  *Save*, *Download config.json*, commit it at `simulation/config.json`.
  Your own browser applies the draft immediately (so you can preview the
  student page); everyone else sees it after the commit deploys.
- Student registrations stay in each student's browser (localStorage) — they
  still flow into every simulation at launch, but there is no central roster.

**The registration must be COMPLETE before a student can play.** Every field is
required, and the student page enforces it rather than hoping: an incomplete
registration raises a pop-up naming exactly which details are missing (the
moment the instructor's approval arrives, since that is when the student is
watching, otherwise on their next visit), shows a banner over the cards, and
clicking a simulation opens the prompt instead of launching it. The Edit-details
form marks the offending fields in red.

**Answers already saved in a student's display language are repaired**
(`answers.js`). The damage did not need a fresh registration: merely opening
*Edit your details* and pressing Save re-read every select, so one visit with
translation on converted a perfectly good English profile into Chinese — which
is why the same students' details reached the Ideation Challenge in clean
English at 05:34 on 2026-08-13 and were Chinese on the roster afterwards.
`canon(field, value)` maps such an answer back to the option it came from
(exact → case/space-folded → ASCII-skeleton, so "18-24岁" is still `18-24` →
a per-FIELD alias table, so "其他" resolves to *Other* inside Gender and inside
Industry without ever colliding). Anything it cannot recognise returns empty —
**never a guess** — and is left exactly as stored, which shows the field as
unanswered and puts it back in front of the student. The repair runs in two
places: the student page heals its own profile silently at load (the save
mirrors it onto the roster + recovery docs), and the admin panel repairs the
roster at idle for the class that may never open the page again, reporting
"Repaired N registrations…". A value it could not map is flagged `⚠` in the
roster's Level column. `answers.js` is also the single source of truth for
every dropdown (the form builds all eight from it, and carries no hardcoded
`<option>` list — the smoke test fails the build on either drift). Offline
test: `node simulation/tools/answers-guard.mjs`.

**Two things caused the empty fields the roster kept showing.** (1) The selects
offered a **blank first option**, so a student could leave a field unanswered
and still save; the first entry is now a **disabled placeholder** ("Choose…") —
nothing empty is selectable, and an untouched field is still caught rather than
silently recording the first real option. (2) Every `<option>` now carries an
explicit `value="…"`. Without one, an option's value IS its text — and a student
browsing with the browser's page translation on has that text rewritten in the
DOM, so `select.value` returned e.g. `大学本科生` and *that* was saved as the
answer: the roster showed Chinese, and re-opening the profile (whose option
values are English) matched nothing and rendered the field **empty**. With
explicit values the student may read the labels in any language while the stored
answer stays canonical. An older profile still carrying a translated answer is
treated as unanswered — the pop-up asks for it again — since nothing else can
map it back. Offline test: `node simulation/tools/registration-guard.mjs`
(Playwright; translates the labels in-page exactly the way a translator does).

**Load time.** Both pages sit behind the Firebase SDK — three ES modules on
Google's CDN — and nothing can be decided until it has loaded and reported who
is signed in. Left alone the browser only learns those modules exist when
`platform.js` RUNS, i.e. after every local script has been fetched and parsed,
so connection setup and download happen in series with the page. Each page's
`<head>` therefore carries a `preconnect` + `modulepreload` for them (and a
`preconnect` for the auth/Firestore API hosts), which starts the work during
HTML parsing. **Keep those URLs in step with the loader in `platform.js`** — the
smoke test fails the build if they drift, because a stale version downloads the
SDK twice. The admin gate also shows "Checking your sign-in…" rather than a
sign-in form the (already signed-in) admin was never going to use, revealing the
form after a moment if the answer is slow, and the e-mail-recovery backfill —
one write per student — is deferred to browser idle so it never competes with
painting the roster.

**FIREBASE mode (recommended for live class use):** create a free Firebase
project, enable **Anonymous** + **Email/Password** auth and **Firestore**,
deploy `firestore.rules` (keep its `isAdmin()` list in sync with
`SIMP_ADMIN_EMAILS`), create the admin user, paste the web config into
`firebase-config.js` — step-by-step walkthrough in `_FIREBASE-SETUP.md`.
Then:

- Activation toggles are **live**: Save publishes instantly to every student
  (one `simPlatform/config` doc, `onSnapshot` on the student page).
- **Live updates are hardened against broken streaming networks** (campus
  proxies / antivirus HTTPS inspection deliver the FIRST snapshot but never
  push again — "it only updates after a refresh"): Firestore is initialised
  with `experimentalAutoDetectLongPolling`, one **memoized** anonymous
  sign-in per page load (two concurrent sign-ins used to mint two uids,
  landing the roster doc under one identity while the approval watch
  listened to the other's), and polling fallbacks — the student's approval
  watch re-checks its own doc every 5 s while unapproved, and the admin
  roster polls a cheap `count()` every 10 s and refetches on change, so a
  new registration appears within seconds even with a dead stream. The
  Approve button also repaints its row locally on success.
- Registrations are mirrored to `simPlatformStudents/{uid}` (anonymous auth),
  giving the admin panel a **live roster with CSV export** — it loads by
  itself when the panel opens and updates the moment a student registers
  (Firestore `onSnapshot`), no manual load step. Each roster row has an
  **Approve** toggle and a **Delete** button (confirm first). **Approval is
  the play gate** (the guard against class links shared with students who
  are not in the room): until the admin clicks Approve on a student's row,
  that student sees **no simulation cards at all** — approval overrides the
  active toggles per student — **except simulations they have already
  completed, which stay visible**: logging out and back in mints a new
  anonymous account (approval never rides through recovery), so a returning
  student would otherwise lose sight of finished work until re-approved.
  It grants nothing — a completed card can't be launched, it opens the
  already-completed notice — and the waiting note appears only while
  something is genuinely still locked. The student page shows a "waiting for your
  instructor's approval" note and unlocks itself live (own-doc `onSnapshot`)
  the moment Approve is clicked; clicking `✓ Approved` again revokes.
  **Whole classes are handled in one click** by the **✓ Approve all** /
  **Revoke all approvals** buttons beside Export CSV (each carries the number
  of students it would change, is disabled when there is nothing to do, and
  confirms first): they act on the rows **currently shown**, so the column
  filters below double as a selector — filter to the students who answered a
  simulation and approve just those; with no filter on, that is the whole
  roster. Only rows that would actually change are written (every uid behind
  a collapsed row, like the per-row toggle), and the table repaints locally on
  success, since the live snapshot can be slow on a stream-hostile network.
  A red **Delete all students** button sits beside them — the row Delete
  applied to every row shown (same filter scope), for clearing a class between
  terms. It is irreversible and locks those students out (a browser that
  believes it already synced does not re-create its roster doc, and the student
  page shows no cards without one), so it asks **twice**: a confirm naming the
  count and scope, then the word `DELETE` typed back.
  Students can never approve themselves — the rules pin `approved` to
  admin-only writes (**republish `firestore.rules` when adopting this**).
  LOCAL mode has no roster and therefore no gate. The roster also carries
  **one column per active simulation** (dynamic — it follows the activation
  toggles) showing who has answered it (✓) and who hasn't (—), with an
  answered/total tally in each header; **click the Approved or a simulation
  header to filter** (all → only ✓ → only —), and the CSV export carries the
  same `completed:<sim>` columns. The data is the student page mirroring its
  play-once markers onto the student's roster doc (`syncCompleted` — the
  `completed` map is student-writable in the rules; it grants nothing), and
  the roster doc flows BACK DOWN: the student page's own-doc watch merges any
  centrally stamped completion into the local markers, so a ✓ shows on the
  student's card wherever they log in. Client-side markers can still miss a
  student (platform tab closed at the moment of finishing, a direct URL,
  another browser) — the **"⟲ Verify from …"** buttons beside Export CSV are
  the ground-truth reconciliation. **There is one button per ACTIVE
  simulation that keeps an identifiable participant record** (one carrying
  the university student ID, the join key to this roster), so the row of
  buttons follows the activation toggles exactly like the roster's columns
  do: today that is **Answer Arena**, the **Ideation Challenge**,
  **PortfolioFit** and **Search for Knowledge**. Simulations that collect no
  identifiable participant data get no button, because there is nothing to
  reconcile against: *Problem Solving* writes to a Google Sheet, *Sustainable
  Supply Chains* records firm decisions rather than students, *Newsvendor* is
  hosted cross-origin in another project, and *Trust the AI?* stores nothing
  at all. Each button reads that simulation's OWN project with the shared
  admin credentials from the locker, matches its completed participants to
  every registered student **by university student ID AND/OR e-mail**
  (`admin/match.js` — owner 2026-08-16: the ID is typed into two different
  forms, so ID-only lost the match for good on one typo while the
  simulation's own admin showed the play; now the record's e-mail rescues
  it, and each adapter reports a `doneByEmail` map beside `doneById` —
  the Ideation Challenge's synthetic `@simplatform` throwaway logins are
  never counted as an identity), and stamps `completed.<simKey>` (with the
  session code) onto every match — applied to the whole roster in one
  click, live everywhere; its outcome (incl. how many matched by e-mail
  where the ID differed, and IDs it could not match by either key) prints
  beside the buttons. **The same pass also runs UNATTENDED** once per admin
  panel open (`maybeAutoVerify`, once the roster and activation config have
  both arrived): the SAFE half only — stamping unique matches + the identity
  fills — using the locker's saved credentials and never prompting (with
  none saved it says how to enable itself and stands down); proposed ✓
  REMOVALS are only counted in the note (press the button to review them —
  the destructive half always stays behind a confirm), it never RE-STAMPS a
  ✓ the instructor removed unless the play on record post-dates the removal
  (a genuine retake; pressing the button IS the explicit instruction to
  re-sync), and one verification runs at a time (`verifyBusy` — the buttons
  render disabled while the chain runs), so the buttons remain for the
  extreme cases. **Duplicate registrations are raised in a pop-up,
  never removed automatically**: one person behind two roster rows (the
  same e-mail under two student IDs — the roster only collapses same-ID
  duplicates — or one simulation record whose ID matches one row and whose
  e-mail matches another) is clustered by `SIMP_MATCH.findDuplicateClusters`
  and listed with a per-entry removal SUGGESTION (pre-ticked, the admin can
  untick): a profile that only registered while its duplicate carries the
  play data, or a **super-fast play** (< 5 min, `FAST_PLAY_MS`) made before
  the student re-registered with slightly different details to play properly
  — when the record's own student ID pins the play to a profile that
  fast-play profile is proposed for removal and the fresh registration kept;
  matched by e-mail alone the play cannot be pinned to either profile (the
  address is shared), so the newest registration — the one the student is
  using — is kept instead. Several proper plays (or several fast ones with
  nothing else) are genuinely ambiguous and get NO suggestion, and when two
  clustered rows carry names with NOTHING in common (siblings on a family
  mailbox) every pre-tick is dropped and a caution says to check the names —
  a shared address is not proof of one person. A suggestion never
  covers a whole cluster, the dialog refuses to delete every registration of
  one student in one click, queues behind an already-open dialog instead of
  replacing it, and deleting uses the same admin delete as the row button.
  A ✓ sitting on a clustered row is also never proposed for REVOCATION (the
  person may be listed under the duplicate) — the pop-up owns that decision. Where each simulation keeps the identity:
  Answer Arena `participants.participantId`; the Ideation Challenge
  `sessions/*/participants/*.platform.studentId` (the sessions this admin
  account created) **or, for a student who played it from a direct link
  rather than a platform launch (no handoff ever writes a platform block —
  sessions SGP2/SGP3/ATHENS, owner 2026-08), the student ID they typed into
  that session's own registration form** — read from `demographics` via the
  session's `registrationConfig`: the default form's `ucdStudentId` field, or
  any admin-added field whose label names a Student/Participant ID (the same
  label rule the handoff uses to FILL such a field, so the two directions
  can't drift); PortfolioFit `participants.studentId`; Search for
  Knowledge `events.pid` — the student ID the platform sends as
  `PROLIFIC_PID` — on its `session_end` events.
  **Adding a simulation to this is two edits:** a `verify` block in
  `catalog.js` (adapter name + the app's public Firebase web config + a note
  on what the join key is) and one reader in `admin/verify.js` returning who
  completed it by student ID and/or e-mail (`doneById` + `doneByEmail`, each
  mark carrying `id`/`email`/`dur` for the cross-join and the fast-play
  judgement); the sign-in, roster join, duplicate detection, safety guards,
  stamping, auto-verification and revoking are all generic. **The Ideation Challenge pass also
  fills the matched records' real name and e-mail FROM this roster** — a
  direct-link student registered here, but no launch handoff ever carried
  their identity into the app, so its records read "Student" + a synthetic
  address; the adapter stays read-only and reports the needy records
  (`identityDocs`), `verifyFromSim` writes them fill-empty (never over a real
  value), and the outcome line reports "filled the real name/e-mail of N …".
  `node simulation/tools/verify-guard.mjs`
  checks the two halves still fit (and that the copied web configs still
  match the apps' own files); `node simulation/tools/verify-adapter-guard.mjs`
  runs the Ideation Challenge adapter itself against a mocked Firestore and
  pins its matching rules (platform ID wins over a typed one, the
  registration-form fallback incl. the no-registrationConfig default, the
  closed-session participation tests, ideas read only for closed sessions,
  the e-mail identity map — synthetic addresses excluded, durations from
  joined→survey — and the identity-backfill report — placeholders only,
  finished or not); `node simulation/tools/match-guard.mjs` pins the
  ID-and/or-e-mail join, the duplicate clustering, the removal-suggestion
  rules, the e-mail-rule parity between match.js and verify.js, and the
  wiring (auto-verification exists, never prompts, never revokes).
  **One student, several roster docs — read them MERGED (`completions.js`).**
  Every registration mints a fresh anonymous uid, so a log-out and re-register
  (or a second device) gives the same student another
  `simPlatformStudents/{uid}` doc. The roster collapses those into one row
  keeping the most recent — but writes fan out to every uid while the
  STUDENT's own push (`syncCompleted`) only ever reaches the doc they are
  signed into, and logging out clears the local markers, so the newest doc can
  be missing a ✓ that a duplicate carries. Reading only that doc showed "—"
  for students PortfolioFit's own admin listed as done, and "⟲ Verify from …"
  asked a DIFFERENT question ("does ANY doc have it?"), counted them as
  already matched and wrote nothing — the pass reported success and the cell
  never healed. `simulation/completions.js` is now the single reading used by
  both halves: group a student's docs newest-first and merge per simulation
  key, the newest statement winning (so a revocation still hides an older
  mark, and a retake after it counts again). A stamp also writes the e-mail
  RECOVERY replica, as revoking always did — otherwise a verified ✓ vanished
  the moment the student logged in on another device, whose fresh doc becomes
  the newest with nothing to restore onto it. And a refused mass-removal
  (the guard against a failing student-ID join) now drops only the removals:
  aborting the whole pass also threw away the safe, additive stamps — the
  very thing the button was pressed for. Offline test:
  `node simulation/tools/completion-guard.mjs`.
  For those, the ✓/— cells are **clickable**:
  a confirm-guarded manual mark/unmark, the instructor's final word. Opening
  the roster also **auto-backfills the e-mail recovery docs** for every
  registered student (students who registered before the recovery feature
  existed had none and could not log back in by e-mail until then). Delete removes the row's
  roster doc(s), including any collapsed duplicate re-registrations, via the
  rules' `allow delete: if isAdmin()`; the student's own browser profile is
  untouched, so they can simply register again. **The account corner (top right):**
  signed out it holds the **Log in** / **Register** pills; signed in it holds
  the student's **name chip** alone (never the pills beside it), which opens
  an account menu with *Edit details* and *Log out*. **Returning students:**
  the page opens on the Log in / Register choice.
  On the SAME browser nothing is ever asked again (registration + identity
  persist — closing the window loses nothing, they land straight on the
  cards). On a NEW device or a cleared browser they press **Log in** and
  give the **university student ID + e-mail** they registered with — BOTH
  must match, so knowing a classmate's e-mail is not enough to assume their
  identity. That restores the whole profile and their completion history
  (including revocations) from `simPlatformRecovery/{sha256(email)}` — a
  mirror written on every profile/completion sync, fetchable only by exact
  key (listing denied), with `approved` deliberately NOT in its field set:
  approval never rides through recovery, so a recovered device waits for the
  instructor's (one-click, live) approval again. LOCAL mode has no central
  roster, so it goes straight to the registration form.

  **Revoking a completion (a student may retake a simulation).** Removing a
  student from a simulation's own backend (e.g. deleting them in the Answer
  Arena admin) is the ground truth: the next **⟲ Verify from …** for that
  simulation removes their ✓ and their card unlocks so they can play again.
  Mechanics:
  a revocation is a TOMBSTONE inside the already-allowed `completed` map
  (`{revoked:1, rts}`) — never a bare delete, because the student's browser
  holds its own play-once marker that a delete cannot reach and that would
  be re-pushed on the next sync. It is written to the roster doc AND the
  e-mail recovery replica, so logging in elsewhere cannot resurrect it. The
  student's browser stamps `seenAt` from its OWN clock the first time it
  sees a tombstone and compares markers against that — the instructor's
  clock is never compared with the student's, so device clock skew can
  neither defeat a revocation nor destroy a genuine retake (a retake
  finished afterwards has a newer marker and survives). Every writer
  replaces its entry through a dotted path and records `src`
  (`verify`/`manual`/`client` — plus the legacy `arena`, from when Answer
  Arena was the only verifiable simulation); the sync never auto-revokes a
  `manual` mark, refuses to run when the simulation returns no participant
  records or no completed participants at all, refuses a mass removal while
  student-ID joins are failing, and always asks for confirmation listing the
  names. A student's **Log out** (account menu) clears the browser and signs
  out the anonymous uid, so on a shared machine the next registration gets
  its own roster doc instead of overwriting the previous student's — it asks
  no confirmation (their class registration is kept and they can log back in
  with their student ID + e-mail); the roster view collapses duplicate
  re-registrations by student ID (newest kept). The admin panel has its own
  **Sign out**.

## How a launch works

1. The student clicks a card. **A pinned Session ID is entered silently and
   never shown** — the card reads "Session ready" and launches straight into
   the sim (per the owner: an unshown code is harder to pass to classmates
   outside class); the same-origin sims hide their own code fields too when
   the code came from the handoff (PortfolioFit / Answer Arena welcome
   screens, the Ideation Challenge join screen auto-joins), revealing them
   again only if the pinned code fails, so nobody dead-ends. The dialog
   appears only when no code is pinned (the student types the announced
   code) or for the cross-origin Newsvendor (copy chips).
2. `platform.js` writes the **handoff** — `localStorage['simp:handoff:v1']` =
   `{sim, session, profile, ts}`. Everything on `stouras.com` is same-origin,
   so any simulation can read it.
3. Any per-sim **seeds** are written (a `catalog.js` hook for sims that read
   a localStorage key at startup; no current entry uses it).
4. The sim opens in a new tab at its **launch URL** — query params per
   `catalog.js` (`?code=` auto-join for Sustainable Supply Chains and
   search-v2, `?session=` prefill for PortfolioFit, `?s=` for Answer Arena…).
5. **Play-once gate:** when the sim reaches its own thank-you / done screen it
   calls `window.simpMarkCompleted()` (defined by `prefill.js` only on a
   genuine platform launch), which records `localStorage['simp:completed:v1']`
   `{simKey: {ts, session}}`. The student page badges that card
   **“✓ Completed”** (live — a storage event flips it the moment the sim
   finishes in its tab) and clicking it shows an *already-completed* notice
   instead of launching. Pinning a **new Session ID** unlocks the card again
   (a fresh class run is not a replay), and a student **Log out** clears the
   markers so the next student on a shared machine starts fresh.
   Instrumented: Ideation Challenge, PortfolioFit, Answer Arena, Problem
   Solving, search-v2. Deliberately NOT gated: Sustainable Supply Chains
   (re-opening to rejoin your firm mid-game is the normal flow), Newsvendor
   (different origin — it cannot write the marker) and Trust the AI?
   (a free-play teaching game).

### Per-simulation integration status

| Simulation | Session ID | Details prefill |
|---|---|---|
| Ideation Challenge | its join screen arrives **pre-filled** from the handoff (clipboard as backup) | **account-free** — a silent throwaway login is minted and the registration auto-submits from the platform data, consents included (bypassed, recorded as `consentVia: 'simulation-platform'`) |
| PortfolioFit | `?session=` pre-fills its welcome screen | **silent** — the post-training registration page is skipped when the platform covers every field, consent ticks carried from the platform (`consentVia` stamped); only an uncovered/custom field is shown |
| Answer Arena | `?s=` pre-fills (optional — default config without one) | **silent** — the intake auto-submits, consent ticks carried from the platform (`consentVia` stamped); only an uncovered/custom field is shown |
| Problem Solving | n/a | n/a (anonymous by design) |
| Sustainable Supply Chains | `?code=` — **auto-joins** | **wired** — firm-setup “Your name” fields auto-fill (no demographics by design) |
| Newsvendor Game | n/a | impossible (different origin) — copy chips |
| Search w/ & w/o AI (v2) | `?code=` + Prolific-style params — **auto-joins**, student ID rides as `PROLIFIC_PID` | n/a (no demographics form) |
| Trust the AI? | n/a | n/a (no identity form) |

### Adopting `prefill.js` in a simulation (optional, one line)

Already wired into **PortfolioFit, Sustainable Supply Chains, Answer Arena
and the Ideation Challenge** (the latter via its source template
`_ideasearchlab-src/index.html` + rebuild; all with a `SIMP_EXPECT` guard
that also disables it on their admin views). To add it to another sim's page (nothing changes when the sim runs
standalone — without a fresh handoff the script is inert):

```html
<script>window.SIMP_EXPECT = 'portfoliofit';</script>  <!-- optional guard -->
<script src="/simulation/prefill.js" defer></script>
```

It fills inputs by explicit `data-simp="studentId|email|name|age|…"`
attributes first, then by **label text** (which is what reaches
PortfolioFit's and ideasearchlab's dynamically built, id-less fields), uses
the native value setter + `input` events so React state updates, only fills
empty fields, and never submits anything. For a Vite-built app the tag goes
in the app's source `index.html` template and ships on the next rebuild
(`ideasearchlab-deploy-update.bat` for the Ideation Challenge).

On a genuine platform launch the drop-in also defines
**`window.simpMarkCompleted()`** — a sim calls it from its own thank-you /
done screen to power the student page's **“✓ Completed” play-once gate**
(see “How a launch works”). Standalone visitors and admin previews never get
the function, so they can never stamp a completion.

## The admin panel and each simulation's own admin

Creating sessions **with parameters** stays in each simulation's own admin
panel — those panels already encode each game's settings, validation and
backend, and duplicating that in the platform would rot. The platform admin
therefore:

- links and **embeds** each sim's admin console (same-origin iframes,
  picker ordered **active-first** following the saved activation state —
  it re-orders on every Save/config change, tags active sims "— active",
  keeps your selection and never collapses an open console:
  Sustainable Supply Chains, search-v2, PortfolioFit `?admin`, Answer Arena
  `?admin`, Ideation Challenge, Problem Solving `?admin`);
- lets you pin the Session ID you just created onto the student card, so
  students launch straight into it.

**Shared credentials:** each Firebase-backed sim authenticates against its
*own* Firebase project, so no true single session exists across them — but if
you register the **same e-mail/password** as the admin user in every project,
one credential fits all. The panel's credential locker (sessionStorage by
default, opt-in localStorage for new tabs) drives real auto-sign-in via a
small `simpTrySso()` snippet **already wired into the Sustainable Supply
Chains, search-v2, PortfolioFit and Answer Arena admin pages** (one silent
attempt when no user is signed in; inert without saved credentials, so
standalone behaviour is unchanged). To wire a future sim the same way, add
this right after its Firebase auth is initialised:

```js
// Simulation Platform SSO (optional): auto-sign-in from the platform's locker.
try {
  var c = JSON.parse(sessionStorage.getItem('simp:admin-creds') ||
                     localStorage.getItem('simp:admin-creds') || 'null');
  if (c && c.email && !auth.currentUser) {
    signInWithEmailAndPassword(auth, c.email, c.pass).catch(function () {});
  }
} catch (e) {}
```

(Embedded consoles share the tab's sessionStorage; consoles opened in a new
tab need the locker's "also for new tabs" option.)

## Adding a simulation

Add one entry to `catalog.js` (path, session mechanism, admin URL, blurb) —
the student cards, the admin table, and the consoles picker all render from
it. Then activate it from the admin panel. Keep the catalog in sync with
what's actually served (CLAUDE.md discipline).
