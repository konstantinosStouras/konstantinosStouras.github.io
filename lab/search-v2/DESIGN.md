# How `search-v2` is designed

**"Search With and Without Generative AI"** — the participant app at
<https://www.stouras.com/lab/search-v2/> and the instructor panel at
<https://www.stouras.com/lab/search-v2/admin/>.

This is the *design* document: what the two apps are, how they are built, and —
in detail — **why every default parameter is the number it is**. `README.md` is
the operator's guide (how to run it, deploy it, test it); `SEEDS.md` records the
frozen seeds; `tools/SIMULATION-FINDINGS.md` carries the measurements that two of
the defaults were changed on. This document is the one that explains the
reasoning, and it cites the other three rather than repeating them.

> **Keep this file in sync.** It describes the app *as built*. Whenever a
> parameter default, a screen, a security rule, an export column, an admin tab or
> the platform contract changes, update the matching section here in the same
> change — the same keep-in-sync discipline the repository applies to
> `fun/index.html` cards and `/lit`'s About page. Every number in this document
> was recomputed from `config.js` on **2026-08-14** (app version `v3.0.0`); the
> section *Verifying the numbers in this document* at the end says how to redo
> that in one command.

---

## Table of contents

1. [What the study is, in one page](#1-what-the-study-is-in-one-page)
2. [What it is designed to measure](#2-what-it-is-designed-to-measure)
3. [Architecture and build philosophy](#3-architecture-and-build-philosophy)
4. [The environment: how a round's prizes are made](#4-the-environment-how-a-rounds-prizes-are-made)
5. [The AI](#5-the-ai)
6. [The arithmetic the whole design rests on](#6-the-arithmetic-the-whole-design-rests-on)
7. [Every default parameter, and why](#7-every-default-parameter-and-why)
8. [Round structure, layouts and the acceptance filter](#8-round-structure-layouts-and-the-acceptance-filter)
9. [Assignment and the crossover](#9-assignment-and-the-crossover)
10. [The participant app, screen by screen](#10-the-participant-app-screen-by-screen)
11. [The plot](#11-the-plot)
12. [Where the score is computed: two backends](#12-where-the-score-is-computed-two-backends)
13. [Data model, logging and the security rules](#13-data-model-logging-and-the-security-rules)
14. [Derivation: nothing in the browser](#14-derivation-nothing-in-the-browser)
15. [The admin panel](#15-the-admin-panel)
16. [The exported workbook](#16-the-exported-workbook)
17. [The Simulation Platform contract](#17-the-simulation-platform-contract)
18. [Tests, and what each one pins](#18-tests-and-what-each-one-pins)
19. [Deployment hazards this build has already hit](#19-deployment-hazards-this-build-has-already-hit)
20. [Deviations from the design brief](#20-deviations-from-the-design-brief)
21. [Known drift and open maintenance](#21-known-drift-and-open-maintenance)
22. [Verifying the numbers in this document](#22-verifying-the-numbers-in-this-document)

---

## 1 · What the study is, in one page

A participant searches a hidden line of **100 positions**. Every position holds
an integer prize from **0 to 100**, and **neighbouring positions differ by at
most 10** — the single structural fact they are told before they look at
anything.

Three actions, and only three:

| Action | Cost | What it does |
|---|---|---|
| **Ask the AI** | **2** points | Returns the AI's *estimate* at that position. Does **not** reveal the truth. The button is **absent** (not disabled) in AI-off rounds |
| **Reveal** | **4** points | Shows the **true** prize there. It stays visible, cannot be bought twice, and **joins the AI's anchor set** |
| **Stop and nominate** | free | Ends the round on the selected position. The button **names** the position; an untouched position asks for confirmation |

> **Score for the round = the TRUE prize at the nominated position, minus every
> point spent that round.**

That one rule is the study. The AI's number is **never** a prize. Without that,
trusting a machine that says 95 where the truth is 60 would pay 95, and the
experiment would measure the opposite of what it exists for. It is also the
**strict comprehension gate** (`qai_score` in `content.js`): a participant cannot
start an AI block until they have answered it correctly.

There is **no score floor**: a round can end negative, and that is logged rather
than clipped (`costs.scoreFloor: false`). Caps of **40 questions** and **20
reveals** per round exist only to bound a pathological session — see §7.

**28 rounds**: 4 warm-up + 24 scored, in two blocks of 12 scored. Every
participant plays **one block with the AI and one without**, order assigned by a
counterbalanced crossover (**A** = off then on, **B** = on then off). Then a
twenty-item exit survey, a debrief that redraws one of the participant's *own*
rounds with the true prizes beside what the AI told them, and a done screen.

The environment is adapted from Malladi, Martínez-Marquina & Morozov, *"Space
Exploration"* (EC 2026), High Variability condition. The implementation follows
the design brief `search_with_ai_design.md`, whose section numbers (`§8`, `§16.8`,
`§17b`…) are cited throughout the source and throughout this document.

---

## 2 · What it is designed to measure

Three outcomes, in the order the design prioritises them.

**1. Does the AI change the score, and does the sign of that change flip with the
AI's density?** The AI knows *K* positions exactly and interpolates between them.
In **sparse** rounds (K = 3) its typical error is large enough that verification
pays; in **dense** rounds (K = 10) it is small enough that trusting is correct.
The prediction is therefore a **change of sign**, not a gradient — the sample is
sized for a sign change, and §6 explains the arithmetic that keeps it one.

**2. Does the AI pull people off the frontier?** The AI interpolates but
**cannot extrapolate**: beyond its outermost known position it repeats that value,
flat, forever. Its blind spot *is* the frontier. So the primary behavioural
outcome is the **share of first moves that land outside everything the
participant knows** (`frontier_share`, `is_frontier`), measured against three
deliberately different starting layouts (§8).

**3. Is trust calibrated?** The exit survey asks what the participant *believed*
the AI's error and hit rate were; the export computes what they *actually
experienced*, from the answers they paid for, and ships the difference
(`error_belief_gap`, `hit_rate_belief_gap`, `perceived_vs_actual_half`).

A supporting design goal runs underneath all three: **every quantity must be
reconstructible offline.** The browser logs raw state; nothing is derived in it
(§14).

---

## 3 · Architecture and build philosophy

Static front end on GitHub Pages, Firebase behind it. **No build step, no
framework, no bundler, no external CDN except the Firebase SDK.** Vanilla
HTML/CSS/JS with **relative URLs only**, so the whole directory can be moved or
served from a file system without editing anything.

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
  logger.js           append-only event log: records + batched telemetry
  app.js              the state machine: screens, rounds, resume
  backend.js          local vs server: where the score-bearing actions run
  svfirebase.js       Firestore + Auth  (NEVER rename to firebase.js — §19)
  firebase-config.js  the project config (public by design)
  firestore.rules     the rules that do the enforcing (§17.4)
  tooltip.js
  _functions/functions/index.js     the callables of §17.2
  _functions/functions/engine/*     a GENERATED copy of config/pool/specs/ai
  admin/index.html · admin.js · export.js · dictionary.js · xlsx.js
  tools/…             generators, tests, the simulator
  README.md · SEEDS.md · DESIGN.md (this file) · tools/SIMULATION-FINDINGS.md
```

Five decisions shape everything else:

**One config, two runtimes.** `config.js`, `pool.js`, `specs.js`, `ai.js`,
`content.js` and `admin/export.js` are UMD modules that load in the browser
(`window.CONFIG`, `window.SVPool`, …) *and* under Node (`require`). The offline
generators, the live app, the admin panel, the Cloud Functions and the exporter
therefore cannot disagree about a constant — there is exactly one definition of
`revealCost`, and `tools/selftest.js` runs the real modules, not a copy.

**Every parameter is a run parameter.** `CONFIG.DEFAULTS` mirrors the admin
panel's Parameters screen field for field. The panel edits a *copy* of it into a
session document; the session's copy is what everything downstream reads. Changing
a default here changes what a *new* session starts from and nothing about a
session that already exists.

**ES5-era syntax on purpose.** The browser code contains no syntax or API newer
than 2020 — no optional chaining, no spread, no `.flat`, no `structuredClone`, no
`:has()` — and the one modern CSS shorthand it uses (`inset`) is written with its
long-hand fallback beside it. Only Chromium is installed in the CI container, so
this plus `tools/layout-guard.mjs` (reachability at five window sizes) is what
stands in for cross-engine testing.

**The Functions' engine is generated, never edited.**
`_functions/functions/engine/{config,pool,specs,ai}.js` is a copy produced by
`tools/sync-engine.mjs`, because `firebase deploy` uploads only that directory.
`sync-engine.mjs --check` runs inside `selftest.js`, inside the emulator test and
as a `predeploy` hook, and **fails the build the moment the copy drifts** — a
drifted copy would have the server computing against a different pool from the one
the exporter joins against, which is the worst kind of silent failure.

**The secrets live in closures.** In local mode the mapping is held inside
`backend.js`'s `localBackend` closure. It is never assigned to `window`, never
written into the DOM, and `app.js` itself never holds it. In server mode the
browser never receives it at all.

---

## 4 · The environment: how a round's prizes are made

### The walk (§8)

One mapping is one round's prize curve: 100 integers, adjacent ones differing by
at most `L = 10`.

1. Pick a random **start index** `y` uniformly in 1…100.
2. Give it a start **value**: with probability `seedHighProb = 0.5` from
   *U*[20, 80], otherwise from *U*[80, 100].
3. Walk **outwards in both directions** from `y`, each step adding *U*[−10, +10].
4. **Reflect** at 0 and 100 — never clip. Clipping piles probability mass on the
   boundaries and changes the process; reflection preserves it.
5. Round to integers, then **re-check adjacency**. Rounding can in principle push
   a difference above `L`, which would make the instructions literally false, so a
   candidate that fails is discarded and redrawn.

### The pool

`buildPool` draws `poolSize` mappings from `env.generatorSeed`, keeping only those
whose **global maximum is at least 80** (the brief's own `build_pool` rule), so
every round has real headroom somewhere. Measured at the shipped defaults:

| Pool statistic | Value |
|---|---|
| mappings | 600 |
| a single position | mean **70.9**, SD **22.8** |
| global maximum | mean **97.9** (5th pct 86, 95th pct 100) |
| worst adjacent step | **10** (the bound holds everywhere) |

The brief quotes 62.2 (SD 26.8) and a global-max mean of 91.7 for the **raw**
generator; the pool is the `max ≥ 80` subset, which is why its level sits higher.
`tools/selftest.js` §2 checks the raw statistics against the brief's numbers, so
the generator is verified independently of the filter.

### The PRNG, and why it is not the brief's

**mulberry32**, implemented identically in `pool.js` (canonical) and
`tools/generate_mappings.py` (exact 32-bit port). The brief's reference generator
is numpy's PCG64, which cannot run in a browser — and the entire point of a frozen
pool is that **one artifact serves every participant**, so it has to be derivable
in both places. The two implementations are proven byte-identical: they print the
same parity vector and build the same 600 arrays, asserted in `selftest.js`.

```
seed 20260813, first five draws:
0.4006963617, 0.3509998717, 0.0757264085, 0.5681982152, 0.8197679692
```

### The plateau, and the tie rule it forced

The walk reflects at the ceiling, so a mapping can attain 100 at several positions
at once. Measured over the default pool of 600:

| | share |
|---|---|
| mappings touching the ceiling | **56.0%** |
| maximum at a **single** position | **49.7%** |
| maximum at **three or more** positions | **24.3%** |

That makes "distance to the argmax" ill-defined for about half the mappings, and
taking the **first** index (what `Pool.argmaxOf` returns) imports a **leftward
bias that is an artifact of the tie-break, not a property of the walk**: by first
index the maximum's mean position is 41.1 with 17.7% of the mass in the first
decile; counting **every** maximising position it is 47.8 and 11.4%, i.e.
essentially uniform, which is what the generator actually produces.

So the export measures `dist_best_to_argmax` to the **nearest** maximising
position and ships **`argmax_count`** beside it, so a plateau is visible in the
data rather than hidden in it. `argmax_position` remains the first index for
continuity. The admin panel's **Design notes** tab renders both rows of that
decile table from the open session's own pool.

The plateaus are **inherited from the source study's generator**, so its data has
the same property and this build does not silently diverge from it. Removing them
would need an acceptance rule ("maximum attained at ≤ 2 positions", ~a quarter of
draws, affordable against a pool of 600) — and that changes the task, so it
belongs to a **new session**, never to a running one.

### What is frozen, and where it lives (§18)

| Artifact | Where | Reproduced by |
|---|---|---|
| generators + every seed | **in the repository** | — |
| the mapping pool (600 × 100 ints) | **never committed** | `pool.js` / `generate_mappings.py` from `generatorSeed` |
| the 28 round specs | **on the session document in Firestore**, with a checksum | `specs.js` from `specSeed` |
| the roster | **Firestore only** | admin panel → Roster |

The split *is* the point: seeds and generator code in the repository make the study
reproducible by anyone who should be able to reproduce it; the generated artifacts
staying out of it are what stop a participant reading the answers. In **server
mode** `generatorSeed` lives on a document the rules make admin-only, so a
participant cannot regenerate the pool at all.

---

## 5 · The AI

### What it knows

Per round the AI holds **K private anchors** — positions whose true prize it knows
*exactly* — **plus every pre-opened position, plus every position the participant
reveals**. K is **3** in sparse rounds and **10** in dense ones, placed
**stratified**: one anchor drawn uniformly inside each of K equal strata.

Stratified rather than uniform, deliberately: a uniform draw of K positions
produces highly variable gap widths, which **blurs sparse and dense across the s\*
threshold** and destroys the sharpness of the prediction. `'uniform'` exists in
the config only as a switch nobody should flip.

### What it answers (§12)

- **At** an anchor → the true value.
- **Between** two anchors → the straight-line interpolation.
- **Beyond** the outermost anchor → that anchor's value, **flat**, however far
  out you ask.

Rounded to the nearest integer, and returned after a **fixed latency identical to
a reveal's**. Nothing about an answer — not its formatting, not its timing, not
the payload shape on the wire — distinguishes an exact answer from an invention.
The participant is told the mechanism in full and told K for the round, but
**never which positions the anchors occupy**.

Two consequences the design leans on:

- **An interpolation of the anchors can never exceed them**, so the AI's curve
  peaks *at* an anchor — a position where its number is the exact truth.
  Following the machine to its highest answer therefore lands on a *real* prize.
  This is why K is the lever rather than the cost: at K = 4 the best anchor is
  already worth 76% of the board's best in sparse rounds, and no reveal cost makes
  that a bad deal (`tools/SIMULATION-FINDINGS.md` §2).
- **The only geometry that punishes trust is the flat extrapolation** beyond the
  outermost anchor, where the AI repeats one number over a plateau the truth
  wanders away from. That is exactly what the FRONTIER layout builds.

### It learns from the participant

Every revealed position joins the anchor set, so the AI's answers **change** after
a reveal, and re-asking about the same position (at full cost) can return a
different number. `ai.allowRequery` is `true` and the act is logged; the debug
overlay's note says why the drawn curve moves and an earlier diamond is left off
the line.

### Two switches that must stay off

`ai.drawCurve` and `ai.markAnchors` remain **visible** in the admin panel behind a
red confirmation dialog, and must never be turned on. Drawing the full curve makes
consultation free — the participant reads every answer off a line instead of
paying for them one at a time. Marking the anchors makes the jaggedness visible,
so locating it stops being the scarce commodity. Either is a **different
experiment**; the confirmation text says so in those words, the session summary
raises a ⚠ box when one is on, and `selftest.js` asserts both are off in the
defaults.

---

## 6 · The arithmetic the whole design rests on

Everything is expressed in the per-step SD of the walk, which is derived from the
session's own step bound rather than hard-coded:

| Quantity | Formula | At the defaults |
|---|---|---|
| per-step SD | `σ = L / √3` | **5.7735** |
| verification threshold | `s* = c_R · √(2π)` | **10.027** |
| gap width where verification starts to pay | `g* = (2 s* / σ)²` | **12.06** |
| SD at the midpoint of a gap of width *g* | `σ √g / 2` | — |
| SD at depth *t* into a tail | `σ √t` | — |
| **sparse** mean anchor gap / mid-gap SD | `J/K = 33.3` | **16.67** — *above* s\* |
| **dense** mean anchor gap / mid-gap SD | `J/K = 10.0` | **9.13** — *below* s\* |

Inside a gap the walk is tied down at both ends, so its uncertainty is the
**Brownian-bridge** SD, `σ√((p−a)(b−p)/g)`, largest at the midpoint. In a tail
nothing holds the far side, so it grows as `σ√t`. Setting the two equal gives the
exchange rate the layouts are built around:

> **g = 4t** — an interior gap carries more uncertainty than the frontier only
> when it is **more than four times as long**.

### The straddle, and the admissible window for the reveal cost

The density manipulation only manipulates anything if **`s*` falls between the two
mid-gap SDs**. Outside that band verification pays either everywhere or nowhere.
Rearranging `s* = c_R√(2π)`:

> **`c_R` must lie in (3.64, 6.65)**, geometric centre **4.92**.

- Below **3.64**, `s*` drops under the *dense* SD → verification pays everywhere.
- Above **6.65**, `s*` rises above the *sparse* SD → trusting is correct
  everywhere.

`tools/selftest.js` asserts this window **against the configured values, not
literals**, so a future parameter edit that breaks the straddle fails in the test
suite rather than in the data. The admin panel's **Consequences** badge shows the
same check live, green when the two settings bracket `s*` and red when the design
has quietly become a gradient.

The K sitting exactly on the threshold at `c_R = 4` is **K\* = 8.29**: sparse must
stay below it, dense above it.

---

## 7 · Every default parameter, and why

Everything in `config.js`'s `DEFAULTS`, group by group. All of it is per-session
and frozen at the first entrant, **except the `ops` group**, which stays editable
for the session's life.

### 7.1 Environment (`env`) — §8

| Parameter | Default | Why |
|---|---|---|
| `positions` | **100** | The source study's line length. Long enough that a 3-anchor AI leaves real gaps, short enough that a slider is a usable instrument |
| `prizeMin` / `prizeMax` | **0 / 100** | Whole points, so a prize and a cost are in the same unit and the score is mental arithmetic |
| `stepBound` (L) | **10** | The one structural fact the participant is told. It sets σ, and through σ every threshold in §6. Also what makes the Lipschitz benchmark (`lipschitz_upper/lower`, `outside_window`) meaningful |
| `seedLowMin/Max` | **20 / 80** | The low band for the walk's start value |
| `seedHighMin/Max` | **80 / 100** | The high band |
| `seedHighProb` | **0.5** | Per the brief. *(Naming trap: it is read as "probability of drawing from the LOW band" in `generateOne`. At 0.5 it does not matter; anyone changing it must read the code.)* |
| `rounding` | `'nearest'` | Integers only, so an AI answer and a true prize are formatted identically |
| `poolSize` | **600** | **Deviates from the brief's 200, for a measured reason** — see below |
| `generatorSeed` | **20260813** | The frozen pool seed. `specSeed` = this + 1 = 20260814 |

**Why the pool is 600 and not 200.** Only about **2%** of (mapping, seed-set)
pairings pass the §9 acceptance filter at the brief's own parameters, and only
about **7%** of mappings admit *any* jitter of the BALANCED seed set. The cause is
an interaction between two rules the brief states separately: `build_pool` keeps
only mappings whose global maximum is ≥ 80, which lifts the whole curve (the
highest of three seeded positions has a median of 91), while the filter asks for
that highest seeded value to land **between 30 and 60**. With 200 mappings the 16
seeded specs cannot each get a distinct curve, and the builder would have to serve
**the same prize mapping in two rounds** — which would make the instruction *"the
prizes are drawn afresh in every round"* false, and would show up in the data as
an unmodelled repeated measure. The pool is generated and never shipped, so a
larger one costs nothing. `Specs.validate()` **fails** a session whose specs repeat
a mapping, so this cannot regress silently.

### 7.2 Costs and limits (`costs`) — §7

| Parameter | Default | Why |
|---|---|---|
| `revealCost` (c_R) | **4** | **Deviates from the brief's 5** — see below. Must stay inside (3.64, 6.65) |
| `queryCost` (c_AI) | **2** | The **ratio** is the premise of the study and should not move: a question at half the price of a reveal makes the AI worth consulting. Measured: a rational searcher with the AI scores 68.62 against 69.52 without it — consulting is genuinely tempting and genuinely not free |
| `queryCap` | **40** | A guard rail, not a constraint. The heaviest simulated questioner asks **4.90** per round. 0.0% of rounds touch either cap |
| `revealCap` | **20** | Same. The heaviest simulated revealer opens **10.54**. The brief contradicts itself here (§7, §17b and §20b say 20; the §20c table says 30) — **the three-to-one reading wins**, and the choice is inconsequential because what limits search is the reveal *cost*, not the cap |
| `scoreFloor` | **false** | A round may end negative, and that is **recorded**. A floor would censor exactly the observations that show a participant over-spending on a machine they trusted |

**Why the reveal cost moved from 5 to 4** (with sparse K, below — the two move
together or not at all). Measured over 1,000 simulated participants playing all 28
rounds of the real frozen artifacts under seven policies
(`tools/simulate.mjs`; tables in `tools/SIMULATION-FINDINGS.md`):

- **Search has to pay**, which pushes `c_R` *down*. At c_R = 4 the study's own
  myopic-EI benchmark opens **2.24** positions a round and buys **+10.64** points
  over spending nothing. At the brief's 5 it buys only +6.19. An arm in which
  effort does not pay cannot show what an AI does to effort.
- **The straddle has to survive**, which pushes `c_R` *up*: it must stay above
  3.64.
- The sweep is monotone and unambiguous in both directions. At c_R = 8 unaided
  search buys **−0.95** — a pure loss — and the apparent "AI effect" swells to
  +9.98 purely because the alternative got worse. At c_R ≤ 3 the straddle fails
  outright.

c_R = 4 sits inside the window with 66% of margin above and 9% below.

### 7.3 The AI (`ai`) — §3, §12

| Parameter | Default | Why |
|---|---|---|
| `sparseK` | **3** | **Deviates from the brief's 4** — see below |
| `denseK` | **10** | Unchanged. Its mid-gap SD (9.13) sits 9% below `s*` and its measured AI error is 5.69 points — comfortably the "trust it" regime |
| `placement` | `'stratified'` | One anchor per equal stratum. Uniform placement blurs the two densities across `s*` (§5) |
| `answerRounding` | `'nearest'` | An answer must be indistinguishable from a prize by its formatting |
| `allowRequery` | **true** | Re-asking after a reveal is a *meaningful* act — the answer legitimately changes — so it is allowed and logged rather than blocked |
| `drawCurve` | **false** | Must never be on (§5) |
| `markAnchors` | **false** | Must never be on (§5) |

**Why sparse K moved from 4 to 3.** At the brief's K = 4 the sparse/dense contrast
is a **gradient, not a sign change**: a trusting participant gains +4.30 in sparse
rounds and +7.85 in dense ones — same sign, and predicting "the AI helps at K = 10
and hurts at K = 4" would be predicting something the design as built does not
produce. The reason is structural, not a tuning problem: the AI's curve peaks at
an anchor, so following it lands on a real prize worth 76% of the board's best
even at K = 4. **Fewer anchors lowers the best anchor**, and a pointer worth
following becomes a pointer worth checking. Measured:

| sparse / dense K | sparse SD | dense SD | straddle | trusting · sparse | trusting · dense | difference |
|---|---|---|---|---|---|---|
| 2 / 10 | 20.41 | 9.13 | yes | −13.65 | +5.00 | −18.65 |
| **→ 3 / 10** | **16.67** | **9.13** | **yes** | **−4.14** | **+5.00** | **−9.14** |
| 4 / 10 | 14.43 | 9.13 | yes | −2.96 | +5.00 | −7.96 |
| 6 / 10 | 11.79 | 9.13 | **NO** | +1.51 | +5.00 | −3.49 |

At K = 3 the sign genuinely flips (−4.14 against +5.00) and the sparse/dense
difference roughly doubles. **K = 2 is stronger still but two anchors on a hundred
positions is barely an AI**, and the instructions have to state K to the
participant. **Do not raise sparse K**: at 6 the nominal straddle fails outright.

Moving **both** parameters is what flips the sign; **neither alone does**
(c_R = 4 with K = 4 → −2.96 sparse, still helped; c_R = 5 with K = 3 → −0.56).
They also help each other: sparse K = 3 is what widens the admissible cost window
to (3.64, 6.65), so c_R = 4 sits comfortably inside it rather than on an edge.

### 7.4 Round structure (`rounds`) — §10

| Parameter | Default | Why |
|---|---|---|
| `warmupPerBlock` | **2** | Enough to meet both kinds of screen (one OPEN then one BALANCED) before anything counts. Never analysed |
| `scoredPerBlock` | **12** | 24 scored rounds total. Simulated: a participant's own 12-round mean varies across people with SD ≈ 3.4 per condition, and the paired difference SD is 5.63 |
| `openPerBlock` | **4** | Blank rounds are where the step-size replication against the published estimate is valid |
| `seededPerBlock` | **8** | Pre-opened rounds are where the first decision's geometry is **experimenter-assigned** — the primary analysis moment |
| `shapeMix` | **FRONTIER 2 · BALANCED 4 · GAP 2** | BALANCED is doubled because it is the knife edge (§8) — the cell where a treatment effect has somewhere to show |
| `densitySeeded` | **SPARSE 4 / DENSE 4** | Density balanced *within* each shape as well as within the block, so density never confounds shape |
| `densityOpen` | **SPARSE 2 / DENSE 2** | Same |
| `seedJitter` | **±2** | Small on purpose: **the geometry is the treatment**, so it must not be blurred. Enough to stop three identical layouts recurring verbatim, not enough to move a shape across the `g = 4t` line |
| `shuffleWithinBlock` | **true** | Order effects are randomised per participant; the realised order is logged (`shuffle_seed`, `round_order`) so it is reproducible from the log alone |

### 7.5 Assignment (`assign`) — §11

| Parameter | Default | Why |
|---|---|---|
| `sequenceAssignment` | `'block'` | Block randomisation over a shuffled list gives an **exact** 50/50 split, not a series of coin flips |
| `freezeSeeds` / `freezeAnchors` | **true** | Every participant meets the same 28 mappings and the same anchors. Mapping difficulty is then balanced across conditions **by construction**, not by luck |
| `nextEntrantOverride` | `'auto'` | The **one** control that stays unlocked after launch, for repairing a live imbalance. Forcing it **demands a written reason**, which is logged and travels into the export — forced assignment is no longer pure randomisation and the analysis has to say so |

### 7.6 Acceptance filter (`filter`) — §9

Applied to every (mapping, pre-opened set) pairing of a **seeded** round.

| Parameter | Default | Why |
|---|---|---|
| `minGlobalMax` | **80** | The round must have somewhere genuinely worth finding |
| `seedHighestMin` / `Max` | **30 / 60** | The best **pre-opened** value must be *middling*. Too low and any move looks good; too high and stopping immediately is correct and the round measures nothing |
| `minHeadroom` | **25** | The global maximum must sit at least this far above the best pre-opened value — the reward for searching has to exceed the noise |
| `applyToOpen` | **false** | **Blank rounds are unfiltered by design.** The step-size manipulation check compares the AI-off arm against a published estimate, and filtering would break that comparison |

Spec generation tries **24 different jitters of the seed set against one mapping**
before moving on (`SEED_TRIES`). §9 says to "reject and redraw the pairing", and
the pairing is (mapping, seed set) — burning a whole mapping per rejected jitter
would exhaust even a 600-mapping pool at a 2% pass rate.

### 7.7 Operations (`ops`) — editable at any time

| Parameter | Default | Why |
|---|---|---|
| `runName` | `'untitled'` | |
| `entryOpen` | **false** | A session is created as a **draft**. Nobody can enter until entry is opened, which is a deliberate, summarised act |
| `windowFrom` / `windowTo` | `''` | Optional scheduled window; outside it the participant sees the closed screen |
| `minViewport` | **900** CSS px | The round screen is a three-column layout with a 960-wide plot. Below this the plot stops being readable and the data stops being comparable. The width is **logged either way**, and widening the window is enough to carry on — no button to find |
| `allowResume` | **true** | |
| `resumeWindowH` | **24** | |
| `idleWarnMin` | **10** | |
| `exitSurvey` / `debrief` | **true** | |
| `gateQ2` | `'strict'` | The scoring question **must** be answered correctly to continue: a participant who thinks the AI's number is the prize is not in the experiment |
| `gateOther` | `'record'` | Everything else **records attempts and lets them through**. A repeated failure there is a covariate, and possibly a finding, not a nuisance |
| `rosterMode` | `'open'` | Any code, including a Simulation Platform student ID, enrols itself on first entry and takes the under-filled sequence. `'roster'` restricts entry to pre-generated codes |
| `compute` | `'client'` | Where score-bearing actions run. **Default off** so a project with no Cloud Functions deployed still works out of the box; **server is the recommendation** once Functions are deployed. It sits in `ops` only so it can be configured before launch — it **locks with the task parameters**, because mixing the two inside one session would put two kinds of row in one dataset |
| `completionCode` | `''` | Shown on the Done screen; blank means none needed |

### 7.8 Constants outside `DEFAULTS`

| Constant | Value | Why |
|---|---|---|
| `SEED_BASE.FRONTIER` | 40, 47, 54, 61 | A tight central cluster: `g/4t = 0.045` |
| `SEED_BASE.BALANCED` | 8, 52, 92 | The knife edge: `g/4t = 1.375` |
| `SEED_BASE.GAP` | 3, 50, 97 | A wide interior gap: `g/4t = 3.92` |
| `BATCH_SIZE` / `BATCH_MS` | 12 / 10 s | Telemetry flush trigger, whichever comes first |
| `SLIDER_THROTTLE_MS` | 250 | One slider row per 250 ms **plus one on release**. Cheap to capture, impossible to recover later |
| `HEARTBEAT_MS` | 30 000 | `active_ms` is summed from heartbeats, so twenty minutes away never looks like twenty minutes of thinking |
| `APP_VERSION` | `v3.0.0` | Stamped on every logged row |
| `DEBUG_KEY` | `stouras` | `?debug=1&key=…` gates the testing overlay; a participant can never trigger it |
| `LATENCY_MS` (app.js) | **320** | The client-side floor: a query and a reveal release after the same delay, so response time cannot signal which action was taken |
| `FIXED_MS` (functions) | **260** | The server-side pad. Measured: a median **267 ms** at an anchor and **267 ms** in a gap |
| `IDLE_FIRST_MS` / `IDLE_AGAIN_MS` | 45 s / 90 s | Nudge timings (§10) |

---

## 8 · Round structure, layouts and the acceptance filter

### The 28 specs

Deterministic in (parameters, `specSeed`): **the same 28 specs for every
participant of a session.** Mapping indices are consumed from one shuffled pass
over the pool, so **no mapping is ever used twice** — the validation gate fails a
session that repeats one.

Per block: 2 warm-up (one OPEN/sparse, one BALANCED/dense) then 12 scored — 4 open
(2 sparse / 2 dense) and 8 seeded (FRONTIER 1+1, BALANCED 2+2, GAP 1+1). Of the 28
specs, **18 are pre-opened and 10 are blank**.

Spec ids are `B<block>-<nn>` for scored rounds and `B<block>-W<n>` for warm-ups.

### Why three layouts, and why all three are needed

The pre-opened positions carve the line into two kinds of unknown: a **gap**
(pinned at both ends) and a **tail** — the frontier (pinned on one side only).
Because the AI interpolates but cannot extrapolate, **its blind spot is the
frontier**. Measured from the shipped seed positions:

| Layout | pre-opened | widest gap g | tail t | g / 4t | benchmark first move to the frontier | where a rational searcher looks first |
|---|---|---|---|---|---|---|
| **FRONTIER** | 40, 47, 54, 61 | 7 | 39 | **0.045** | 0.99 | the frontier |
| **BALANCED** | 8, 52, 92 | 44 | 8 | **1.375** | 0.38 | either — the knife edge |
| **GAP** | 3, 50, 97 | 47 | 3 | **3.92** | 0.10 | the widest interior gap |

*(These are what the panel computes live from the session's own parameters, with
tail = max(left, right) and the frontier share as `1/(1+(g/4t)^1.6)`. The brief's
own simulated shares are 1.00 / 0.51 / 0.03; the **ordering and the side of 1 each
shape falls on** — which is what the design rests on — are identical, and that is
what the tests pin.)*

The simulator confirms the manipulation works **with no AI on the screen at all**:
the frontier share of first moves is 100.0% under FRONTIER, 42.9% under BALANCED
and 0.0% under GAP — a 100-percentage-point spread. Against that, the AI moves the
frontier share by −6.28 points in the mixed population: smaller than the layout
effect, and in the predicted direction. **Run only GAP rounds and an AI that pulls
people off the frontier would be undetectable, because the frontier was never
worth visiting.**

One analysis caveat the simulator surfaced: a round can end with **no first move
at all** — the myopic benchmark opens nothing in 8.3% of its rounds, because the
best pre-opened value is already good enough. Those rounds have no frontier
outcome, so the primary outcome's denominator is smaller than the round count and
has to be reported as such.

---

## 9 · Assignment and the crossover

**Sequence A** = block 1 without the AI, block 2 with it. **Sequence B** = the
reverse. Assignment is decided **once**, persisted immediately, and travels on
every row — a participant is never re-randomised mid-study.

Three paths, in priority order:

1. **Pre-generated roster codes** carry their sequence, block-randomised over a
   shuffled A/B list seeded on the session id, so the split is exactly half and
   half.
2. **Open mode** (the platform case): `claimCode` assigns transactionally from
   `runCounts`, taking the under-filled arm, so the split stays exact even as
   students arrive in an unpredictable order.
3. **No Firebase**: `hash('seq:' + runId + ':' + code) % 2`, deterministic per
   participant.

A **next-entrant override** can force A or B for the next arrival. It demands a
written reason, appends to an override log on the session document, and the log is
exported on the Run sheet.

Within a block the 12 scored specs are shuffled from `hash(participant_code)`,
with a **per-block RNG stream** (`seed ^ (0x9E3779B9 * block)`) so block 2's order
does not depend on how many draws block 1 happened to consume. Warm-ups always
come first and are never shuffled into the scored set.

---

## 10 · The participant app, screen by screen

```
code entry → consent → instructions 1–5 (+ comprehension gate)
  → warm-up block 1 → [AI instructions + AI gate, if block 1 is AI-on]
  → block 1: 12 scored rounds → block transition
  → [AI instructions + AI gate, if block 2 is AI-on] → warm-up block 2
  → block 2: 12 scored rounds → exit survey → debrief → done
```

**Entry.** `?code=` is the session code; `?pcode=` (or a Simulation Platform
handoff, or `PROLIFIC_PID`) is the participant code. With neither, the page shows
a code gate and refuses to start. §11 of the brief forbids names, e-mail addresses
and free-text identifiers, so the study takes **only** the student ID — the join
key between the two datasets — and nothing else.

**A missing or unreachable session never strands a participant.** The built-in
defaults *are* the recommended parameter set, so the study runs either way and the
rows carry `run_id = null`, which the export reports honestly.

**Consent** is a single checkbox that enables the button. **Instructions** are five
pages (the line; neighbours differ by at most L; revealing costs; stopping and
scoring; rounds are independent). All prose lives in `content.js` as data, with
tokens (`{J}`, `{L}`, `{revealCost}`, `{queryCost}`, `{revealCap}`, `{queryCap}`,
`{scored}`, `{warmup}`, `{K}`) substituted at render time, so the words cannot
drift from the parameters.

**The comprehension gates** (6 base questions, 6 AI questions) carry three
deliberate design choices:

- **The facts needed to answer are on the same screen as the questions.** The
  participant read the instructions several screens ago; asking them to recall a
  number they saw in passing tests memory, not comprehension.
- **Every question must be answered** before anyone moves on — leaving one blank
  is not the same as getting it wrong, and an unanswered question records no
  attempt, which would hollow out the measure.
- **Every answered question says whether it was right, and a correct one carries
  the reason.** The point of the gate is that the rule is *understood*; a tick with
  no explanation teaches nothing.

Only `qai_score` blocks (`gateQ2: 'strict'`). Attempts, time to first answer and
first-answer correctness are logged per question; `qai_outside` (what the AI's
answer is based on beyond its outermost known position) becomes the participant
flag **`understood_frontier`**.

**AI instructions come before the first AI round, warm-up included** — in both
blocks. The brief orders them warm-up → AI instructions for block 1 but the
reverse for block 2; block 1's order would put an unexplained "Ask the AI" button
in front of a participant, so block 2's order is followed in both.

**The round screen** is three columns:

- **Left — the ledger only.** Questions asked and their cost, positions revealed
  and their cost, total spent, best prize **found**, selected position, **score if
  you stop right now**, rounds remaining, and the prices, always on screen. What
  was *found* lives on the plot, where every mark already carries its value; the
  panel used to repeat it in words, which asked the participant to read the same
  thing twice. There is deliberately **no "best estimate"** mixing claims with
  truths, and the "score if you stop now" line uses the best **true** prize held,
  never the selected position — an unopened position has no known value and
  guessing at it there would hand over the truth for free.
- **Centre — the plot**, a legend, and the same four numbers big underneath
  (best prize found · spent revealing · spent asking · **net value if you stop
  now**), then the position controls: arrows, a slider and a number box.
- **Right — the three actions**, each with a one-line note. "Ask the AI" is
  **absent** in AI-off rounds, not disabled.

**The keyboard works everywhere.** Arrow keys move the selection by one wherever
focus sits — except inside a form control, which handles arrows itself. Buttons
are *not* excluded, because after any click focus sits on a button and excluding
them silently killed the arrow keys, which is exactly the state a keyboard user
ends up in.

**Latency parity** is enforced on both sides: the client releases the UI only
after `LATENCY_MS` (320 ms) whichever action it was, and each Cloud Function pads
to `FIXED_MS` (260 ms). Neither the wire nor the clock can distinguish an exact AI
answer from an invented one.

**Nudges** are short, friendly and dismissible. They never block anything and
never say *what* to choose — only that the participant may act, and how the round
is scored: after 45 s with no action, after 90 s of further idleness, and once
after three consecutive rounds ending with nothing bought. **Every appearance is
logged as telemetry with its kind**, because an unlogged prompt is an uncontrolled
intervention.

**Between rounds** the true prize at the nominated position is shown, with the
whole sum itemised — prize won, cost of revealing, cost of asking, round score —
plus what the AI had said there and by how much it was out. A participant should
never have to work out where their score went, and **every round ends with them
learning whether the machine was right**.

**The exit survey** is twenty items in six parts. Design choices worth recording:
free text comes **before** multiple choice within each part, so the options never
supply the vocabulary; the debrief comes after every question, so nothing in it
contaminates an answer; Part F (background) is coarse bands only and entirely
optional, because with ~90 participants from one population a fine-grained
combination is close to identifying; and **any Part F item the Simulation Platform
already answered is not asked again** — it travels with the row as
`platform_<field>` instead, so the two datasets carry one answer each rather than
two that can disagree. Free-text items are never compulsory: forcing prose
produces noise.

**The debrief** explains the mechanism in full and then **redraws one of the
participant's own rounds** — the AI round where they asked the most, because that
is where the discrepancies are visible — with the true prizes, the AI's whole
curve, its private anchors, the answers they paid for and what they revealed. In
server mode the truth for it comes from a Function that serves it only for a round
that is already finished.

**Resume (§17.7).** State is kept in `localStorage` and mirrored to the
participant document. A round that was open when the browser closed is **restarted
from its beginning and flagged `interrupted`**, which ships as a *column*, not a
filter. A round already nominated is not replayable — the server refuses it — or a
participant could re-roll a bad score.

**Logout** clears every `searchv2:` key and signs the device out. The logger is
stopped **first**, because its `pagehide` flush fires during the navigation and
would otherwise write the event mirror straight back into the storage just
cleared.

---

## 11 · The plot

Inline SVG, 960 × 400, drawn by `chart.js`. Two decisions matter:

**The vertical axis is fixed at 0–100 and never autoscaled**, so the visual
difficulty of a round can never depend on its realised range.

**The marker vocabulary keeps claims and truths apart:**

- **pre-opened** — filled square, the true prize, free at the start
- **revealed** — filled circle, the true prize the participant paid for
- **asked** — open diamond, the AI's *stated* value

A position that was both asked and revealed shows **both** markers, so the
discrepancy between what the machine said and what was there stays on screen.

The renderer is **pure**: it draws only what it is handed. Unrevealed truth, the
AI's curve and its private anchors reach it only when a caller explicitly turns on
the testing or debrief overlays — which the app never does for a live participant,
and which `tools/smoke.mjs` asserts on a live round by checking that `.gt-line`,
`.ai-line` and `.anchor-dot` are absent from `#plot` and that `#testview` is not
displayed.

---

## 12 · Where the score is computed: two backends

`backend.js` puts two implementations behind one promise-returning interface —
`claimCode`, `startRound`, `act`, `nominate`, `debriefRound`, `plan`,
`canSeeTruth`.

**SERVER mode (the recommendation).** The client sends a **position**; the Cloud
Function holds the mapping, computes the answer or the truth, charges the cost,
appends the authoritative event and returns **one number**. The mapping never
reaches the browser. Three properties are enforced and tested against the real
emulator:

1. **Identical response** whether or not the position was one of the AI's private
   anchors — the same keys, the same payload shape, and every handler padded to a
   fixed duration so the clock cannot leak it either.
2. **Idempotent on a client-generated `actionId`** — a retried reveal after a
   dropped connection returns the recorded answer and charges nothing further,
   while a *different* action id on an already-open position is refused outright.
3. **`nominate` computes the score.** A client total is never trusted.

In server mode the client is not even told the specs: no spec id, no seed shape,
no density, no pre-opened positions, no anchors. What it *does* get is the
**shape** of the session — how many rounds, which block each sits in, whether it is
scored, and which condition it runs under — because the flow needs that to know
when to show the AI instructions, and none of it is secret (the condition follows
from the participant's own sequence). Everything else arrives one round at a time
from `startRound`, which is the only place pre-opened **values** reach the client,
and only for positions that are open to the participant anyway.

**LOCAL mode.** The client computes from a pool it regenerates from the session's
seed. This is what runs with no Firebase at all, in the admin's test round (where
the testing overlays must work), and on a project without the Blaze plan. A
determined participant with developer tools could read a round's prizes there — the
honest reason server mode is the default recommendation.

**The two are never mixed inside a session, and a server-mode failure is never
silently downgraded to local.** Falling back would quietly void the integrity
property the session was configured for and put two kinds of row in one dataset.
The participant sees *"We could not reach the study server"* with a reload button;
`serverProblem()` also logs a `server_error` row.

Which mode a session uses is a **locked session parameter** (`ops.compute`), set
before the first participant.

### Event-id banding on the server

Authoritative rows are one document each, and the id must be unique across the
whole session, so each round gets a band:

```
round_index * 1000        round_start
                 + 1..899 decisions (the caps allow at most 60)
                 +   900  the stop decision
                 +   901  round_end
```

This is a scar with a story: the round end used to be written at
`roundIndex * 1000 + 1000`, which is the **next** round's `round_start` — same id,
`{merge:false}` — so starting round N+1 destroyed round N's `round_end`. In a
28-round session 27 of 28 authoritative round rows were overwritten and
`rounds.csv` came out with one row per participant.

---

## 13 · Data model, logging and the security rules

### Firestore layout (§17.3)

```
runs/{runId}                  parameters, status, locked flag, frozen specs, seeds
runPublic/{runId}             the REDACTED client-readable copy
runCodes/{code}               code → runId, so participants never list runs
runCounts/{runId}             sequence counters, transactionally assigned
roster/{runId}__{code}        one entrant: sequence, claim, status
participants/{runId}__{code}  the session record of §16.1
  └ rounds/{roundIndex}       server-only per-round state (queries, reveals, score)
events/{eventId}              the append-only event log
audit/{auditId}               admin actions
messages/{msgId}              admin → participant messages
```

**`events` must keep its name.** `simulation/admin/verify.js` reads it and matches
`event == 'session_end'` on `pid` to tick a student's card on the class platform.

### The rules, and what each one is defending against

- **The event log is append-only *by rule*, not by convention.** A participant may
  create their own rows and can never update or delete one; only the admin may
  read them. This matters concretely: participant codes are **university student
  IDs**, so document ids are guessable, and a signed-in user allowed to update an
  existing row could rewrite the values in another participant's rows.
- **A run document is admin-only whenever `serverMode == true`**, because it
  carries `generatorSeed`. The Admin SDK inside the Functions bypasses the rules,
  so the server still reads it. In local mode the client necessarily derives the
  pool from the same seed, so there is nothing to hide and the run stays readable.
- **`runPublic`** is what the participant boots from in server mode: costs, caps,
  round counts and operational flags — **no seeds, no specs, no anchors, no
  filter**.
- **Run parameters refuse to change once the session is locked.** The lock is set
  by `claimCode` on the first entrant. Editing a live session is *impossible*,
  not discouraged.
- **The roster is never listable** — a listable roster is an enumerable list of
  every valid code. A participant may `get` the one document whose id they already
  know, and may only write it to bind it to their own uid.
- **`runCounts` must be writable by an entrant** (they increment it inside their
  own claim transaction), so instead of being closed it is *constrained*: only the
  two integer keys, only ever increasing, and by at most one in total. That leaves
  nothing worth tampering with.
- **The per-round server state is `read: admin, write: false`.** A client that
  could read it would learn the answers; one that could write it would set its own
  score.
- Everything else is denied by default.

### The logger

Two classes of event:

- **RECORDS** — every `query`, `reveal` and `stop`, round and session boundaries,
  comprehension answers, survey responses. **One flat document each, written the
  moment they happen, never batched, never updated.** These are the analysis.
- **TELEMETRY** — slider moves (throttled to 250 ms plus one on release), 30-second
  heartbeats, focus/blur, instruction opens, resizes. Buffered and flushed as
  **one document holding an array** every 10 s, at every round end and on page
  hide. Written individually, slider moves alone would be six figures of
  documents; batched they are a few hundred.

**Three redundant paths:** Firestore (durable), a `localStorage` mirror (survives a
reload and an outage), and a downloadable JSON/CSV on the Done screen.

**A decision row carries the complete information state at the instant before the
action** — including **both** anchor sets: `ai_anchors_before` (what the AI knows,
private anchors included) and `participant_known_before` (what the participant
knows), plus `participant_queried_before`, the two "best" values, the counts, and
the timing and scanning that preceded the choice. Anchor sets are encoded
`"12:44|37:61|88:9"` because Firestore rejects nested arrays and a CSV cell must
stay one cell.

Two robustness scars worth keeping:

- **The sync watermark is contiguous, not a maximum.** Rows are written
  concurrently, so a row that failed while a later one succeeded used to be jumped
  over and never retried. Acked sequence numbers are held until the run below them
  is complete, and failed rows are also retried **within** the session every 20 s —
  without that, a write that failed while the connection was down survived only
  until the tab closed, and for the last participant of the day that is the end of
  the study.
- **`logger.FIELDS` is a whitelist, and anything not in it does not exist.**
  `raw_score` and `nomination_type` were logged by `app.js` but missing from the
  list, so they were silently dropped from **every real session** — while the
  export's bot path set them directly, which is why the offline tests never
  noticed. The round rows now recompute the score from the mapping
  (`final_score_check`, `score_mismatch`) so a discrepancy is flagged rather than
  hidden.

---

## 14 · Derivation: nothing in the browser

**Log raw state, derive nothing in the client (§16).** The browser writes what
happened; **every** derived quantity of §16.8 is computed offline by
`admin/export.js`, from the raw rows plus the frozen pool and specs. A formula that
turns out to be wrong then costs one rerun of a script rather than the data.

`ai.js` is shared between the live answer and the offline derivation, so an
analysis can never disagree with what the participant was shown. It supplies:

- **geometry** — `choice_region` (gap / left_tail / right_tail), `is_frontier`,
  `gap_width`, `gap_fraction`, `tail_depth`, `dist_to_nearest_anchor`,
  `max_gap_available`, `max_tail_available`, `exchange_ratio`
- **uncertainty** — `ai_sd` (Brownian bridge in a gap, `σ√t` in a tail),
  `verify_pays` (`ai_sd > s*`)
- **rationality benchmarks** — the **Lipschitz window** (`lipschitz_upper/lower`;
  every anchor bounds every other position, capped at the prize range) and
  `outside_window` (the ceiling is below the best known value, so the reveal is
  dominated); **expected improvement** and the myopic-EI surface, giving
  `max_ei_available`, `ei_argmax_position`, `matched_benchmark`, `ei_regret`
- **AI truth-checks** — `ai_prediction`, `ai_error`, `hit_private_anchor`,
  `ai_curve_max`

Three derivation decisions that are easy to get wrong and are therefore pinned by
comments and tests:

**The AI's anchor set is reconstructed, never trusted from the row.** A stop row
carries no anchors — no writer supplies them, and in server mode the browser could
not know them — so trusting the field left the *nomination*, the decision this
study is about, with no AI geometry at all, handed `eiSurface` an empty set, and
made `matched_benchmark` come out TRUE for anyone who stopped at position 1.

**Server and client rows are one row.** In server mode an action is written twice
on purpose: the Function writes the authoritative values (it is the only side with
the mapping), the browser writes the timing and the scanning (the only side with a
clock in front of the participant). Both carry the same `event_id`. They are merged
with server fields winning where both are present, and `info` blobs merged
key-by-key — merging whole-blob would keep one side and silently drop the other's
keys.

**First answer wins when a position was queried more than once.** Once a position
is revealed it joins the AI's anchor set, so a re-query there returns the truth;
keeping the *last* answer made every verify-then-recheck look like a wasted
verification and zeroed the very error the participant had caught.

Also: `frontier_share` counts a reveal made when **nothing is yet known** as a
frontier move. It used to sit in the denominator and never the numerator, which
biased the primary outcome down by 1/n in exactly the rounds it is measured in —
the open ones, which by construction start with nothing known.

---

## 15 · The admin panel

`/lab/search-v2/admin/` — six tabs over the brief's six screens. It runs in **local
preview** against browser storage until Firebase is configured, so parameters,
consequences, validation, the preview and the dry run all work before anything is
set up.

### Vocabulary

**The UI calls the unit a SESSION.** The brief calls the same object a *run*, and
**the data keeps that name** — every event, round and participant row carries
`run_id`, and the workbook has a Run sheet — so the two words mean one thing and
existing analysis scripts are untouched. Rename UI copy only.

### The governing rule: clone, do not edit

A session is an **immutable parameter set**. The moment its first participant
claims a code, every parameter that touches the task locks: the fields render
greyed with a padlock and the lock date, and the only way to change anything is
**Clone**, which copies the parameters into a fresh id with its own pool, specs and
roster. Two parameter sets can therefore never be silently pooled. **The lock is a
Security Rule, not a UI state** — the panel refuses it too, but only so the panel
stays honest about what the database will do.

Only the **Operations** group and the **next-entrant override** stay editable.
`ops.compute` is the deliberate exception in the other direction: it lives in
Operations for convenience but locks with the task parameters.

### A session is summarised before it can bite

Two moments are one-way in practice — **creating** freezes the pool and all 28
specs under the seeds, and **opening entry** starts the clock on the lock — so both
put the whole configuration in front of the admin as prose, once, in the order it
matters: the session · rounds · the task · the AI (including **whether the two
densities still bracket `s*`**, and a ⚠ if a testing overlay is on) · assignment ·
after the task · the participant link. **Cancel is a real cancel** —
`tools/admin-smoke.mjs` asserts that a cancelled summary creates nothing.

Opening entry additionally **refuses until the validation gate passes**.

### Tab 1 · Sessions

Grouped **Active** and **Completed** with a count each. One card per session:
code · status · lock tag · name · created · id · participant count · completed
count · sequence balance · round count · and a chip saying **where the score is
computed**.

Buttons: **Open · Copy link · ⬇ Export data · 🧪 Test round · Clone · Open entry /
Close session · Delete**.

- **Copy link** is dropped on a completed session — its link would refuse the
  entrant, and offering a dead link is worse than offering none.
- **Export data** is the whole job in one press: select the session, read the log,
  build the workbook, save it. The Data screen opens behind it so the tables and
  health checks are there to look at.
- **Test round** opens the participant flow in a sandbox that writes nothing (§17).
- **Delete** removes the session **and its event log**, confirm-guarded with the
  participant count and an "export first" warning.

The buttons use the **same `.sBtn` pill family** as the ideasearchlab and Answer
Arena admin panels — same height, radius, weight and colour roles, **1 px border on
every variant** (transparent on the filled ones) so a row sits on one baseline. See
the repository's `CLAUDE.md` for that shared contract.

### Tab 2 · Parameters (+ Consequences beside it)

Six collapsible groups — **Environment · Costs and limits · AI · Round structure ·
Assignment · Acceptance filter**, each tagged *locked after launch* — plus
**Operations**, tagged *editable at any time*. Every control is declared once in a
`FIELDS` table, so reading the form, writing it and locking it stay in step.

Four buttons underneath, unchanged in number and colour from the previous panel:
**Save session** (green), then **Cancel edit**, **Make this the default** and
**Restore built-in default** (ghost). "Make this the default" saves to this
machine's browser only; it never touches a stored session.

The two AI overlay switches are behind a red confirmation that spells out what
turning them on would change about the experiment.

**Consequences** recomputes live beside the form: σ, `s*`, `g*`, both mean anchor
gaps and mid-gap SDs (each annotated *above s\** / *below s\**), the `g = 4t`
exchange rate, a benchmark frontier share per layout, rounds per participant,
expected reveals per round without the AI, an estimated session length, the maximum
spend in one round, and the pool statistics **recomputed from the seed the form
currently holds**.

Two badges:

- **Sign-change badge** — green when sparse sits above `s*` and dense below it;
  **amber** when both are on the same side but within 20% of it; **red**
  otherwise, saying in words that the design now tests a gradient and the sample is
  not sized for that.
- **Seed-shape badge** — green when at least one layout puts the benchmark first
  move near a coin flip (0.3–0.7), so a treatment effect has somewhere to show;
  red when all three point the same way.

### Tab 3 · Roster

Generate anonymous codes (prefix + 3 digits) with an **exact 50/50
block-randomised** split, export them as CSV, and see per-code status (unused / in
progress / completed) with claim times and whether the entry was pre-generated or
self-enrolled. Auto-generated session codes use a 5-character alphabet with **I, O,
0 and 1 removed**, because codes get read aloud and typed.

The **next-entrant override** lives here, demands a reason, and writes an override
log that ships with the export.

### Tab 4 · Live monitor

Counters from a Firestore listener on the participants collection — started, in
progress, completed, abandoned, sequence A/B, plus a warning box when the sequence
gap exceeds 3. A per-participant table with phase, round, active minutes,
resumptions, viewport and flags, and a **message** button that pushes a one-off
note to that participant's screen.

Underneath, the **health strip**, each row flagged against a threshold chosen to
mean "look at this now":

| Check | Warns when |
|---|---|
| median active time per participant | < 30 min or > 70 min |
| median time per round | < 20 s |
| comprehension failures on the scoring question | > 10% |
| failures on the jaggedness / frontier questions | > 40% |
| query or reveal cap hit | > 3% of rounds |
| immediate-stop rate in seeded rounds | > 60% |
| participants with a median decision < 500 ms | any |
| rounds with a blur longer than two minutes | any |
| viewport below the minimum | any |

The counters never scan the event log; only the health rows that need it read
whatever has been loaded.

### Tab 5 · Data & preview

- **Validation gate** — adjacency over the whole pool, the acceptance filter over
  every seeded spec, the anchor count per spec, **no mapping served twice**, and
  shape/density balance in both blocks. A session cannot open until it passes.
- **Preview a round spec** — play any single spec exactly as a participant would,
  writing nothing.
- **Dry run** — a scripted bot (living in `export.js`, so the panel and
  `selftest.js` drive the *same* session) plays two whole sessions against the
  session's real specs in memory and reports which columns stayed empty in each of
  the three analysis sheets. It also **builds the workbook and throws the bytes
  away** — the export is the point of the dry run, and checking the columns without
  exercising the writer would miss exactly the failure it exists to catch — and it
  proves that bot rows produce **0** rows in a real export.
- **Export** — the workbook plus `decisions.csv`, `rounds.csv`,
  `participants.csv` and the raw log, with row counts and a checksum.
- **Danger zone** — reset one participant's rows (reason required, audited) and
  close the session.

### Every round, drawn

At the bottom of Data & preview the panel draws **one plot per round of the
session, in the frozen order**: the hidden prize walk, the prizes that start open
(with values), the positions the AI knows exactly, and the line it interpolates
between them — each behind its own tick box, plus *mark the best position* and
*scored rounds only*. Under every plot: what is pre-opened, where the best prize
is, and how many positions the AI knows.

It is the fastest way to see whether a session's parameters produced the geometry
they were meant to — a FRONTIER round really clustering its seeds, a sparse round
really leaving the AI guessing — **before anyone plays it**.

**All of it is admin-only, and that is the point.** The ground truth is the whole
secret of the study.

### Tab 6 · Design notes

The questions this design attracts, answered **against the code** rather than the
document, with **every number measured from the open session's own frozen pool at
render time**: does the AI hold private data; what a pre-opened round is and why it
exists (identification — the geometry at the first decision is
experimenter-assigned); gaps vs tails and `g = 4t` with the live per-layout table;
why all three layouts are needed; whether the landscape changes each round; and the
ceiling-plateau decile table with the tie-rule explanation.

It also disambiguates the word **"seed"**, which carries three unrelated meanings
in this codebase and would break the design silently if mixed up:

1. **pre-opened positions** — what the participant starts with (`pre_opened`,
   `seed_shape`, the filter's "highest pre-opened value")
2. **the walk's start value** — where the random walk is anchored before it is
   drawn outwards (labelled *walk start value* in the Environment group)
3. **the RNG seed** — reproducibility (`generatorSeed`, `specSeed`, `shuffle_seed`)

It also states plainly that **"Brownian" here runs across positions, not across
time**: the path is drawn once, offline, and then sits still. Position 1…100 is a
spatial index, not a clock; nothing evolves while the participant works.

---

## 16 · The exported workbook

One `.xlsx` per session, plus three CSVs. Sheet order:

**ReadMe · Dictionary · Run · Specs · Decisions · Rounds · Participants · Slider ·
Attention · Raw**

**The Dictionary sheet is what makes the rest legible**: every column of the three
analysis sheets described in a sentence with its type, generated from
`admin/dictionary.js`. `tools/selftest.js` **fails** when a column is exported
without an entry, so the two cannot drift — *a derived field nobody can define in a
sentence is a field nobody should be analysing.*

The data sheets stay tidy while doing that: one row per observation, one column per
variable, no merged cells, no spacer rows; header frozen and filterable; numbers as
numbers; **booleans as real Excel booleans** (so a cell reads TRUE/FALSE and parses
as a boolean in pandas — the same as the CSVs); timestamps as **both** epoch
milliseconds and ISO 8601; and an **empty cell meaning *not applicable*, never
zero**.

Join keys: `participant_code + round_index` (Decisions → Rounds),
`participant_code` (→ Participants), `spec_id` (→ Specs).

Each export bundles the session's **frozen configuration, seeds, checksums and
override log**, so the parameters always travel with the data. `xlsx.js` is a
dependency-free OOXML writer — no CDN.

The two exclusion flags — **`interrupted`** at the round level and
**`disengaged`** at the participant level — are **columns, not filters**, so every
analysis states its own rule. `disengaged` is set when the median decision is under
500 ms, or when more than half of the participant's reveals came with no slider
movement since the previous action.

---

## 17 · The Simulation Platform contract

Students reach this study from **stouras.com/simulation/**, so the two datasets
have to join. `tools/platform-guard.mjs` pins the whole contract in both
directions.

**Platform → study.** The launch handoff's `studentId` becomes this study's
`participant_code` **and** is carried as `pid`. That is the only join key, and **no
second identifier is invented**. A background question the platform has already
answered — level of study, age band, gender — is **not asked again**; its answer
travels as `platform_<field>`, flagged as to its source. **Nothing else from the
profile is stored**: the student's name and e-mail address never reach this
study's log. The handoff is read directly from `localStorage` rather than waiting
for `/simulation/prefill.js` (which is deferred and runs after this script, while
the participant code has to resolve during boot), under the same freshness rule
(6 hours) and the same `SIMP_EXPECT` sim guard.

**Study → platform.** Finishing writes a `session_end` row carrying `pid` — the
exact row `simulation/admin/verify.js` matches on — and calls
`window.simpMarkCompleted()`, so the student's card flips to "✓ Completed" on its
own.

**A rehearsal does neither.** `?preview=1&debug=1&key=…` opens the admin test round:
a constant ribbon says nothing is saved, `SIMP_EXPECT` is switched off so the
completion marker is never even defined, the student's ID is never adopted, the
backend is **always local** (so the testing overlays work and no Function is
reached), consent and the gates are skipped, and the rows carry no `run_id`, so
they could never be pooled with real data.

This app is one of six in the repository's **"every class simulation that can have
one has a 🧪 Test round"** family; see `CLAUDE.md` for the shared contract and the
other five.

---

## 18 · Tests, and what each one pins

```bash
node lab/search-v2/tools/selftest.js          # 213 checks, no browser
node lab/search-v2/tools/smoke.mjs            # a whole 28-round session
node lab/search-v2/tools/admin-smoke.mjs      # the admin panel
node lab/search-v2/tools/platform-guard.mjs   # the platform contract, both ways
node lab/search-v2/tools/layout-guard.mjs     # reachability at five window sizes
node lab/search-v2/tools/preview-guard.mjs    # the sandbox writes nothing
node lab/search-v2/tools/emulator-test.mjs    # the REAL Functions + Rules
python3 lab/search-v2/tools/generate_rounds.py --validate
```

What the important ones exist to catch:

- **`selftest.js`** — the PRNG's determinism and its Python parity; the brief's §8
  statistics; the pool; the acceptance filter; spec generation and balance; the
  crossover; the AI's answer; **the `s*` straddle window, asserted against the
  configured values rather than literals**; `g = 4t`; the geometry and rationality
  benchmarks; that every exported column has a Dictionary entry; that the two
  overlay switches are off; and that the **vendored Functions engine is identical**
  to the originals.
- **`smoke.mjs`** — plays a real session in a browser and asserts that the live
  plot contains **no** ground truth, **no** AI curve and **no** anchors.
- **`emulator-test.mjs`** — drives the real Cloud Functions and Security Rules in
  the Firebase emulator: identical response shape and timing at an anchor and in a
  gap, idempotency on `actionId`, server-side scoring, and that the rules refuse
  what they claim to refuse. Skips cleanly without Java / firebase-tools.
- **`layout-guard.mjs`** — reachability and containment at five window sizes,
  standing in for cross-engine coverage together with the ES5-era source rule.

**Tests must never hard-code a study parameter or a board position.** The specs are
regenerated from the seeds whenever K changes, so which positions start pre-opened
moves: the browser tests **choose** a revealable position (a pre-opened one
correctly has its reveal button disabled) and read costs from
`window.CONFIG.DEFAULTS`, after waiting out the latency gate that disables every
button.

---

## 19 · Deployment hazards this build has already hit

Both of these have actually happened; both now fail loudly.

**Always name the project.** The repository holds six unrelated Firebase projects,
and the CLI takes its target from a project it remembers *per folder* in its own
global config **before** it reads the `default` alias in `.firebaserc`. A deploy run
from this directory therefore published these rules into another study's database
and reported a clean success — it locked Answer Arena's participants out until its
own rules were re-published. `tools/check-project.mjs` now runs as a predeploy hook
on both targets and **aborts** when the resolved project is not the `.firebaserc`
default.

```bash
cd lab/search-v2
firebase use search-with-ai-456d7                                # once per machine
node tools/sync-engine.mjs
firebase deploy --only functions       --project search-with-ai-456d7
firebase deploy --only firestore:rules --project search-with-ai-456d7
```

**On Windows this file is `svfirebase.js` and must never be renamed to
`firebase.js`.** CMD searches the current directory before PATH and `.JS` is in the
default `PATHEXT`, so a `firebase.js` here makes `firebase` run *that file* under
Windows Script Host: every command prints nothing, exits cleanly and deploys
nothing.

Also: `npm install --prefix _functions/functions` runs as a predeploy step, because
the CLI needs `firebase-functions` resolvable locally to work out what to deploy and
a fresh clone otherwise fails. The runtime is **nodejs22** — Node 20 was deprecated
on 2026-04-30 and is decommissioned on 2026-10-30.

The Firebase config shipped with the client (API key, project id) **is not a secret
and is not meant to be one**. Security comes from the Rules and from Auth.

---

## 20 · Deviations from the design brief

Everything else follows the brief line by line. These five do not, and each is
recorded because an appendix will need them.

| Deviation | Why |
|---|---|
| Reveal cost **4**, not 5, and sparse **K = 3**, not 4 | Measured over 1,000 simulated participants: at the brief's values the AI-OFF arm is barely a search arm and the sparse/dense contrast is a gradient, not the sign change the design rests on. Moving both flips it; neither alone does (§7.2, §7.3) |
| Mapping pool of **600**, not 200 | Measured: ~2% of pairings pass the §9 filter, so 200 cannot give 16 seeded specs a distinct curve each (§7.1) |
| Reveal cap **20** | §7, §17b and §20b say 20; the §20c table says 30. The three-to-one reading wins, and the choice is inconsequential |
| Mean anchor gap read as **J/K** | §17b writes `100/(K+1)` but quotes 25.0 for K = 4, and the SD beside it, 14.43, is `σ√25/2`. The values are right and the formula is a slip |
| AI instructions come **before** the first AI round, warm-up included | §13 orders them warm-up → AI instructions for block 1 but the reverse for block 2. Block 1's order would put an unexplained "Ask the AI" button in front of a participant (§10) |

Two of the brief's own figures do not reproduce from the numbers printed next to
them: the benchmark `g/4t` for BALANCED and GAP. **The ordering, and the side of 1
each shape falls on — which is what the design rests on — are intact**, and that is
what the tests pin.

---

## 21 · Known drift and open maintenance

Recorded here rather than quietly fixed, because each is a copy-editing decision
about participant-facing text or documentation, not a behaviour change. **Verified
2026-08-14.**

1. **`content.js` uses an unsubstituted token.** The three adjacency questions'
   `why` explanations contain `{stepBound}`, but `tokens()` in `app.js` substitutes
   `{L}` — so the feedback renders the literal text "{stepBound}" to a participant
   who answers those questions. *Fix: rename the token to `{L}` in `content.js`, or
   add `{stepBound}` to `tokens()`.*
2. **Two participant-facing strings still say the AI knows 4 positions.** Survey
   item `s07` ("In some rounds the AI knew 4 positions and in others it knew 10")
   and the `DEBRIEF` prose ("4 of the 100 in some rounds") predate the sparse K
   change to **3**. *Fix: tokenise them, or update to 3.*
3. **`admin/dictionary.js` describes `ai_density` as "SPARSE (K=4)".** Same
   provenance; it reaches the exported Dictionary sheet.
4. **`README.md` says `selftest.js` runs 211 checks.** It runs **213**.
5. **`tools/SIMULATION-FINDINGS.md` reads oddly because it was regenerated after
   the recommendation was adopted** — the simulator's "current settings" are now the
   recommended ones, so §6 reads *"Move the REVEAL COST from 4 to 4"* and some
   before/after comparisons quote the same number twice. Every measured table in it
   is correct and current; only the recommendation prose is self-referential. *Fix:
   either leave a note at its head, or re-run the sweep with the brief's values
   pinned as the baseline.*
6. **`SEEDS.md`'s run log is empty.** Add a row whenever a session is frozen for
   data collection — the export's Run sheet carries the same values, but the
   repository should be able to answer "which sessions were real" on its own.

Neither 1–3 changes any recorded quantity: `ai_k` is written per round from the
specs, so the **data** is right in every case; it is the prose describing it that
is stale.

---

## 22 · Verifying the numbers in this document

Every derived figure in §4, §6 and §8 comes from `config.js` and can be recomputed
in one command:

```bash
cd lab/search-v2
node -e "
const CFG=require('./config.js'), Pool=require('./pool.js'), Specs=require('./specs.js');
const P=CFG.DEFAULTS, sigma=CFG.sigma(P.env.stepBound), sStar=CFG.sStar(P.costs.revealCost);
const sdS=sigma*Math.sqrt(P.env.positions/P.ai.sparseK)/2, sdD=sigma*Math.sqrt(P.env.positions/P.ai.denseK)/2;
console.log('sigma',sigma.toFixed(4),'s*',sStar.toFixed(3),'g*',CFG.gStar(P.costs.revealCost,P.env.stepBound).toFixed(2));
console.log('sd sparse',sdS.toFixed(2),'sd dense',sdD.toFixed(2));
console.log('c_R window',(sdD/Math.sqrt(2*Math.PI)).toFixed(2),'..',(sdS/Math.sqrt(2*Math.PI)).toFixed(2));
const pool=Pool.buildPool(P.env,P.env.generatorSeed);
console.log(Pool.poolStats(pool));
console.log('validate', Specs.validate(pool, Specs.buildSpecs(pool,P,P.env.generatorSeed+1), P).pass);
"
```

The admin panel's **Consequences** and **Design notes** tabs display the same
quantities for whichever session is open, measured from *that* session's frozen
pool — so if this document and the panel ever disagree, **the panel is right and
this file is stale**.

---

*Companion documents: `README.md` (operating and deploying), `SEEDS.md` (frozen
seeds and the run log), `tools/SIMULATION-FINDINGS.md` (the measurements behind the
two changed defaults), and the repository's `CLAUDE.md` (cross-app conventions:
the admin button family, the test-round contract, the Simulation Platform).*
