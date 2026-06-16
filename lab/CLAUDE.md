# CLAUDE.md - Answer Arena (lab root app)

Context file for an LLM. This explains how the **Answer Arena** app at
`stouras.com/lab/` is built, so it can be extended without re-reading
everything. It follows the same philosophy as the sibling `portfoliofit`
research app and the `ideasearchlab` admin.

- **Live (participant):** https://www.stouras.com/lab/
- **Live (admin):** https://www.stouras.com/lab/?admin
- **Join a session:** https://www.stouras.com/lab/?s=CODE
- **Repo:** `lab/` (front end) + `_lab-arena-firebase/` (backend, not web-served)

## 1. What it is

A pairwise **preference study**. Each participant goes through:

```
welcome -> tour -> register/login -> training (practice) -> N comparisons
          (random order) -> survey -> thank-you
```

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
5. **Research integrity.** Participants get an anonymous label (p1, p2, ...),
   never see which model wrote which answer, and left/right is randomized.

## 3. Files

Served (`lab/`):

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
`firestore.rules`, `firestore.indexes.json`, `functions/` (`nextLabel`),
`firebase.json`, `.firebaserc`, `README.md` (full setup steps).

## 4. The comparison data shape

Every task (built-in or uploaded) is:

```js
{ id, task, outputA, outputB, title?, domain?, complexity? }
```

`outputA`/`outputB` are the two models' outputs; the app picks a per-task
`flip` so each participant sees them in a randomized left/right order, and
records which underlying output (`o1`/`o2`) was chosen.

**Excel upload** (admin Tasks tab) expects three columns: `task`, `outputA`,
`outputB` (header names matched loosely; otherwise the first three columns).
It writes a `taskSets/{id}` doc and points `config.activeTaskSetId` at it.

## 5. The 2x2 design

`settings.twoByTwo` = `{ enabled, assignment('random'|'fixed'), fixedCell,
labels, banners }`. When enabled, each participant is assigned a cell of
**Transparency** (abstract tokens vs translated cost) x **Incentive** (firm pays
vs personal budget); the cell is stored on the participant doc and on every
response, and an optional per-cell banner is shown. A **session** can override
the global setting (off / random / fixed). When disabled, everyone is in the
baseline cell and no banner shows.

## 6. Sessions

Admin creates sessions with a short join **code**. Participants enter it on the
welcome screen (or open `?s=CODE`). Sessions are publicly readable so the code
can be validated before sign-in; they hold no personal data. Participant counts
are computed from `participants.sessionId` (not stored on the session).

## 7. Gotchas to carry forward

- Keep model identities out of anything the participant sees.
- `arena-config.js` placeholders => local mode; real config => Firebase. The
  switch is automatic (`ARENA_FB_READY`).
- Firestore **rejects nested arrays**; the response docs avoid them. If you add
  array-of-array data, JSON-stringify it.
- Sessions are public-read on purpose (pre-auth code check). Don't put anything
  sensitive on a session doc.
- After changing `firestore.rules`, redeploy or writes silently fail.
