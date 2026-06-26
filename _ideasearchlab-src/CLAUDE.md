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
- listRegisteredUsers: admin-only callable. Returns every Firebase Auth account (uid, email, displayName, creationTime, lastSignInTime) so the instructor can see who signed up, including users who never joined a session. The client SDK cannot list Auth users, so this goes through the Admin SDK. Lives in `functions/users.js`.
- deleteRegisteredUser: admin-only callable (`functions/users.js`). Permanently removes ONE registered Firebase Auth account by uid. Before deleting the account it detaches that user from every session where they're an **active** participant, via the shared `detachParticipant(sessionRef, uid, { activeOnly: true })` helper in session.js — so each affected group keeps playing with one fewer member (n-1) under the same parameters (mirrors `reconcileGroupAfterRemoval`, advances a group if the removed member was the only blocker, queues a backfill vacancy while in play). Participants who already finished (`survey`/`done`) keep their records so their exported data is preserved. Guards the admin account and the caller's own uid. **Requires `firebase deploy --only functions`** to work (the frontend button calls this callable).
- deleteAllRegisteredUsers: admin-only callable. Bulk-deletes every Auth account except the admin/caller (leaves participant docs).
- advancePhase: instructor-controlled override for any phase transition (manual "Force advance" button). Calls `tallyGroupVotes()` whenever leaving the group phase (next is survey for individual_first, individual for group_first). When forcing group -> individual (group_first), participants still in 'group' are moved to 'individual'.
- autoGroupParticipants: Firestore trigger on individualComplete flipping true. individual_first: when all members of a group complete individual phase, moves them to group phase (session auto-advance accounts for all group members being moved in the batch, not just the triggering participant). group_first or individual-only: the individual phase is the last working phase, so the finished participant moves straight to 'survey' on their own, and the session advances to 'survey' once everyone is in survey/done.
- handleStragglers: callable -- starts the partly-filled last group whose members are still 'waiting' in the lobby (every participant already has a deterministic group from join, so it just moves the waiting members into the first phase and marks their group full).
- sendAIMessage: calls LLM, stores response in `sessions/{sessionId}/aiMessages`
- saveAISettings: saves global AI provider settings
- submitVote: legacy Cloud Function, still deployed but no longer called by the frontend. Voting now happens via direct Firestore writes from GroupPhase.jsx.
- onParticipantUpdated: Firestore trigger with two jobs. (1) When a participant's `votesSubmitted` flips to true, `finishGroupVoting()` checks whether every member of that group has submitted; if so it tallies that group's votes (top 3 -> `finalIdeas`), marks the group 'done', moves the members to the next phase in the sequence (survey for individual_first, individual for group_first), and advances the session status once every participant has moved past the group phase. This is how groups reach the survey automatically -- "Force advance" remains the manual override. (2) When a participant's status becomes 'done', checks if all participants are done and advances session status to 'done'.
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page. Saved keys reload into the page on every visit (password fields + "saved ✓" tags). `saveAISettings` is admin-only (admin@admin.com) and accepts partial updates — sending `null` clears a field back to its built-in default. Firestore rule: ALL `settings/*` reads are `isAdmin()` (participants must never read settings/ai — it holds the API keys; Cloud Functions use the Admin SDK and bypass rules). The AI Settings page's Model, Parameters and System Prompt sections each have the standard three default buttons (Make this the default / Reset this page to defaults / Restore built-in default) doing per-section partial saves. Model lists in AISettings.jsx updated June 2026 (Claude Opus 4.8/Fable 5/Sonnet 4.6/Haiku 4.5, GPT-5.5/5.4/5.2, Gemini 3.5/3.x/2.5); provider defaults in functions/ai.js: claude-sonnet-4-6, gpt-5.5, gemini-3.5-flash. callClaude omits `temperature` for Opus 4.7+/Fable/Mythos (they 400 on sampling params) and reads the first text block (thinking blocks may come first); callOpenAI uses `max_completion_tokens` and no temperature for gpt-5*/o* reasoning models. Session aiConfig.model defaults to null = defer to global AI Settings.
**Session flow:** waiting -> individual -> group -> survey -> done (order and active phases configurable per session). Note: 'voting' was removed from the backend phase sequence. Voting now happens client-side as a sub-phase within GroupPhase.

