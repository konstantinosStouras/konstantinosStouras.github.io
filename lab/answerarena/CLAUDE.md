# CLAUDE.md - Answer Arena

Context file for an LLM. This explains how the **Answer Arena** app at
`stouras.com/lab/answerarena/` is built, so it can be extended without
re-reading everything. It follows the same philosophy as the sibling
`portfoliofit` research app and the `ideasearchlab` admin.

- **Live (participant):** https://www.stouras.com/lab/answerarena/
- **Live (admin):** https://www.stouras.com/lab/answerarena/?admin
- **Join a session:** https://www.stouras.com/lab/answerarena/?s=CODE
- **Repo:** `lab/answerarena/` (front end) + `_lab-arena-firebase/` (backend, not web-served)

## 1. What it is

A pairwise **preference study**. Each participant goes through:

```
welcome (optional session code) -> tour -> intake (anonymous: short
          demographics + consent, NO account) -> training (practice) ->
          N comparisons (random order) -> survey -> thank-you
```

Play is **fully anonymous**: there is no e-mail/password and no login. The
participant signs in with a throwaway **Firebase anonymous account** when they
submit the intake form (`Store.signInAnonymously()`); each play still gets its
own `request.auth.uid`, so the owner-based Firestore rules apply unchanged. A
**session code is optional** - with one you join a specific admin-created
session, without one you play the default configuration (`sessionId = '_none'`).
The Anonymous sign-in provider must be enabled in the Firebase console (see
`_lab-arena-firebase/README.md`); if it is off the intake shows "Anonymous play
is not enabled yet." The admin still logs in with Email/Password at `?admin`.

Each **comparison** shows one task card and two answer cards (outputs from two
unnamed systems; left/right randomized per participant). The participant taps
the answer they prefer, or marks them "equally good", then Next. This is the
preference-elicitation step of the wider "Matching Models to Tasks" project.

Model identities are **never** shown to participants.

## 2. Design philosophy (same as portfoliofit)

1. **No build step.** Plain static HTML/CSS/JS served as-is by GitHub Pages.
2. **One source of truth for content.** `arena-data.js` (`window.ARENA_DEFAULTS`)
   holds all default texts, tour steps, 2x2 settings, registration/survey
   questions, the practice task, and the 20 built-in placeholder comparisons.
   Both the app and the admin's "Restore built-in default" read it.
3. **One backend abstraction.** `arena-store.js` (`window.ArenaStore`) exposes a
   single async API with two interchangeable implementations: **Firebase**
   (when `arena-config.js` has a real config) and **local** (localStorage)
   so the whole flow is testable offline before Firebase is wired up.
4. **Admin behind a flag.** `?admin` loads the admin panel (`admin.js`); the
   plain URL is the participant app (`arena-app.js`). Each ignores the other's
   view.
5. **Research integrity.** Participants never see which model wrote which
   answer, and the left/right order is randomized per participant. (The app is
   single-player; there are no p1/p2 anonymous labels.)

## 3. Files

Served (`lab/answerarena/`):

| File | Role |
| --- | --- |
| `index.html` | Shell: SEO, all participant CSS, `#arena-top` + `#arena-screen`, loads the scripts in order. |
| `arena-config.js` | Public Firebase web config (placeholder until filled) + `ARENA_FB_READY`. Edit this after creating the Firebase project. |
| `arena-data.js` | `window.ARENA_DEFAULTS`: texts, tourSteps, settings (incl. `twoByTwo`), registration/survey questions, practiceTask, `defaultTasks` (20 placeholders). Also `window.ARENA_COUNTRIES` (195+ list shared by the two `country` registration fields). |
| `arena-store.js` | `window.ArenaStore`: Firebase + local backends behind one API. |
| `arena-app.js` | Participant phase machine, comparison UI, 2x2 assignment, session join, resume. |
| `admin.js` | Admin panel (`?admin`): Sessions, Tasks (Excel upload), Content, Registration, Survey, 2x2 & Settings, Participants + Excel export. |
| `CLAUDE.md` | This file. |
| `tools/admin-guard.mjs` | Offline test: a deleted participant can never reach an export; session Close vs Delete; a finished participant is never shown/restamped "playing" (see §6). |
| `tools/preview-guard.mjs` | Offline test: the 🧪 Test round sandbox is isolated + pre-filled. |

Backend (`_lab-arena-firebase/`, underscore-prefixed so it is not published):
`firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`,
`README.md` (full setup steps). No Cloud Functions (Spark plan is enough).

## 4. The comparison data shape

Every task (built-in or uploaded) is:

```js
{ id, task, outputA, outputB, title?, domain?, complexity? }
```

`outputA`/`outputB` are the two models' outputs; the app picks a per-task
`flip` so each participant sees them in a randomized left/right order, and
records which underlying output (`o1`/`o2`) was chosen. **o1 = outputA = the
baseline model; o2 = outputB = the frontier model.** The Excel export renames
them to `baseline`/`frontier` everywhere (chosen/left/right model columns and the
Events `model` column).

Each submitted comparison writes a **response** doc:

```js
{ taskId, idx, sessionId, choice('left'|'right'|'tie'), chosenOutput('o1'|'o2'|'tie'),
  leftOutput, rightOutput,
  prefValue,        // 7-point preference in the DISPLAYED frame: -3 (A much better)
                    //   .. 0 (Equal) .. +3 (B much better); A = left, B = right
  prefLabel,        // the matching text label
  prefModelValue,   // re-framed to the models: neg = baseline better, pos = frontier better
  choiceMs,         // decision time part 1: shown -> first side pick
  prefMs,           // part 2: that pick -> final grading on the 7-point bar
  answerMs,         // total to a final answer = choiceMs + prefMs (exactly)
  prefSource,       // 'bar' (graded explicitly) | 'card' (kept the seeded degree)
  responseMs, condition, ts }
```

