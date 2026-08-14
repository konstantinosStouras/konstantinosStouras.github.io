# Search With and Without Generative AI (`search-v2`)

A behavioural experiment, served as static files on GitHub Pages at
**https://www.stouras.com/lab/search-v2/**, with Firebase behind it. No build
step, no framework, no external CDN except the Firebase SDK — vanilla
HTML/CSS/JS with relative URLs only.

The environment is adapted from Malladi, Martínez-Marquina & Morozov,
*"Space Exploration"* (EC 2026), High Variability condition. It implements the
design brief in full: `search_with_ai_design.md`, whose section numbers are cited
throughout the source.

---

## The study in one page

A participant searches a hidden line of **100 positions**, each holding an
integer prize from 0 to 100. Neighbouring positions differ by at most **10**.

Three actions:

| Action | Cost | What happens |
|---|---|---|
| **Ask the AI** | 2 points | Its estimate at that position is shown and recorded. It does **not** reveal the truth |
| **Reveal** | 5 points | The true prize is shown. It joins the AI's anchor set |
| **Stop and nominate** | 0 | Ends the round on the selected position |

**Score for the round = the true prize at the nominated position, minus all query
and reveal costs.** The AI's number is never a prize. That single rule is what
makes trust fallible and verification meaningful; without it, trusting a machine
that says 95 when the truth is 60 would pay 95 and the study would measure the
opposite of what it is for.

**The AI** holds **K private anchors** — positions whose true prize it knows
exactly, 4 in *sparse* rounds and 10 in *dense* ones, placed one per equal
stratum. Its anchor set is those K, plus every pre-opened position, plus every
position the participant reveals. Asked about a position it answers the true
value if it is an anchor, the straight-line interpolation between the two nearest
anchors if it is between them, and the nearest anchor's value, flat, beyond the
outermost. The participant is told this mechanism in full, and the value of K for
the round, but never **which** positions the anchors occupy. Nothing about an
answer distinguishes an exact one from an invention — not its formatting, not the
time it takes to arrive.

**28 rounds**: 4 warm-up and 24 scored, 12 scored per block. Every participant
plays one block with the AI and one without, in an order assigned by a
counterbalanced crossover (sequence **A** = off then on, **B** = on then off).
Per block: 4 open rounds and 8 seeded ones, whose pre-opened positions take one
of three geometries that straddle the `g = 4t` exchange rate between an interior
gap and the frontier — **FRONTIER** (2), **BALANCED** (4), **GAP** (2).

Then the twenty-item exit survey, a debrief that redraws one of the
participant's own rounds with the true prizes beside what the AI told them, and
the done screen.

**Registration comes first, and the exit survey no longer asks background.** The
three background items (year or level, age band, gender) are a **registration
phase** between consent and the instructions — asked once, before the task, all
optional. Field of study was dropped in 2026-08 as irrelevant to the study,
which leaves exactly the items a Simulation Platform launch already answers:
each travels with the row as `platform_<field>` and is **not asked again**, so a
platform participant passes through the phase without seeing a screen — and
without leaving a `phase_ms_registration` behind, since consent routes past a
phase with nothing to ask. A standalone participant is asked all three.
`tools/platform-guard.mjs` pins both halves.

**The two paid buttons are the outcome, so the interface may not tilt them.**
"Ask the AI" and "Reveal" are one button style at strict visual parity — same
size, padding, radius, weight, border, shadow and states, two hues matched on
saturation and lightness — placed **side by side** (vertical primacy is the
strongest position bias) with "Stop and nominate" apart below a divider, never
in the swap. Which is on the **left** is assigned once per participant and fixed
for the session, block-randomised **jointly with the sequence** so all four
cells of sequence × order fill evenly, and stamped on every row as
`button_order` for the model to control with. It is deliberately never redrawn
per round or per decision: ~300 actions with the buttons moving buys mis-clicks
(one spends the higher cost and destroys the ground truth at that position) and
inflates decision latency, which is itself a measure. The cost numeral inside
each button is red — and nothing else on screen is — with the cheaper action in
a lighter tint of the same hue; both colours are locked run parameters
(`ui.costColorReveal` / `ui.costColorQuery`), because styling that touches a
primary outcome is a treatment, not a theme. The Reveal cost renders identically
in AI-off rounds, where the Ask button is absent from the DOM rather than
hidden. `tools/smoke.mjs` measures the parity from computed styles.

