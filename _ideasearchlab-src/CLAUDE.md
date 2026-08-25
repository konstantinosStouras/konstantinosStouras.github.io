# CLAUDE.md -- Project Notes for AI Assistant
Paste the contents of this file at the start of any new Claude conversation
to give Claude full context about this project instantly.
---
## Project Notes: Ideation Challenge App
**What it is:** A research app for structured group ideation sessions with individual and group phases, optional AI assistance, and post-session surveys. Built for Kostas Stouras (researcher/instructor at ideasearchlab).
**Live URL:** https://www.stouras.com/lab/ideasearchlab/
**Source code (authoritative):** vendored in the main site repo at `konstantinosStouras.github.io/_ideasearchlab-src/`. This is the single source of truth — the app is self-contained inside the main repo. The old standalone `github.com/konstantinosStouras/ideasearchlab` repo is RETIRED/redundant (its source was 3+ days behind this copy) and can be deleted.
**Main site repo:** github.com/konstantinosStouras/konstantinosStouras.github.io
**Local source code path:** `<main-repo>/_ideasearchlab-src` (the folder name starts with `_` so GitHub Pages/Jekyll never publishes it).
**Deployment:** No external repo and no CI needed. Run `ideasearchlab-deploy-update.bat` from the main repo root (or, by hand, `cd _ideasearchlab-src && npm install && npm run build`, then copy `dist/*` into `../lab/ideasearchlab/`), commit, and push to master. A `spaFallback` plugin in `vite.config.js` injects the GitHub Pages SPA redirect into `index.html` and writes `404.html` at build time, so there is no post-build sed/CI step. Verified: a clean `npm run build` from this folder reproduces the live `lab/ideasearchlab/` bundle byte-for-byte.
**Firebase project:** ideasearchlab (region: europe-west1)
**Firebase services used:** Firestore, Authentication (Email/Password), Cloud Functions (Node 20, europe-west1)
**Frontend:** React + Vite, React Router with basename="/lab/ideasearchlab"
**Favicon:** `public/favicon.svg` (idea-lamp SVG in the app palette), linked from index.html with an absolute path that Vite rewrites using `base` at build time.
**NPM dependencies of note:** `xlsx-js-style` (a SheetJS fork that also *writes* cell styles) for client-side Excel export in the admin panel. The plain `xlsx` community build ignores `cell.s` styles when writing, so it cannot bold headers — `xlsx-js-style` is required for the bold header rows. Same `XLSX.utils` API; drop-in replacement.
**Cloud Functions (all in europe-west1):**
- joinSession: registers a participant and places them in EXACTLY ONE group atomically via `assignToGroup` (a single Firestore transaction). Every join is serialized through the session's `joinCount` counter, giving each participant a unique sequential join index → a deterministic group id (`g0`, `g1`, …) and label (`p1`, `p2`, …). This replaces the old racy query-then-batch `tryFormGroup`, which under concurrent joins (e.g. 70 students at once) could put one participant in two groups. The member who fills a group flips every member of that group into the first phase together; the first group to fill advances the session. Rejoins (participant doc already exists) only refresh name/email — never re-group. Transactions can't query, so it reads documents only (session doc + the single target group doc).
- listRegisteredUsers: admin-only callable. Returns every Firebase Auth account (uid, email, displayName, creationTime, lastSignInTime) so the instructor can see who signed up, including users who never joined a session. The client SDK cannot list Auth users, so this goes through the Admin SDK. Lives in `functions/users.js`. **It also joins each account to the student's REAL identity and repairs placeholder Auth displayNames** (owner 2026-08-16): a `collectionGroup('participants')` read — which, being Admin SDK, also sees docs ORPHANED by a deleted session, where the panel's client-side join is blind (client `deleteDoc` on a session doc does not cascade into subcollections and the rules can no longer authorise reading them) — is resolved through `functions/identity.js` (a CJS port of `src/utils/participantIdentity.js`; **keep in sync — parity-checked by `tools/identity-guard.mjs`**), merged per uid (a platform-handoff value wins per field, else first non-empty) and returned as `identity: {name,email,studentId}` on each user; while listing, a displayName that is empty/"Student" is updated to the real name (or `Student ID NNNNNNNN` when only the ID is known) — fill-empty, idempotent, best-effort, response carries `healedNames`. Auth E-MAILS are never touched (login key, must stay unique — the real e-mail travels in `identity`). The Admin panel prefers `identity` over its client-side join, reports the repair count, and labels a no-identity 0-session account "no registration on record — this login never joined a session" (an abandoned mint at `/join`, not a lost player). **Requires `firebase deploy --only functions`** — until then the panel degrades to the client-side join over the instructor's own live sessions.
- deleteRegisteredUser: admin-only callable (`functions/users.js`). Permanently removes ONE registered Firebase Auth account by uid. Before deleting the account it detaches that user from every session where they're an **active** participant, via the shared `detachParticipant(sessionRef, uid, { activeOnly: true })` helper in session.js — so each affected group keeps playing with one fewer member (n-1) under the same parameters (mirrors `reconcileGroupAfterRemoval`, advances a group if the removed member was the only blocker, queues a backfill vacancy while in play). Participants who already finished (`survey`/`done`) keep their records so their exported data is preserved. Guards the admin account and the caller's own uid. **Requires `firebase deploy --only functions`** to work (the frontend button calls this callable).
- deleteAllRegisteredUsers: admin-only callable. Bulk-deletes every Auth account except the admin/caller (leaves participant docs).
- advancePhase: instructor-controlled override for any phase transition (manual "Force advance" button). Calls `tallyGroupVotes()` whenever leaving the group phase (next is survey for individual_first, individual for group_first). When forcing group -> individual (group_first), participants still in 'group' are moved to 'individual'.
- autoGroupParticipants: Firestore trigger on individualComplete flipping true. individual_first: when all members of a group complete individual phase, moves them to group phase (session auto-advance accounts for all group members being moved in the batch, not just the triggering participant). group_first or individual-only: the individual phase is the last working phase, so the finished participant moves straight to 'survey' on their own, and the session advances to 'survey' once everyone is in survey/done.
- handleStragglers: callable -- starts the partly-filled last group whose members are still 'waiting' in the lobby (every participant already has a deterministic group from join, so it just moves the waiting members into the first phase and marks their group full).
- sendAIMessage: calls LLM, stores response in `sessions/{sessionId}/aiMessages`
- saveAISettings: saves global AI provider settings
- submitVote: legacy Cloud Function, still deployed but no longer called by the frontend. Voting now happens via direct Firestore writes from GroupPhase.jsx.
- onParticipantUpdated: Firestore trigger with two jobs. (1) When a participant's `votesSubmitted` flips to true, `finishGroupVoting()` checks whether every member of that group has submitted; if so it tallies that group's votes (top 3 -> `finalIdeas`), marks the group 'done', moves the members to the next phase in the sequence (survey for individual_first, individual for group_first), and advances the session status once every participant has moved past the group phase. This is how groups reach the survey automatically -- "Force advance" remains the manual override. (2) On any participant phase change, `maybeAdvanceSession` re-syncs the session status — **capped at 'survey', never 'done'**: a session must never auto-close, because every CURRENT participant being finished does not mean the session is over (a groupSize-1 session is run as many independent solo plays, and a late joiner can arrive after the first cohort finished). `status: 'done'` — which closes the session (JoinSession filters done sessions out of code lookup; useSessionEnded ends every open page) — is set ONLY by the instructor: Close Session or Force advance.
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page. Saved keys reload into the page on every visit (password fields + "saved ✓" tags). `saveAISettings` is admin-only (admin@admin.com) and accepts partial updates — sending `null` clears a field back to its built-in default. Firestore rule: ALL `settings/*` reads are `isAdmin()` (participants must never read settings/ai — it holds the API keys; Cloud Functions use the Admin SDK and bypass rules). The AI Settings page's Model, Parameters and System Prompt sections each have the standard three default buttons (Make this the default / Reset this page to defaults / Restore built-in default) doing per-section partial saves. Model lists in AISettings.jsx updated June 2026 (Claude Opus 4.8/Fable 5/Sonnet 4.6/Haiku 4.5, GPT-5.5/5.4/5.2, Gemini 3.5/3.x/2.5); provider defaults in functions/ai.js: claude-sonnet-4-6, gpt-5.5, gemini-3.5-flash. callClaude omits `temperature` for Opus 4.7+/Fable/Mythos (they 400 on sampling params) and reads the first text block (thinking blocks may come first); callOpenAI uses `max_completion_tokens` and no temperature for gpt-5*/o* reasoning models. Session aiConfig.model defaults to null = defer to global AI Settings.
**Session flow:** waiting -> individual -> group -> survey -> done (order and active phases configurable per session). Note: 'voting' was removed from the backend phase sequence. Voting now happens client-side as a sub-phase within GroupPhase.

## Participant onboarding flow
The participant join flow now has four steps before reaching the session lobby:
1. **JoinSession** (`src/pages/JoinSession.jsx`): Enter session code. Validates code client-side via Firestore query. If participant is new, navigates to Welcome. If already registered (rejoining), skips directly to SessionLobby. **On a platform launch the join is SILENT** (owner 2026-08: session codes are never shown to students): a handoff carrying a session auto-joins with a "Joining your class session..." card — the code never rendered; a failing code falls back to the empty form with a "ask your instructor" error so nobody dead-ends. Standalone visitors see the form unchanged.
2. **Welcome** (`src/pages/Welcome.jsx` + `Welcome.module.css`): Displays study overview with dynamic phase descriptions based on session's `phaseConfig`. Adapts text for individual-first, group-first, individual-only, or group-only configurations. Amazon Voucher paragraph only shown when group phase is active. "I agree and continue" button navigates to Registration.
3. **Registration** (`src/pages/Registration.jsx` + `Registration.module.css`): Collects demographics (Age, Gender, Nationality, Country, Level of Study, Work Experience, Occupation, English Fluency) plus two consent checkboxes. Nationality and Country use dropdown menus with full 195-country list. Work Experience is a number input validated 0-50. On submit, calls `joinSession` Cloud Function, then writes demographics to participant doc via `updateDoc`. Data stored as `demographics` object + `consentGiven` + `consentTimestamp` on participant document.
4. **SessionLobby**: Existing page, unchanged.

Routes added to `App.jsx`: `/session/:sessionId/welcome` and `/session/:sessionId/register`, both wrapped in SessionWrapper.

### Timing instrumentation
The app records how long participants spend on the key steps, surfaced in the export's **Timing** sheet. The tricky part: **Welcome and Registration run before the participant doc exists** (it's created at Registration submit via `joinSession`), so those marks are collected client-side in `sessionStorage` (`src/utils/timing.js`: `markTiming`/`readTiming`/`clearTiming`, keyed by session, client epoch ms) and **flushed onto the participant doc as `timing.*` at Registration submit** (then cleared). Everything after the doc exists is written with `serverTimestamp()` directly to the participant doc: `timing.individualOpenedAt` / `timing.groupOpenedAt` / `timing.surveyOpenedAt` are written once on first entering each page (guarded by a `useRef` + a `!data.timing?.X` check so they capture the FIRST entry); `individualStartedAt` / `groupStartedAt` on Start; `groupVotingStartedAt` on first moving to voting (in `goToStage('voting')` + `autoSubmitVotes`). All are self-updates on the participant's own doc, so no Firestore rules change is needed. The export computes each duration within one clock domain (client-ms pairs or server pairs) so a client/server offset never skews a duration.