**Decision timing is split in two** (per the owner): `choiceMs` is how long the
participant took to pick a side, `prefMs` how long they then took to say HOW MUCH
better it is, and `answerMs` their sum - the total time to a final answer. The two
stopwatches live in `buildComparison` (`times()`, fed by `pick()`/`setPref()`),
are derived from stored timestamps (so `data()` can be polled without the numbers
drifting), and ride on both the submitted response and the saved `draftResponse`.
`buildComparison` is handed the same `opts.shownAt` stamp `responseMs` measures
from, so `responseMs >= answerMs` always holds and their difference is exactly the
time spent re-reading after deciding. Because tapping an answer card *seeds* a
degree (-2/+2/0), a participant can finish without touching the bar: that is
`prefSource: 'card'` with `prefMs = 0`, distinguished from a fast explicit grading
(`'bar'`) so the two can never be conflated in analysis. The export adds
`choice_ms` / `preference_ms` / `answer_ms` / `preference_source` to **Responses**
and `mean_choice_ms` / `mean_preference_ms` / `mean_answer_ms` to **Task summary**
(each averaged only over rows that carry it, so pre-change data can't skew a mean);
older responses recorded before this leave the columns blank. The raw per-click
`Events` sheet remains the finest-grained record.

The comparison UI: the participant taps an answer (or "They're equally good"),
which reveals a **7-point preference bar** centered below the tie button (`A much
better · A better · A slightly better · Equal · B slightly better · B better · B
much better`); the bar is the response. **Next stays disabled until a choice is
made.** (There are no longer per-answer 1-5 satisfaction ratings or a free-text
reason - removed in favour of the single graded preference.) These columns ride
along in the admin Excel export (Responses sheet: `preference`, `preference_AB`,
`preference_model`). `settings.comparisonsPerUser` (0 = whole set) caps how
many comparisons each participant sees: when it is below the active-set size the
participant gets that many **randomly chosen** task pairs. `startMain` picks the
subset in three independent random steps so the exposure is statistically clean:
(1) a uniform **simple random sample without replacement** of `comparisonsPerUser`
tasks from the whole set (unbiased Fisher-Yates `shuffle` + `slice`), so every task
has an equal `lim/N` chance of being shown to any participant and each task's
**expected number of responses is identical** (`P·lim/N` across `P` participants) -
this selection is **independent of `randomizeOrder`** (a fixed display order still
gets a random subset, not the first `lim` rows); (2) the chosen subset is shown in
**random order** per participant when `randomizeOrder` is on, else in the sheet's
original order; (3) each comparison independently flips **left/right** 50/50 so
outputA (Haiku) and outputB (Opus) are equally likely on either side. **Each session
snapshots `comparisonsPerUser`, `randomizeOrder` and `taskSetId` at creation**
(alongside the 2x2 `condition`), and `startMain` prefers the session's snapshot
over the live global settings (older sessions with no snapshot fall back to
global) - so a session keeps the count **and the exact task set** it was built
with even if the global active set changes later. The task set is loaded via
`Store.loadTaskSet(session.taskSetId)` (falling back to `loadActiveTasks()` for a
no-code play or a session with no snapshot; an empty/deleted snapshot degrades to
the built-in default inside the store, so it never dead-ends anyone). The admin **Setup summary** shows this as e.g. "2 of 100 (random subset)"
and auto-refreshes (via
the `summaryRefresh` hook) whenever a card that feeds it is saved - the
Comparison-flow, 2x2 and Long-list cards (in each `saveConfig().then` **after**
`cfg` is updated, so it never reads stale values) and the Task card (inside
`refreshActive`, after upload / import / restore changes the active set). The
comparison set is rebuilt fresh on
every entry into the comparisons phase - past progress is **not** resumed, so each
play starts at comparison 1 (within a single page load the order stays stable).

**Task input** (admin Tasks tab) takes either an **Excel/CSV upload** or a
**public Google Sheet link** — both flow through the same `rowsToTasks()` parser
(column detection is shared via `detectCols()`). The Google import reads the
**whole workbook** (`export?format=xlsx`) and `tasksFromWorkbook()` auto-picks the
tab whose header best matches (most of task/outputA/outputB recognized), so a
multi-tab sheet imports by just pasting any link to it; it falls back to the
single-tab **gviz CSV** (`#gid=`) if the workbook export is blocked. It is built
for the **"Summarized"**
layout produced by the Model-Task-Matching workbook but reads **only the columns
the app uses**, by loose header match: `Specific description` -> `task` (the
problem shown to participants), `Output of Haiku 4.5 …` -> `outputA`,
`Output of Opus 4.8 …` -> `outputB`, and the two `Total Cost ($)` columns ->
`costA`/`costB` (US$, used only when cost transparency is active). `Task ID` is
kept as the internal `id`; everything else (Complexity, Domain, General task,
Prompt, Notes, token counts, thinking cost) is ignored. Output columns are the
text columns containing "output"/"answer" (not the token/cost ones); cost
columns prefer "total cost" over the "thinking cost". Money parsing tolerates
`$`, commas and scientific notation (`8.29E-4`, which the CSV path delivers as a
string). A simple `task` / `outputA` / `outputB` (+ optional cost) file still
works. It writes a `taskSets/{id}` doc and points `config.activeTaskSetId` at
it. An
upload / Google-Sheet import is parsed, previewed and **made the active set
immediately**; the Save / Make this the default buttons are then an explicit
re-save, Discard hides the preview, and Restore built-in default reverts to the
placeholders.

## 5. The 2x2 design

`settings.twoByTwo` = `{ factors: { transparency, incentive } }` (two booleans;
`incentive` is the internal key for the **Firm-pay** factor - kept for stored-data
compatibility, but shown everywhere in the UI/exports as "Firm-pay"). Each factor
that is switched **on** is varied between-subjects: every participant is randomly
and invisibly assigned one of its two levels - **Cost transparency**
(`abstract`/`translated`) and/or **Firm-pay** (`firm` = company pays / `personal`
= user bears the cost). A factor that is off is fixed at its baseline level. So
both on = 4 groups, one on = 2, none = 1 baseline group. The assigned cell
(`{ enabled, transparency, incentive }`) is
stored on the participant doc and on every response, and is **never shown** to
the participant. The 2x2 is configured **globally** (the admin "2x2 conditions" card), and
**each session snapshots it at creation** into the session's `condition`
(`{ factors:{transparency,incentive} }`). `assignCondition()` uses that snapshot,
so a session keeps the conditions it was created with even if the global setting
changes later; each session card shows its conditions on the right.

**Cost-transparency manipulation.** When a participant's cost-transparency level
is `translated` (and the active set has per-answer costs in columns D/E), the
top bar shows a live **"Spent so far: $X"** meter. Each comparison adds the US$
cost of the chosen answer (`costOf()`; a tie adds the average of the two). The
running total is the cost of the participant's own choices, making "my choices ->
this cost" salient. The cost is recorded on every response for **all**
participants (`costBaseline`/`costFrontier`/`answerCost`/`runningCost`, exported
as `cost_*_usd`/`chosen_cost_usd`/`running_cost_usd`) so the control group's
hypothetical cost is analysable too; only the `translated` group sees the meter.

## 6. Sessions

Admin creates sessions from the **"Create a session"** card at the bottom of the
left column (a "Create Session" button + a **setup summary** of the saved
parameters a new session will use). The card has an optional **Session name** and
an optional **Session ID** (custom code), mirroring the ideasearchlab admin: the
code input live-normalises to a single word of capital letters and digits
(`.toUpperCase().replace(/[^A-Z0-9]/g,'')`), is validated `^[A-Z0-9]{3,40}$`, and
is checked for uniqueness via `Store.getSessionByCode()` before creating; a blank
ID falls back to the auto-generated 6-char `code6()`. On success a vivid dashed
**code box** (`.aa-codebox`) shows the session code (custom or auto) with a share
hint. `Store.createSession` already honours a passed `data.code` (both backends
fall back to `code6()` when it is blank). Every session is **created open**; there is
no status picker. The right column has two cards: **Active sessions** and a
separate **Closed sessions** card (shown only when there are closed ones). Each
card shows a session's code + status, participant count + **2x2 conditions**
(right) and created date (left). A running session offers Open / Copy link /
⬇ Export data / **🧪 Test round** / **Close Session** / **Delete**; a closed
session (no joins) offers ⬇ Export data / **🧪 Test round** / **Reopen** /
**Delete**.

**Close Session and Delete are two DIFFERENT endings** (owner 2026-08, mirroring
the ideasearchlab cards' grey `.closeBtn` + red `.deleteBtn` pair): **Close
Session** is styled neutrally (`.aa-btn sec`, grey) because it only stops new
joins and moves the card into **Closed sessions** below with everything kept —
it used to be a red `danger` button labelled just "Close", which read as the
destructive action. **Delete** (`.aa-btn danger`, red, directly after it) is the
destructive one and **removes the session AND all of its data**:
`Store.deleteSessionData(sid)` runs FIRST and `Store.deleteSession(sid)` second,
so a failed purge leaves the session listed and the action retryable instead of
orphaning rows under a session that appears nowhere (Firestore keeps
sub-collection docs alive under a deleted parent — the same trap
`deleteParticipant` documents). Two confirms, since there is no undo.
`deleteSessionData` exists in **both** backends and, for every participant who
played the session, deletes the responses/events tagged with it, its
`survey/{sid}` doc and an unsubmitted `draftResponse` belonging to it, drops it
from `playedSessions`/`completedSessions` (clearing `sessionId` when it still
points at it) — and deletes the participant record **outright** when that was
the only session they ever touched (the record exists only because of it). A
participant who also played another session keeps that session's data: nobody is
owned by one session. The shared helpers `sessionKeysOf`/`touchesSession`/
`onlySession` (module level in `arena-store.js`) are what both backends decide
with — keep the two implementations in step. Covered by
`node lab/answerarena/tools/admin-guard.mjs` (button order/styling, Close writes
only `status`, Delete's data-then-session order, and the local backend's purge
semantics end to end).

**A session is never edited once it exists** — the old "Edit name" button and its
inline `editMode` rename form were removed (owner 2026-08: participants may
already be playing in it), the same rule as the ideasearchlab admin, which lost
its Edit button in the same change; name a session on the Create card. The
`.aa-btn … sm` pill set here is the reference the ideasearchlab cards were
aligned to (`.sBtn` + variants in its `Admin.module.css`) — keep the two in sync:
its `font-size:12px` / `padding:7px 11px` / `border-radius:10px` / `font-weight:600`
are copied there verbatim, so changing them here means changing them there too.
**`.aa-btn` carries a 1px TRANSPARENT border** (it used to be `border:none`, and
`.green` with it) so a filled pill and an outlined one are exactly the same
height — without it Open/Export data sat 2px shorter than Copy link/Test round/
Close in the very same row. Per-session
participant counts include anyone who **played** it - started (`playedSessions`),
is on it (`sessionId`), or completed it (`completedSessions`).

**A session code is optional.** The welcome screen has an optional code field:
enter a code to join that specific admin-created session, or just continue to
play the default configuration anonymously (`sessionId = '_none'`). A shared
link (`?s=CODE`) simply prefills that optional field on the **welcome** screen
(no login panel any more). Sessions are publicly readable so the code can be
validated before sign-in; they hold no personal data. The admin can **export one
session's data** (the "Export data" button on a session card) - just the users
who played it and only their data for that session - in addition to the
all-users export in the Registered users card.

**One anonymous identity, many sessions, each once.** Each browser gets a
persistent Firebase **anonymous** identity (anonymous auth persists across
reloads). It can take part in several sessions, but each session **only once**.
The participant doc carries `completedSessions` (a `{ sid: completedAtMs }`
map); `sid` = the session id, or `'_none'` for the default code-less play. On
entry (`routeParticipant`), the app resolves the target session (from a chosen
session, a code typed on welcome, or `?s=CODE`) and: blocks a session already in
`completedSessions` - **including `'_none'`** - (`showAlreadyDone`), resumes an
in-progress survey for the same session, or else (re)starts the comparisons for
that session. The thank-you and already-completed screens are **final - no
"Start over" button** (it minted a fresh anonymous identity, which let a
participant replay; each user plays once, per the owner 2026-08). Only the
closed/not-yet-open session screen (`showSessionUnavailable`) keeps a "Start
over" as its way back to the welcome screen - that visitor never played the
session. `sessionId`
on the participant doc is the **current** session; per-session completion lives
in `completedSessions`. `markCompleted()` adds the current sid on the thank-you
screen. Responses, events and survey docs are all tagged/keyed by `sid`, and the
survey is stored per session (`survey/{sid}`). Admin session counts include any
participant currently in or having completed that session.

**A finished participant is never restamped "playing"** (owner report 2026-08:
the Registered-users list showed students as `playing` who had completed their
session). `status` is a **live cursor** the app overwrites on every entry
(`registered` → `playing` → `survey` → `done`), and three paths used to move it
backwards, each also filing a phantom play:
- **Re-entry without the code.** A returning identity opening the plain URL
  resolved to the code-less default play `'_none'`, which was not in
  `completedSessions`, so `routeParticipant` started a fresh play and wrote
  `status:'playing'`. It now shows `showAlreadyDone(true)` ("already completed
  this study") when the participant has completed **any** session — the same
  play-once rule as the thank-you screen having no "Start over".
- **A code that does not resolve.** `resolveTargetSession` swallowed an unknown
  code / a failed lookup and returned null, silently downgrading the visit to
  `'_none'` — wrong session in the data. It now records `S.codeUnresolved` and
  `routeParticipant` shows `showCodeProblem(code)` (Try again · Continue
  without a code) instead of playing anything.
- **Records already written that way** stay in the database, so the admin
  DERIVES the truth with `participantStatus(p)` (admin.js): nothing completed →
  the raw cursor; the session they point at is completed, or they point at
  `'_none'` while having really completed a session → **done**; pointing at
  another, unfinished session → the raw cursor (genuinely mid-play). It drives
  the Registered-users badge (hover = `statusTitle`, which explains any
  correction) and the export's **`status`** column, with the raw value kept
  beside it as **`recorded_status`** (both documented in Conventions).
Covered by `node lab/answerarena/tools/admin-guard.mjs` (the six
`participantStatus` cases + a returning participant landing on
already-completed with their record untouched).

**Decision log.** Every pick and every satisfaction-rating change emits an
**event** (`participants/{uid}/events`: `{ type, value, taskId, idx, sessionId,
ts }`), so the time of each decision - and of each change to a new option - is
recorded. Both the all-users export ("Export to Excel") and the per-session
export ("Export data" on a session card) produce a workbook with sheets:
**Conventions** (documents every sheet/column + the join keys), **Sessions**
(one row per session play - status, snapshotted 2x2/flow settings, participant
count), **Participants** (one per person, incl. `comparisons_assigned` /
`comparisons_submitted` so a **drop-out** is visible at a glance - fewer submitted
than assigned while `status` = playing), **Tasks** (one per task pair = the
unit of analysis: full description + both model answers + costs), **Task
summary** (per-task aggregates: n, baseline/frontier/tie counts,
`frontier_win_rate`, `mean_preference_model`, `mean_response_ms`), **Responses**
(one per comparison), **Events** (one per click/change), **Survey**. **Join keys:
`account_id`** (the Firebase anonymous UID) is the unique participant key present
on *every* sheet - `participant_id`/`email` are optional/legacy and usually blank
for anonymous players, so never join on them; **`task_id`** joins Responses /
Events / Task summary to Tasks; **`session_id`** (+ human `session_code`) joins to
Sessions. Task text is resolved from the active set **merged with each in-scope
session's pinned task set** (what participants actually saw wins), so a per-session
export shows the right descriptions even after the active set changed; long model
outputs are capped at ~32,000 chars (`cellCap()`) so one huge answer can't break
the write. Columns use self-explanatory snake_case names
(`shown_order`, `left_model`/`right_model`, `cost_transparency`/`firm_pay`
(per-participant 2x2 group as 1/0 via `condBit()`; blank if that factor was not
varied), ...); the Conventions sheet (built by `buildConventions()`, including
each registration/survey question label) is the source of truth - keep it in sync
when columns change.

**Nothing is lost on an abrupt close.** Each comparison is written one-by-one as
its **Next** is pressed, and the in-progress (not-yet-submitted) answer is saved
continuously as a `draftResponse` on the participant doc (debounced on change,
and flushed on `visibilitychange`/`pagehide`). The export adds the draft as a
Responses row with `submitted = no (draft)`.

## 6b. Test round (🧪) — rehearse the flow, saving NOTHING

Every session card carries a **🧪 Test round** button (and the "Create a
session" card has **🧪 Test round (nothing saved)**, which rehearses the
currently-saved settings without creating a session). It opens the participant
app in a new tab at **`?preview=1&key=stouras[&s=CODE]`** and the whole flow —
welcome, tour, intake, training, comparisons, survey, thank-you — runs end to
end while writing **nothing**: no participant doc, no responses, no events, no
session count, nothing to clean up afterwards. Mirrors the ideasearchlab admin's
Test round button and sustainable-supply-chains' `?preview=1` sandbox.

How the isolation works (`ARENA_PREVIEW` in **arena-store.js**):

- `previewOn` is resolved once from the URL (`preview=1` **and** `key=stouras`,
  so a stray `?preview=1` is not a sandbox). When it is on, the store is
  **always** `LocalBackend` — even when `ARENA_FB_READY` is true — so the
  Firebase SDK is not even fetched.
- `LocalBackend(prefix)` namespaces its whole store; the sandbox uses
  `arena:preview:` (`…:db` / `…:uid`), so the normal offline data (`arena:db`,
  `arena:uid`) is untouched and a rehearsal can never be mistaken for real
  local-mode data.
- The admin's `launchTestRound(session)` (admin.js) writes a **seed** to
  `arena:preview:seed` first — the effective `cfg` (texts/settings/registration/
  survey questions), the session being rehearsed (forced `status:'open'`) and its
  task set (the session's pinned `taskSetId` when the backend exposes
  `loadTaskSet`, else the active set) — then opens `ARENA_PREVIEW.launchUrl()`.
  `seedFrom()` applies it once per launch, keyed on the seed's `ts`: a **reload
  keeps** the sandbox's progress, a **new launch resets** it. A task set too big
  for localStorage (~5 MB; real sets hold full model answers) is retried
  progressively trimmed (40 → 15 → 5 comparisons) and the toast says so, rather
  than leaving an unseeded sandbox.
- **The intake arrives pre-filled with random test data** — `previewAnswers(qs)`
  in arena-app.js gives every question a random plausible answer (a random
  option for select/radio/country, a value inside `min`/`max` for numbers,
  digits for a Student-ID field, a test address for e-mail, a name for a name
  field) and **ticks the consents**; `buildField(q, preset)` applies it to
  whichever control was rendered. The tester can still edit anything before
  pressing Start. The ideasearchlab sandbox does the same via
  `randomRegistrationAnswers` (`_ideasearchlab-src/src/utils/testData.js`) —
  keep the two in sync.
- A constant `.a-ribbon` banner ("Test mode — … nothing you do here is saved")
  is appended on boot, and a **real Simulation-Platform handoff is ignored**
  (`simpHandoff()` returns null in preview, and `SIMP_EXPECT` is switched off in
  index.html for `?preview=1`), so a launch still sitting in this browser can't
  silently answer the sandbox's intake.

Offline test: `node lab/answerarena/tools/preview-guard.mjs` (Playwright, no
network — asserts the local backend + namespace isolation, the untouched
`arena:db`, the ribbon, a fully pre-filled intake, and that the flag is inert
without the key).

## 7. Gotchas to carry forward

- **The registration form mirrors the ideasearchlab admin's registration form**
  (same questions + dropdown options): UCD Student ID, Age, Gender (optional),
  Nationality, Country of residence, Level of Study, Work Experience (0-50),
  Occupation, English Fluency, then two consent checkboxes. To support it,
  `buildField()` (arena-app.js) and the admin question editor (admin.js
  `QUESTION_TYPES`) handle two extra field types beyond `select`/`radio`/
  `text`/`number`/`textarea`: **`country`** (a `select` populated from the shared
  `window.ARENA_COUNTRIES` list - the editor shows a "built-in country list" note
  instead of an options box) and **`checkbox`** (a single required consent tick;
  the label sits beside the box, not as a top label). `number` fields honour
  optional `min`/`max` (rendered + validated; editable via the "Number range"
  inputs in the admin). The **UCD Student ID keeps `system: 'participantId'`** so
  it still stores into the participant-doc `participantId` slot / export column -
  but it is now **required** (unlike the old optional Participant ID).
- Keep model identities out of anything the participant sees.
- **Silent intake from the Simulation Platform** (`simpHandoff`/`simpAnswers`/
  `finishRegister` in arena-app.js): launched from `stouras.com/simulation`,
  the intake answers itself from the platform handoff and renders ONLY what
  the platform can't supply — any extra/custom field. Consent checkboxes are
  CARRIED as ticked from the platform launch (bypassed entirely, per the
  owner 2026-08); when that happens the participant doc is stamped
  `consentVia: 'simulation-platform'` so the data shows HOW consent was
  given. With nothing left it signs in and submits silently ("Setting up
  your session..."; failures show the cause + Try again). An answer must
  survive the form's own validation or its field is shown. The generic
  `/simulation/prefill.js` include also remains for any form that still
  renders. Inert outside a platform launch. **The session code is hidden on
  a platform launch** (`hiddenCode` in showWelcome): when the handoff's
  session matches `?s=`, the welcome's optional-code field is not rendered
  (a "✓ Your class session is set" note shows instead) and is revealed again
  only if that code fails to resolve — the code is never displayed to
  students, per the owner. **Play-once gate:**
  `showThankYou()` and `showAlreadyDone()` call
  `window.simpMarkCompleted()` (defined by prefill.js only on a platform
  launch), so the platform's card shows "✓ Completed" and blocks a second
  play of the same run.
- Anonymous play needs the **Anonymous** sign-in provider enabled in the
  Firebase console; otherwise `Store.signInAnonymously()` fails
  (`auth/operation-not-allowed`) and the intake shows "Anonymous play is not
  enabled yet." **Email/Password** must stay enabled for the admin login.
- `arena-config.js` placeholders => local mode; real config => Firebase. The
  switch is automatic (`ARENA_FB_READY`) — **except in a test round**
  (`?preview=1&key=…`), which always uses the local backend in its own
  namespace so a rehearsal cannot write to the live project.
- Firestore **rejects nested arrays**; the response docs avoid them. If you add
  array-of-array data, JSON-stringify it.
- Sessions are public-read on purpose (pre-auth code check). Don't put anything
  sensitive on a session doc.
- After changing `firestore.rules`, redeploy or writes silently fail.
- **Task sets are stored chunked.** `saveTaskSet()` writes a `taskSets/{id}`
  metadata doc (`name, source, count, chunkCount`) plus sibling `taskSets/{id}__chunk_N`
  docs holding the tasks in ~600 KB slices, so a large set (100+ comparisons of full
  model outputs) never hits Firestore's 1 MiB per-document limit - which used to make
  the admin Save silently fail (no green "✓ Saved"). `loadActiveTasks()` reassembles
  the chunks (and still reads older inline `tasks` sets). Chunk docs share the
  `taskSets` collection, so the existing rules cover them - no rules change - and
  `listTaskSets()` skips them (`isChunk`).
- **A configured `activeTaskSetId` whose `taskSets/{id}` read fails no longer
  dead-ends anyone.** `Store.loadActiveTasks()` catches that read and falls back
  to the built-in default (logging the cause), so the admin "current set" card
  and the participant comparisons never hang/Problem on a dangling id, a denied
  read or a network blip. The admin card also shows an error + "Reset to built-in
  default" / "Retry" if even that fails. Use "Restore built-in default" to clear a
  bad id for good.
- **"Missing or insufficient permissions" when a participant taps Start on the
  intake** = the Firestore rules were never deployed (the DB is on default-deny),
  *not* a required-field problem - the session code and Participant ID are both
  optional. Fix it on the backend: from `_lab-arena-firebase/` run
  `firebase deploy --only firestore:rules` (and enable the Anonymous sign-in
  provider). `authError()` now shows a clear message + logs this hint instead of
  the raw Firebase string.

## 8. Data analytics tab (admin)

The admin has a **top nav** (`headerRow()` in `admin.js`) with two views —
**Admin** (the two-column panel) and **Data analytics** — mirroring the
ideasearchlab admin. `currentView` (`'admin'|'analytics'`) drives `renderShell()`,
which dispatches to `renderAnalytics()`. All analytics state lives in the
module-level `daState` object, so leaving and returning to the tab preserves the
loaded data, selections and edited code. Everything runs **entirely in the
browser** — no data is uploaded, no Cloud Function or Firestore-rules change.

**The Data-analytics tab is directly linkable** (like ideasearchlab's
`/admin/data-analytics`): `?admin=data-analytics` opens straight on it, plain
`?admin` opens the Admin panel. `viewFromUrl()` reads the initial tab (also
accepts `?admin=analytics` / `?admin&view=analytics` / `#data-analytics`),
`setViewUrl()` keeps the address bar in sync as you switch tabs (canonical
`?admin` / `?admin=data-analytics`, preserving other params), and a `popstate`
listener makes the browser Back/Forward switch tabs. The top-of-file guard still
activates on `/[?&]admin\b/`, which matches `?admin=data-analytics`.

Four sections:

1. **Data source** (`buildDaSection1`). Lists every session (with participant
   count + condition) as a checkbox; you can also **Import Excel / CSV** (a
   per-session or all-data export from this admin, or any table). Imported files
   are queued as their own ticked rows (parsed into `{name, rows}` per sheet; a
   CSV becomes one sheet named `Responses`). Pressing **Load** pulls the ticked
   sessions' data into memory: it fetches the participants who played any ticked
   session and calls `collectAggregateSheets(parts, ids)` — a thin wrapper over
   the **same** export builder (`exportExcel`/`buildWorkbook` with
   `opts.sessionIds` = a `{id:true}` map and `opts.returnSheets`), so the
   aggregate is byte-for-byte the same multi-tab shape as the per-session export.
   Ticked imported workbooks are then stacked onto the map by sheet name
   (`mergeBookIntoSheetMap`, case-insensitive; unmatched sheets added as their
   own tab).

2. **Aggregate data** (`buildDaSection2`). Shows stat boxes (responses,
   participants, sessions, tasks-with-data) and a **Download aggregate Excel**
   button that writes the in-memory sheet map (`daState.sheetMap`) as one
   workbook — tabs `Conventions · Sessions · Participants · Tasks · Task summary ·
   Responses · Events · Survey` plus any imported extras, each source stacked
   within every tab. Sheet names are sanitised/deduped for Excel's rules
   (`safeSheetName`).
   - **Randomization-balance block** (`renderBalance` + `daBalanceData`), directly
     under the stat boxes — *how many students answered each task*, so the
     randomization can be eyeballed. Two inline-SVG charts: (a) the
     **distribution** (`daDistChart`) — one row per response-count value (equal-width
     buckets aimed at ~14 rows when the observed range is longer), **one dot per
     task**, with the **median · mode** rows and the **fewest / most** tasks called
     out by id, empty rows inside the range kept because a gap is part of the shape;
     (b) **per task, descending** (`daTaskCountChart`) — one bar per task labelled
     `T### · domain`, the whole bar every submitted response and the **darker part the
     decisive ones** (ties excluded), with a dashed **mean** line. Both are in a
     scroll box, `<title>` tooltips carry the task ids/counts. The note above them
     turns "the bars are uneven" into a verdict: each task's count has variance
     `Σ_students q(1−q)` with `q = m_i/k` if every student really drew a uniform
     random subset, so the observed spread is compared with that expectation
     (`daChiSqUpper`, a regularised incomplete gamma matching `scipy.stats.chi2.sf`
     to ~1e-11) and **both tails are read** — wider than random (a task was not in
     every session's set), *more even* than random (a deliberately balanced
     allocation, or stacked/duplicated sources), consistent, or nothing to judge
     (every student saw every task → `expSd == 0`; or fewer than 5 tasks / 20
     responses). It also flags tasks holding more responses than distinct students.
     Deliberately **the same row filter as the provisioning charts** (blank/`yes`
     `submitted`), so every block in §2 describes the same rows.
   - **Model-provisioning charts** (`renderProvisioning` + `daProvChart`). Below
     the stats, three inline-SVG grouped-bar charts computed from the aggregate
     **Responses** sheet: preferring **Opus** = **over-provisioning**, a **tie** =
     **indifference**, preferring **Haiku** = **under-provisioning**. **Per task**
     (sorted by over-provision rate) shows the % in each with **Wilson** 95% CIs
     (so a task with fewer responses gets a wider whisker); **by task type** and
     **by domain** show the **average of the per-task rates** (each task weighted
     equally) with a CI from the **delta method** (`daGroupRate`): SE =
     `sqrt(Σ per-task Agresti-Coull variance) / k`. This is the correct CI because
     the 30 tasks are the **whole study** (fixed, not sampled), so only the finite
     student responses carry error — a t-interval *across tasks* (an earlier
     version) added spurious task-sampling variance and, with only 2–4 tasks per
     domain, blew the interval out to span 0–100%; the delta method keeps the same
     equal-weight mean but gives an informative CI (e.g. Data Analysis over ≈ 58%
     `[44, 72]` instead of `[10, 100]`). It still "accounts for unequal responses
     per task" — each task weighted equally in the mean, and a task with fewer
     responses contributes more variance. (Caveat, stated in the on-page note:
     these descriptive CIs treat responses as independent across tasks, though
     the same student answers several tasks in a group; the Section-3 tests
     additionally cluster on the student.) Task complexity/domain come from the
     exported `task_complexity`/`task_domain` columns when present, else the
     built-in `DA_TASK_META` map (the 30-task list). Helpers: `daWilson`
     (per-task proportion CI), `daGroupRate` (equal-weight mean + delta-method CI),
     `svgEl` (SVG builder — `var()` colours go via `style`, not attributes).

3. **Process with Python or R** (`buildDaSection3`). Pick a table from the
   aggregate (default **Responses** = one row per comparison, the analysis unit),
   edit the pre-filled **Python** or **R** script, and **Run**. The chosen table
   is serialised to CSV (`XLSX.utils.sheet_to_csv(json_to_sheet(rows))`) and
   handed to the code as the string `DATA_CSV` (Python) / the file
   `/tmp/data.csv` (R). Python compiles in-browser via **Pyodide**
   (`daRunPython`, loads numpy/pandas/scipy/matplotlib) and R via
   **WebR** (`daRunR`, base R; base-graphics captured as PNGs) — both ported from
   the ideasearchlab Data Analytics page and loaded lazily from jsDelivr on first
   Run. Console output streams below; the **plots do not render here** — they are
   shown in **Insights gained** (§4), each beside the paragraph that explains it,
   so Section 3 only prints a "N figures rendered — see Insights gained" pointer.
   Edited code auto-persists to `localStorage` (`aa-da:py` / `aa-da:r`); **Reset
   template** restores the bundled default. A `DA_TPL_VERSION` stamp
   (`aa-da:ver`) is checked by `daMigrateTemplates()` on load: when the bundled
   templates change we bump the version and **drop the saved code**, so a stale
   saved script from an older version can't shadow the current template (that was
   the "Python won't run" symptom — an old saved script erroring on new data).

   The default templates (`DA_PY_TEMPLATE` / `DA_R_TEMPLATE`) answer **one
   question and nothing else** (owner, 2026-08-28): *given the data collected,
   for which specific task ids can we say with **95% confidence** that **Haiku**
   is preferred, and for which **Opus**? Then the same at **99%**.* Four lists of
   task ids, the numbers behind them, and one figure. Everything the previous
   templates did beyond that — the `TASK_META` complexity/domain map, the
   by-domain and by-task-type breakdowns, the cluster-robust regressions, the
   TOST "indifferent" verdicts, the seven figures — was **deleted**, and the two
   scripts are heavily commented line-by-line so a non-coder can read them.

   **THE TEST IS THE EXACT SIGN TEST, AND WHICH TEST LEADS IS A FACT ABOUT THIS
   APP, NOT A TASTE.** Per task, among the students who expressed a preference
   (m of them, k for Opus), *p = the share of the 2^m possible splits at least
   this lopsided*. A task is listed at confidence C when `p <= 1-C`, on the side
   more students picked. Exact: no degrees of freedom, no normality, no CLT —
   which matters at 10–30 answers on a bounded scale heaped with zeros.

   It uses the DIRECTION and not the strength because **`pick(side)` in
   `arena-app.js` seeds the 7-point bar at ±2 the moment a card is tapped**: a
   student who taps and moves on exports a magnitude the *screen* chose, and the
   export records exactly that as `preference_source = "card"` (vs `"bar"`). The
   side chosen is always the student's own act, and one student's "3" is not
   another's, so counting sides uses the part of each answer the student really
   produced. That was the argument that overturned an earlier draft built on the
   magnitude-weighted **sign-flip** test — keep it in mind before "improving" the
   headline back to something that weighs magnitudes.

   The strength is **not** discarded: the SAME engine (`signflip_p`, one
   convolution over the sign distribution) is run a second time weighted by the
   magnitudes, printed for every task as **`p_str`**, and **every disagreement
   between the two readings is named on screen** — both directions of it (a task
   listed on the split whose strengths point the other way, and a task the
   strengths would list that the split does not). A run where over half the
   graded responses are `card`-sourced says so before the lists.

   **Both verdicts read their DIRECTION from their own statistic** — the headline
   from the vote margin, the strength reading from the score total. That is not
   pedantry: with 17 mild `+1`s and 6 emphatic `-3`s the margin is +11 while the
   total is −1, so a single shared direction would publish the wrong model. The
   templates guard pins it in both languages.

   **Degenerate cases need no conventions at all**, which is most of why this
   test was chosen. Every response identical → `p = 2^(1-m)`, a real number, not
   the old `0/0` patched to `p=0`; two responses that agree → `p = 0.5`, so no
   `MIN_N` floor is needed; every response a tie → `p = 1`. The old
   constant-data/zero-variance conventions are gone with the t-test that needed
   them. What IS reported is **attainability**: since the smallest possible p is
   `2^(1-m)`, a task needs **≥6** expressed preferences before *any* split could
   reach 95% and **≥8** for 99%, and tasks below that are named as a sample-size
   fact rather than a finding (`min_responses_for`).

   **Multiplicity is a COLUMN, never a filter.** Each task carries a
   Benjamini-Hochberg adjusted `q_bh` (FDR — the right currency for a list) and
   the listed tasks that do not survive it are named, but the **headline lists
   stay per task**, because that is the question the owner asked. There is
   deliberately **no second set of lists**: one set, plus a column and a sentence.

   **The 99% lists are subsets of the 95% lists** by construction (one p per
   task, two thresholds), and the script *prints the check* rather than assuming
   it, plus which tasks the stricter level costs.

   **Data hygiene the scripts do themselves**, each of which was a real
   Python-vs-R divergence before it was fixed: every column is read as **text**
   and coerced by hand (`dtype=str` / `colClasses="character"`) — left alone,
   pandas infers types and R does not, so `"0012"` and `"12"` merge into one
   student in Python only, and a `TRUE`/`FALSE` submitted column becomes a
   boolean whose text filter drops **every row** and reports it as "nothing
   reached significance"; `submitted` accepts `yes`/blank/`true`/`t`/`y`/`1` and
   the **count of excluded drafts is printed**; a score is used only when it is a
   **whole number in −3..+3** (a re-scaled `1.5` would otherwise be silently
   truncated by *both* languages) and rejects are counted; R sorts with
   `method = "radix"` so its locale can never order task ids differently from
   Python; both pin their table width so R does not wrap a wide table into a
   headerless continuation block. Duplicate `(account_id, task_id)` rows and
   responses that name a winner yet grade the two as equal are **warned about,
   never silently repaired** — which of the two is right is not something the
   script can know.

   A row that recorded only a **choice** contributes its direction with a
   magnitude of 1, so a table carrying one of the two columns but not the other
   is still answerable; on the app's own Responses table every row is graded, so
   this never fires.

   **The figure** (exactly one, two panels): left, one bar per task = its mean
   graded preference, coloured by the 95% verdict; right, the same tasks with
   each task's exact `p` on a **log axis** against the 0.05 and 0.01 lines — *a
   task is listed exactly when its dot sits left of the line* — with a hollow dot
   for `p_str` beside it. A plain-language **`INSIGHTS`** block ends each script
   and carries the `## Figure 1 - …` heading the Insights panel drops the image
   under (§4).

   The Python version uses numpy / pandas / matplotlib and **needs no statistics
   library at all** (the exact test is a convolution written out by hand); scipy
   stays in `DA_PY_PACKAGES` for scripts the user writes. The R version is base R
   only. The two were verified to agree by **running both** (CPython + Rscript)
   over **19 synthetic exports** — realistic, edge cases, drafts-only,
   choice-only, graded-only, no-`submitted`, junk `chosen_model`, the wrong
   sheet, one student, an empty table, leading-zero ids, a `TRUE`/`FALSE`
   submitted column, out-of-range scores, a slider left at 0, and the
   margin-vs-total crossing case — comparing the four task-id lists, every table
   cell and every `INSIGHTS` bullet; and the engine itself was checked against
   **brute-force enumeration of all 2^m sign patterns** (261 samples × both
   weightings) and found **bitwise identical between the two languages** on 522
   cases. **`node lab/answerarena/tools/templates-parity.mjs` re-runs all of
   that** — it extracts both templates from `admin.js` exactly as the page hands
   them to Pyodide/WebR, drives them over those fixtures, compares the lists,
   every table cell and every `INSIGHTS` bullet, and brute-forces the engine;
   it **skips itself** with a message when `python3` (numpy/pandas/matplotlib)
   or `Rscript` is missing, which is the normal case in this repo's CI, exactly
   as `page-test.mjs` does for Playwright. Note it writes the fixture to
   `/tmp/data.csv`, because that is the absolute path WebR mounts the table at
   and the R template reads. `node lab/answerarena/tools/templates-guard.mjs`
   keeps them in step offline (the section titles and their order, figure guides contiguous 1..N
   with identical titles, identical `LEVELS`, **no hard-coded confidence
   percentage anywhere a label is printed**, one engine used twice, which test is
   the headline, which statistic each verdict takes its direction from, that no
   list is ever built from the adjusted column, and that both scripts still say
   an unlisted task is not an equal task). That guard is **mutation-tested** —
   five deliberate regressions were introduced and each was caught, and the
   parity harness was mutation-tested the same way (a wrong convolution shift in
   R and a strict-inequality tail in Python each raised 20+ failures).

   **A task that is NOT listed is NOT a task where the models are equal**, and
   both scripts say so in three places. Proving equivalence is a different claim
   needing a different test (the deleted TOST); the scripts deliberately do not
   make it.

   Note: R rejects 3-digit hex colours (`#888`), so the templates use 6-digit
   (`#888888`). `DA_TPL_VERSION` was bumped to `2026-08-28-tasklists`, which
   drops any saved script from the previous templates.

4. **Insights gained** (`buildDaSection4`). A readable write-up of the last run
   **and the home of every plot**: `daParseInsights()` extracts the script's
   `INSIGHTS` block (the text after a line reading `INSIGHTS`) and renders it with
   `## ` headings, `- ` bullets and `**bold**` (`daInlineBold`). A heading matching
   `^Figure N` **drops the Nth harvested image (`run.images[N-1]`) in right under
   it**, so each plot sits with its explanation; any image not matched to a
   `Figure N` heading is appended at the end (so a user's custom script never
   silently loses a plot). `run()` snapshots each run into `daState.lastRun`
   (`{output, images, lang, ok}`) and calls `daRefs.updateInsights()`. Editing the
   script's `INSIGHTS` prose (or the `## Figure N` headings) changes what shows and
   where the plots land.

**Deleted participants can never appear in an export.** The admin's Delete
**hard-deletes** the participant doc *and* its `responses`/`events`/`survey`
sub-collections (`deleteParticipant`, arena-store.js) — failures are no longer
swallowed, because Firestore keeps sub-collection docs alive under a deleted
parent and a half-delete used to orphan a student's answers while the UI said
"Deleted." The **Registered users list is grouped by student** (one card per
Participant ID, showing each account's `account_id` — the export's own join
key — and "N accounts" when they registered more than once), so its Delete removes
**every account behind that student**, then **re-reads and verifies** nothing
is left under that Participant ID before reporting success. When there IS more
than one account the card **lists them individually** (account id · registered
· sessions · status) each with **its own Delete**, because a student who
registered twice needs the stale account removed while the one they actually
played is KEPT — folding them under a single button would hide that choice. On top of that,
`exportExcel` **intersects `parts` with a fresh `listParticipants()` read**, so
no caller — a stale in-memory array, a list captured before a deletion, a
future caller that forgets to re-read — can leak a removed account into a
file; it fails open (keeps the caller's list) if that read errors. Offline
tests (both no-network, no-deps): `node lab/answerarena/tools/admin-guard.mjs`
(the deleted-participant / duplicate-account guarantees above) and
`node lab/answerarena/tools/templates-guard.mjs` (the Python and R analytics
templates stay in step — see §8).

**Gotchas:** the runtimes need network access to jsDelivr on first Run (blocked
in some sandboxes → a visible "Failed to load … (CDN / network / CSP?)" error,
not a crash). `SHEET_ORDER` is the single source of truth for the tab order,
shared by the export and the aggregate. The export refactor kept the single/all
export behaviour identical — `keep()` and `buildSessionRows(sessions, parts,
keep)` now take an in-scope predicate instead of a single `only` id.
