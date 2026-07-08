# Trust the AI? — How it works

`lab/jagged/index.html` is a **single, self-contained** static page (no build step,
no backend, no external CDN, no data collection). It is a teaching game about
**Artificial Jagged Intelligence**: a model that is reliable near what it has learned
and unreliable — while looking equally confident — in the gaps between. The player
acts as a user of such a model and repeatedly decides whether to **trust** the AI's
answer or **pay to verify** it.

This document describes the full functionality. The underscore prefix (`_HOW-IT-WORKS.md`)
keeps Jekyll from publishing it; the served page is `index.html`.

---

## 1. The idea

- AI knowledge is **jagged**: a model can be excellent on one question and confidently
  wrong on an almost identical one.
- Why: a model reliably knows the answers it has actually seen (its **knowledge points**),
  and for every other question it **interpolates** from those. Near a knowledge point it
  is accurate; far from one, in a wide gap, its answer is a confident-looking guess that
  can be badly off.
- The page is a **conceptual model** of this, plus a game about how a user searches such
  a model for correct answers — the trade-off between **interpolating** (relying on what
  the model already "knows") and **exploring** (spending to find out).

---

## 2. The formal model

The whole world lives on a 1-D map of **questions** `x ∈ [0, 100]` (integer positions
`1..100`). Each question has a correct **answer** `y(x) ∈ [0, 1]`.

### 2.1 The hidden truth — a reflected Brownian walk
`buildLandscape()` draws the true answer curve as a Gaussian random walk (a discretised
Brownian motion), reflected to stay in `[0, 1]`:

```
truth[1] = 0.5
truth[x] = truth[x-1] + N(0, STEP_SD²)      // STEP_SD = 0.05
           reflected into [0,1]:  if <0 → −v ;  if >1 → 2−v
```

Brownian motion is scale-free, so the per-question **roughness** is set by `STEP_SD`, not
by any finer discretisation; sampling at integer positions is already an exact Brownian
sample at those points. The truth is **hidden** from the player during a round.

### 2.2 What the AI knows — knowledge points
The AI knows the true answer exactly at `K` scattered positions (its training data /
"knowledge points"):

- `K = K_SPARSE = 6` under **Sparse** coverage, `K = K_DENSE = 14` under **Dense**.
- Positions are drawn uniformly at random in `[4, 97]` (a Poisson process with the count
  pinned, so difficulty is predictable).

### 2.3 The AI's answer everywhere — interpolation
`computeInterp(truth, known)` produces the AI's answer `ai[x]` and its local uncertainty
`sd[x]` for every `x`:

- **Between** two neighbouring knowledge points `lo < x < hi`: linear interpolation
  `ai[x] = truth[lo] + t·(truth[hi] − truth[lo])`, `t = (x−lo)/(hi−lo)`.
  Local std is the **Brownian-bridge** posterior std
  `sd[x] = STEP_SD·√((x−lo)(hi−x)/(hi−lo))` — zero at the dots, largest mid-gap.
- **Beyond** the outermost dots: flat extrapolation (`ai` holds the nearest end value) and
  `sd[x] = STEP_SD·√(distance to that end point)` — uncertainty grows without bound.

So the AI's confidence looks uniform (a smooth line) while its true reliability is jagged.

### 2.4 The questions you face — the inspection paradox
A round has `N_Q = 15` questions, drawn **uniformly at random**, distinct, and excluding
the AI's own knowledge points (so you never get a trivial freebie on a dot). Because a
uniform draw lands in a long gap more often than a short one, you disproportionately face
the AI's weak spots. Questions are drawn once at the start of a round and served in order;
they are **not** adaptive or correlated with your past choices.

---

## 3. The decision and scoring

Each question you choose one of two actions:

- **Trust the AI** (free): submit the AI's answer. You are paid for accuracy:
  `trustPoints(err) = clamp(100 − 200·err, −40, 100)`
  where `err` is the distance between the AI's answer and the truth. `+100` if spot on,
  dropping by 2 points per 0.01 of error, floored at `−40` in a bad gap.