**Nobody mid-session loses data.** The registration phase is entered from the
consent button, so a participant who had already consented under the previous
build would be asked by neither it nor the deleted Part F. Two catch-ups, in
`app.js`: resumed *before* the task they are routed into the phase; resumed
*inside* the rounds the items come back at the end of the exit survey, where
they used to be, logged as `registration` rows so they still land in the same
`reg_*` column. `tools/migration-guard.mjs` pins both.

**Engagement, within the same rule.** Forty minutes of a repeated task loses
people, and a bored participant produces fast empty rounds that look like
decisions. So: a progress bar and "round n of 12 in this half" under the round
title; a milestone pop-up at the halfway point, with three rounds left, and on
the last round; one in-round encouragement tip; a friendly line between rounds;
and a **focus prompt** when a scored round is about to be closed after
`ui.rushMinActions` actions or fewer — always dismissible in one click, because
a prompt that could not be dismissed would coerce the choice being measured.
Every message is motivational and never informational: none names a position,
none reacts to how the participant is scoring, none differs between the two
arms, and each is logged as a `nudge`. The copy lives in `content.js`
(`ENCOURAGE`) and the whole feature is one locked parameter, `ui.encouragement`.

---

## File structure

```
lab/search-v2/
  index.html          the participant screens (content injected by app.js)
  styles.css
  config.js           ONE place for every parameter (browser + Node)
  pool.js             the mapping generator + acceptance filter (§8, §9)
  specs.js            round specs, per-participant order, validation gate (§10, §11)
  ai.js               the AI's answer, and every derived measure of §16.8
  content.js          instructions, both comprehension gates, the 20 survey items,
                      the registration block, every encouragement message, and
                      the per-session wording overrides that may replace them
  chart.js            the inline-SVG centre panel (§14)
  logger.js           append-only event log: records + batched telemetry (§16, §17.2)
  app.js              the state machine: screens, rounds, resume
  svfirebase.js       Firestore + Auth for the layout of §17.3 (never name it
                      firebase.js — see "Deploying" below)
  firebase-config.js  the project config (public by design — see below)
  firestore.rules     the Security Rules that do the enforcing (§17.4)
  backend.js          local vs server: where the score-bearing actions run
  _functions/functions/index.js   the callables of §17.2 (deploy with firebase)
  firebase.json, .firebaserc      deploy + emulator config
  SEEDS.md            every random seed, and why the pool size differs from the brief
  admin/index.html    the admin panel — six screens (§17b)
  admin/admin.js
  admin/export.js     the ONLY place §16.8 is computed; also the dry-run bot
  admin/xlsx.js       dependency-free OOXML writer (no CDN)
  tools/generate_mappings.py   the generator, seed hard coded (§18)
  tools/generate_rounds.py     seed + anchor placement + the filter (§18)
  tools/upload_run.py          freeze a run into Firestore from a local machine
  tools/selftest.js            Node acceptance tests
  tools/smoke.mjs              a whole session in a browser
  tools/admin-smoke.mjs        the admin panel in a browser
  tools/wording-guard.mjs      a session's own words reach its participants
  tools/platform-guard.mjs     the Simulation Platform contract, both directions
  tools/layout-guard.mjs       reachability at five window sizes
  tools/preview-guard.mjs      the admin test round writes nothing
```

There is no `data/` directory. The mapping pool is **generated, never
committed** (§18) — see below.

---

## Running it locally

```bash
# from the repository root
python3 -m http.server 8000
# then:
#   http://localhost:8000/lab/search-v2/?code=WAVE1&pcode=P001
#   http://localhost:8000/lab/search-v2/admin/
```

`?code=` is the run code; `?pcode=` (or `PROLIFIC_PID`) is the participant code.
With neither, the page shows the participant-code gate and refuses to start.

**Debug / testing view.** `&debug=1&key=stouras` adds a bar over the plot that
can draw the true prizes, the AI's whole curve and its private anchors, and a
readout of the AI's standard deviation at the selected position against `s*`.
It is gated on the key, so a participant can never trigger it, and it also
bypasses the minimum-window check so a narrow test window still works.