## Participant onboarding flow
The participant join flow now has four steps before reaching the session lobby:
1. **JoinSession** (`src/pages/JoinSession.jsx`): Enter session code. Validates code client-side via Firestore query. If participant is new, navigates to Welcome. If already registered (rejoining), skips directly to SessionLobby.
2. **Welcome** (`src/pages/Welcome.jsx` + `Welcome.module.css`): Displays study overview with dynamic phase descriptions based on session's `phaseConfig`. Adapts text for individual-first, group-first, individual-only, or group-only configurations. Amazon Voucher paragraph only shown when group phase is active. "I agree and continue" button navigates to Registration.
3. **Registration** (`src/pages/Registration.jsx` + `Registration.module.css`): Collects demographics (Age, Gender, Nationality, Country, Level of Study, Work Experience, Occupation, English Fluency) plus two consent checkboxes. Nationality and Country use dropdown menus with full 195-country list. Work Experience is a number input validated 0-50. On submit, calls `joinSession` Cloud Function, then writes demographics to participant doc via `updateDoc`. Data stored as `demographics` object + `consentGiven` + `consentTimestamp` on participant document.
4. **SessionLobby**: Existing page, unchanged.

Routes added to `App.jsx`: `/session/:sessionId/welcome` and `/session/:sessionId/register`, both wrapped in SessionWrapper.

### Timing instrumentation
The app records how long participants spend on the key steps, surfaced in the export's **Timing** sheet. The tricky part: **Welcome and Registration run before the participant doc exists** (it's created at Registration submit via `joinSession`), so those marks are collected client-side in `sessionStorage` (`src/utils/timing.js`: `markTiming`/`readTiming`/`clearTiming`, keyed by session, client epoch ms) and **flushed onto the participant doc as `timing.*` at Registration submit** (then cleared). Everything after the doc exists is written with `serverTimestamp()` directly to the participant doc: `timing.individualOpenedAt` / `timing.groupOpenedAt` / `timing.surveyOpenedAt` are written once on first entering each page (guarded by a `useRef` + a `!data.timing?.X` check so they capture the FIRST entry); `individualStartedAt` / `groupStartedAt` on Start; `groupVotingStartedAt` on first moving to voting (in `goToStage('voting')` + `autoSubmitVotes`). All are self-updates on the participant's own doc, so no Firestore rules change is needed. The export computes each duration within one clock domain (client-ms pairs or server pairs) so a client/server offset never skews a duration.