- **Verify** (`−20`): pay to reveal the true answer and submit it, for a guaranteed
  `verifyPoints() = 100 − 20 = +80`.

**Break-even.** Setting the two equal, `100 − 200·err = 80 → err = 0.10` (`GOOD_ERR`).
So trusting beats verifying only when the AI's error is below **0.10**.

**Displayed-value consistency.** The AI answer and truth are rounded to 2 decimals for
display, and `err` is computed from those rounded values, so the shown "off by" always
equals `(AI answer − truth)` exactly (e.g. `0.21 − 0.20 = 0.01`). Scoring uses the same
rounded `err`.

**Feedback (after each choice).** Shows what happened and the counterfactual, e.g.:
> The AI said **0.85**; the truth was **0.69** (off by 0.16), **outside** the ±0.10 trust
> zone. Trust would score +68; Verify +80. You chose Trust for +68; verifying would have
> given +80 (12 more).

Green when the choice was optimal, red when it left points on the table. Under Shared
learning it also notes "The AI just learned position N…".

---

## 4. The plot

Drawn as inline SVG (`drawPlot`), the game/preview plot can contain:

- **Blue dots** — the AI's knowledge points (drawn at their true answers).
- **Blue line** — the AI's interpolated answer everywhere.
- **Blue shaded band** — the AI's uncertainty, `ai[x] ± 2·sd[x]` (clamped to `[0,1]`),
  i.e. **≈ a 95% range, not a hard bound** — the true curve can occasionally lie outside.
- **Green "trust zone"** — a `±0.10` bracket around the AI's answer at the current question.
  If the hidden truth lands inside it, trusting beats verifying; outside, verifying wins.
- **Red dashed L-guide** — from the x-axis up to the AI's answer marker (reads the question),
  then across to the y-axis (reads the answer value).
- **Hollow blue circle** — the AI's answer at the current question.
- **Red dots** — true answers that have been revealed (your verifications this round).
- **Red curve** — the full true answer, shown only on the end-screen reveal.

Which of these are visible depends on the **reliability** condition (§5.2).

---

## 5. Experimental conditions (the levers)

Three start-screen toggles reshape the playing environment. Together they frame the
question of what turns raw model capability into usable value: how much the model has
learned, whether you can see where it is reliable, and whether using it makes it better.

### 5.1 Coverage — Sparse / Dense (scaling)
Sets `K` (6 vs 14 knowledge points). More data → denser dots → smaller gaps → usually
safer to trust. This is the effect of AI "scaling."

### 5.2 Reliability — Blind / Band (blind vs calibrated)
What you can see about local reliability:

- **Blind** — you see only the AI's answer for the current question (the marker) and the
  trust zone. No dots, no line, no band. A *blind* user.
- **Band** (default) — you see the AI's knowledge points, its interpolated line, and the
  shaded ≈95% uncertainty band. A *calibrated* user who can read where the model is unsure.

(Showing the exact band is the **perfect-calibration** benchmark; a realistic extension
would be a *noisy* reliability signal that interpolates between Blind and Band.)

### 5.3 Shared learning — Off / On (a data flywheel)
- **Off** — the AI's knowledge is fixed for the round.
- **On** — each knowledge point you **verify** is added to the AI's model: it re-interpolates
  (`computeInterp`) so its line bends to pass through that point and its gaps shrink where you
  searched. This makes model improvement **endogenous and targeted** at the spots users probe
  (a data flywheel), rather than exogenous scaling. It lets you study whether verifying is an
  *investment* that pays off on later nearby questions, whether usage fills the widest gaps
  first, and the public-good externality of your checks improving the model for everyone.

---

## 6. Screen flow