### The tests

```bash
node lab/search-v2/tools/selftest.js         # 299 checks, no browser
node lab/search-v2/tools/smoke.mjs           # 201 checks, a whole session
node lab/search-v2/tools/admin-smoke.mjs     # 161 checks, the admin panel
node lab/search-v2/tools/wording-guard.mjs   #  17 checks, a session's own words
node lab/search-v2/tools/platform-guard.mjs  #  28 checks, the platform contract
node lab/search-v2/tools/layout-guard.mjs    # 104 checks, five window sizes
node lab/search-v2/tools/preview-guard.mjs   #  the sandbox writes nothing
node lab/search-v2/tools/emulator-test.mjs   #  37 checks against the REAL Functions
                                             #  and Rules (needs Java + firebase-tools;
                                             #  skips cleanly without them)
python3 lab/search-v2/tools/generate_rounds.py --validate
```

The browser tests use Playwright. Only **Chromium** is installed in this
container, so they report Firefox and WebKit as skipped rather than pretending to
have run them; `SV_BROWSERS=chromium,firefox,webkit` picks up any engine that is
present. What stands in for cross-engine coverage is `layout-guard.mjs`, which
measures reachability and containment at five window sizes, plus a source audit:
the browser code contains no syntax or API newer than 2020 (no optional chaining,
no spread, no `.flat`, no `structuredClone`, no `:has()`), and the one modern CSS
shorthand it uses, `inset`, is written with its long-hand fallback beside it.

---

## The frozen artifacts (§18)

| Artifact | Where |
|---|---|
| the generators and every seed | **in this repository** (`pool.js`, `specs.js`, `tools/*.py`, `SEEDS.md`) |
| the mapping pool | **never committed** — regenerated from `generatorSeed` |
| the round specs | **on the run document in Firestore**, plus their checksum |
| the roster | **Firestore only** |

`tools/generate_mappings.py` is a bit-exact port of the PRNG in `pool.js`: the
two print the same parity vector and build byte-identical pools, which
`tools/selftest.js` asserts. The brief's reference generator is numpy's PCG64,
which cannot run in a browser; mulberry32 is the canonical generator here, and it
reproduces every statistic the brief pins down (§8: a single position has mean
62.2 and SD 26.8; the global maximum has mean 91.7).

**The pool size differs from the brief — deliberately, and for a measured
reason.** See `SEEDS.md`: at the brief's own parameters only ~2% of
(mapping, seed-set) pairings pass the §9 acceptance filter, so a 200-mapping pool
cannot give the 16 seeded specs a distinct prize curve each. The default here is
600. `Specs.validate()` fails any run whose specs repeat a mapping, so this
cannot regress silently.

---

## Architecture, and what this build does and does not guarantee

Static front end on GitHub Pages, everything else on Firebase (§17). The
Firestore layout, the collections and the Security Rules follow §17.3 and §17.4:

```
runs/{runId}                  parameter set, status, locked flag, frozen specs
runCodes/{code}               code → runId, so participants never list runs
runCounts/{runId}             sequence counters, transactionally assigned
roster/{runId}__{code}        one entrant: sequence, claim, status
participants/{runId}__{code}  the session record of §16.1, and `state_json` —
                              their own progress, so a return on another device
                              continues where they left off
events/{eventId}              the append-only event log
audit/{auditId}               admin actions
```

**What holds.** The event log is append-only *by rule*, not by convention — a
participant may create their own rows and can never update or delete one, and
only the admin may read them. Run parameters are admin-write only and refuse to
change once the run is locked, so editing a live run is impossible rather than
merely discouraged. The roster is never listable, so codes cannot be enumerated.
A participant reads and writes only their own record — or, on a device whose
uid has never written it, the record whose roster document THIS browser has
claimed, which is what makes resuming on a second device possible without
opening anyone else's data. **Republish `firestore.rules` for that to work**;
until then a returning participant simply falls back to whatever their own
browser holds, exactly as before.

