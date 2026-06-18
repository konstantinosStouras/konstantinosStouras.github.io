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
| `arena-data.js` | `window.ARENA_DEFAULTS`: texts, tourSteps, settings (incl. `twoByTwo`), registration/survey questions, practiceTask, `defaultTasks` (20 placeholders). |
| `arena-store.js` | `window.ArenaStore`: Firebase + local backends behind one API. |
| `arena-app.js` | Participant phase machine, comparison UI, 2x2 assignment, session join, resume. |
| `admin.js` | Admin panel (`?admin`): Sessions, Tasks (Excel upload), Content, Registration, Survey, 2x2 & Settings, Participants + Excel export. |
| `CLAUDE.md` | This file. |

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
  responseMs, condition, ts }
```

The comparison UI: the participant taps an answer (or "They're equally good"),
which reveals a **7-point preference bar** centered below the tie button (`A much
better · A better · A slightly better · Equal · B slightly better · B better · B
much better`); the bar is the response. **Next stays disabled until a choice is
made.** (There are no longer per-answer 1-5 satisfaction ratings or a free-text
reason - removed in favour of the single graded preference.) These columns ride
along in the admin Excel export (Responses sheet: `preference`, `preference_AB`,
`preference_model`). `settings.comparisonsPerUser` (0 = whole set) caps how
many comparisons each participant sees: when it is below the active-set size the
participant gets that many **randomly chosen** task pairs. **Each session
snapshots `comparisonsPerUser` and `randomizeOrder` at creation** (alongside the
2x2 `condition`), and `startMain` prefers the session's snapshot over the live
global settings (older sessions with no snapshot fall back to global) - so a
session keeps the count it was built with even if the global setting changes
later. The admin **Setup summary** shows this as e.g. "2 of 100 (random subset)"
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
parameters a new session will use). Every session is **created open**; there is
no status picker. The right column has two cards: **Active sessions** and a
separate **Closed sessions** card (shown only when there are closed ones). Each
card shows a session's code + status, participant count + **2x2 conditions**
(right) and created date (left). A running session offers Open / Copy link /
Export data / Edit name / **Close**; a closed session (no joins) offers Export
data / **Reopen** / permanently **Delete**. Per-session
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
`completedSessions` - **including `'_none'`** - (`showAlreadyDone`, whose "Start
over" mints a fresh anonymous identity), resumes an in-progress survey for the
same session, or else (re)starts the comparisons for that session. `sessionId`
on the participant doc is the **current** session; per-session completion lives
in `completedSessions`. `markCompleted()` adds the current sid on the thank-you
screen. Responses, events and survey docs are all tagged/keyed by `sid`, and the
survey is stored per session (`survey/{sid}`). Admin session counts include any
participant currently in or having completed that session.

**Decision log.** Every pick and every satisfaction-rating change emits an
**event** (`participants/{uid}/events`: `{ type, value, taskId, idx, sessionId,
ts }`), so the time of each decision - and of each change to a new option - is
recorded. Both the all-users export ("Export to Excel") and the per-session
export ("Export data" on a session card) produce a workbook with sheets:
**Conventions** (documents every column), **Participants**, **Responses**,
**Events**, **Survey**. Columns use self-explanatory snake_case names
(`participant_id`, `shown_order`, `left_model`/`right_model`,
`satisfaction_answer_A/B`, `cost_transparency`/`firm_pay` (per-participant 2x2
group as 1/0 via `condBit()`; blank if that factor was not varied), ...);
the Conventions sheet (built by `buildConventions()`, including each
registration/survey question label) is the source of truth - keep it in sync
when columns change.

**Nothing is lost on an abrupt close.** Each comparison is written one-by-one as
its **Next** is pressed, and the in-progress (not-yet-submitted) answer is saved
continuously as a `draftResponse` on the participant doc (debounced on change,
and flushed on `visibilitychange`/`pagehide`). The export adds the draft as a
Responses row with `submitted = no (draft)`.

## 7. Gotchas to carry forward

- Keep model identities out of anything the participant sees.
- Anonymous play needs the **Anonymous** sign-in provider enabled in the
  Firebase console; otherwise `Store.signInAnonymously()` fails
  (`auth/operation-not-allowed`) and the intake shows "Anonymous play is not
  enabled yet." **Email/Password** must stay enabled for the admin login.
- `arena-config.js` placeholders => local mode; real config => Firebase. The
  switch is automatic (`ARENA_FB_READY`).
- Firestore **rejects nested arrays**; the response docs avoid them. If you add
  array-of-array data, JSON-stringify it.
- Sessions are public-read on purpose (pre-auth code check). Don't put anything
  sensitive on a session doc.
- After changing `firestore.rules`, redeploy or writes silently fail.
- **"Missing or insufficient permissions" when a participant taps Start on the
  intake** = the Firestore rules were never deployed (the DB is on default-deny),
  *not* a required-field problem - the session code and Participant ID are both
  optional. Fix it on the backend: from `_lab-arena-firebase/` run
  `firebase deploy --only firestore:rules` (and enable the Anonymous sign-in
  provider). `authError()` now shows a clear message + logs this hint instead of
  the raw Firebase string.