1. **Start screen** (`#s-start`)
   - Title, the "AI knowledge is *jagged*" intro (with links to Karpathy's tweet and the
     "jagged frontier" article), a **What the map shows** legend of the axes and marks, a
     **Your task** blurb, and a **How points are scored** box with a worked example.
   - A **concept illustration** plot: a fresh random landscape (reshuffles when you toggle
     Sparse/Dense) with two labelled arrows in a header band above the plot — one to the
     AI's dots + line, one to the true curve. The arrows never overlap the curve.
   - An **Experimental conditions** section: the three toggles plus a live **"Your playing
     environment under these conditions"** preview (`drawPreview`) that redraws for the
     selected toggles over a stable base landscape, with a one-line caption.
2. **Game** (`#s-game`) — 15 questions. Left panel: fixed payoffs, running score, progress.
   Centre: the plot. Right: the current question, the AI's answer, **Trust** / **Verify**,
   the feedback, and **Next question**. Top-right **How it works** reopens the rules modal.
3. **Done** (`#s-done`) — reveals the full true curve over the AI's line, compares the
   player to **Always trust / Always verify / Perfect play** as bars, and gives an insight
   line counting over-trusting (trusted in gaps) vs over-verifying (paid near dots).

No consent form, survey, or rounds beyond the single 15-question run. **No data is collected
or transmitted.**

---

## 7. Constants (top of the `<script>`)

| Constant | Value | Meaning |
|---|---|---|
| `N_POS` | 100 | number of questions (x-axis positions) |
| `N_Q` | 15 | questions per round |
| `CORRECT` | 100 | points for a correct answer |
| `VERIFY_FEE` | 20 | cost to verify (verified answer scores 80) |
| `PEN` | 200 | trust penalty slope (points lost per unit error) |
| `FLOOR` | −40 | worst possible trust outcome |
| `STEP_SD` | 0.05 | roughness of the hidden truth (Brownian step std) |
| `K_SPARSE`, `K_DENSE` | 6, 14 | knowledge points under Sparse / Dense |
| `GOOD_ERR` | 0.10 | error below which trusting beats verifying (the trust zone) |
| `HEADER` | 104 | reserved band above the plot for the illustration's callouts |

---

## 8. Key functions

- `gauss()` — standard normal (Box–Muller); `clamp`, `round2`, `randint` — helpers.
- `computeInterp(truth, known)` — the AI's `ai[]` (interpolation) and `sd[]` (Brownian-bridge
  std) from its knowledge points. Used by the game, the demo, the preview, and Shared learning.
- `buildLandscape()` — generates a round: truth walk, `K` knowledge points, `ai`/`sd`, and the
  15-question sequence.
- `drawPlot(target, opts)` — renders a plot. `opts.mode` (`'blind'`/`'shown'`) controls
  visibility; `opts.current` adds the current-question marker, trust zone, and L-guide;
  `opts.revealed` draws red truths; `opts.showTruth` draws the full true curve; `opts.annotate`
  draws the header band with the two explanatory callouts.
- `drawDemo()` — the annotated concept illustration (random landscape at the current coverage).
- `genPreviewBase()` / `drawPreview()` — the "Your playing environment" preview; the base
  landscape is stable across reliability/shared toggles and reshuffles on coverage change.
- `trustPoints(err)`, `verifyPoints()` — scoring.
- `startRound()` → `renderQuestion()` → `decide(choice)` → `nextQuestion()` → `finish()` — the
  round loop. `decide` also applies Shared learning on Verify.
- `showScreen`, `segWire`, `resetSegs`, `calloutSVG` — screen switching, toggle wiring, reset,
  and the annotation callouts.

---

## 9. Modifying it

- Change the numbers in §7 to retune difficulty (e.g. `STEP_SD` for roughness, `K_SPARSE`/
  `K_DENSE` for coverage, `GOOD_ERR`/`VERIFY_FEE`/`PEN` for the trust-vs-verify trade-off).
- Change the treatment logic in `buildLandscape` / `computeInterp`.
- The plot is inline SVG in `drawPlot`; the copy is in the `#s-start` section and the
  How-it-works modal.