**Coming back (§17.7).** Progress is mirrored to `state_json` on every save, so
a participant who returns — on this browser, another browser, another device, or
this one after its storage was cleared — continues from where they left off. The
boot takes whichever copy got FURTHER (rounds finished first; the clock only
breaks a tie), so a sync that never landed can never replay finished rounds. The
one thing that does NOT resume mid-way is an open round: it restarts from its
beginning and is flagged `interrupted`, because a round is one uninterrupted
decision sequence and its timings are the measure. Every return is logged as a
`resume` row carrying the gap since they were last seen; a gap of at least
`CONFIG.BREAK_MIN_MS` (5 minutes) is a **break between sittings** rather than a
reload, and the workbook derives `breaks_count`, `break_total_ms`,
`longest_sitting_break_ms` and `sittings` from those raw gaps.

**Score-bearing actions (§17.2).** `claimCode`, `startRound`, `act` (query or
reveal), `nominate` and `debriefRound` are **callable Cloud Functions** in
`_functions/functions/`. The client sends a position; the server holds the
mapping, computes the answer or the truth, charges the cost, appends the
authoritative event and returns **one number**. The three properties the brief
demands are enforced and tested against the real emulator:

- **Identical response** whether or not the queried position was one of the AI's
  private anchors — the same keys, the same payload shape, and every handler
  padded to a fixed duration so the clock cannot leak it either. Measured: a
  median 267 ms at an anchor and 267 ms in a gap.
- **Idempotent on `actionId`** — a retried reveal after a dropped connection
  returns the recorded answer and charges nothing further, while a *different*
  action id on an already-open position is refused outright.
- **`nominate` computes the score.** A client total is never trusted.

In server mode the run document is **admin-only** (it holds `generatorSeed`) and
the participant boots from `runPublic/{runId}`, a redacted copy with no seeds and
no specs in it. The server's per-round state is unreadable to everyone but the
admin. The mapping never reaches the browser at all.

**Which mode a run uses is a locked run parameter** — *Score-bearing actions* in
the admin's Operations group, set before the first participant. The two are never
mixed inside a run, and a server-mode failure is **never** silently downgraded to
computing locally: the participant sees "we could not reach the study server" and
can reload. Falling back would quietly void the property the run was configured
for and put two kinds of row in one dataset.

**Client mode** remains for a project without Functions deployed, for the admin's
test round, and for running with no Firebase at all. There the client computes
from a pool it regenerates from the run's seed, so a determined participant with
developer tools could read a round's prizes — which is why server mode is the
default recommendation now that the plan supports it.

### Deploying

**Always name the project.** This repository holds six unrelated Firebase
projects, and the CLI takes its target from a project it remembers per folder in
its own global config *before* it reads the `default` alias in `.firebaserc`. A
deploy run from this directory can therefore publish these rules into another
study's database and report a clean success — it has happened, and it locked
Answer Arena's participants out until its own rules were re-published. So:

```bash
cd lab/search-v2
firebase use search-with-ai-456d7                                    # once per machine
node tools/sync-engine.mjs          # refresh the engine copies (also a predeploy step)
firebase deploy --only functions       --project search-with-ai-456d7
firebase deploy --only firestore:rules --project search-with-ai-456d7
```

`tools/check-project.mjs` runs as a predeploy hook on both targets and **aborts
the deploy** when the project the CLI resolved is not the `default` in
`.firebaserc`, so a mis-aimed deploy now fails loudly instead of overwriting
someone else's rules. Run it on its own to see where this folder points:
`node tools/check-project.mjs`.

The Functions' `node_modules` is not in the repository, and the CLI needs
`firebase-functions` resolvable *locally* to work out what to deploy — a fresh
clone otherwise fails with "Couldn't find firebase-functions package in your
source code". `npm install --prefix _functions/functions` therefore runs as a
predeploy step too, so the first deploy on a new machine works with no separate
step. The runtime is **nodejs22**: Node 20 was deprecated on 2026-04-30 and is
decommissioned on 2026-10-30, after which it cannot be deployed at all.

**On Windows, this file is `svfirebase.js` and must never be renamed to
`firebase.js`.** CMD searches the current directory before PATH and `.JS` is in
the default `PATHEXT`, so a `firebase.js` here makes `firebase` run *that file*
under Windows Script Host: every command prints nothing, exits cleanly and
deploys nothing. If you ever see silent `firebase` output, that is why — and
`firebase.cmd` is the immediate way through.