## Accounts: user activity panel + admin user visibility
- **Profile menu** (`src/components/ProfileMenu.jsx` + `.module.css`): account dropdown in the top-right of the participant-facing headers. Shows the avatar/name; opens to "My activity & statistics" (→ `/history`), "Join a session" (→ `/join`), and "Log out". Closes on outside-click / Escape. Replaced the old plain name + Sign-out buttons.
- **HeaderControls** (`src/components/HeaderControls.jsx` + `.module.css`): the shared top-right cluster = `<ThemeToggle/>` + `<ProfileMenu/>`. Rendered on EVERY participant-facing page so the light/dark toggle (default light) and the signed-in account menu stay present throughout the whole flow — JoinSession, Welcome, DemoTour, Registration, SessionLobby, the Individual/Group instruction screens AND their workspaces (added into each `.topBar`'s `.topRight`), Survey, and the Done screen (pinned via a fixed `.doneControls` wrapper since Done has no header). The standard page headers are `position: sticky; top: 0` so the controls stay visible while scrolling. UserHistory keeps its own ThemeToggle+ProfileMenu.
- **Header controls sit on the SAME right edge on every screen** (owner 2026-08). `HeaderControls` (theme toggle + account menu) is the one piece of furniture present throughout the flow, so it must never shift between steps. Two things used to move it: (a) the phase headers (`.instrHeader`) had no `justify-content`, relying entirely on `.instrTimer`'s `margin-left: auto` to push the controls right — so the individual/group **confirmation screens**, which correctly carry no phase timer, left them sitting beside the wordmark; `.instrHeader` now declares `justify-content: space-between` like every other page header (with a timer present, its auto margin still absorbs the free space first, so timer+controls stay together on the right exactly as before). (b) The workspace `.topBar` padded 28px against the page headers' 40px, so the controls jumped 12px on entering a workspace; its padding is now `18px 40px 14px 28px` — right edge aligned with the headers, left still aligned with the workspace content below. The `Done` screen pins `right: 40px` to the same edge. **Any new screen's header must land the controls 40px from the right.** Pinned by `tools/phase-hold-guard.mjs`, which measures the controls' right edge on all 11 screens of the flow and fails if they are not identical.
- **UserHistory** (`src/pages/UserHistory.jsx` + `.module.css`, route `/history`, RequireAuth): a participant's own activity page. Lists every session they joined with status, joined date, group label, and survey state, plus summary stats (joined / completed / in-progress). Implemented purely client-side under existing rules: read all sessions (signed-in read is allowed) then `getDoc` the user's own `participants/{uid}` doc in each (own-doc read is allowed). No schema/rules/functions changes; works with all existing data.
- **Admin → Registered Users** (Admin.jsx `UsersPanel`): a card listing every registered account (email, name, registered/last-sign-in dates) and, expandable per user, the sessions they joined with each session's status. The account list comes from the `listRegisteredUsers` callable (Firebase Auth, the only authoritative "who signed up"); participation is cross-referenced client-side from the per-session participant docs the admin already subscribes to (`participantsBySession`). Degrades to participants-only if the function isn't deployed. Has a search box + refresh. Each expanded user card has a **Remove user** footer button → a confirm modal (`removeUserConfirm`) → `removeUser(uid)` calls the `deleteRegisteredUser` callable, which detaches them from any active group (so it continues with n-1 members) and deletes the Auth account, then `loadUsers()` refreshes the list. "Delete all registered users" (bulk) remains alongside.
- **AdminSession participants → per-group + expandable detail**: the live participant list is bucketed under per-group headers ("Group 1 — N members · ideas x/N · votes y/N") that are **collapsed by default and click-to-expand**; each member row then expands on click to show that user's current stage, email, joined time, individual/vote/survey progress, group stage, demographics, and a per-participant action bar (Message / Nudge / Remove). See the "Click-to-expand groups + per-participant messaging" note under AdminSession below.
- **Fine-grained participant sub-stage (admin)**: `participantStageLabel(p)` in AdminSession takes the whole participant doc and shows exactly where each user is, distinguishing the instructions screen from the active workspace: `individual — reading instructions` (status `individual`, no `individualStartedAt`) vs `individual — writing ideas` (after Start), `individual submitted — waiting for group` (`waiting_for_group`), and for the group phase `group — reading instructions` / `group — ideation` / `group — voting` / `group — votes submitted` (driven by `groupStage` + `votesSubmitted`). Shown both in each participant row and the expanded "Current stage" detail.

## Social sharing metadata (Open Graph)
`index.html` carries Open Graph + Twitter Card tags (title, description, url, `og:image`) so the link shows a rich preview on WhatsApp/Facebook/etc. The image is `public/og-image.png` (1200×630, generated from `public/og-image.svg`; Vite copies both to `dist/` → served at `/lab/ideasearchlab/og-image.png`). `og:image`/`og:url` use absolute `https://www.stouras.com/...` URLs because Vite does not rewrite meta `content`. **The share copy and image deliberately never mention AI** — AI assistance is optional/hidden and must not be advertised to participants. Regenerate the PNG with sharp after editing the SVG: `sharp('public/og-image.svg',{density:144}).resize(1200,630).png().toFile('public/og-image.png')`.

## Idea data model
Ideas have structured fields:
```
ideas/{ideaId}: {
  title: string,          // idea title (bold display)
  description: string,    // description (smaller text below)
  text: string,           // combined "title: description" for backward compatibility
  authorId, authorName, phase, groupId, votes, createdAt,
  selected: boolean       // true if user chose this as a top idea for group phase
}
```
Note: vote counts are NOT stored on idea documents. They are derived client-side by counting across all group members' `votedFor` arrays on their participant documents.

## IndividualPhase.jsx
- **Two-view structure**: Instructions view (shown first with "Start" button), then workspace view.
- **TWO TIMED STAGES (idea generation -> idea selection)**: the workspace is played in two stages, each with its own admin-allocated countdown (`phaseConfig.individualGenerationDuration` / `individualSelectionDuration`, resolved by `src/utils/phaseTimers.js`). **Generation** ("Individual Ideation Phase") = write/edit/delete ideas; the top bar's action is **Proceed to Selection** (disabled until there is at least one idea) and double-click selection is OFF. **Selection** ("Individual Selection Phase") = the same list, now double-click-to-select up to `ideasCarriedToGroup`, no add form and no edit/delete, action **Finish & Submit**; an inline "Back to adding ideas" link returns to the generation list (the selection clock, once started, stays the live one — same rule as the group phase's "Back to ideation"). The stage is mirrored to the participant doc as `individualStage` ('generation' | 'selection') so the instructor sees it, and `individualSelectionStartedAt` (serverTimestamp, written once) anchors the selection countdown and splits the export's timing. When the GENERATION timer expires the participant moves to selection (it does not submit); when the SELECTION timer expires `autoFinish()` submits (auto-picking if nothing was selected). A session with no group phase has nothing to carry forward, so it has no selection stage and finishes straight from the generation stage.
- **Legacy sessions keep ONE clock**: a session created before the split carries only `individualPhaseDuration`; `individualTimers()` reports `split: false` and the single countdown spans both stages, expiring straight into `autoFinish()` exactly as before — so a session already in flight never changes behaviour mid-study. The admin edit form migrates such a session's timers into the per-stage fields (`migratePhaseTimers`) so saving it can't silently drop its countdown.
- **Instructions page**: Full-page card with study instructions, the per-stage durations (`{genMinutes}` / `{selMinutes}`; `{minutes}` = both together), task checklist, group-phase warning (conditional).
- **Collapsible Task Brief**: Shown in workspace, contains the product design prompt (the smart-materials / colour-changing-fabric task — "design a new product using a fabric that changes colour at 37°C"), evaluation criteria (Novelty, Feasibility, Financial Value, Overall Quality), AI note (conditional), and selection instructions. (The old sleep-mask example image was removed — no example image is shown.)
- **Structured idea submission**: Two fields, "Idea title" and "Description", rendered in pill-shaped cards (border-radius: 20px) with bold title, gradient separator line, and smaller description text. Pressing **Enter** in either field submits the idea (the same as clicking Add); **Shift+Enter** in the Description inserts a newline. Same behaviour in the GroupPhase "Group Ideas" add form.
- **Inline editing**: Pencil icon appears on hover, click enters edit mode with editable fields + Save/Cancel.
- **Delete**: Trash bin icon appears on hover (red on hover), calls `deleteDoc`.
- **Double-click selection**: Double-click toggles idea selection for group carry-over. Selected cards get accent border, glow, and "Selected" badge. Selection bar shows count ("Selected ideas: 2 / 3"). Maximum controlled by `ideasCarriedToGroup`.
- **Finish & Submit**: Disabled until at least one idea is selected. Does participant `updateDoc` first (critical), then idea selection batch separately (non-critical, fails gracefully if Firestore rules missing).
- **Submission-confirmation screen + its minimum hold**: after Finish & Submit the page shows a dedicated summary of the individual stage — every idea submitted, the carried-forward ones badged "Carried to group" — while the participant waits for the rest of their group. It is a VIEW inside IndividualPhase (rendered while `done`/`status === 'waiting_for_group'`), not a separate lobby route. **It is held on screen for at least `CONFIRM_HOLD_MS` (15 s) after this participant's own submit** (owner report 2026-08: the summary "showed too quickly in a flash and couldn't see them again"). Why it flashed: `autoGroupParticipants` flips a participant to the group phase the moment EVERY member of their group has `individualComplete` — which is the same instant they submit for whoever submits LAST, and always the case in a solo group (`groupSize: 1`, how the app is usually tested) — and the participant-doc listener navigated on that status change within one Firestore round-trip. So the listener now routes 'group'/'survey' through `goNext()`, which parks the path in `pendingPathRef` and starts a countdown (`submittedAtRef` stamped in `markDone` BEFORE the write, so the status change it triggers can never beat it); the countdown effect recomputes the remaining time from that stamp rather than decrementing, so a backgrounded tab (throttled intervals) still leaves on time. `status === 'done'` is deliberately NOT held — that one means the instructor closed the session. **The advance stays fully automatic** (per the owner: no Continue button, so nobody can stall their group by walking away); the waiting note just reads "The group phase starts in Ns..." while the hold runs, and otherwise "N of M group members have submitted. The group phase will start automatically as soon as the rest of your group get here." The listener also restores `done` from `individualComplete`, so a reload while waiting re-opens the summary instead of the already-submitted workspace. **Nothing definitive is drawn until that document has actually ARRIVED** (owner report 2026-08: refreshing on the summary showed the "Individual Ideation Phase" instructions — with a Start button — for a moment first). `started` and `done` are BOTH restored from the participant doc, so until its first snapshot lands they are both false, which is exactly the state that renders the instructions: the page confidently drew a screen it had no evidence for. Both phase pages now carry a `participantLoaded` flag, set inside the snapshot handler BEFORE the `snap.exists()` bail (so a participant with no doc still stops loading), and a `if (!participantLoaded) return <div className={styles.restoring}>Restoring your session…</div>` gate placed BEFORE the `!started` instructions branch. That ORDERING is the fix, and it is pinned by `node _ideasearchlab-src/tools/phase-restore-guard.mjs` — a SOURCE check on purpose: reproducing it at runtime needs a participant who submitted in a PREVIOUS page load, and the preview sandbox's store lives in memory for the lifetime of the tab, so a reload wipes the very document whose absence is the bug. **This screen carries NO phase timer in its header** (owner 2026-08): it comes AFTER the submit, so the selection stage's countdown no longer governs anything — leaving it running showed a clock ticking down beside the only countdown that does (the hold, printed on the card), and its expiry would re-fire `autoFinish`. Verified end-to-end in the preview sandbox (`node hold-test`-style Playwright run through welcome → registration → individual → submit): summary at +2.5 s with "starts in 13s", still there at +9.5 s, group phase at 15.2 s.
- **Group progress strip**: always-visible bar under the top bar (when a group exists and has >1 member) showing "Group progress: X / Y submitted" plus a chip per member (anonymous label, green ✓ once `individualComplete`). Gives participants visibility of where the rest of their group stands while they work — both to engage those waiting and to signal to the bottleneck that others are done.
- **Static image**: Example sleep mask image at `public/images/sleep-mask-example.png`. The `<img>` tag hides itself via `onError` if file not found.
- **Sticky timer (always visible)**: the phase workspace `.topBar` (which holds the PhaseTimer + the Finish/Submit/Proceed button) is `position: sticky; top: 0` inside the scrolling `.main`, with a `var(--paper)` background, a bottom border, and negative horizontal margins so it spans edge-to-edge (the `.main` top padding moved into the bar). So however far the participant scrolls — or zooms in until content overflows — the countdown and the submit control stay pinned at the top. Applies to IndividualPhase and both GroupPhase sub-phases (same `.main`/`.topBar` classes).
- **Per-participant timer (starts on Start)**: the individual-phase countdown is per-participant, not the shared session timer. Pressing **Start** on the instructions screen writes `individualStartedAt: serverTimestamp()` to the participant doc; the PhaseTimer counts the generation stage's full duration from that moment (then the selection stage's own from `individualSelectionStartedAt`), so every participant gets their full time from when they actually begin (no longer already ticking from the shared `phaseStartedAt` while they read). On the instructions screen the timer renders in a non-ticking **preview** mode (PhaseTimer `preview` prop — shows the full duration, no countdown, no `onExpire`). A reload restores the workspace (skips instructions) and continues the same timer because `individualStartedAt` is read from the participant snapshot (`setStarted(true)` when present). Trade-off vs. the old shared timer: a participant who never clicks Start has no countdown and won't auto-submit, so the instructor's Force advance / handleStragglers covers that edge case.
- **Timer default decision**: once started, when the phase timer expires `autoFinish()` submits whatever exists — if nothing was double-click selected it auto-selects the latest `ideasCarriedToGroup` ideas first, and it submits even with zero ideas, so one participant can never stall their group. The manual Finish button keeps its stricter `canFinish` gate.
- **Nudge banner**: `<NudgeBanner />` (src/components/NudgeBanner.jsx) shows a "please wrap up" banner in two cases. Manual: the instructor nudges this participant (`nudgedAt` on the participant doc); dismissing writes `nudgeAckAt`, and a newer nudge shows it again. Automatic: the page passes `autoMessage` when this participant is the bottleneck — IndividualPhase when every OTHER group member has `individualComplete` but they haven't submitted; GroupPhase when every other member has `votesSubmitted` but they haven't. Auto-dismissal is local-only; an instructor nudge takes precedence over the auto text. Solo participants (no other members) never auto-nudge. Rendered on the instructions screens and workspaces of both phases.
- **Navigation**: Listens for status changes via onSnapshot. Navigates to group, survey, or done. The old `voting` navigation was removed since voting is no longer a separate phase.

## GroupPhase.jsx (major update -- two client-side sub-phases with chat)
GroupPhase handles two sub-phases via a client-side `subPhase` state toggle ('ideation' or 'voting'). This is purely a UI toggle per participant, not a Firestore status change. The participant's Firestore status stays as 'group' throughout.

Each participant's sub-phase is mirrored to their participant doc as `groupStage` ('ideation' | 'voting'), written by `goToStage()` — and also set to 'ideation' the moment they press **Start** on the group instructions screen (`startGroup()`), so the admin and other members can tell "reading instructions" (no `groupStage`) from "ideating". Pressing Start also records a **per-participant timer start** `groupStartedAt` (serverTimestamp), and the group IDEATION timer counts its full duration from that moment — mirroring the individual phase, so each member gets their full time from when they actually start rather than from the shared phase start. **The two sub-phases are timed SEPARATELY** (`phaseConfig.groupIdeationDuration` / `groupVotingDuration`, resolved by `src/utils/phaseTimers.js`): the ideation clock runs from `groupStartedAt`, and moving on to voting (button, or the ideation clock running out — `autoAdvanceToVoting`) starts the voting clock from `groupVotingStartedAt`, which then stays the live clock even if a member steps back to ideation. A legacy session (only `groupPhaseDuration`) reports `split: false` and keeps its single clock across both sub-phases, expiring straight into `autoSubmitVotes()` as before. The group instructions screen therefore shows the timer in non-ticking **preview** mode; the ideation and voting workspaces count down from `groupStartedAt`. A reload restores the workspace (skips instructions) when `groupStage` or `groupStartedAt` is set, and restores the voting sub-phase if `votesSubmitted`. Member chips in BOTH sub-phases show each member's live stage so the group always knows where everyone stands: plain chip = still ideating, small "voting" tag = picking votes, green ✓ = votes submitted.

Like IndividualPhase, GroupPhase has a **two-view structure**: an instructions screen (full-page card with Start button, rendered from contentConfig `group.instructions`, supports `{minutes}` and `{votes}` placeholders) shown first, then the workspace. Both phases' instructions screens render the PhaseTimer (header, right) and the NudgeBanner. Both now show the timer in non-ticking **preview** mode on the instructions screen, because both countdowns are per-participant and only start when the participant presses Start (`individualStartedAt` / `groupStartedAt`). Trade-off: a participant who never clicks Start has no countdown and won't auto-submit, which the instructor's Force advance / handleStragglers covers. Inside the workspace a **collapsible Task Brief** (contentConfig `group.brief`, shown in both sub-phases) replaced the old single-field intro banner (`group.body`). The brief is toggled by an **always-visible centred green pill button** below the card — "▲ Hide task description" / "▼ Show task description" (mirroring The Lit’s Hide/Show filters control; same pattern in IndividualPhase). This replaced the old click-the-header toggle with the tiny chevron, which users didn’t discover, plus the dismissible tip banner that existed only to explain it (both removed 2026-08). The "Task Brief" header is now static. The admin Content editor's Group phase block accordingly has the same two sections as the Individual phase: "Instructions screen (before Start)" and "Task brief (inside the workspace)". Legacy sessions that stored a custom `group.body` banner fall back to showing it as the task brief (handled in `getContent` in defaultContent.js).

