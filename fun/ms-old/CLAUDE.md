# CLAUDE.md - Ideation Challenge (ideasearchlab)

## Project Overview

Structured group ideation research app for academic sessions. Participants brainstorm individually, collaborate in groups, vote, and complete a post-session survey, with optional AI assistance at configurable phases.

**Live URL:** stouras.com/lab/ideasearchlab  
**Repo:** github.com/konstantinosStouras/ideasearchlab  
**Local path:** C:\Users\User\Documents\GitHub\ideasearchlab

## Stack

- **Frontend:** React + Vite, CSS Modules
- **Backend:** Firebase (Firestore, Auth, Cloud Functions Node 20, europe-west1)
- **Deployment:** GitHub Actions to GitHub Pages (subdirectory: /lab/ideasearchlab/)
- **Excel export:** `xlsx` (SheetJS) npm package
- **AI providers:** Anthropic Claude, OpenAI GPT, Google Gemini (keys stored in Firestore via admin settings page at /admin/ai-settings)

**Firebase project ID:** ideasearchlab  
**Admin account:** admin@admin.com

## Phase Architecture

Session flow: `waiting` -> `individual` -> `group` -> `survey` -> `done`

- `'voting'` was removed from the phase sequence in backend logic.
- **GroupPhase** uses client-side sub-phases (`subPhase` state: `'ideation'` and `'voting'`), no Firestore status change between them.
- **Ideation sub-phase:** Individual Ideas (left), Group Ideas + WhatsApp-style group chat (right).
- **Voting sub-phase:** All ideas merged and sorted by vote count (left), group chat full-width (right). Max 3 votes per participant. Votes stored as `votedFor` array on participant doc. "Submit Votes" writes `votesSubmitted: true`. `tallyGroupVotes()` called on instructor advance from group to survey, stores top 3 as `finalIdeas`.
- Group chat stored in Firestore subcollection: `sessions/{sessionId}/groups/{groupId}/messages`
- Separate VotingPhase page retired; its route now renders GroupPhase.

## Cloud Functions (europe-west1)

joinSession, advancePhase, autoGroupParticipants, sendAIMessage, saveAISettings, autoAdvanceOnTimer, submitVote

**Orphaned (to clean up):** autoAdvanceOnTimer, submitVote

## AI Assistant

Active in Individual Phase. Split-screen 58/42 layout with draggable divider. Supports Anthropic Claude, OpenAI, Gemini.

## Admin Panel

AdminSession.jsx includes Excel export with 6 sheets: Participants, Ideas, Survey, Group Chat, AI Chat, Groups.

## Key Patterns and Gotchas

- **Firestore security rules are a silent failure mode.** Deletes, edits, selection persistence, Finish & Submit, and group chat have all failed due to rules issues without obvious errors. Always verify rules deployment when a feature silently does nothing.
- **`writeBatch` should not mix critical and non-critical operations.** If a batch fails, all writes fail.
- **Transactions do not support query reads (`.where()`).** Only document reads work inside Firestore transactions. Use query-then-batch pattern instead.
- **GroupPhase idea filter must fall back to latest-N** when `selected` flags were never persisted.
- **Race conditions at join time:** `tryFormGroup` must explicitly include the joining participant's UID in the count.
- **CSS module filenames are case-sensitive on GitHub Pages.** Use dots not underscores (e.g. `Admin.module.css` not `Admin_module.css`).
- **`joinSession` must be called via Cloud Function**, not direct Firestore write, to avoid bypassing `tryFormGroup`.
- **npm packages must be installed before GitHub Actions build.** Missing packages cause Rollup build failures.
- **SPA routing on GitHub Pages:** Requires a `404.html` redirect passing target path as `?redirect=` query param, handled by a script injected into `index.html` during the build via a `sed` command in the workflow.

## Pending Tasks

- Update `phaseSequence.js` to remove `'voting'` (ensure consistency with backend changes)
- End-to-end test of the full participant flow post-refactor
- Add `sleep-mask-example.png` asset
- Clean up orphaned Cloud Functions: `autoAdvanceOnTimer` and `submitVote`
- Update Firestore security rules for participant self-update and group chat message creation

## Working Preferences

- Targeted `str_replace` edits for small changes; full file replacements for larger refactors
- Stage-by-stage workflow. Fix issues before proceeding to the next feature.
- Debugging: upload relevant source files and screenshots, receive complete replacement files ready to copy into local repo.
- Uses GitHub Desktop for commits, not terminal git commands.
- Uses Windows batch scripts for folder backups; git tags for lightweight version snapshots.
- No em dashes in any text. Use commas or separate sentences instead.
- No emoticons in participant-facing text. Minimize emoticons elsewhere.
- Modular, extensible code where adding new parameters requires minimal changes.
- Participants are anonymous (labeled p1, p2, etc.) throughout the app.