Then set *Score-bearing actions* to **On the server** for the run, before its
first participant. `tools/emulator-test.mjs` runs the whole thing against the
Firestore + Functions + Auth emulator first.

The Firebase config that ships with the client (API key, project id) is not a
secret and is not meant to be one. Security comes from the Rules and from Auth.

### One-time Firebase setup

1. **Firestore** — Build → Firestore Database → Create, **Production mode**.
2. **Authentication** — enable **Anonymous** (participants) and
   **Email/Password** (you); add your admin user.
3. **Config** — paste your `firebaseConfig` into `firebase-config.js` and set
   `ADMIN_EMAILS`.
4. **Rules** — copy `firestore.rules` into Firestore → Rules, replace
   `admin@admin.com` with your address, and **Publish**. The panel will tell you
   if it cannot read a collection because the rules are not yet published.
5. Open `/lab/search-v2/admin/`, create a run, run the validation gate, and open
   entry. Codes are not generated in the panel: leave **Roster mode** on *Open*
   and each class-platform student ID enrols itself on first entry.

Until Firebase is configured the admin panel opens in **local preview** (runs in
browser storage) and the study still runs, logging locally and offering the data
as a download on the done screen.

---

## The admin panel (§17b)

`/lab/search-v2/admin/`, seven tabs covering the brief's six screens.

**The panel calls the unit a SESSION**, played as **28 rounds** (4 warm-up and 24
scored, in two blocks). The brief calls the same object a *run*, and the data
keeps that name — every event, round and participant row carries `run_id` — so
the two words mean one thing and existing analysis scripts are untouched.

**The governing rule is clone, do not edit.** A session is an immutable parameter
set. Once its first participant claims a code every parameter that touches the
task is locked; the fields render greyed with a padlock and the date, and the
only way to change anything is **Clone**, which copies the parameters into a
fresh id with its own pool, specs and roster. Two parameter sets can therefore
never be silently pooled. The lock is a Security Rule, not a UI state.

**A session is summarised before it can bite.** Creating one freezes the mapping
pool and all 28 specs under its seeds; opening entry starts the clock on that
lock, because the first entrant fixes everything. Both moments therefore put the
whole configuration in front of you first — rounds, task, costs and caps, the two
AI densities and whether they still bracket `s*`, assignment, what happens after
the task, and the participant link — with **Cancel** as a real cancel.

**A session is named before it exists.** The Sessions screen opens on a **Create a
session** card — session name, an optional Session ID, one green button — the same
shape the ideasearchlab and Answer Arena admins use. It builds the session from the
saved default parameters, shows the summary above, and then **selects it**, so
creating a session is also opening it: every other screen is already on it, and the
card reports the code, the participant link, and the three things there are to do
next (copy the link, check its parameters, open entry). Naming is the one thing
every session needs, so it is asked first; the parameter form stays one click away
(**Set the parameters first…**, which carries whatever was typed with it) for a
session whose task differs from the defaults.