## Accounts: user activity panel + admin user visibility
- **Profile menu** (`src/components/ProfileMenu.jsx` + `.module.css`): account dropdown in the top-right of the participant-facing headers. Shows the avatar/name; opens to "My activity & statistics" (→ `/history`), "Join a session" (→ `/join`), and "Log out". Closes on outside-click / Escape. Replaced the old plain name + Sign-out buttons.
- **HeaderControls** (`src/components/HeaderControls.jsx` + `.module.css`): the shared top-right cluster = `<ThemeToggle/>` + `<ProfileMenu/>`. Rendered on EVERY participant-facing page so the light/dark toggle (default light) and the signed-in account menu stay present throughout the whole flow — JoinSession, Welcome, DemoTour, Registration, SessionLobby, the Individual/Group instruction screens AND their workspaces (added into each `.topBar`'s `.topRight`), Survey, and the Done screen (pinned via a fixed `.doneControls` wrapper since Done has no header). The standard page headers are `position: sticky; top: 0` so the controls stay visible while scrolling. UserHistory keeps its own ThemeToggle+ProfileMenu.
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
- **Instructions page**: Full-page card with study instructions, dynamic duration from `individualPhaseDuration`, task checklist, group-phase warning (conditional).
- **Collapsible Task Brief**: Shown in workspace, contains the sleep wellness product design prompt, example product with image (`public/images/sleep-mask-example.png`), evaluation criteria (Novelty, Feasibility, Financial Value, Overall Quality), AI note (conditional), and selection instructions.
- **Structured idea submission**: Two fields, "Idea title" and "Description", rendered in pill-shaped cards (border-radius: 20px) with bold title, gradient separator line, and smaller description text. Pressing **Enter** in either field submits the idea (the same as clicking Add); **Shift+Enter** in the Description inserts a newline. Same behaviour in the GroupPhase "Group Ideas" add form.
- **Inline editing**: Pencil icon appears on hover, click enters edit mode with editable fields + Save/Cancel.
- **Delete**: Trash bin icon appears on hover (red on hover), calls `deleteDoc`.
- **Double-click selection**: Double-click toggles idea selection for group carry-over. Selected cards get accent border, glow, and "Selected" badge. Selection bar shows count ("Selected ideas: 2 / 3"). Maximum controlled by `ideasCarriedToGroup`.
- **Finish & Submit**: Disabled until at least one idea is selected. Does participant `updateDoc` first (critical), then idea selection batch separately (non-critical, fails gracefully if Firestore rules missing).
- **Group progress strip**: always-visible bar under the top bar (when a group exists and has >1 member) showing "Group progress: X / Y submitted" plus a chip per member (anonymous label, green ✓ once `individualComplete`). Gives participants visibility of where the rest of their group stands while they work — both to engage those waiting and to signal to the bottleneck that others are done.
- **Static image**: Example sleep mask image at `public/images/sleep-mask-example.png`. The `<img>` tag hides itself via `onError` if file not found.
- **Per-participant timer (starts on Start)**: the individual-phase countdown is per-participant, not the shared session timer. Pressing **Start** on the instructions screen writes `individualStartedAt: serverTimestamp()` to the participant doc; the PhaseTimer counts the full `individualPhaseDuration` from that moment, so every participant gets their full time from when they actually begin (no longer already ticking from the shared `phaseStartedAt` while they read). On the instructions screen the timer renders in a non-ticking **preview** mode (PhaseTimer `preview` prop — shows the full duration, no countdown, no `onExpire`). A reload restores the workspace (skips instructions) and continues the same timer because `individualStartedAt` is read from the participant snapshot (`setStarted(true)` when present). Trade-off vs. the old shared timer: a participant who never clicks Start has no countdown and won't auto-submit, so the instructor's Force advance / handleStragglers covers that edge case.
- **Timer default decision**: once started, when the phase timer expires `autoFinish()` submits whatever exists — if nothing was double-click selected it auto-selects the latest `ideasCarriedToGroup` ideas first, and it submits even with zero ideas, so one participant can never stall their group. The manual Finish button keeps its stricter `canFinish` gate.
- **Nudge banner**: `<NudgeBanner />` (src/components/NudgeBanner.jsx) shows a "please wrap up" banner in two cases. Manual: the instructor nudges this participant (`nudgedAt` on the participant doc); dismissing writes `nudgeAckAt`, and a newer nudge shows it again. Automatic: the page passes `autoMessage` when this participant is the bottleneck — IndividualPhase when every OTHER group member has `individualComplete` but they haven't submitted; GroupPhase when every other member has `votesSubmitted` but they haven't. Auto-dismissal is local-only; an instructor nudge takes precedence over the auto text. Solo participants (no other members) never auto-nudge. Rendered on the instructions screens and workspaces of both phases.
- **Navigation**: Listens for status changes via onSnapshot. Navigates to group, survey, or done. The old `voting` navigation was removed since voting is no longer a separate phase.

## GroupPhase.jsx (major update -- two client-side sub-phases with chat)
GroupPhase handles two sub-phases via a client-side `subPhase` state toggle ('ideation' or 'voting'). This is purely a UI toggle per participant, not a Firestore status change. The participant's Firestore status stays as 'group' throughout.

Each participant's sub-phase is mirrored to their participant doc as `groupStage` ('ideation' | 'voting'), written by `goToStage()` — and also set to 'ideation' the moment they press **Start** on the group instructions screen (`startGroup()`), so the admin and other members can tell "reading instructions" (no `groupStage`) from "ideating". Pressing Start also records a **per-participant timer start** `groupStartedAt` (serverTimestamp), and the group timer now counts the full `groupPhaseDuration` from that moment — mirroring the individual phase, so each member gets their full time from when they actually start rather than from the shared phase start. The group instructions screen therefore shows the timer in non-ticking **preview** mode; the ideation and voting workspaces count down from `groupStartedAt`. A reload restores the workspace (skips instructions) when `groupStage` or `groupStartedAt` is set, and restores the voting sub-phase if `votesSubmitted`. Member chips in BOTH sub-phases show each member's live stage so the group always knows where everyone stands: plain chip = still ideating, small "voting" tag = picking votes, green ✓ = votes submitted.

Like IndividualPhase, GroupPhase has a **two-view structure**: an instructions screen (full-page card with Start button, rendered from contentConfig `group.instructions`, supports `{minutes}` and `{votes}` placeholders) shown first, then the workspace. Both phases' instructions screens render the PhaseTimer (header, right) and the NudgeBanner. Both now show the timer in non-ticking **preview** mode on the instructions screen, because both countdowns are per-participant and only start when the participant presses Start (`individualStartedAt` / `groupStartedAt`). Trade-off: a participant who never clicks Start has no countdown and won't auto-submit, which the instructor's Force advance / handleStragglers covers. Inside the workspace a **collapsible Task Brief** (contentConfig `group.brief`, shown in both sub-phases) replaced the old single-field intro banner (`group.body`). The admin Content editor's Group phase block accordingly has the same two sections as the Individual phase: "Instructions screen (before Start)" and "Task brief (inside the workspace)". Legacy sessions that stored a custom `group.body` banner fall back to showing it as the task brief (handled in `getContent` in defaultContent.js).

### Group Ideation sub-phase (default)
- **Title**: "Group Ideation Phase"
- **Top right**: Timer + "Proceed to Voting" button (accent pill)
- **Left column**: Individual Ideas (selected/carried from individual phase), chronological order
- **Right column**: Split vertically into Group Ideas (top, ~45% height by default with add form) and Group Chat (bottom, fills remaining space)
- **Resizable regions**: the ideation workspace columns are a flex row with a draggable `ResizeDivider` (`src/components/ResizeDivider.jsx`) between the Individual Ideas column and the Group Ideas+Chat column (drag left/right), and a second `ResizeDivider` between Group Ideas and Group Chat (drag up/down). The parent (GroupPhase) holds `leftColPct` / `groupIdeasPct` state and applies them as inline `flex-basis`; the divider only reports the dragged-to %, so the overall structure is unchanged. Group-only sessions get just the left/right column divider. The main app↔AI split stays the existing `SplitLayout` divider.
- Title + description submission form (dashed-border pill card) for adding group ideas
- **Group-only sessions** (no individual phase, `phaseConfig.individualPhaseActive === false`): there are no individual ideas to show, so the layout adapts — the **Group Ideas list + add form become the primary left column** and Group Chat takes the right column (instead of rendering an empty "Individual Ideas" panel). The shared `groupIdeasList` JSX (ideas + add form) is reused across both layouts. This fixes the "one user in the group phase, no idea showing" feedback where a lone participant in a group-only session saw an empty primary column.

### Group Voting sub-phase (after clicking "Proceed to Voting")
- **Title**: "Group Voting Phase"
- **Top right**: Timer + vote counter (0/3) + "Submit Votes" button (disabled until 3 votes, locks votes on click)
- **Left column**: ALL ideas merged (individual + group) in one scrollable list, sorted by votes descending. Each pill shows a small "individual" or "group" phase tag.
- **Right column**: Group Chat only, taking full column height (no Group Ideas header)
- Double-click any idea pill to toggle a vote (max 3 per participant). **Required vote count adapts**: `requiredVotes = max(1, min(3, totalIdeaCount))`, so a small or solo group can still unlock "Submit Votes" when fewer than 3 ideas exist (the vote counter shows `/ requiredVotes`). Normal sessions with ≥3 ideas are unchanged at 3.
- Votes stored as `votedFor` array on the participant's own document (direct `updateDoc`), not on idea docs
- Vote counts derived in real-time by iterating all group members' `votedFor` arrays (from the existing members onSnapshot listener)
- "Votes: N" badge shown on idea pills that have votes
- Voted pills get accent border + glow. Maxed-out pills get dimmed opacity
- After clicking "Submit Votes": writes `votesSubmitted: true` and `votedAt` to participant doc, locks the UI (double-clicks ignored), button replaced by green "Votes submitted" badge
- Member chips show checkmark next to members who have submitted votes
- Compact voting hint text with inline "Back to ideation" link
- Chat remains active during voting
- **Timer default decision**: when `groupPhaseDuration` expires (timer shown in both sub-phases), `autoSubmitVotes()` locks in whatever votes the participant currently has (possibly none) and flips them to the voting view. With every member locked, the `finishGroupVoting` backend trigger tallies and advances the group — so a timed group phase always ends on schedule.
- **Vote self-heal (no more frozen voting screens)**: moving from group voting to the next phase no longer depends solely on the single `finishGroupVoting` trigger fired by the *last* submitter. At scale (many groups voting at once, or all members auto-submitting together at timer expiry) that one server round-trip could be delayed or dropped, freezing the other members on "Votes submitted" while only the last submitter (who self-navigated client-side) moved on. Fix: GroupPhase has a `useEffect` self-heal — once this member has `votesLocked` and **every** member of the group has `votesSubmitted`, the participant writes their **own** `status: nextAfterGroup` (allowed by the existing owner-update rule; the status listener then navigates them). So each member advances itself; no group can stall. The backend still tallies `finalIdeas` via `finishGroupVoting` when its trigger fires, and Force advance remains a backstop. Complementary backend backstop: `maybeAdvanceSession` (in `onParticipantUpdated`, runs on any participant status change) monotonically advances `session.status` to the furthest phase ALL active (non-removed) participants have reached, so the session reaches survey/done and never sticks on 'group' even if a per-group trigger was missed. **The freeze fix is purely client-side (live on the Pages deploy); `maybeAdvanceSession` needs `firebase deploy --only functions`.**

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
- **surveyQuestions.js** (`src/data/surveyQuestions.js`): Completely rewritten with 12 questions across 4 sections:
  - "Your Experience" (Q1-Q4): difficulty, satisfaction, idea rating group, collaboration comfort
  - "Creativity and Idea Generation" (Q5): supporting others' ideas
  - "Reflection" (Q6-Q7): two freetext questions
  - "Questions about sleep wellness" (Q8-Q12): importance, activities, product purchases, interest, prior experience
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
- Session status auto-advances from survey->done via onParticipantUpdated trigger when all participants have status 'done'

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
  individualPhaseDuration, groupPhaseDuration, votingDuration
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
  individualStartedAt: serverTimestamp, // pressed Start on individual instructions (also the timer anchor)
  groupStartedAt: serverTimestamp,      // pressed Start on group instructions (group timer anchor)
  groupVotingStartedAt: serverTimestamp,// first moved to the voting sub-phase (splits group ideation vs voting)
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
- **Close Session** (Admin.jsx): each Active Session card has a "Close Session" button (next to Open/Edit, before Delete). After a confirm modal it calls `closeSession()` which sets the session's `status: 'done'` + `completedAt` (via `updateDoc`), so the session leaves Active Sessions and appears in Completed Sessions (which filters on `['done','survey']`). The session and all its data are kept (unlike Delete) — read-only for review/export. Lets the admin retire any active session (e.g. abandoned/test sessions) without deleting it. No Cloud Function or rules change needed (instructor already has session update permission via isAdmin()).
- Admin advance button is labelled "Force advance -> [phase]" and is a manual override; most transitions happen automatically.
- Language throughout uses "participants" not "players".
**Admin UI (Admin.jsx + Admin.module.css):**
- Two-column layout: left = Create/Edit session form, right = Active/Completed sessions list
- **Content editor default buttons:** every page block in the "Page Text & Content" editor has three actions: "Make this the default" (saves that page's current text to the Firestore doc `settings/contentDefaults`, merged per page; future sessions start with it), "Reset this page to defaults" (resets the editor to the effective default = admin-saved if present, else built-in), and "Restore built-in default" (shown only when an admin-saved default exists; deletes it via `deleteField()` and puts the built-in text back). Transient feedback text appears next to the buttons. The same three buttons (shared `DefaultActions` component) also appear under the Registration form and Survey questions builders, stored in the same doc under the `registrationForm` and `surveyQuestions` keys (whole config objects) — covered by the existing contentDefaults Firestore rule, no rules change needed.
- `getEffectiveDefaults(custom)` in defaultContent.js merges the admin-saved defaults over `DEFAULT_CONTENT` field-by-field (empty-safe). Admin.jsx listens to `settings/contentDefaults` with onSnapshot and seeds the create form once on first load. Sessions still snapshot their full contentConfig at creation, so changing defaults later never alters existing sessions (`getContent` intentionally falls back to built-ins only).
- Firestore rule: `allow write: if isAdmin() && docId == 'contentDefaults'` on `settings/{docId}` — must be deployed for the buttons to work.
- **Resizable editors:** block-mode RichTextEditor windows (toolbar + text area) are resizable via a custom corner drag handle (SVG grip + pointer-capture drag in RichTextEditor.jsx that sets inline width/height on `.wrapBlock`; default 340px tall, CSS `min-width: 100%` / `min-height: 180px` so they only grow outward). Native CSS `resize` is NOT used — its grip glyph renders inconsistently/detached across browsers. `.contentGroup` must NOT have `overflow: hidden` (corners are rounded on header/body instead) or rightward growth past the card edge gets clipped. The size resets when a page block is collapsed (component unmounts).
- Each form section has a small 11px hint text (sectionHint class) below the section heading
- cardSubtitle class used under card titles for descriptive text
- **Session details (create form)**: a "Session details" section near the bottom of the create form (just above the Create button; shown only when creating, not editing) with an optional **Session name** (`e.g. Spring MBA 2026`, stored as `session.name` and shown in the Active/Completed session cards) and an optional **Session ID** custom code. The custom code is a **single word of capital letters and digits** (no spaces/dashes): both the create input and JoinSession input live-normalise with `.toUpperCase().replace(/[^A-Z0-9]/g,'')`, it's validated `^[A-Z0-9]{3,40}$`, and checked for uniqueness via `getDocs(where('code','==',code))` before `addDoc`. Identical normalisation on both ends guarantees the shared code is always typable back in. Blank ID falls back to the auto-generated short code. JoinSession's code input is `maxLength={40}` / min length 3.
- After creating a session, a vivid code box appears (createdCodeBox) below the Create button and above Setup Summary, showing the session code with a dashed accent border. No auto-navigation -- admin opens the session from the right panel.
- Code box hint text: "Share this code before your session begins. Participants join at: stouras.com/lab/ideasearchlab" (with clickable link)
- joinHint class shows at the bottom of the Active Sessions panel
- Setup Summary sits below the code box at the bottom of the left card
- CSS module filenames must be Admin.module.css and AdminSession.module.css (dot not underscore) -- GitHub Pages build is case-sensitive

**AdminSession.jsx + AdminSession.module.css (host control room):**
- Header: back button, wordmark, slash, session code, status badge
- **Completed sessions read as "done"**: a session only reaches the `survey` status once *every* participant has moved past the group phase, and it is then filed under Completed Sessions — so a lingering `survey` badge (e.g. one straggler who never finished the survey) looked like work was still happening. AdminSession derives `isCompleted = status === 'done' || 'survey'`; when completed the header badge and phase timeline read **done** (timeline fully filled, DONE highlighted), the Force-advance bar is replaced by the completion note, and that note is honest about any straggler ("30 of 31 finished the survey; 1 still had it open."). The Admin list's completed-session card badge maps `survey → done` the same way. Pure display — the stored `session.status` is untouched (Close Session still sets `done`).
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
- "Download Excel" button fetches all session data on-demand from Firestore and generates a multi-sheet `.xlsx` file
- Uses the `xlsx-js-style` (SheetJS fork) npm package for client-side Excel generation, so cell styles are written out
- **Every sheet's header row (row 0) is bold** — applied in `autoWidth()` after the column widths, by setting `cell.s.font.bold` on each header cell
- Excel file name: `session_{CODE}_data.xlsx`
- **Sheet 1 -- Participants**: ID, name, email, anonymous label, group ID, status, individual complete, votes submitted, voted for (comma-separated IDs), consent, demographics (all fields), joined at
- **Sheet 2 -- Ideas**: ID, title, description, full text, author, phase, group ID, selected flag, vote count (tallied from participants' votedFor arrays), created at
- **Sheet 3 -- Survey**: One row per participant who completed the survey. Fixed columns (ID, name, label, completed at) followed by one column per survey question **in the session's own survey order, headed by the question text** (`Q{n}. {text}`) from `getSurveyQuestions(session)` — not the raw answer keys. A `rating_group` expands to one column per criterion (`Q{n}. {text} — {criterion label}`); a radio `followUp` gets its own column (`Q{n}. {prompt}`). Any stored answer key not present in the current survey config is appended at the end under its raw key so nothing is dropped.
- **Sheet "Timing"**: one row per participant capturing how long they spent on / between the key steps, as durations in seconds plus the absolute timestamps. Columns: Joined; **Welcome read (s)** (welcomeAgreedAt − welcomeOpenedAt); **Registration time (s)**; **Individual instructions read (s)** (individualStartedAt − individualOpenedAt) + Individual started; first/last idea, ideas count, and **all idea times** (when each idea was written); **Group instructions read (s)**, Group started, **Group ideation time — adding ideas (s)** (groupVotingStartedAt − groupStartedAt), Proceeded-to-voting, **Group voting time (s)** (votedAt − groupVotingStartedAt), Votes submitted; **First AI message** + AI prompt/reply counts; **Survey time (s)** (surveyCompletedAt − surveyOpenedAt) + Survey completed. `toMs`/`durSec`/`fmtMs` helpers normalise both Firestore Timestamps and the client-ms Welcome/Registration marks; each duration is computed within one clock domain. Per-message AI/idea times also live in the AI Chat / Ideas sheets.
- **Sheet 4 -- Group Chat**: Group ID, author ID, author label, message text, sent at. Sorted chronologically. Fetched from each group's messages subcollection.
- **Sheet 5 -- AI Chat**: Role (user/assistant), scope, scope ID, author ID, author name, message text, model, input/output tokens (assistant rows; blank for messages logged before token tracking), timestamp. Fetched from `sessions/{sessionId}/aiMessages` ordered by timestamp.
- **Sheet "AI Usage"**: token totals per scope (participant UID for individual, groupId for group): AI reply count, input/output/total tokens, model(s) used, true cost in USD and EUR ("as of" date in the column headers), unpriced-reply count, plus TOTAL and AVG PER PARTICIPANT rows -- for budgeting and per-model cost analysis. Costs computed at export time from `src/data/aiPricing.js` (MODEL_PRICES per 1M tokens + USD_TO_EUR snapshot + PRICES_AS_OF date -- update that file when provider prices change).
- **Sheet "AI Pricing"**: the price table and exchange rate the cost columns were computed with, for transparency/reproducibility.
- **Sheet 6 -- Groups**: Group ID, members, member labels, status, final ideas, created at.
- Column widths auto-fitted based on content (capped at 50 chars)

**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated trigger in session.js detects all-done and advances session to 'done'

**SPA routing:** 404.html at root of konstantinosStouras.github.io catches unknown paths and redirects to /lab/ideasearchlab/?redirect=... The inject step in deploy.yml injects a script into index.html that reads the redirect param and restores the URL.
**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width. The AI chat input (AIChat.jsx) **auto-grows** with its content — height is set in JS from the textarea's `scrollHeight` on every change (min-height 52px, auto-grow capped ~240px then scrolls), so a long message stays fully visible instead of scrolling inside a 2-row box. It also has a **draggable top handle** (`.resizeHandle`): dragging it up/down sets an explicit `userHeight` that overrides the auto-grow (kept sticky until dragged again, clamped 52px–min(460, 60vh)). The textarea is wrapped in a flex-column `.inputWrap` (handle on top, textarea below); the CSS `max-height` was removed so height is fully JS-controlled. The input is **never disabled while the AI is thinking**, so participants can keep typing their next question during a reply; submitting is still gated on `sending` (send button + `handleKeyDown`) so requests don't overlap.

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
- `phaseConfig.votingDuration` is no longer shown in the session form (voting is a sub-phase of the group timer); old sessions may still carry the field, it is ignored

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