### Group Ideation sub-phase (default)
- **Title**: "Group Ideation Phase"
- **Top right**: Timer + "Proceed to Voting" button (accent pill)
- **Left column — "Group Ideas so far"**: ONE combined list of every idea the group is working with — the individual ideas carried in from the individual phase **plus** the ideas the group adds during this phase. Each pill carries a small "individual"/"group" phase tag so the source is clear (the `IdeaPill` `showPhaseTag` prop; `renderPill(idea, variant, true)` turns it on — the tag also always shows in voting mode). Individual ideas first, then group ideas, each chronological. When a participant adds a new group idea it lands in this list automatically (it's driven by the `ideas.group` snapshot).
- **Right column**: split vertically into the **"Add a Group Idea"** form (top, ~34% by default — just the title/description add form, since the ideas themselves now live in the left list) and **Group Chat** (bottom, fills the rest). New ideas submitted here appear in the left list.
- **Resizable regions**: the ideation workspace columns are a flex row with a draggable `ResizeDivider` (`src/components/ResizeDivider.jsx`) between the left "Group Ideas so far" list and the right add-form+chat column (drag left/right), and a second `ResizeDivider` between the add form and the chat (drag up/down). The parent (GroupPhase) holds `leftColPct` / `groupIdeasPct` state and applies them as inline `flex-basis`. Group-only sessions get just the left/right column divider. The main app↔AI split stays the existing `SplitLayout` divider.
- Title + description submission form (`addIdeaForm`, dashed-border pill card) for adding group ideas. It's extracted on its own so it can sit in the right column; group-only sessions append it under the list via the shared `groupIdeasList`.
- **Group-only sessions** (no individual phase, `phaseConfig.individualPhaseActive === false`): there are no individual ideas to carry, so the layout adapts — the **`groupIdeasList` (group ideas + add form) is the primary left column** and Group Chat takes the right column (instead of rendering an empty panel). This fixes the "one user in the group phase, no idea showing" feedback where a lone participant in a group-only session saw an empty primary column.

### Group Voting sub-phase (after clicking "Proceed to Voting")
- **Title**: "Group Voting Phase"
- **Top right**: Timer + vote counter (0/3) + "Submit Votes" button (disabled until 3 votes, locks votes on click)
- **Left column**: ALL ideas merged (individual + group) in one scrollable list, sorted by votes descending. Each pill shows a small "individual" or "group" phase tag.
- **Right column**: Group Chat only, taking full column height (no Group Ideas header)
- Double-click any idea pill to toggle a vote (max 3 per participant). **Required vote count adapts**: `requiredVotes = max(1, min(3, totalIdeaCount))`, so a small or solo group can still unlock "Submit Votes" when fewer than 3 ideas exist (the vote counter shows `/ requiredVotes`). Normal sessions with ≥3 ideas are unchanged at 3.
- Votes stored as `votedFor` array on the participant's own document (direct `updateDoc`), not on idea docs
- Vote counts derived in real-time by iterating all group members' `votedFor` arrays (from the existing members onSnapshot listener)
- **Where the group's votes are is marked on the CARD, not just in a small tag**
  (owner 2026-08: "show the votes per idea and the ideas that do have some votes
  more clearly highlighted, to help group members reach consensus"). The old
  `Votes: N` grey micro-text is now a filled accent chip — **`N votes of M`**
  (M = group size, so a count reads as a share of the group; the `of M` is
  dropped in a solo group) — and the pill itself carries the signal:
  `.ideaPillHasVotes` gives ANY idea with a vote a 4px accent left edge + tint,
  and `.ideaPillLeading` deepens it for the ones currently in the group's top
  three, each stamped with its rank (`#1`/`#2`/`#3`) — the set that becomes the
  group's picks if voting ended now. The ranks come from `leadingIds`, sliced off
  `allIdeasForVoting`'s OWN order (NOT `topVotedIds`, which sorts by count alone
  and breaks ties by object order), so the marks can never contradict the order
  on screen. A maxed-out pill still dims, but less (`0.85`) when it carries
  votes — dimming the very ideas the group is converging on defeats the point.
- **A live ballot line above the list** (`.voteStatus`, groups of 2+): "no votes
  yet" → "N ideas with votes · your group agrees on K of them — the highlighted
  #1–#3 become your group's picks" → the amber divergence advisory (below).
- Voted pills (BY ME) additionally get the accent border + glow. Maxed-out pills
  get dimmed opacity
- After clicking "Submit Votes": writes `votesSubmitted: true` and `votedAt` to participant doc, locks the UI (double-clicks ignored), button replaced by green "Votes submitted" badge
- Member chips show checkmark next to members who have submitted votes
- Compact voting hint text with inline "Back to ideation" link
- Chat remains active during voting
- **The "you haven't agreed yet" advisory is raised UNPROMPTED, while there is
  still time to talk** (owner 2026-08). It used to appear only when someone
  pressed **Submit Votes** — by which point they had already made up their mind.
  A `useEffect` now watches `votesDiverging` = *two or more members have cast a
  COMPLETE ballot (`votedFor.length >= requiredVotes`) and still no idea has more
  than one vote* — deliberately stricter than the submit-time
  `consensusMeasurable` (any two members having voted at all), because
  half-finished ballots look like disagreement while members are simply still
  clicking. It re-arms if the group converges and drifts apart again and never
  fires twice within `DIVERGE_COOLDOWN_MS` (90 s), so it advises rather than
  nags; the same state also paints the amber `.voteStatusWarn` banner above the
  list (which stays after the modal is dismissed, with a "What should we do?"
  link that re-opens it).
- **"Consensus" is spelled out in plain words** in both modal modes
  (`.consensusNote`, an accent-barred callout): *simply agreeing together. Your
  group talks it over and picks the SAME ideas, so the final ideas are ones
  everybody can stand behind* — plus a concrete "what to do now" (say which ideas
  you like in the Group Chat, listen, re-vote; votes can be changed until
  submit). Kept SHORT and free of em dashes, per the owner (2026-08), in the
  modal, the banner and the rank tooltip alike: this is read mid-task by students
  under a countdown, many of them non-native speakers. Many participants are non-native
  English speakers and the study's own vocabulary should not be a barrier. The
  warn modal's **Submit anyway** button now renders only when the ballot could
  actually be submitted (`myVoteCount >= requiredVotes`); below that
  `submitVotes` silently returned, so the button read as dead.
- **Voting-result screen + its 15 s hold** (owner 2026-08): once EVERY member of the group has submitted their votes, the workspace is replaced by a summary of the group's **final selected ideas** — most-voted first, rank chip, vote count, description — held for `CONFIRM_HOLD_MS` (15 s, the twin of IndividualPhase's constant; keep the two together) before the phase change goes through. Same machinery as the individual summary and for the same reason: the backend advances everyone the instant the LAST member submits (immediately, in a solo group), so the group's result used to flash past. The status listener routes 'survey'/'individual' through `goNext()`, which parks the path in `pendingPathRef`; the hold is stamped in `groupDoneAtRef` the first time this browser learns the group is done, from EITHER source — the members snapshot (in the self-advance effect, stamped BEFORE its write) or a status change that arrives while `votesSubmitted` is true (the backend trigger beating that snapshot). `status === 'done'` is never held: that is the instructor closing the session. The ideas shown prefer the group doc's tallied `finalIdeas` and fall back to the identical client-side tally (`topVotedIds`, mirroring `finishGroupVoting`'s "most votes first, top 3") while that write is in flight, so the card is never blank in the seconds after the last vote — and an EMPTY `finalIdeas` is ignored, since that is the value a group is created with. Like the individual summary, the header carries no phase timer (voting is over). Offline test: `node _ideasearchlab-src/tools/phase-hold-guard.mjs`.
- **Timer default decision**: when the VOTING timer expires (or, in a legacy unsplit session, the single group timer), `autoSubmitVotes()` locks in whatever votes the participant currently has (possibly none) and flips them to the voting view. When the IDEATION timer expires in a split session the group is moved to voting instead — it never skips voting. With every member locked, the `finishGroupVoting` backend trigger tallies and advances the group — so a timed group phase always ends on schedule.
- **Timed reminder pop-ups (self-dismissing)**: a centred reminder appears (and fades on its own after ~6 s — no button) as the single group timer crosses thresholds, driven by the new `PhaseTimer` `onTick(remaining)` prop so the nudges stay in lock-step with the displayed countdown. GroupPhase's `handleTimerTick` uses crossing-detection (`prev > t && now <= t`) and fires each once, only in the matching sub-phase: **ideation → 5 min and 2 min left** ("keep generating ideas, and vote for the ones to take into the next phase" / "wrap up and move to voting"); **voting → 1 min and 30 s left** ("place your votes" / "quickly place your votes!"). The pop-up (`.timeNudge`) is `position:fixed`, centred, `pointer-events:none` so it never blocks the workspace, and keyed so each one replays its fade-in. Short phases never fire a threshold above their duration (crossing-detection, not `<=`).
- **Vote self-heal (no more frozen voting screens)**: moving from group voting to the next phase no longer depends solely on the single `finishGroupVoting` trigger fired by the *last* submitter. At scale (many groups voting at once, or all members auto-submitting together at timer expiry) that one server round-trip could be delayed or dropped, freezing the other members on "Votes submitted" while only the last submitter (who self-navigated client-side) moved on. Fix: GroupPhase has a `useEffect` self-heal — once this member has `votesLocked` and **every** member of the group has `votesSubmitted`, the participant writes their **own** `status: nextAfterGroup` (allowed by the existing owner-update rule; the status listener then navigates them). So each member advances itself; no group can stall. The backend still tallies `finalIdeas` via `finishGroupVoting` when its trigger fires, and Force advance remains a backstop. Complementary backend backstop: `maybeAdvanceSession` (in `onParticipantUpdated`, runs on any participant status change) monotonically advances `session.status` to the furthest phase ALL active (non-removed) participants have reached, so the session reaches 'survey' and never sticks on 'group' even if a per-group trigger was missed (capped at 'survey' — never 'done'; sessions close only by instructor action). **The freeze fix is purely client-side (live on the Pages deploy); `maybeAdvanceSession` needs `firebase deploy --only functions`.**

### Group Chat (both sub-phases)
- Messages stored in Firestore subcollection: `sessions/{sessionId}/groups/{groupId}/messages/{messageId}`
- Each message: `{ authorId, authorLabel, text, createdAt }`
- Real-time `onSnapshot` listener, ordered by `createdAt` ascending
- WhatsApp-style bubbles: own messages right-aligned with accent tint, others left-aligned with sender's anonymous label (p1, p2) shown above
- Small timestamp on bottom-right of each bubble
- Header shows "Group Chat" with subtitle "Discuss and refine your ideas"
- Auto-scroll to newest message
- Empty state: "No messages yet. Start the conversation!"

### Individual ideas filter (unchanged)
- Prefers ideas with `selected: true`. Falls back to latest N by `createdAt` if no selected ideas found (handles case where selection batch failed due to Firestore rules).

### Vote tallying (backend)
Vote tallying happens on either of two paths. Automatic: when the last member of a group clicks "Submit Votes", the `onParticipantUpdated` trigger (via `finishGroupVoting()` in session.js) tallies that one group and moves its members to the next phase — this is the normal way groups reach the survey. Manual override: when the instructor clicks "Force advance" from group to survey, `advancePhase` calls `tallyGroupVotes()` for all still-active groups:
- Reads all active groups and their members' `votedFor` arrays
- Counts votes per idea across all group members
- Stores the top 3 idea IDs as `finalIdeas` on each group document
- Marks group status as 'done' with `votingCompletedAt` timestamp

## VotingPhase.jsx (retired)
The separate VotingPhase page is no longer used. The `/voting` route can be removed from App.jsx. The old VotingPhase.jsx and VotingPhase.module.css files remain in the repo but are not imported anywhere.

## Survey (redesigned)
- **surveyQuestions.js** (`src/data/surveyQuestions.js`): 27 questions across 7 sections:
  - "Your Experience" (Q1-Q4): difficulty, satisfaction, idea rating group, collaboration comfort
  - "Creativity and Idea Generation" (Q5): supporting others' ideas
  - "Reflection" (Q6-Q7): two freetext questions
  - "Questions about sleep wellness" (Q8-Q12): importance, activities, product purchases, interest, prior experience
  - **"About you" (10 items): a Big-Five personality short form** (2 likert items each for Openness/Conscientiousness/Extraversion/Agreeableness/Neuroticism) — a pre-registered moderator.
  - **"Your group" (4 items): cognitive-diversity** likert items ("members of my group differ in…"), `showIf` groupPhaseActive (a group-level moderator).
  - **"Creative thinking" (1 freetext): the divergent-thinking "list creative uses for a brick" task** — pre-registered creative-ability measure.
  - These three moderator sections were added so the **default** questionnaire collects the AsPredicted #298152 moderators without per-session customization; they flow into `surveyAnswers` and the export's Survey sheet via the existing dynamic-column logic (no export-code change). Existing/custom sessions are unaffected.
- **New question types**: `likert5` (1-5 scale with custom anchors), `rating_group` (each sub-item/criterion rated on its own 1-5 box scale with optional description + anchors; fully editable in the admin SurveyBuilder — label, description, low/high anchor per criterion), `radio` (pill buttons with optional conditional follow-up), `freetext`
- **Exports**: `SURVEY_TITLE`, `SURVEY_SUBTITLE`, `SURVEY_QUESTIONS`
- **Survey.jsx**: Questions grouped into section cards. The likert5 1–5 scale renders as five numbered square boxes (`.scaleBox`, rounded squares, accent-filled when selected) — replaced the older connected-dot/track scale per participant feedback. **rating_group** no longer renders as a table grid of circles; instead each criterion is a stacked sub-question with its own 1–5 box scale (reusing `.scaleBox`/`.boxScale`/`.scaleAnchors`), an optional italic description (subheading) after the criterion name, and optional per-criterion `lowLabel`/`highLabel` anchors under the scale. Item shape is now `{ id, label, description?, lowLabel?, highLabel? }` (description/anchors all optional — render only when filled). Pill-shaped radio buttons. Conditional follow-up field (Q10). Proper validation for all types including nested groups and conditional follow-ups. Each section can have an optional `sectionSubheading` (set per question in the admin SurveyBuilder, second input under "Section heading") rendered as a smaller muted line under the section heading.
- **Survey.module.css**: Section cards with shaded headers, responsive layout.

## Firestore security rules
**Ideas subcollection:**
```
allow update: if request.auth.uid == resource.data.authorId;
allow delete: if request.auth.uid == resource.data.authorId;
```
- Authors can edit/delete their own ideas (title, description, selected flag)

**Participants subcollection:**
- Participants need self-update permission for writing `votedFor`, `votesSubmitted`, `votedAt`, `surveyAnswers`, `status: 'done'`, etc.
```
allow update: if request.auth.uid == request.resource.id;
```

**Group chat messages** (nested inside groups match):
```
match /messages/{messageId} {
  allow read: if request.auth != null;
  allow create: if request.auth != null;
}
```
- Participants can read all chat messages and create new messages
- No editing or deleting chat messages

**Group formation logic (atomic, race-free):**
- Groups are assigned at join time via `assignToGroup()` in session.js, inside ONE Firestore transaction. Every join reads+increments the session's `joinCount` counter, so joins are serialized and each participant gets a unique sequential index `myIndex`. The group is deterministic: `groupId = g{floor(myIndex/groupSize)}`, label `p{(myIndex % groupSize) + 1}`. This guarantees each participant is in EXACTLY ONE group even under heavy concurrent joins (the old `tryFormGroup` query-then-batch could double-assign under load). `tryFormGroup` and `preAssignGroups` were removed.
- The transaction reads documents only (session doc + the single target group doc) because Firestore transactions cannot run queries. The member who fills a group flips every member of that group into the first phase; the first group to fill advances the session status + sets phaseStartedAt.
- Participant docs are created already carrying `groupId`, `anonymousLabel`, and `uid` (no longer a `groupId: null` then-update window). Rejoins (doc already exists) refresh name/email only — never re-group, never bump joinCount.
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing). Sessions are created with `joinCount: 0`.
- Partly-filled last groups (e.g. 70 students / groupSize 3 → one group of 1) stay 'waiting' until more join or the instructor calls handleStragglers, which starts them as an undersized group.
- Each participant is assigned an anonymous label (p1, p2, p3...) by position within their group at join; labels are shown instead of names throughout the session.
- autoGroupParticipants handles the individual->group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual->group when all groups are formed
- Session status never auto-advances past 'survey' — 'done' (which closes the session to new joiners) is instructor-only: Close Session or Force advance. Participants' own status still reaches 'done' individually.

**Phase sequence (backend, `getPhaseSequence` in session.js and phaseSequence.js):**
- 'voting' has been removed from the sequence
- Both individual and group active (individual_first): waiting, individual, group, survey, done
- Both active (group_first): waiting, group, individual, survey, done
- Individual only: waiting, individual, survey, done
- Group only: waiting, group, survey, done