| Screen | What it does |
|---|---|
| **Sessions** | a **Create a session** card first — name, optional Session ID, Create session — then grouped **Active** and **Completed**, one card each in the shape of the other class admin panels: code, status, name, created date, participant count, sequence balance and where the score is computed; **Open · Copy link · ⬇ Export data · 🧪 Test round · Clone · Open entry / Close session · Delete**. Export data does the whole job in one press — read the log, build the workbook, save it. Delete removes the session **and its event log**, so export first |
| **Parameters** | six collapsible groups — Environment, Costs and limits, AI, Round structure, Assignment, Acceptance filter — plus an always-editable Operations group. Two red-confirmed switches ("draw the full curve", "mark the AI's known positions") stay visible but must never be turned on |
| **Consequences** | recomputed live beside the form: σ, `s*`, `g*`, the two gap-midpoint SDs, the benchmark frontier share per seed shape, session length, and **two badges** — green when sparse sits above `s*` and dense below it, red when the design has become a gradient rather than a sign change |
| **Participants** | one full-width table of everyone in the session: code, sequence, **Left button** — which of the two paid buttons (Ask the AI / Reveal) sat on the left for them, the covariate `button_order` — **Round** — the scored rounds they have finished out of the scored rounds the session assigns them, `18/24 (75%)`; warm-ups are not counted, and 100% with a status of *started* is a real state, because the survey and the debrief come after the last round — status, when they claimed and how they enrolled, with the sequence and button-order balance in the tiles above and a CSV of the lot. **Every heading sorts, and sorts back when pressed again**; rows with nothing to compare (an unclaimed code has no progress) stay at the bottom either way, and Status orders by how far they got rather than alphabetically. **Status is read from the participant's own session record**, so it turns to `completed` the moment they reach the end; the roster document is stamped too, but the panel does not depend on it. The screen holds no code generator and no entrant override: participants enrol from the class platform, and the override is a parameter (Assignment → Next entrant). The data keeps the name `roster` — the collection, the document ids and the tab's own id are unchanged |
| **Live monitor** | counters from a Firestore listener plus the health strip: median active time **over completed sessions only**, median round time, comprehension failures, cap hits, immediate-stop rate, narrow viewports, long blurs, sub-500 ms deciders. Every check states the threshold behind its ⚠, and the six that need the event log say so until you press **⟳ Refresh health checks** — the log is far heavier than the participant records the counters use, so it is never fetched on its own. The fourth tile is **Away 30+ min**, not "abandoned": it is `started − completed − in progress`, and anyone in it can come back and carry on. Per participant: their phase, round, active time, **resumptions** and **breaks** (how many, how long away in total) |
| **Data & preview** | the validation gate, a spec preview that writes nothing, a scripted dry run, the export, a danger zone, and the round gallery below |
| **Design notes** | the questions this design attracts, answered against the code — does the AI hold private data, what a pre-opened round is, gaps versus tails and `g = 4t`, why all three layouts are needed, whether the landscape changes each round — with **every number measured from the open session's own frozen pool**, never copied from the design document |
| **Wording** | **everything the study says to a participant, in the order they meet it** — consent, the background questions asked before the study, both sets of instructions, both quick checks with their answer options, all twenty-four survey items, the encouragement messages, the part headings, debrief and thanks — each shown with this session's own numbers already substituted, and editable **for this session only** |

The four buttons under the parameter form are unchanged in number and colour from
the previous panel: **Save session** (green), then **Cancel edit**, **Make this
the default** and **Restore built-in default** (ghost).

### Wording

The words are in `content.js`, which is the study's default for every session.
The **Wording** screen shows them all — with `{revealCost}` and the rest already
resolved to this session's own numbers, because a screen that displayed the token
would not answer the question it exists to answer — and lets you change any of
them **for one session**. `content.js` itself is never touched, so every other
session keeps the defaults.

The screen covers the study text, which is what `content.js` holds. It does not
cover the game screen's own buttons and labels, or the reminder box above each
quick check — app.js builds those from the numbers, so they follow the parameters
on their own. The screen says so, rather than implying it covers them.

An edit is stored as a per-session override: a flat `key → string` map, held on
the run document as a JSON string (`run.contentJson`, beside `specsJson`). The
string matters. Both writers use `setDoc(merge:true)`, which deep-merges a map —
so stored as a map, a reverted key would be merged straight back, and **revert
would look right in the panel and change nothing for the participant**. A string
field is replaced whole, so removing a key removes it.

It travels with the redacted public copy as well, or a participant in server
mode — who cannot read the run document at all — would never see it. Leaving a
box blank, or pressing **Revert to default**, removes the override rather than
freezing today's default into the session. A **clone** carries the wording of the
session it was cloned from, which is what makes clone-do-not-edit workable for a
session whose words were tuned.

**Wording is editable; structure is not.** How many answers a question has, which
one is correct, the question types, the order, and the numeracy answers always
come from `content.js`, whatever a session says. This is not a UI simplification:
`admin/dictionary.js` describes one entry per exported column and the column set
is derived from these ids, so a session that could add a question or move an
answer key would invalidate its own workbook. Rewording cannot — which is also
why wording stays editable after a session locks, unlike the task parameters.

