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
  content.js          instructions, both comprehension gates, the 20 survey items
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
node lab/search-v2/tools/selftest.js         # 202 checks, no browser
node lab/search-v2/tools/smoke.mjs           # 137 checks, a whole session
node lab/search-v2/tools/admin-smoke.mjs     #  55 checks, the admin panel
node lab/search-v2/tools/platform-guard.mjs  #  26 checks, the platform contract
node lab/search-v2/tools/layout-guard.mjs    #  89 checks, five window sizes
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
participants/{runId}__{code}  the session record of §16.1
events/{eventId}              the append-only event log
audit/{auditId}               admin actions
```

**What holds.** The event log is append-only *by rule*, not by convention — a
participant may create their own rows and can never update or delete one, and
only the admin may read them. Run parameters are admin-write only and refuse to
change once the run is locked, so editing a live run is impossible rather than
merely discouraged. The roster is never listable, so codes cannot be enumerated.
A participant reads and writes only their own record.

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
5. Open `/lab/search-v2/admin/`, create a run, run the validation gate, generate
   a roster, and open entry.

Until Firebase is configured the admin panel opens in **local preview** (runs in
browser storage) and the study still runs, logging locally and offering the data
as a download on the done screen.

---

## The admin panel (§17b)

`/lab/search-v2/admin/`, five tabs covering the brief's six screens.

**The governing rule is clone, do not edit.** A run is an immutable parameter
set. Once its first participant claims a code every parameter that touches the
task is locked; the fields render greyed with a padlock and the date, and the
only way to change anything is **Clone this run**, which copies the parameters
into a fresh `run_id` with its own pool, specs and roster. Every event, round and
participant row carries `run_id`, so two parameter sets can never be silently
pooled. The lock is a Security Rule, not a UI state.

| Screen | What it does |
|---|---|
| **Runs** | every run: status, participants, sequence balance, launch link; open, clone, copy link, test round, export, close, delete |
| **Parameters** | six collapsible groups — Environment, Costs and limits, AI, Round structure, Assignment, Acceptance filter — plus an always-editable Operations group. Two red-confirmed switches ("draw the full curve", "mark the AI's known positions") stay visible but must never be turned on |
| **Consequences** | recomputed live beside the form: σ, `s*`, `g*`, the two gap-midpoint SDs, the benchmark frontier share per seed shape, session length, and **two badges** — green when sparse sits above `s*` and dense below it, red when the design has become a gradient rather than a sign change |
| **Roster** | generate anonymous codes with an exact 50/50 block-randomised split; next-entrant override, which demands a reason and logs it into the export |
| **Live monitor** | counters from a Firestore listener plus the health strip: median active time, median round time, comprehension failures, cap hits, immediate-stop rate, narrow viewports, long blurs, sub-500 ms deciders |
| **Data & preview** | the validation gate, a spec preview that writes nothing, a scripted dry run, the export, and a danger zone |

The four buttons under the parameter form are unchanged in number and colour from
the previous panel: **Save run** (green), then **Cancel edit**, **Make this the
default** and **Restore built-in default** (ghost).

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

## Deviations from the design brief

Everything else follows the brief line by line. These four do not, and each is
recorded here because an appendix will need them.

| Deviation | Why |
|---|---|
| Mapping pool of **600**, not 200 | measured: ~2% of pairings pass the §9 filter, so 200 cannot give 16 seeded specs a distinct curve each. See `SEEDS.md` |
| Reveal cap **20** | §7, §17b and §20b all say 20; the §20c table says 30. The three-to-one reading wins |
| Mean anchor gap read as **J/K** | §17b writes the formula `100/(K+1)` but quotes 25.0 for K = 4, and the SD beside it, 14.43, is `σ·√25/2`. The values are right and the formula is a slip |
| The AI instructions come **before** the first AI round, warm-up included | §13 orders them warm-up → AI instructions for block 1 (steps 3–4) but AI instructions → warm-up for block 2 (steps 7–8). Block 1's order would put an unexplained "Ask the AI" button in front of a participant; block 2's order is followed in both |

Two of the brief's own figures do not reproduce from the numbers printed next to
them: the benchmark `g/4t` for BALANCED and GAP (1.67 and 7.2 against 1.57 and
3.92 from the stated seed positions; FRONTIER's 0.06 reproduces exactly). The
ordering and the side of 1 each shape falls on — which is what the design rests
on — are intact, and that is what the tests pin.