**Key config objects per session:**
```
phaseConfig: {
  individualPhaseActive, groupPhaseActive, phaseOrder,
  maxIdeasIndividual, ideasCarriedToGroup, groupSize,
  // per-STAGE countdowns (seconds; null = manual). See src/utils/phaseTimers.js
  individualGenerationDuration, individualSelectionDuration,
  groupIdeationDuration, groupVotingDuration,
  // pre-split sessions only, still read as the single per-phase clock:
  individualPhaseDuration, groupPhaseDuration
}
aiConfig: {
  individualAI, groupAI, model, temperature,
  maxTokens, systemPrompt, personality, contextWindow
}
```
**Group Firestore document:**
```
groups/{groupId}: {            // groupId is deterministic: g0, g1, g2, ...
  members: [uid, uid, ...],
  memberLabels: { uid: 'p1', uid: 'p2', ... },
  status, finalIdeas, createdAt, votingCompletedAt,
  full                          // true once groupSize members joined (or stragglers started)
}
groups/{groupId}/messages/{messageId}: {
  authorId: string,
  authorLabel: string,   // e.g. 'p1'
  text: string,
  createdAt: serverTimestamp
}
participants/{uid}: {
  ...,
  uid,                          // == doc id; written at join for collection-group lookups
  anonymousLabel: 'p1',
  groupId, status, individualComplete,
  individualStage: 'generation' | 'selection', // individual-phase stage (writing ideas vs picking the ones to carry)
  groupStage: 'ideation' | 'voting',   // group-phase sub-stage, shared so members see where others stand
  votedFor: [ideaId, ideaId, ideaId],  // up to 3 idea IDs
  votesSubmitted: boolean,              // true after clicking "Submit Votes" (or timer auto-submit)
  votedAt: serverTimestamp,
  nudgedAt: serverTimestamp,            // instructor "Nudge" button; shows NudgeBanner
  nudgeAckAt: serverTimestamp,          // participant dismissed the banner
  demographics: { age, gender, nationality, country, levelOfStudy, workExperience, occupation, englishFluency },
  consentGiven: boolean,
  consentTimestamp: string,
  surveyAnswers: { ... },
  surveyCompletedAt: serverTimestamp,
  // ── Timing instrumentation (feeds the export's "Timing" sheet) ──
  individualStartedAt: serverTimestamp, // pressed Start on individual instructions (generation-stage timer anchor)
  individualSelectionStartedAt: serverTimestamp, // first moved to the selection stage (its timer anchor; splits writing vs selecting)
  individualSubmittedAt: serverTimestamp,// pressed Finish & Submit (closes the selection stage)
  groupStartedAt: serverTimestamp,      // pressed Start on group instructions (ideation-stage timer anchor)
  groupVotingStartedAt: serverTimestamp,// first moved to the voting sub-phase (voting-stage timer anchor; splits ideation vs voting)
  timing: {                             // map; Welcome/Registration marks are client epoch ms, the rest serverTimestamp
    welcomeOpenedAt, welcomeAgreedAt,         // client ms (sessionStorage, flushed at registration submit)
    registrationOpenedAt, registrationSubmittedAt, // client ms
    individualOpenedAt, groupOpenedAt, surveyOpenedAt, // serverTimestamp, written once on first entering each page
  }
}
```
**AI Messages Firestore collection:**
```
sessions/{sessionId}/aiMessages/{messageId}: {
  role: 'user' | 'assistant',
  text: string,
  scope: 'individual' | 'group',
  scopeId: string,        // participant UID or groupId
  authorId: string,        // participant UID or 'ai'
  authorName: string,
  timestamp: serverTimestamp,
  // assistant messages only (since June 2026 — older docs lack these):
  provider: 'claude' | 'openai' | 'gemini',
  model: string,
  inputTokens: number | null,   // provider-reported usage (Gemini output includes thoughts)
  outputTokens: number | null
}
```