`node tools/wording-guard.mjs` proves the round trip: a session carrying
overrides is played in a browser and its own words appear on the consent screen,
the instructions and the quick check, while the reworded question still grades on
the answer key it always had.

### Every round, drawn

At the bottom of **Data & preview** the panel draws **one plot per round of the
session**, in the frozen order: the hidden prize walk itself, the prizes that
start already open (with their values), the positions the AI knows exactly, and
the line it interpolates between them — each behind its own tick box, plus
*mark the best position* and *scored rounds only*. Under every plot: what is
pre-opened, where the best prize is, and how many positions the AI knows.

It is the fastest way to see whether a session's parameters produced the geometry
they were meant to — a FRONTIER round really putting its seeds in a cluster, a
sparse round really leaving the AI guessing between anchors — before anyone plays
it.

**All of it is admin-only, and that is the point.** The ground truth is the whole
secret of the study: a participant's plot starts blank and fills in only with
what they have paid for. The truth and the AI's curve exist in the participant
build solely as debug overlays behind the preview key, the anchors are never sent
to a live browser at all in server mode, and `tools/smoke.mjs` asserts on a live
round that none of `.gt-line`, `.ai-line` or `.anchor-dot` is in the participant's
plot and that the testing panel is not displayed.

---

## The data

**Log raw state, derive nothing in the client** (§16). The browser writes what
happened; every derived quantity in §16.8 is computed offline by
`admin/export.js`, from the raw rows plus the frozen pool and specs. A formula
that turns out to be wrong costs one rerun of that file rather than the data.

Two classes of event, as §17.2 requires:

* **Records** — every `query`, `reveal` and `stop`, the round and session
  boundaries, comprehension answers and survey responses. One flat document each,
  written the moment they happen, never batched, never updated.
* **Telemetry** — slider moves (throttled to one per 250 ms plus one on release),
  30-second heartbeats, focus/blur, instruction opens, resizes. Buffered and
  flushed as one document holding an array.

A decision row carries the complete information state at the instant before the
action: **both** anchor sets — `ai_anchors_before` (what the AI knows, private
anchors included) and `participant_known_before` (what the participant knows) —
plus `participant_queried_before`, the two "best" values, the counts, and the
timing and scanning that preceded the choice.

### The workbook is meant to be read

One `.xlsx` per session, plus the three CSVs. Sheet order is **ReadMe ·
Dictionary · Run · Specs · Decisions · Rounds · Participants · Slider ·
Attention · Raw**, and the second of those is the one that makes the rest
legible: every column of the three analysis sheets described in a sentence, with
its type, generated from `admin/dictionary.js`. `tools/selftest.js` **fails** if
a column is exported without a description, so the two cannot drift — a derived
field nobody can define in a sentence is a field nobody should be analysing.

It stays tidy while it does that: one row per observation, one column per
variable, no merged cells, no spacer rows inside a data sheet. Header row frozen
and filterable, numbers written as numbers, booleans as real booleans (so the
cell reads TRUE/FALSE in Excel and parses as a boolean in pandas — the same as
the CSVs), timestamps as both epoch milliseconds and ISO 8601, and an empty cell
meaning *not applicable*, never zero. `participant_code + round_index` joins
Decisions to Rounds; `participant_code` joins either to Participants; `spec_id`
joins any of them to Specs.

### Export

The **Data & preview** tab downloads one workbook — *ReadMe, Run, Specs,
Decisions, Rounds, Participants, Slider, Attention, Raw* — and `decisions.csv`,
`rounds.csv`, `participants.csv` and the raw log separately, with row counts and
a checksum. Each export bundles the run's frozen configuration, so the parameters
always travel with the data.

`participants.csv` carries the session record of §16.1 (including `active_ms`
from heartbeats and the per-phase breakdown), comprehension attempts per
question, the `understood_frontier` flag, every survey response, and the three
calibration fields: `error_belief_gap`, `hit_rate_belief_gap` and
`perceived_vs_actual_half`. The two exclusion flags — `interrupted` at the round
level and `disengaged` at the participant level — are **columns, not filters**, so
every analysis states its own rule.

---

## The Simulation Platform

Students reach this study from **stouras.com/simulation/**, so the two datasets
have to join and the two apps have to talk. `tools/platform-guard.mjs` pins the
whole contract; in short:

**Platform → study.** The launch handoff's `studentId` becomes this study's
`participant_code`, and the same value is carried as `pid`. That is the only join
key, and no second identifier is invented. A background question the platform has
already answered — level of study, age band, gender — is **not asked again**; the
platform's own answer travels with the row as `platform_<field>`, flagged as its
source, so the two datasets carry one answer each rather than two that can
disagree. Nothing else from the profile is stored: the student's name and e-mail
address never reach this study's log, which is what §11 asks for.

**Study → platform.** Finishing writes a `session_end` row carrying `pid` — the
exact row `simulation/admin/verify.js` matches on to tick the student's card —
and calls `window.simpMarkCompleted()`, so the card flips to "✓ Completed" on its
own. The `events` collection must therefore keep its name.

**A rehearsal does neither.** `?preview=1&debug=1&key=…` opens the admin test
round: a constant ribbon says nothing is saved, `SIMP_EXPECT` is switched off so
the completion marker is never even defined, the student's ID is never adopted,
and the rows carry no `run_id`, so they could never be pooled with real data.

---

### The ceiling plateau, and the tie rule it forced

The walk reflects at the prize ceiling, so a mapping can reach 100 at several
positions at once. Measured over the default pool of 600: **56.0%** touch the
ceiling, only **49.7%** have their maximum at a single position, and **24.3%**
have it at three or more.

That makes "distance to the argmax" ill-defined for about half the mappings, and
taking the first index — which `Pool.argmaxOf` returns — imports a leftward bias
that is an artifact of the tie-break, not a property of the walk. It is visible:
by first index the maximum's mean position is **41.1** and the first decile holds
17.7% of the mass; counting every maximising position it is **47.8** and 11.4%,
i.e. essentially uniform, which is what the generator actually produces.

So `dist_best_to_argmax` is the distance to the **nearest** maximising position,
and **`argmax_count`** ships beside it so a plateau is visible in the data rather
than hidden in it. `argmax_position` remains the first index for continuity.

The plateaus themselves are inherited from the source study's generator, so their
data has the same property and this build does not silently diverge from it. To
remove them, add an acceptance rule rejecting mappings whose maximum is attained
at more than two positions — roughly a quarter of draws, affordable against a
pool of 600. That changes the task, so it belongs to a new session.

---

## Deviations from the design brief

Everything else follows the brief line by line. These five do not, and each is
recorded here because an appendix will need them.

| Deviation | Why |
|---|---|
| Reveal cost **4**, not 5, and sparse **K = 3**, not 4 | measured over 1000 simulated participants (`tools/simulate.mjs`): at the brief's values the AI-OFF arm is barely a search arm and the sparse/dense contrast is a gradient, not the sign change the design rests on. Moving both flips it; neither alone does. See `tools/SIMULATION-FINDINGS.md` |
| Mapping pool of **600**, not 200 | measured: ~2% of pairings pass the §9 filter, so 200 cannot give 16 seeded specs a distinct curve each. See `SEEDS.md` |
| Reveal cap **20** | §7, §17b and §20b all say 20; the §20c table says 30. The three-to-one reading wins |
| Mean anchor gap read as **J/K** | §17b writes the formula `100/(K+1)` but quotes 25.0 for K = 4, and the SD beside it, 14.43, is `σ·√25/2`. The values are right and the formula is a slip. (At this build's K = 3 the same rule gives 33.3 and 16.67.) |
| The AI instructions come **before** the first AI round, warm-up included | §13 orders them warm-up → AI instructions for block 1 (steps 3–4) but AI instructions → warm-up for block 2 (steps 7–8). Block 1's order would put an unexplained "Ask the AI" button in front of a participant; block 2's order is followed in both |

Two of the brief's own figures do not reproduce from the numbers printed next to
them: the benchmark `g/4t` for BALANCED and GAP (1.67 and 7.2 against 1.57 and
3.92 from the stated seed positions; FRONTIER's 0.06 reproduces exactly). The
ordering and the side of 1 each shape falls on — which is what the design rests
on — are intact, and that is what the tests pin.