**Admin:**
- Only admin@admin.com can access /admin routes. Other users are redirected to /join.
- Logging in as admin@admin.com redirects directly to /admin.
- Session delete is allowed only for admin@admin.com (Firestore rule: isAdmin()).
- **Close Session** (Admin.jsx): each Active Session card has a "Close Session" button (after Open / Export data / Test round, before Delete). After a confirm modal it calls `closeSession()` which sets the session's `status: 'done'` + `completedAt` (via `updateDoc`), so the session leaves Active Sessions and appears in Completed Sessions (which filters on `['done','survey']`). The session and all its data are kept (unlike Delete) — read-only for review/export. Lets the admin retire any active session (e.g. abandoned/test sessions) without deleting it. No Cloud Function or rules change needed (instructor already has session update permission via isAdmin()).
- Admin advance button is labelled "Force advance -> [phase]" and is a manual override; most transitions happen automatically.
- Language throughout uses "participants" not "players".
**Admin UI (Admin.jsx + Admin.module.css):**
- Two-column layout: left = Create session form, right = Active/Completed sessions list
- **A session is never edited after it is created** (owner 2026-08: participants may already be playing in it). The session cards have no Edit button and the whole edit path is gone — `editingSession` state, `startEdit`/`saveEdit`/`cancelEdit`, the form's "Edit Session — CODE" title + editing badge, and the "Save Changes / Cancel" form actions. Each section's **Save** button now only confirms the value is captured for the session about to be created ("Saved — used when you create the session."); "Make this the default" / "Restore built-in default" are unchanged. Answer Arena's "Edit name" went in the same change.
- **Session-card buttons are ONE pill family**, carrying the Answer Arena admin's `.aa-btn … sm` geometry verbatim — `font-size:12px`, `padding:7px 11px`, `border-radius:10px`, `font-weight:600`, `line-height:1.4`, nowrap, and a 1px border on every variant (transparent on the filled ones, so a filled pill and an outlined one are exactly the same height). Those numbers are a contract with `lab/answerarena/admin.js` — change them in both or neither. `.sBtn` + a variant — `.sBtnPrimary` (Open), `.exportBtn` (solid green ⬇ Export data), `.sBtnSec` (🧪 Test round), `.closeBtn` (Close Session), `.deleteBtn` (red-outlined Delete, no longer borderless/`margin-left:auto`) — same height, radius, weight and `white-space: nowrap`, in `Admin.module.css`. Active and Completed cards use the same set. A new card button must be `.sBtn` + a variant, never a bare `btn-primary`/`btn-ghost` (their larger padding is what made these rows ragged and wrapped "⬇ Export data" onto two lines).
- **Copy link (session cards).** Beside **Open**, every ACTIVE session card has a **Copy link** button (mirroring the Answer Arena admin) that copies the participant join link for that session and flips to a green "✓ Copied" for ~1.6 s. Completed cards deliberately have none — a closed session is filtered out of the join lookup (`status != 'done'`), so its link would dead-end. The link's two ends live together in **`src/utils/joinLink.js`** (`joinLinkFor` builds it, `joinCodeFromSearch` reads it back, `normalizeJoinCode` is the shared `[A-Z0-9]{,40}` rule) so they cannot drift. Two deliberate choices: (a) it points at the app **root** with the code on the query string — `https://www.stouras.com/lab/ideasearchlab/?code=BALI` — NOT at `/join`, because the root is a real file and such a link never depends on the SPA 404 fallback; `App.jsx`'s "/" → "/join" default therefore carries the query through (`NavigateKeepingQuery` — a bare `<Navigate to="/join">` dropped it); (b) it only **pre-fills** the join field and the student presses Join — it never auto-joins, so they see which session they are entering and a stale link fails on the normal form instead of dead-ending. `?s=` is accepted as an alias (Answer Arena's spelling). The Simulation-Platform handoff remains the ONE silent path, and its code stays hidden because the instructor never handed it out. Clipboard writes fall back to a hidden-textarea copy, then to a `prompt()`. Offline test: `node _ideasearchlab-src/tools/join-link-guard.mjs`.
- **Condition encoding on every session card.** The right-hand meta block of each card (Active AND Completed — one shared `SessionCard`) reads: `N participants` · the working phases **in order** · the session's **condition encoding**. (a) The phase line is built from `getPhaseSequence(phaseConfig)` itself, so it prints "Individual → Group" or "Group → Individual" and can never disagree with the flow participants walk; the old "Individual + Group" read identically for a `group_first` session. (b) The encoding line is a **None / Solo / Group / Both** chip + "AI in neither stage / solo stage only / group stage only / both stages", from **`conditionOf()` imported from `src/utils/sessionExport.js`** — the same function that stamps the `Condition` / `Condition (paper name)` / `AI present in` / `AI Solo (0/1)` / `AI Group (0/1)` columns on every sheet of the Excel/CSV export and that the Data Analytics page regresses on. Importing it (rather than re-deriving the flags from `aiConfig` on the card) is the point: a card and its exported data cannot encode a session differently, and the card inherits the export's phase gating — an `individualAI` flag on a session whose individual phase is off is NOT counted as AI in the solo stage. Chip colours are `.cond_None/.cond_Solo/.cond_Group/.cond_Both` in `Admin.module.css`, mirroring `.cond0…3` in `DataAnalytics.module.css` (grey · accent · blue · green) — keep the two in sync. The `title=` tooltip spells out the encoding, its paper name and where the AI sits.
- **Content editor default buttons:** every page block in the "Page Text & Content" editor has three actions: "Make this the default" (saves that page's current text to the Firestore doc `settings/contentDefaults`, merged per page; future sessions start with it), "Reset this page to defaults" (resets the editor to the effective default = admin-saved if present, else built-in), and "Restore built-in default" (shown only when an admin-saved default exists; deletes it via `deleteField()` and puts the built-in text back). Transient feedback text appears next to the buttons. The same three buttons (shared `DefaultActions` component) also appear under the Registration form and Survey questions builders, stored in the same doc under the `registrationForm` and `surveyQuestions` keys (whole config objects) — covered by the existing contentDefaults Firestore rule, no rules change needed.
- `getEffectiveDefaults(custom)` in defaultContent.js merges the admin-saved defaults over `DEFAULT_CONTENT` field-by-field (empty-safe). Admin.jsx listens to `settings/contentDefaults` with onSnapshot and seeds the create form once on first load. Sessions still snapshot their full contentConfig at creation, so changing defaults later never alters existing sessions (`getContent` intentionally falls back to built-ins only).
- Firestore rule: `allow write: if isAdmin() && docId == 'contentDefaults'` on `settings/{docId}` — must be deployed for the buttons to work.
- **Resizable editors:** block-mode RichTextEditor windows (toolbar + text area) are resizable via a custom corner drag handle (SVG grip + pointer-capture drag in RichTextEditor.jsx that sets inline width/height on `.wrapBlock`; default 340px tall, CSS `min-width: 100%` / `min-height: 180px` so they only grow outward). Native CSS `resize` is NOT used — its grip glyph renders inconsistently/detached across browsers. `.contentGroup` must NOT have `overflow: hidden` (corners are rounded on header/body instead) or rightward growth past the card edge gets clipped. The size resets when a page block is collapsed (component unmounts).
- Each form section has a small 11px hint text (sectionHint class) below the section heading
- cardSubtitle class used under card titles for descriptive text
- **Session details (create form)**: a "Session details" section near the bottom of the create form (just above the Create button) with an optional **Session name** (`e.g. Spring MBA 2026`, stored as `session.name` and shown in the Active/Completed session cards) and an optional **Session ID** custom code. The custom code is a **single word of capital letters and digits** (no spaces/dashes): both the create input and JoinSession input live-normalise with `.toUpperCase().replace(/[^A-Z0-9]/g,'')`, it's validated `^[A-Z0-9]{3,40}$`, and checked for uniqueness via `getDocs(where('code','==',code))` before `addDoc`. Identical normalisation on both ends guarantees the shared code is always typable back in. Blank ID falls back to the auto-generated short code. JoinSession's code input is `maxLength={40}` / min length 3.
- **Per-session Excel export from the session list** (`SessionCard`): every card in
  **Active Sessions AND Completed Sessions** carries a green **⬇ Export data** button
  that downloads that session's full research workbook right there, without opening
  the control room (mirrors the Answer Arena admin, where each session card has its
  own Export data). It calls the SAME shared builder as the control room's "Download
  Excel" — `exportSessionWorkbook(session)` from `src/utils/sessionExport.js` — so the
  two can never produce different files. The button shows "Preparing…" while it
  fetches and prints an inline error under the card if the fetch/write fails
  (`.exportBtn` / `.sessionExportError` in Admin.module.css). The cards hold full
  session docs (`{id, ...data}` from the instructor's own sessions query), which is
  all the builder needs.
- **Test rounds pre-fill the registration form with random data** — see the "Admin
  Test round" note in the main repo's CLAUDE.md; the generator is
  `src/utils/testData.js` (`randomRegistrationAnswers`), applied by Registration.jsx
  only when `isPreview()`.
- After creating a session, a vivid code box appears (createdCodeBox) below the Create button and above Setup Summary, showing the session code with a dashed accent border. No auto-navigation -- admin opens the session from the right panel.
- Code box hint text: "Share this code before your session begins. Participants join at: stouras.com/lab/ideasearchlab" (with clickable link)
- joinHint class shows at the bottom of the Active Sessions panel
- Setup Summary sits below the code box at the bottom of the left card
- CSS module filenames must be Admin.module.css and AdminSession.module.css (dot not underscore) -- GitHub Pages build is case-sensitive

**AdminSession.jsx + AdminSession.module.css (host control room):**
- Header: back button, wordmark, slash, session code, status badge
- **Sessions never auto-close; only 'done' is completed** (owner bug report 2026-08: a groupSize-1 session auto-closed after its single tester finished — but such a session is meant to be played by many independent solo players). `maybeAdvanceSession` caps automatic advancement at 'survey'; `status === 'done'` comes only from the instructor (Close Session, or Force advance survey → done — `isLast` no longer treats 'done'-next as disabled, since that advance IS the close action). Display follows the truth: Admin's Active/Completed lists split on `status === 'done'` alone, a 'survey' session stays in Active Sessions with its real badge plus a green `sessionOpenNote` ("All current participants have finished — the session stays open for new joiners until you press Close Session"), and AdminSession (`isCompleted = status === 'done'`) keeps the live control room in 'survey' with an open-note bar giving the finished tally. Needs `firebase deploy --only functions` for the backend cap; the admin display changes ship with the Pages bundle.
- Phase timeline rendered inside a timelineCard div (not raw text)
- phaseLabel() helper displays human-friendly labels: "group ideation" for group status
- Two-column grid: Participants panel (with breakdown chips and list) + Session Config panel
- **Participants list (live progress)**: sorted by group then anonymous label; each row shows a "G1 · p2" group tag, the name, "ideas ✓/–" (`individualComplete`) and "votes ✓/–" (`votesSubmitted`) ticks, status, and a **Nudge** button (only for participants in 'individual' or 'group'). Nudge writes `nudgedAt: serverTimestamp()` to the participant doc; the participant sees the NudgeBanner until they dismiss it (`nudgeAckAt`). No Cloud Function involved — instructors already have update permission on participant docs.
- **Click-to-expand groups + per-participant messaging**: the Participants panel buckets everyone under per-group headers that are now **collapsed by default** — the header is a toggle button (`expandedGroups` Set + `toggleGroup(key)`); clicking it reveals that group's participant rows. Each group header carries **View** and **Message group** buttons; each participant row still expands (click) to its detail, and the per-participant actions now live **inside that detail** as an action bar (`.pActions`): **Message** (centred window to that one person), **Nudge** (banner, only when in 'individual'/'group'), and **Remove** (two-click confirm). Moving the actions into the detail keeps the collapsed rows clean and avoids the stop-propagation juggling the old inline buttons needed.
- **Live group control (during play)**: View/Message group on the header, Remove inside each participant's detail.
  - **View** (`GroupViewModal` in AdminSession.jsx): a read-only modal that live-subscribes (`onSnapshot`) to the group's ideas (`ideas where groupId == gid`) and group chat (`groups/{gid}/messages`), plus each member's current stage. Instructors are session members, so the existing read rules already allow this — no rules/functions change.
  - **Message** (`sendMessage` + `openMessage(target)` + `messageTarget` state): one composer modal serves both a **whole group** (`{ kind:'group', group }` → writes to every non-removed member) and a **single participant** (`{ kind:'participant', participant }` → writes to just them). It writes `adminMessage = { id: Date.now(), text, from }` to each recipient's participant doc (instructors already have participant-update permission). `AdminBroadcast` (`src/components/AdminBroadcast.jsx`, mounted once in `SessionWrapper` so it rides over every session page) subscribes to the signed-in participant's own doc and pops the message up as a **centred window**; dismissing records `adminMessageAckId` (a newer message id shows again). Per-participant Message buttons appear both in the Participants detail and in the Submitted Ideas list, so the admin can nudge a specific user from wherever they are looking. **Pure frontend** — no functions/rules change, live on the Pages deploy.
  - **Remove** (`removeParticipant` Cloud Function): detaches a participant from their group mid-session even after play has started. The detach logic lives in the shared `detachParticipant(sessionRef, participantId, opts)` helper (also used by `deleteRegisteredUser`): it marks them `removed: true` / `status: 'removed'` / `groupId: null`, removes them from the group doc's `members`/`memberLabels`, and — if the group is still active — pushes a vacancy `{ groupId, label, phase }` onto `session.backfillQueue`. `reconcileGroupAfterRemoval` then advances the group if the removed member was the only one still blocking it (mirrors autoGroupParticipants / finishGroupVoting for the survivors). `removeParticipant` itself just authorizes (instructor of that session) then calls the helper. The removed participant sees a full-screen "you've left this session" overlay (also via AdminBroadcast).
  - **Late-joiner backfill**: `assignToGroup` reads `session.backfillQueue` up front; a brand-new joiner takes the oldest vacancy, joins that exact group with the freed label, and starts at the slot's `phase` (e.g. jumps straight into the individual stage that group is in) — so the late user just registers and lands where the removed participant was. Normal deterministic assignment is untouched when the queue is empty. **Requires `firebase deploy --only functions`** (the frontend View/Message work without it; Remove/backfill need the deployed function).
- Config panel includes "Group phase timer" row showing minutes or "Manual"
- ConfigRow uses CSS module classes (configRow, configLabel, configValue) not inline styles
- Advance bar at bottom: current phase, arrow, next phase, auto-note, Force advance button
- Participant display falls back to anonymousLabel or truncated ID if name is missing
- **Submitted Ideas grouped by group → participant**: the individual-phase confirmation list (shown when the individual phase is active) is laid out group-by-group, reusing the same `groupsOrdered` buckets as the live participant list; within each group every member is listed with their idea count and **Message/Nudge** buttons, then their individual-phase ideas (carried-to-group ones flagged). Ideas are keyed by `authorId` (`ideasByAuthorId`); members with none show "No ideas submitted.", and any author with no matching current participant (later removed/deleted) is shown under a trailing "Former participants" bucket so nothing is dropped.

**Data & Export section (AdminSession.jsx):**
- Sits below the Participants/Config grid, above the advance bar
- Shows three stat boxes: Participants count, Voted count, Surveys completed count
- "Download Excel" button fetches all session data on-demand from Firestore and generates a multi-sheet `.xlsx` file. **The actual workbook is now built by the shared `src/utils/sessionExport.js` (`exportSessionWorkbook`/`buildSessionSheets`), the same builder the Data Analytics "Aggregate Data" step uses — so the single-session export and the aggregate share one identical format. `AdminSession.exportData` is now a thin wrapper around it.**
- Uses the `xlsx-js-style` (SheetJS fork) npm package for client-side Excel generation, so cell styles are written out
- **Every sheet's header row (row 0) is bold** — applied in `autoWidth()` after the column widths, by setting `cell.s.font.bold` on each header cell
- Excel file name: `session_{CODE}_data.xlsx`
- **Analysis-ready / condition-coded export (for AsPredicted #298152, "The Effects of AI Timing on Idea Generation and Selection" — the 2×2 AI-timing study; the idea is the unit of analysis):** the export is shaped so single-session files **stack into one condition-coded dataset**. A `stamp()` helper prepends condition columns to **every** data sheet (all except the static "AI Pricing"): **Session Code**, **Condition** (the Set A / placement encoding — `None`/`Solo`/`Group`/`Both`, derived from `aiConfig.individualAI`/`groupAI` gated by phase-active), **Condition (paper name)** (`Human-Only Hybrid`/`Individual + AI`/`Group + AI`/`Full AI`), **AI present in** (`neither stage`/`solo stage only`/`group stage only`/`both stages`), and machine-friendly **AI Solo (0/1)** / **AI Group (0/1)** dummies (so condition-dummy regressions and the Solo-vs-Group contrast need no string parsing). Encoding map: None=Human-Only Hybrid, Solo=Individual + AI, Group=Group + AI, Both=Full AI. (The old `AI Condition`/`Condition Code`/`AI Solo Stage`/`AI Group Stage` columns were replaced by this encoding.) Clustering on the triad must use **Group UID** (`SessionCode:groupId`) not the bare `Group ID` (g0/g1… repeat across sessions).
- **Sheet "About" (first tab)**: a self-documenting analysis guide (`aoa_to_sheet`) stating this session's condition, the four-condition coding, where each measure lives (DVs → Ideas; selected ideas → Ideas filter / Groups; mechanisms → AI Chat/Usage + Ideas text; moderators → Survey; controls → Participants), and a this-session-at-a-glance tally.
- **Sheet "Conditions" (last tab)**: one stackable summary row per session — n participants, groups, individual/group/carried/final-selected idea counts, AI prompts & replies (solo vs group), survey completers — so stacking several files gives a between-condition overview.
- **Sheet 1 -- Participants**: ID, name, email, anonymous label, group ID, status, individual complete, **votes submitted** (raw flag, back-compat), and the derived vote columns **Votes Cast** (count), **Ballot Status** (`voted` / `partial (n/required)` / `empty (submitted, no votes)` / `not submitted`), **Voted For (idea IDs)** and **Voted For (titles)**, consent, demographics (all fields incl. **Age/Gender controls**), joined at — condition-stamped. The Ballot Status/Votes Cast columns exist because a "submitted" ballot can hold ZERO votes (auto-submitted at group-timer expiry), so `Votes Submitted = Yes` is **not** a safe proxy for "actually voted"; required-votes per group mirrors GroupPhase (`max(1, min(3, group voting-pool size))`). Documented in the "About" sheet too.
- **Sheet 2 -- Ideas (the unit of analysis)**: condition-stamped; one row per idea with **Stage** (`individual (solo)` / `group`), Phase, Group ID, **Group UID** (`SessionCode:groupId` — the triad clustering id), Author ID/Name/**Author Label** (anonymous), Title, Description, Full Text (for semantic-dispersion / search-breadth), **Carried to Group** (renamed from the ambiguous "Selected" — = double-click-selected in the individual phase to carry forward, NOT a final pick), vote count, **Final Group Pick** (Yes/No — in its group's `finalIdeas`), **Final Pick Rank** (e.g. `g2 #1`, top-voted first), created at, **Exclude (Yes/No)** + **Exclusion reason** (the pre-reg "drop nonsensical/empty ideas" screen), and **empty blind-rater DV columns** `Novelty (rater 1..3)` / `Usefulness (rater 1..3)` (multiple raters; aggregate across raters, then Overall Quality = mean(Novelty, Usefulness)) — so the file doubles as the expert-rating sheet. *(Final Group Pick / Final Pick Rank answer "which ideas did each group select after voting" directly from the Ideas sheet.)*
- **Sheet "Votes" (who voted for which idea)**: one row per CAST VOTE — voter x idea, long/tidy form — condition-stamped like every other data sheet. Votes are stored as a `votedFor` ARRAY on the VOTER's participant doc, so before this sheet the workbook could only be read one voter at a time (Participants → `Voted For (idea IDs)`/`(titles)`, a comma-joined cell) or as a bare per-idea tally (Ideas → `Vote Count`); the idea→voters direction did not exist anywhere, which is what a colleague hit in 2026-08 ("we can't see who is voting for each idea"). Columns: Voter ID/Name/Label, Group ID + **Group UID**, Idea ID/Title/Stage, Idea Author ID/Label, **Voted For Own Idea** (Yes/No), **Final Group Pick** + **Final Pick Rank** (so "which members backed the ideas the group actually selected" is one filter), Ballot Position, Votes Cast (this ballot), Required Votes, **Ballot Status**, Votes Submitted (+ At). The Ideas sheet also gained **`Voted By (labels)`/`(IDs)`** beside `Vote Count`, so idea→voters reads where the tally already is. **No data was lost retroactively** — `votedFor` was always stored, so re-exporting an OLD session now yields the full sheet. **A participant who cast no vote has NO row here by construction**: the census of who did and did not vote is Participants → `Ballot Status` (`voted` / `partial (n/required)` / `empty (submitted, no votes)` / `not submitted`), computed by the shared `ballotStatusOf` so the two sheets can never disagree. **Why many ballots come back empty**: `autoSubmitVotes` locks in whatever votes exist when the group timer expires, and in an UNSPLIT (pre-`groupIdeationDuration`/`groupVotingDuration`) session that single clock spans both sub-phases — so a group still in ideation when it runs out has every member stamped `votesSubmitted: true` with an EMPTY ballot, having never seen the voting screen. Signature in the Timing sheet: `Group voting time (s)` ≈ 0 with `Proceeded to voting At` == `Votes submitted At`. Split sessions (the default since the timer split: 15 min ideation + 5 min voting) instead move the group ON to voting when the ideation clock expires, so the voting window is always reached. Secondary cause of `partial` ballots: Submit Votes is gated on `myVoteCount >= requiredVotes` (`max(1, min(3, ideas in the pool))`), so someone who likes only one or two ideas cannot submit at all and is locked as partial when the timer catches them. Offline test: the synthetic-ballot check under `scratchpad/votes-test.mjs` (full / partial / empty / never-submitted, plus condition stamping and aggregate stacking).
- **Sheet 3 -- Survey**: One row per participant who completed the survey. Fixed columns (ID, name, label, completed at) followed by one column per survey question **in the session's own survey order, headed by the question text** (`Q{n}. {text}`) from `getSurveyQuestions(session)` — not the raw answer keys. A `rating_group` expands to one column per criterion (`Q{n}. {text} — {criterion label}`); a radio `followUp` gets its own column (`Q{n}. {prompt}`). Any stored answer key not present in the current survey config is appended at the end under its raw key so nothing is dropped.
- **Sheet "Timing"**: one row per participant capturing how long they spent on / between the key steps, as durations in seconds plus the absolute timestamps. Columns: Joined; **Welcome read (s)** (welcomeAgreedAt − welcomeOpenedAt); **Registration time (s)**; **Individual instructions read (s)** (individualStartedAt − individualOpenedAt) + Individual started; first/last idea, ideas count, and **all idea times** (when each idea was written); **Individual generation time — writing ideas (s)** (individualSelectionStartedAt − individualStartedAt), Proceeded-to-selection, **Individual selection time (s)** (individualSubmittedAt − individualSelectionStartedAt), Individual submitted; **Group instructions read (s)**, Group started, **Group ideation time — adding ideas (s)** (groupVotingStartedAt − groupStartedAt), Proceeded-to-voting, **Group voting time (s)** (votedAt − groupVotingStartedAt), Votes submitted; **First AI message** + AI prompt/reply counts; **Survey time (s)** (surveyCompletedAt − surveyOpenedAt) + Survey completed. `toMs`/`durSec`/`fmtMs` helpers normalise both Firestore Timestamps and the client-ms Welcome/Registration marks; each duration is computed within one clock domain. Per-message AI/idea times also live in the AI Chat / Ideas sheets.
- **Sheet 4 -- Group Chat**: Group ID, author ID, author label, message text, sent at. Sorted chronologically. Fetched from each group's messages subcollection.
- **Sheet 5 -- AI Chat**: Role (user/assistant), scope, scope ID, author ID, author name, message text, model, input/output tokens (assistant rows; blank for messages logged before token tracking), timestamp. Fetched from `sessions/{sessionId}/aiMessages` ordered by timestamp.
- **Sheet "AI Usage"**: token totals per scope (participant UID for individual, groupId for group): AI reply count, input/output/total tokens, model(s) used, true cost in USD and EUR ("as of" date in the column headers), unpriced-reply count, plus TOTAL and AVG PER PARTICIPANT rows -- for budgeting and per-model cost analysis. Costs computed at export time from `src/data/aiPricing.js` (MODEL_PRICES per 1M tokens + USD_TO_EUR snapshot + PRICES_AS_OF date -- update that file when provider prices change).
- **Sheet "AI Pricing"**: the price table and exchange rate the cost columns were computed with, for transparency/reproducibility.
- **Sheet 6 -- Groups**: Group ID, members, member labels, status, final ideas (raw ids), **Final Ideas (titles)** (the same chosen ideas as readable titles, top-voted first, each tagged `[group]`/`[individual]`), created at.
- Column widths auto-fitted based on content (capped at 50 chars)

## Data Analytics page (admin-only, `/admin/data-analytics`)
A research analytics workbench reached from the **"Data Analytics"** button in the
top-right of the Admin header (`Admin.jsx`, next to "AI Settings"). Route added to
`App.jsx`, wrapped in `RequireInstructor` (admin@admin.com only), like the other
`/admin/*` pages. Purpose: test which of the **four AI-timing conditions** wins on
each of **three KPIs** (novelty, usefulness, overall quality), per the study design
in AsPredicted #298152 ("Effects of AI Timing on Idea Generation").

All three admin pages (Admin, Data Analytics, AI Settings) share one consistent top-right
nav: the Instructor badge + theme toggle + three `btn-ghost` links to the **other two**
admin destinations + **Sign out** (Admin → Data Analytics / AI Settings; Data Analytics →
Admin / AI Settings; AI Settings → Admin / Data Analytics), so the header looks identical
across the admin area.

**The four conditions are derived from each session's AI config** (`conditionForSession`
in `src/utils/analyticsData.js`), and encoded with the **Set A / placement** scheme
`individualAI`×`groupAI` → **None** (no AI = Human-Only Hybrid, the regression **reference**),
**Solo** (solo only = Individual + AI), **Group** (group only = Group + AI), **Both** (both =
Full AI). `CONDITIONS = ['None','Solo','Group','Both']`; `CONDITION_INFO`/`paperNameFor` hold the
paper-name mapping; `canonicalCondition` maps the encoding, the paper names and the old
codes/labels → placement. The page shows this mapping in a top-of-page table, the Excel/CSV
exports carry it, and the Python/R templates regress on it (reference = `None`; pandas
`read_csv(keep_default_na=False)` so the string `"None"` isn't parsed as NaN). So a session *is*
a condition — no manual labelling.

A condition-encoding card under the intro shows a **two-column** key — *Encoding* (the
None/Solo/Group/Both tag) · *AI is present in* — centered under the full-width intro text.

Six-step flow on the page (`src/pages/DataAnalytics.jsx` + `.module.css`):
1. **Data source.** Lists **only the instructor's own sessions** — `refreshSessions` queries
   `sessions` with `where('instructorId','==', auth.currentUser.uid)`, the same ownership
   filter the Admin panel uses, so orphan/foreign sessions never appear here (an admin's
   active + completed sessions). Each shows its condition tag;
   tick any completed/active ones and "Load" pulls their ideas/participants/groups and
   flattens to **one row per idea** (`buildRowsForSession`): idea_id, session, condition,
   phase, group_id, author_id, novelty, usefulness, overall_quality, final_pick, text.
   Also **Import Excel/CSV** to append external data. The importer understands the
   admin's own condition-coded Excel export (`AdminSession.jsx`): it reads the
   **Ideas** sheet (not the leading "About" guide), derives the condition from the
   `AI Solo (0/1)` × `AI Group (0/1)` dummies (falling back to the `AI Condition` /
   `Condition Code` label), **averages the blind-rater columns** `Novelty (rater 1..n)`
   / `Usefulness (rater 1..n)` into the KPI scores, maps `Idea ID` / `Session Code` /
   `Stage` / `Group UID` / `Final Group Pick`, and drops rows flagged
   `Exclude (Yes/No) = Yes` (the pre-registered screen). A plain table with
   `condition` / `novelty` / `usefulness` columns still works too
   (`normalizeImportedRows` in `analyticsData.js`).
   - **Format check:** a file that doesn't look like idea data (needs a condition column +
     idea/KPI columns, via `looksLikeIdeaData`) is **rejected with a pop-up** and not imported;
     the same check guards Step 3's "Load scores file".
   - **Deferred load:** an imported file is parsed and shown in the list as its **own ticked
     checkbox row** (`importedBooks` entries carry their parsed `rows` + `selected`), but is added
     to the dataset only when **"Load …"** is pressed — the Load button reads e.g. *"Load 3
     sessions and 1 imported file"*. `loadedBookIds` (derived from `rows._book`) is which imports
     are actually loaded; the Step-2 aggregate uses those. Each imported row has a **Remove**.
   - **"Clear"** here does a full reset (selection + loaded dataset + imported files).
2. **Aggregate Data.** A single **Download aggregate Excel** button (`downloadAggregate`
   in `DataAnalytics.jsx`) consolidates **every loaded source into ONE workbook with the exact
   same multi-tab structure and format as the per-session research export** — *About,
   Participants, Ideas, Survey, Timing, Group Chat, AI Chat, AI Usage, AI Pricing, Groups,
   Conditions* — with each session's rows stacked within every tab (condition-stamped), **plus
   one extra tab, `Rankings`** (one row per idea: *Idea ID, Condition, Stage, Final Group Pick,
   Title, Description* + empty *Novelty / Usefulness / Quality* for blind expert rating). File
   name `idea_analytics_aggregate.xlsx`.
   - **Shared builder (`src/utils/sessionExport.js`).** The per-session export logic was
     extracted from `AdminSession.jsx` into this module — `fetchSessionExportData(session)`,
     `buildSessionSheets(session, data)` (returns the ordered sheet descriptors for all 11
     tabs), `appendSheetsToWorkbook(wb, sheets)`, `exportSessionWorkbook(session)` (single-file
     download, now called by AdminSession), `mergeSessionSheets(sources, aboutMeta)` (stacks the
     same tab across sessions; About replaced by one aggregate guide via `buildAggregateAbout`,
     AI Pricing kept once, Conditions stacks one row per session) and `rankingsSheetFromIdeas()`.
     **Both the per-session "Download Excel" and the aggregate now go through this one builder, so
     they can never drift in format.** The aggregate sources are the **Firestore sessions loaded**
     in Step 1 (`loadedSessions` state — re-fetched in full, incl. group chat + aiMessages) and
     any **imported export workbooks** (`importedBooks` state — Step 1's *Import Excel/CSV* now
     retains every sheet of an imported `.xlsx`, not just the Ideas rows). `bookAboutMeta()` reads
     an imported book's Conditions/Ideas sheet for the aggregate About.
   - **Summary tallies:** three stat boxes — *Ideas generated* (`rows.length`), *Total final ideas*
     (`final_pick == 1`), *Number of sessions* (distinct session codes in the loaded data).
   - **Participants per condition:** a two-column card under the stat boxes (styled like the
     top-of-page encoding key, each encoding as its coloured `condTag` chip) listing all four
     conditions with the number of participants loaded under each (zero-count rows dimmed;
     total in the title). EVERY registered participant counts — including admin-detached
     ones, whose ideas stay in the dataset — so participant and idea tallies share one basis
     (same as the export's Conditions-sheet counts). Firestore-loaded sessions use the real
     head-count captured at Load time (`_participantCount` on `loadedSessions`); a loaded
     imported workbook is counted from its condition-stamped *Participants* sheet; anything
     else (plain CSV import, restored dataset) by distinct idea authors (blank author IDs
     skipped; unrecognised condition labels surface as an "Other" row) — the
     `participantsByCondition` memo in DataAnalytics.jsx.
   - **Scores round-trip:** the Rankings tab's *Novelty / Usefulness / Quality* columns are filled
     from any scores set in Step 3 (mapped by Idea ID via `rankingsSheetFromIdeas(ideaRows, scoreById)`),
     so re-downloading the aggregate after scoring carries the scores back in.
3. **Score ideas (the Rankings rows), manage participants & download.** Works the **Rankings**
   rows of the consolidated Step-2 data. Every idea gets a per-KPI score:
   the configured LLM rates each on novelty + usefulness (**1–5**, the scale
   `RATER_SYSTEM_PROMPT` states and `clamp1to5` enforces), overall = their mean.
   Scoring runs **client-side from the browser** via `src/utils/llmClient.js`, which reads
   the provider key straight from `settings/ai` (admin can read it per Firestore rules —
   no Cloud Function / redeploy needed) and calls Claude/OpenAI/Gemini directly (Claude
   needs the `anthropic-dangerous-direct-browser-access` header). Ideas are batched (8/req),
   results map back by index. The **API provider + specific model** are chosen on-page via two
   dropdowns (catalogue in `src/data/aiModels.js`, now shared with AI Settings); the default
   rater is **Claude Haiku 4.5** (`SCORING_DEFAULT_MODEL` — fast/cheap for bulk scoring), and
   the matching key is read from `settings/ai` (a "no key saved" hint shows if the selected
   provider has none). Scores are also **hand-editable** in the data table; nothing is
   written back to Firestore (admin lacks idea-write permission, and keeping it in-memory
   avoids a rules change). **Manage participants:** a collapsible panel lists every
   participant in the loaded data grouped by session; **Remove** drops all of that person's
   ideas from the table, the summary stats, the regressions, and the downloads (toggle to
   restore — implemented as an `excludedUsers` set deriving `effectiveRows`, so it is
   non-destructive). A **search box** filters the participant list by name / email / user ID
   (rows carry display-only `author_name` + `author_email`). Each row carries a stable `rid`
   so score edits / AI write-back stay correct even when the table shows the filtered view.
   **Load scores file:** a second button reads idea scores from an external ranked-ideas file
   — it locates the **"All Ideas Ranked"** sheet (skipping any preamble to the header row that
   has *Idea Title* + *Novelty* columns) and matches each row's Novelty/Usefulness onto the
   loaded ideas **by normalised title** (`matchScoresIntoRows` in `analyticsData.js`: exact,
   then length-guarded contains; each idea used once), reporting matched/unmatched counts. So
   you can score externally and pull the scores back in, then re-download.
   - **An upload ADDS scores — it never overrides one that is already there** (owner 2026-08).
     A scores file typically carries ideas rated in an earlier sitting (by a past AI rater or
     by hand); both upload paths used to write unconditionally, replacing those scores with
     the file's and **blanking a score outright wherever the file's cell was empty or
     unparseable**. Now each KPI is filled ONLY where the row is still blank AND the incoming
     value is usable — the same rule the LLM run already applied (`scoreUnscored` fills only
     the missing field(s)). It covers **both** paths into the canonical KPI columns:
     `matchScoresIntoRows` (3.2 AI scores, 3.3 evaluator ratings) and
     `matchUploadedKpisIntoRows` (3.1 "Upload additional KPIs", whose `canonicalKpiField`
     routing means a file with a "Novelty" column lands in the AI Novelty column). The one
     deliberate exception: an **`x_…` uploaded-extra column is the file's OWN column**
     (prototypicality, ks, …), so re-uploading it REPLACES it — that is the point of
     re-uploading a corrected file. Both matchers now also return `filled` / `kept` (per-idea
     and mutually exclusive — an idea that gains one KPI while holding the other counts as
     filled), which the page reports: *"scored 12 ideas that had no score yet; kept the
     existing scores of 30 already-scored ideas"*. To change a kept score, edit its cell in
     the Step-3 table — the one deliberate path, stated in the 3.2/3.3 banners.
     Offline test: `node _ideasearchlab-src/tools/analytics-scores-guard.mjs` (no network,
     no deps — imports `analyticsData.js` directly).
   - **The Step-3 table's three AI columns are headed *AI Novelty* / *AI Usefulness* /
     *AI Quality*** (`SORT_GETTERS` labels, used only for that header row), so they read
     unambiguously beside the evaluator (3.3) and objective (3.1) KPI columns appended after
     them. The Excel exports' own column labels are unchanged (*Novelty* / *Usefulness* /
     *Overall Quality*), and `canonicalKpiField` already accepts both spellings, so a
     re-imported workbook still lands in the right columns. **Download:** a
   single summarized **Excel** workbook (`xlsx-js-style`, bold headers) — sheets *Ideas* (the
   per-idea dataset), *Summary by condition* (n + mean/SD/n per KPI), *Summary by session*, and
   *Removed participants* when any — plus a raw-dataset **CSV**. Both reflect the current
   post-removal `effectiveRows`.
   - **A long scoring run never silently leaves rows empty** (owner report 2026-08: "uploaded 435 ideas, asked for AI scores, some rows were empty"). 435 ideas is ~55 sequential API calls, and the old loop lost work four silent ways while the progress bar still read 435/435: **(1)** one failed call **re-threw**, so the caller's `setRows` never ran and every score already collected was discarded — 54 good batches lost to a 429 on the 55th; **(2)** a reply **truncated** by the token limit has no closing `]`, and the array-only parser returned null, losing all 8 ideas of that batch; **(3)** a **short reply** (6 entries for 8 ideas) left the other 2 empty for good; **(4)** a **duplicate `"i"`** overwrote one slot and left a sibling empty. The batching/parsing/retry logic now lives in **`src/utils/scoreBatch.js`** (no Firebase/`fetch` import, so it is testable offline): `extractScoreObjects` salvages the complete `{...}` objects out of an unterminated array, `assignScores` never lets a duplicate or out-of-range index clobber a filled slot, ideas still unscored after the batch call are retried **one at a time** (`singleTries`, because the usual failure is an unreadable REPLY, which the transport retry never sees), transient errors (429/5xx/network) get `withRetry` backoff while fatal ones (401/403/400 — a rejected key fails identically every time) abort at once, and **partial results are always returned**. A dead provider trips a **circuit breaker** (`maxConsecutiveFailures`, 3) instead of grinding all 55 batches through the backoff, and a thrown batch skips the per-idea round (the transport is down, not the ideas). Token ceilings were raised with it — Claude/OpenAI 1500 → 4000, reasoning models 2000 → 8000 (they spend the budget on hidden reasoning FIRST and can return an empty message), Gemini 2000 → 8000 — since truncation was cause (2). The page now **reports the shortfall** instead of showing blank rows: "Scored 431 of 435 ideas. 4 could not be scored this run … press Score again to retry just those", with ideas that have **no text** counted separately (nothing can rate them). Pressing Score again picks up exactly the still-empty ones, since the button's scope is "ideas with no score yet". Offline test: `node _ideasearchlab-src/tools/score-batch-guard.mjs` (33 checks against a fake model — truncated, short, duplicate-indexed, rate-limited and dead-provider replies).
   - **Coming back to a dataset with empty AI cells — the whole loop in one step**
     (owner report 2026-08-25: *"in the past I noticed that some rows had no scores for
     those two columns … I would like to be able to upload my entire data set, and in
     this step, we check how many ideas do not have AI novelty and AI usefulness, and I
     simply press the button to fill them up and update the entire dataset"*).
     `scoreBatch.js` had already stopped a long run LOSING work; three things were still
     missing, and together they are that loop:
     - **Nothing said how big the hole was.** The only number on screen was the Score
       button's own scope count, which follows the Final-Ideas tick — so a dataset with
       24 unscored ideas could read *"Score 0 final ideas with AI"* and look finished.
       3.2 now opens with an always-on **AI score coverage** panel (`scoreGaps`/`gapSummary`
       in **`src/utils/scoreGaps.js`**): *"24 of 741 ideas still need an AI score · 24
       missing AI Novelty · 24 missing AI Usefulness"*, plus a second line when the tick
       is what is hiding a gap ("across the **whole** dataset N still need one"). An idea
       with **no text** is counted APART as `unratable`, never as outstanding — nothing can
       ever rate it, and lumping it in leaves a panel that can never reach zero.
     - **One press did one pass.** `scoreUnscored` now RE-DERIVES what is still empty and
       runs again while each pass keeps filling something (`shouldRunAnotherPass`,
       `MAX_FILL_PASSES` 4). The rule turns on three cases: a pass that filled some and
       left some is working → go again; a pass that reached every idea and filled nothing
       will not read better → stop; a pass `runScoring` **aborted** (its circuit breaker
       trips after 3 consecutive failed batches) never SENT the rest, which on a 93-batch
       run is the usual shape of a rate limit — so that one case gets `MAX_RECOVERY_PASSES`
       (2) more goes with a growing pause (`RECOVERY_WAIT_MS`, 10s × the attempt), the
       button saying *"Waiting for claude to recover…"*. A genuinely dead provider costs
       those few attempts and is then reported as the outage it is.
     - **`scoreIdeas` DISCARDED the abort flag**, so a run that gave up at batch 7 of 55
       with 380 ideas never attempted reported exactly like one that mishandled four
       replies. It now takes an `opts.onReport` carrying `{unscored, blank, failedBatches,
       aborted, lastError}`, and the page says which happened. What WORKED is a neutral
       line; only a real shortfall is red (a run that filled every gap used to be painted
       as a failure through the same error slot).
     - **Upload full dataset (top up AI scores)** — a second upload beside *Load AI scores
       file*. The Step-1/2 importer APPENDS, so re-uploading your own dataset to fill its
       gaps gave you every idea twice; this merges by **Idea ID** (normalised title only as
       the fallback for a file with no id), fills blanks only, and **never appends** an
       unmatched row — the admin's own `ideas_with_kpis` export carried no Session Code and
       no author columns, so appending its rows would file real participants' ideas under a
       nameless "imported" session. Unmatched rows are REPORTED with what to do instead.
       With nothing loaded the file simply BECOMES the dataset, through the same
       `importedBooks` bookkeeping Step 1 uses (its own removable source row, every sheet
       kept for the Step-2 aggregate).
     - **`downloadIdeasWithKpis` now carries the identity columns** — Session Code, Group
       UID, Author ID/Name/Email, Carried to group, Full Text — so that round trip is
       lossless. Every one is a header `normalizeImportedRows` already reads and the KPI
       sweeps already skip, so nothing else about the workbook changes.
     - **One definition of "has text".** `scorableText` in `scoreGaps.js` is used by BOTH
       `hasIdeaText` (which decides an idea is unratable) and the page (which decides what
       to send the rater). They must not drift: the page used to build the rater's text as
       `r.text || ideaText(r)`, and `ideaText` reads `title`/`description` where a dataset
       row carries `idea_title`/`idea_description` — so a row with only a title would have
       been counted as fillable and sent as an EMPTY STRING, scored by nobody for ever
       while the panel went on offering to fill it. The guard caught it, and pins it.
     - **A pass that scored NOTHING must not escape the loop.** `scoreIdeas` throws
       when a run came back empty (`lastError && unscored === scores.length`) — which
       is precisely the case the recovery rule exists for, so the throw would have
       skipped it in the worst situation of all. The pass now catches around
       `scoreIdeas` and treats a non-fatal throw as an aborted pass; a FATAL one
       (`isFatalScoringError`) still stops the run at once, since retrying a rejected
       key only makes the admin sit through the pauses before being told what is
       wrong. `isFatalApiError`/`isFatalScoringError` moved from `llmClient.js` into
       **`scoreBatch.js`** for that: it is the module that owns what is worth
       retrying, and — unlike llmClient, which imports Firebase — a guard can load
       it. A missing key is tagged `.fatal` at the throw site, since it carries no
       HTTP status. `aborted` is `report?.aborted || threw`: scoreIdeas ALSO throws
       when every batch was attempted and every one failed, which the circuit
       breaker never sees, so the report alone would reset the flag to false and
       skip the retry.
     - **A partial idea with no text is `unratable`, not fillable.** One score and no
       text (an imported ratings sheet with no titles) cannot have its other column
       filled either — counting it as fillable puts a number on the panel that
       pressing the button can never bring down, and makes the run report it as "the
       model's reply could not be read" when nothing was ever sent. `ideaScoreState`
       therefore tests the text BEFORE splitting missing from partial.
     - **An auto-generated `import_<n>` id never joins two files.**
       `normalizeImportedRows` invents one for a file with no Idea ID column, and
       those are POSITIONS, not identities: two unrelated files both start at
       `import_1`, so `mergeAiScoresIntoRows` joining on one would confidently write
       the third row of one file onto the third row of another. `joinableId` drops
       them and lets the title match decide.
     - **The scores are not always on the sheet called "Ideas"** (found in the owner's
       own two exports, 2026-08-25). The admin's AGGREGATE workbook is 13 tabs and
       keeps the halves apart: **Ideas** holds the raw session rows — session,
       author, votes, and the blind-rater columns, which are EMPTY — while the AI
       scores live on **Rankings**. Measured on the real 741-idea export: `Ideas`
       carried 0 of 741 AI values, `Rankings` 741 of 741. So the top-up preferring
       the sheet literally named "Ideas", the way the Step-1 importer does, read the
       one sheet of that workbook with no scores on it and would have reported
       "filled 0" and looked broken. `pickScoredSheet` chooses by CONTENT — the
       sheet must identify its rows (an Idea ID or a Title) and wins on how many AI
       values it actually carries; blind-rater columns and the 3.1 objective KPIs
       are deliberately not counted, and with nothing scored anywhere the
       identifiable "Ideas" sheet still wins (the plain `ideas_with_kpis` case, and
       the Step-1 behaviour). The chosen sheet is NAMED in the message, so it is
       always visible where the scores came from.
     - **A round trip through the aggregate workbook does NOT carry the AI scores
       back in**, and that is worth knowing rather than fixing blind: the Step-1/2
       importer reads the Ideas tab, so re-importing an aggregate export brings the
       ideas in UNSCORED and the next run re-scores them all. That is why the
       owner's August file shows 174 of 435 July scores changed — a re-score by the
       same rater (r = 0.85/0.88, means 2.83→2.86 and 3.03→3.04, 99% within one
       point), not a mis-join: all 435 Idea IDs matched with identical titles. The
       3.2 top-up is the path that carries them across.
     - Offline test: **`node _ideasearchlab-src/tools/score-gaps-guard.mjs`** (60+ checks, no
       network) — the coverage arithmetic, the scope toggle, the merge rules (id beats a
       changed title, a duplicate file row is not a second match, an empty cell never blanks
       a stored score, nothing is appended), the pass rule, and an END-TO-END run of the
       owner's own scenario through the REAL `runScoring`: 741 ideas with 24 empty, against
       a healthy model, a transient outage that aborts the first pass, a dead provider, and
       a model returning short batches.
   - **Score scope toggle (`scoreOnlyFinal`, default ON):** a checkbox **"Only score the Final
     Ideas"** scopes the AI scoring to the group-selected ideas (`final_pick == 1`) — the set
     Step 5 analyses — or, unticked, to every idea. The button label + count adapt
     (`scopeUnscored`). The data table now also shows a **Final** column (Final Group Pick Yes/No)
     and the *Quality* header (= `overall_quality`), so it reads as the Rankings view. Scores set
     here feed the Step-2 aggregate Rankings tab and the Step-5 regressions.
   - **Sortable table:** each header is clickable (`toggleSort`/`sortedRows`/`SORT_GETTERS`) and
     cycles ascending → descending → original order; the active column shows ▲/▼.
   - **"Clear"** here is scoped to THIS step: it wipes the KPI scores + the regression run/insights
     (so Steps 5–6 empty) but leaves the loaded dataset and Sections 1–2 intact.
4. **Summary Statistics.** Descriptive stats of the consolidated Step-3 data (`statRows`):
   stat boxes (ideas analysed, final ideas, sessions, conditions with data, mean quality), a
   per-condition table (n ideas / final / scored + each KPI's mean (SD) via `summarize()`), and
   a stage breakdown (individual vs group, final-pick rate). A checkbox **"Only include ideas
   scored on all 3 KPIs"** (`statsOnlyScored`, **default on**) restricts every figure to
   fully-scored ideas.
5. **Regressions — edit & compile online.** Runs on the **group-selected Final Ideas only**
   (`effectiveRows.filter(final_pick == 1)` → `dataCsv`; the guard needs ≥2 scored final ideas) —
   "currently we compare conditions for the ideas the group selected after the group phase; other
   subsets may be added later". **Unbalanced design handled:** the conditions have different n
   (e.g. None~27/Solo~39/Group~33), so both templates fit every OLS/LPM with **HC3
   heteroscedasticity-robust SEs** (Python `cov_type='HC3'`; R has a base-R `hc3_coef()` helper
   since WebR has no `sandwich`), print each condition's n, and drop a condition with < 2 ideas
   for a KPI from that KPI's split models — **dummy AND rows**, so a tiny condition can never
   pool into the None baseline. Both print `rows used for analysis: N` (read by the page for the
   Step-6/PDF header). The plots use **large fonts**, annotate every value, and explain
   what they show (a caption appears above them in Step 6 and the PDF). Two tabs, **Python** and
   **R**, each pre-filled
   with a complete script (`src/data/analyticsPython.py` / `analyticsR.R`, inlined via Vite
   `?raw` in `analyticsTemplates.js`) that runs the SAME analysis: paper-style **Tables 3–6**
   (one OLS/`lm` column per KPI on the Any-AI dummy and on the condition dummies, Human-Only =
   baseline, plus top-rating linear-probability models), the **primary planned contrast
   Individual + AI − Group + AI** per KPI,
   then an **INSIGHTS** section that reads the results back in plain language (per-KPI
   best→worst ranking of the conditions + a DATA-COVERAGE CHECK that flags any of the four
   conditions with no data, e.g. "Full AI", and excludes it from the rankings), and plots
   (mean±95%CI bars + coefficient/forest plot). Both scripts are heavily commented and load
   the **scored step-2 dataset** (the same rows as the "Download CSV/Excel" summary, including
   each idea's final scores). Note: statsmodels `t_test().effect`/`.sd` can be 2-D, and the
   NumPy in current Pyodide refuses `float()` on a non-0-D array — the Python template uses an
   `_s()` helper (`float(np.ravel(...)[0])`) for every scalar extraction. The admin edits the code and hits
   **Run**: Python compiles in-browser via **Pyodide** (`src/utils/pyodideRunner.js`,
   loads numpy/pandas/scipy/statsmodels/matplotlib; harvests open matplotlib figures as PNG
   data URLs) and R via **WebR** (`src/utils/webrRunner.js`, base R only; CSV mounted at
   `/tmp/data.csv`; base-graphics captured via `captureR({captureGraphics:true})`). Output
   (with p-values) streams to a console; plots render below. Both runtimes load lazily from
   jsDelivr on first Run (Pyodide `v314.0.1`, WebR `0.6.0`, each with same-API version
   fallbacks), so they add ~0 KB to the main bundle. **Entirely client-side — ships with a
   normal Pages build, no Cloud Functions or Firestore-rules change.**
6. **Insights gained.** A readable, formatted write-up of the Step-5 results so the admin no
   longer has to squint at the monospace console. On every Run the page snapshots the run
   (`lastRun = { lang, code, output, images, ranAt }`); `parseRunOutput()` in
   `src/utils/insightsReport.js` splits the console text at the `# INSIGHTS` banner into the
   **regression results** (everything before it) and the **INSIGHTS** block, then
   `parseInsights()` structures that block — the data-coverage warning, conditions-with-data,
   and per-KPI {best→worst ranking chips, each condition vs the no-AI baseline with
   significance coloured, the AI-timing contrast sentence, best/worst}, plus the cross-KPI
   ranking summary table. `InsightsPanel` (in `DataAnalytics.jsx`) renders this with large
   easy-to-read fonts and shows the **plots full-width** (`.plotGridLarge`). The parser is
   tolerant: a custom edit that drops the INSIGHTS section falls back to the raw text. An
   **Export PDF** button (`exportInsightsPdf`) opens a print-ready document built by
   `buildInsightsPrintHtml()` (self-contained HTML + inline CSS, the figures embedded as their
   data-URL PNGs) in a new window that auto-fires `window.print()` → the browser's "Save as
   PDF". The PDF carries the formatted insights + large figures, then **Appendix A — Regression
   results** (the verbatim stats the insights are read from) and **Appendix B — Python/R code**
   (the exact script that produced them, for whichever tab was last run). No new npm dependency
   (uses native print-to-PDF), no Cloud Functions / rules change — pure client-side.

**Per-section Save / Make-default / Restore (browser-local).** Each section (data source,
dataset, and each code tab) has the admin-style three-button row (`SectionActions` in
`DataAnalytics.jsx`): **Save** and **Make this the default** both persist that section's
current value to `localStorage` (session selection / the scored rows+removed-participants /
the active tab's code) and the clicked button **flashes green** for ~2s (the admin's
`#2e7d32`); **Restore built-in default** clears the saved value (and resets a code tab to its
bundled template). Saved values are reloaded on page open (a `useEffect` reads the `LS.*`
keys). Browser-local by design — no Firestore-rules change. (`userKey()` joins
session+author with `|`; session codes `[A-Z0-9]` and Firebase UIDs never contain it.)

**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated in session.js re-syncs session status via maybeAdvanceSession (capped at 'survey'; sessions close only by instructor action)

**A finished participant is NEVER dragged back (`functions/phaseGuard.js`).** A
group advances TOGETHER — `finishGroupVoting`, `autoGroupParticipants` and
`reconcileGroupAfterRemoval` each wrote `{ status: nextPhase }` onto EVERY
member — but members reach the survey individually (the GroupPhase self-heal,
or Force advance) and the survey is short, so a fast participant can be `done`
minutes before the slowest member of their group submits their votes. When that
last vote landed, the trigger rewrote the whole group to 'survey' and DEMOTED
the finished one. Observed in session SGP1 (2026-08-13): zhangqiong finished
their survey at 06:01:34, g13's last member voted at 06:04:29, and the doc was
left carrying a complete `surveyAnswers`+`surveyCompletedAt` beside
`status: 'survey'` — the admin read them as still working and the Simulation
Platform's "Verify from Ideation Challenge" offered to REVOKE their ✓ (same for
Zhang Pan in g5, 25 s apart). Every group-wide write now goes through
`shouldSetStatus(participant, nextPhase, sequence)`, which applies two rules:
a participant who has **completed the survey is terminal** (the survey is the
last step, so a stored survey IS completion whatever `status` says), and
otherwise nobody moves **backwards** in that session's own phase sequence
(individual_first and group_first order the phases differently, hence the
sequence argument rather than a global rank table). **Needs
`firebase deploy --only functions`.** The readers ship with the Pages bundle and
carry the same truth: `src/utils/participantStatus.js`
(`hasCompletedSurvey`/`participantIsDone`), `participantStageLabel` reads it
before `status`, the Registered-Users panel shows such a session as `done`, and
`healFinishedParticipants` REPAIRS the already-written records — Admin.jsx runs
it once per session per visit, AdminSession.jsx once per control-room open
(reporting "Marked N participant(s) as finished"). The platform's own
`simulation/admin/verify.js` counts a stored survey as done for the same reason.
Offline test: `node _ideasearchlab-src/tools/phase-guard.mjs`.

**SPA routing:** 404.html at root of konstantinosStouras.github.io catches unknown paths and redirects to /lab/ideasearchlab/?redirect=... The inject step in deploy.yml injects a script into index.html that reads the redirect param and restores the URL.
**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width. **The AI panel follows the chosen theme** (owner report 2026-08: in dark mode the assistant stayed cream-coloured). It used to be painted `background: var(--ink); color: var(--paper)` — i.e. always the INVERSE of the page, which reads as a dark sidebar in light mode but flips to a *light* panel in dark mode, since `--ink`/`--paper` swap. `AIChat.module.css` now paints from its own `--ai-*` tokens (defined in `src/styles/globals.css` under BOTH `:root` and `[data-theme="dark"]`, beside the palette): `--ai-panel-bg`, `--ai-line`, `--ai-bar-bg`, `--ai-bubble-bg`/`-border`, `--ai-field-bg`/`-border`, `--ai-dim`/`--ai-faint`, `--ai-grip`, `--ai-scroll-thumb`, `--ai-code-bg`, `--ai-pre-bg`, `--ai-quote-line`/`-fg`, `--ai-badge-bg`/`-fg`, `--ai-sent-fg`. Every hardcoded `rgba(255,255,255,…)`/`rgba(245,242,235,…)` overlay in that stylesheet (which silently assumed a dark backdrop) was replaced by one of them, and its text colours are now `var(--ink)`. **Add new AI-panel colours as `--ai-*` token pairs, never as a bare white/black overlay** — an overlay tuned for one theme is invisible in the other. The whole-panel `background`/`color` also carry `var(--theme-transition)` so toggling fades like the rest of the app. Note when screenshotting a theme switch: that 0.2 s transition means a capture taken immediately after flipping `data-theme` shows the old colours mid-fade. The AI chat input (AIChat.jsx) **auto-grows** with its content — height is set in JS from the textarea's `scrollHeight` on every change (min-height 52px, auto-grow capped ~240px then scrolls), so a long message stays fully visible instead of scrolling inside a 2-row box. It also has a **draggable top handle** (`.resizeHandle`): dragging it up/down sets an explicit `userHeight` that overrides the auto-grow (kept sticky until dragged again, clamped 52px–min(460, 60vh)). The textarea is wrapped in a flex-column `.inputWrap` (handle on top, textarea below); the CSS `max-height` was removed so height is fully JS-controlled. The input is **never disabled while the AI is thinking**, so participants can keep typing their next question during a reply; submitting is still gated on `sending` (send button + `handleKeyDown`) so requests don't overlap. **Scroll stick-to-bottom:** the message list only auto-scrolls to the newest message when the user is already at/near the bottom (`stickRef`, set from an `onScroll` distance check; instant `scrollTop = scrollHeight`, not smooth `scrollIntoView`). So scrolling up to re-read a long reply no longer gets yanked back down when a snapshot re-fires; sending a message forces stick back on so the user sees their message + the reply.

**DemoTour (`pages/DemoTour.jsx`):** the pre-registration walkthrough. `SceneVoting` must destructure `clock` (it renders a mock timer) — a missing destructure threw a render-time ReferenceError that blanked the whole app near the tour's end and forced a refresh. A small `SceneBoundary` error boundary now wraps each dynamic scene: if any scene throws it shows a quiet placeholder and the tour keeps auto-advancing (Skip/Start stay usable), instead of unmounting the React root to a blank page.

**Theme inversion — the one pattern to watch.** Two surfaces were painted
`background: var(--ink); color: var(--paper)`, i.e. always the INVERSE of the
page. That reads as intended in light mode but *flips* under
`[data-theme="dark"]`, because `--ink`/`--paper` swap: the surface turns light
while everything around it goes dark. Both are fixed, in the two ways such a
surface can be fixed — and which one applies is a design question, not a
mechanical one:
- **The AI assistant panel** (`AIChat.module.css`) is a full pane, so it must
  FOLLOW the theme: light panel in light mode, dark in dark mode. It paints
  from `--ai-*` tokens declared under both `:root` and `[data-theme="dark"]`
  (see the split-screen note above).
- **The `/login` branding hero** (`Login.module.css` `.left`) is a brand panel
  whose whole job is to contrast with the sign-in form beside it; making it
  light in light mode would leave a light hero next to a light form and erase
  the design. So it is PINNED to the branded dark surface in both themes via
  `--login-hero-bg` / `--login-hero-fg` / `--login-hero-dim`, declared in
  `:root` only and deliberately **not** re-declared under `[data-theme="dark"]`
  — a dark override is exactly what made it flip. Light mode renders
  identically to before (the token values are the old light-mode
  `--ink`/`--paper`); in dark mode the hero sits a step below the form side's
  `--paper`, so the two halves stay distinct. `.sub`'s hardcoded
  `rgba(245,242,235,0.6)` and the `.decoration` SVG's `currentColor` went to
  the same tokens, since both assumed a dark backdrop.

Still deliberately inverted, and fine: the small `.role` instructor chips
(Admin / AISettings / DataAnalytics) and GroupPhase's `.timeNudgeCard` toast —
each is a small contrast element that stays legible whichever way it lands.

**To deploy any frontend change:**
```
cd C:\Users\User\Documents\GitHub\ideasearchlab
git add .
git commit -m "your message"
git push
```
GitHub Actions handles the rest automatically.
**To redeploy Cloud Functions:**
```
cd C:\Users\User\Documents\GitHub\ideasearchlab
firebase deploy --only functions
```
Note: Firebase detects unchanged functions and skips them. If a redeploy is skipped unexpectedly, add a trivial comment change to force detection.

**Conditional AI text (`[AI]` marker):** any paragraph/list item/heading in instructor-editable content whose text starts with `[AI]` is shown only when AI is enabled (marker stripped from display); when AI is off the whole line is removed (`applyAiCondition` in RichText.jsx, driven by the `aiOn` prop). Works on ALL content pages: Individual and Group instructions/briefs use their own phase's flag (individualAI / groupAI), while Welcome, Registration, Lobby, Survey and Done show `[AI]` lines if either flag is on. The `/done` route is wrapped in SessionWrapper so the Done page renders the session's custom completion text (and AI flags) instead of built-ins. Replaces the old "(Remove this line if AI is turned off.)" manual editing. Editor hints mention it.

**Key learnings and gotchas:**
- Firestore transactions (db.runTransaction) do NOT support query reads (tx.get with .where()). Only document reads (tx.get(docRef)) work inside transactions. Use batch writes instead when queries are needed.
- Firestore read-after-write race condition: querying immediately after a .set() may not include the just-written document. Fix by passing the new document's ID explicitly and injecting it into the result if missing.
- JoinSession and GroupPhase both had transaction bugs fixed by replacing transactions with query-then-batch pattern.
- Every phase page (SessionLobby, IndividualPhase, GroupPhase, Survey) has a real-time onSnapshot listener on the participant's own document that navigates automatically when status changes. This is the core routing mechanism.
- Session closed/deleted end message: `useSessionEnded()` (SessionContext.jsx) returns true once the SessionProvider snapshot resolves and the session is either closed (`status === 'done'`) or deleted (doc gone, `session === null`). SessionLobby, IndividualPhase, GroupPhase and Survey each call it and `return <Done />` when ended, so when the instructor force-advances to done or deletes the session, participants in any phase immediately see the existing end message instead of being stranded (deleted → built-in done text via `getContent(null)`; closed → the session's custom done text). It returns false while still loading so pages show their own loading state first.
- Dynamic AI model name in instructions ({aiModel}): the AI notes in the Individual/Group instructions+briefs use a `{aiModel}` placeholder that resolves to the friendly name of the model configured in the admin AI panel. Participants cannot read `settings/ai` (it holds API keys), so `saveAISettings` mirrors the non-secret provider+model (and a `modelLabel`) to `settings/aiPublic` on every save (using the `MODEL_LABELS` map in functions/ai.js). Firestore rule: `settings/aiPublic` is readable by any signed-in user, writable only via the Admin SDK. `useAIModelLabel()` (SessionContext.jsx) subscribes to that doc and is passed into both pages' `contentVars`; it falls back to "Anthropic's Claude Sonnet 4.6" (the app default) when the doc is missing or unreadable, so the note is never blank/wrong before the functions+rules are deployed. NOTE: this needs `firebase deploy --only functions,firestore:rules` to go fully dynamic — until then the fallback default shows.
- GroupPhase handles both ideation and voting as client-side sub-phases via a `subPhase` state toggle. The participant's Firestore status stays 'group' throughout. There is no separate 'voting' status in Firestore.
- Voting uses `votedFor` array on participant documents (not on idea docs). Vote counts are derived client-side by iterating all group members' votedFor arrays. This avoids needing special Firestore rules for cross-user idea updates.
- `tallyGroupVotes()` in session.js is called by `advancePhase` when transitioning group->survey. It reads all participants' votedFor arrays, tallies votes, and stores top 3 as finalIdeas on group docs.
- Downloaded file changes must be manually copied into the local repo before committing -- Claude cannot push to GitHub directly.
- CSS module filenames are case-sensitive on the GitHub Pages build server. Always use dots not underscores (Admin.module.css not Admin_module.css).
- Native `<select>` dropdown arrows render oversized at some browser zoom levels/platforms. The RichTextEditor toolbar selects use `appearance: none` plus a small fixed-size SVG chevron background instead.
- Native `<input type="checkbox">` renders with a heavy/oversized default border on some platforms (looked "weird" in the admin FormBuilder). Fix is to set `accent-color: var(--accent)` plus a fixed `width`/`height` (15px) — same treatment Registration consent checkboxes already use. Applied to `.checkRow input[type="checkbox"]` in FormBuilder.module.css.
- Browser cache can mask deployed changes. Use Ctrl+Shift+R or incognito to verify.
- Git tags used for lightweight version snapshots; CLAUDE.md at repo root for project context onboarding.
- autoGroupParticipants session-advance check must account for all group members in the current batch, not just the triggering participant. Using only change.after.id causes the check to fail for groups of 2+ because the other members still show old status in Firestore before the batch commits.
- Atomic writeBatch operations fail entirely if any single write fails. For operations mixing critical updates (participant status) with non-critical ones (idea selection flags), separate them into independent calls so the critical path succeeds even if the non-critical batch fails due to missing Firestore rules.
- GroupPhase individual ideas filter must fall back to "latest N by createdAt" when no ideas have `selected: true`, to handle the case where the selection batch failed due to Firestore rules.
- The `xlsx-js-style` npm package must be installed (`npm install xlsx-js-style`) for the admin export to work. It's a client-side dependency used in AdminSession.jsx. (Plain `xlsx` works for data but cannot write bold headers — its writer drops `cell.s` styles.)

## Files changed in latest session (voting client-side, chat, data export)

**Updated files:**
- `src/pages/GroupPhase.jsx` + `.module.css` -- complete rewrite: two client-side sub-phases (ideation/voting), "Proceed to Voting" button, "Submit Votes" button with lock, merged idea list in voting mode, group chat panel, vote badges, phase tags
- `src/pages/IndividualPhase.jsx` -- removed `voting` status navigation (voting phase no longer exists)
- `src/pages/AdminSession.jsx` + `.module.css` -- added Data & Export card with Excel download (6 sheets including AI Chat), removed voting-specific config rows
- `functions/session.js` -- removed 'voting' from `getPhaseSequence`, added `tallyGroupVotes()` called on group->survey transition, removed voting participant status case from `advancePhase`

**Resolved housekeeping (previously listed as pending):**
- `src/utils/phaseSequence.js` no longer contains 'voting' (in sync with backend)
- The dead `/session/:sessionId/voting` route and the retired `VotingPhase.jsx` + `VotingPhase.module.css` files have been removed
- Firestore security rules deployed: participant self-update, idea author edit/delete, group chat messages, admin write to settings/contentDefaults
- `phaseConfig.votingDuration` (the original, never-used voting timer) was dropped from the session form and from `DEFAULT_CONFIG`; group voting now has its own real timer, `groupVotingDuration`. Old sessions may still carry `votingDuration`, it is ignored

**Orphaned Cloud Functions (still deployed, safe to delete):**
- `autoAdvanceOnTimer` -- no longer in local source code, Firebase will prompt to delete on next deploy
- `submitVote` -- still exported from voting.js but no longer called by the frontend

**Static assets needed:**
- `public/images/sleep-mask-example.png` -- example product image for task brief (gracefully hidden if missing)

**Current status:** Full flow deployed: group ideation/voting as client-side sub-phases with chat, automatic phase transitions (group voting completion, timers with default decisions, group_first/individual-only individual->survey), instructor nudges, live progress visibility for participants and instructor, admin-editable content defaults, resizable editors, [AI]-conditional text on all pages, Excel export.

**Next steps when resuming:**
1. End-to-end test of the full participant flow (group size 1 for solo, short timers)
2. Add sleep mask image to public/images/
3. Optionally clean up orphaned Cloud Functions (autoAdvanceOnTimer, submitVote)

## Simulation Platform integration — the ACCOUNT-FREE student flow

Owner decision 2026-08: students never see an account screen or the
registration form ("each user plays once by entering a code"). The
participant flow is now: `/join` (code, pre-filled from the platform
handoff) → welcome → tour → SILENT registration → lobby/phases.

- **`src/utils/simplatform.js`** — reads the platform launch handoff
  (`localStorage 'simp:handoff:v1'`, same origin, sim === 'ideasearchlab',
  ≤6 h old), mints the silent login and maps registration fields onto the
  platform profile (by default field id, then by label).
- **`RequireStudent`** (ProtectedRoute.jsx) wraps `/join` and every
  `/session/*` route: a visitor with no session gets a **silent THROWAWAY
  e-mail/password account** (synthetic `student-…@simplatform.stouras.com`
  address + random password, displayName = the student's real name;
  "Preparing your session..." while it mints; falls back to `/login` only
  if creation fails). **Deliberately NOT Firebase anonymous auth:** the
  deployed `joinSession` writes `{ name, email }` from the auth token and
  the Admin SDK rejects `undefined` — an anonymous user (no email claim)
  crashes it server-side; the synthetic account keeps the deployed backend
  untouched. `/login` remains for instructors (and `/history` keeps
  `RequireAuth`).
- **Registration.jsx**: on a platform launch it maps the session's
  registration fields from the handoff profile and — when every required
  field is covered — **submits invisibly** ("Setting up your session...")
  and proceeds; the participant doc also records the student's REAL
  name/e-mail/ID under `platform` (the login e-mail is synthetic). Consent
  statements are **bypassed on a platform launch** (owner decision
  2026-08): the silent submit carries them as granted and stamps
  `consentVia: 'simulation-platform'` on the participant doc so the data
  shows HOW consent was given (the old consent-only card was removed). No
  handoff, or an unmappable required field → the normal form (consents
  ticked by the student), pre-filled where possible.
- `index.html` (the Vite template) still loads `/simulation/prefill.js`
  (`SIMP_EXPECT` guard, off on `/admin`) as a belt-and-braces fallback for
  any visible form. The tag rides through every rebuild.
- **Play-once gate:** the `Done()` component (Survey.jsx) calls
  `window.simpMarkCompleted()` in a mount effect (guarded by `!isPreview()`,
  and the function only exists on a genuine platform launch), so the
  platform's card shows "✓ Completed" and blocks a second play of the same
  run. Rebuild-sensitive — the platform smoke's marker preflight checks the
  shipped bundle still carries the call. **Only on `<Done completed />`** —
  the same screen is what EVERY phase page renders when the instructor closes
  the session (`useSessionEnded`), so an unguarded stamp ticked students who
  were still mid-phase (and blocked their retake). The instructor-side
  reconciliation applies the matching rule: a CLOSED session's participants
  count as complete only with a submitted survey or demonstrable
  participation (an idea they authored, or a vote cast) — never on
  `votesSubmitted`/`individualComplete` alone, which the phase timers set with
  empty content.
- **A direct-link student's REAL identity is resolved and healed
  (`src/utils/participantIdentity.js`).** The throwaway login means a student
  who opened the app from a direct URL (no platform handoff — owner 2026-08:
  sessions SGP2/SGP3/ATHENS were played that way) lands on the participant doc
  as displayName "Student" + `student-…@simplatform.stouras.com`, while the
  name/e-mail/student ID they actually typed sit under `demographics`, keyed by
  the session's own `registrationConfig` field ids. `participantIdentity.js`
  (deliberately IMPORT-FREE so `tools/identity-guard.mjs` runs it under plain
  Node) is the ONE resolver: `identityFields(session)` classifies the
  registration fields (the default form's `ucdStudentId`, plus admin-added
  fields by label — Student/Participant ID, Full/First/Last Name, E-mail — the
  same label discipline as `simplatform.js`'s LABEL_MAP, and the same rules the
  platform's `simulation/admin/verify.js` adapter applies on ITS side, so keep
  the two in sync); `realIdentity`/`displayName`/`displayEmail` prefer the
  platform block, then the registration answers, then a non-placeholder doc
  value. **Displays**: AdminSession's participant rows/detail + Submitted-Ideas
  bylines and Admin's Registered-Users panel (real e-mail + name shown first,
  the throwaway shown small as "login: …"; search covers both) resolve through
  it, and every `Name`/`Email` column of the Excel export (`sessionExport.js`)
  does too — the raw `Platform *` columns stay raw. **Heal**:
  `healParticipantIdentities` (in `participantStatus.js`, beside the
  finished-status heal, run once per session per visit by Admin.jsx AND once
  per control-room open by AdminSession.jsx, which reports "Filled in the real
  name / e-mail / student ID of N participants") writes `identityRepairFor`'s
  payload onto the doc: fill-empty ONLY — doc `name`/`email` only while they
  still hold the placeholders, `platform.studentId`/`platform.name`/
  `platform.email` via dotted paths only while empty (a handoff's record always
  wins and its `source: 'simulation-platform'` is never relabelled; a filled
  block is stamped `source: 'in-app-registration'`), junk e-mail answers never
  written, idempotent (a healed doc computes null). Instructor-permitted by the
  deployed rules (isSessionInstructor updates any participant of their
  session) — no rules or functions change. Filling `platform.studentId` is
  what makes the platform's "Verify from Ideation Challenge" and the export's
  Platform columns agree; the verify adapter ALSO reads `demographics`
  directly, so verification never waits on this heal. **A participant with no
  resolvable NAME is labelled by their STUDENT ID, never "Student"** (owner
  2026-08-16: the DEFAULT registration form asks no name — its one identity
  field is "UCD Student ID" — so a direct-link session resolves no name for
  anyone and every admin row read "Student"): `displayNameOrId` (name → student
  ID → doc value) is what the participant LISTS render — AdminSession's rows +
  Submitted-Ideas bylines, and the Registered Users panel, which shows
  "Student ID NNNNNNNN" in the name slot (and as a small line under a known
  name; search matches the ID too), while the expanded participant detail
  gained an explicit "Student ID" row. Deliberately NOT the export's Name
  columns — a student ID is not a name, and the workbook carries the ID in its
  own column. Offline test:
  `node _ideasearchlab-src/tools/identity-guard.mjs`.
- **"0 ideas" in the Submitted-Ideas panel says what the participant DID do.**
  That list is individual-phase only, so someone who wrote only group ideas,
  voted, or completed the survey read as a no-show ("No ideas submitted") —
  while the platform correctly ticked them, which is exactly the mismatch the
  owner reported (2026-08). Each participant now carries a **finished ✓** chip
  when their survey is in (`participantIsDone`), and the empty line reads
  "No individual ideas — 2 group ideas · 3 votes cast · survey submitted." or,
  when there really is nothing, "No ideas submitted, and nothing else recorded
  for this participant."
