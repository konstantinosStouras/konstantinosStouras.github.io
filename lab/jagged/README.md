# Trust the AI? — A Jagged Intelligence Game

**Live:** <https://www.stouras.com/lab/jagged/>

A single-page, self-contained browser game about **Artificial Jagged
Intelligence (AJI)** — the observation that an AI model can be brilliant on one
question and confidently wrong on an almost identical one. You play the role of
a *user* of such a model and, question by question, decide whether to **trust**
its answer or **pay to verify** it. It is a teaching tool: a hands-on,
playable illustration of when an impressive model actually helps you, and when
its confident-looking answer is a guess you should check.

There is **no build step, no backend, no external code or fonts, and no data
collection**. Everything — the model, the game, and the plot — runs in the page
from one `index.html`. The chart is drawn as inline SVG.

> This document describes **what the app does** and how to play it. For the
> internal mechanics — the exact formulas, the random-walk generator, the
> function-by-function breakdown, and the tunable constants — see
> [`_HOW-IT-WORKS.md`](./_HOW-IT-WORKS.md).

---

## The idea behind it

AI knowledge is **jagged**. A model reliably knows the answers it has actually
seen (its *knowledge points* — its training data), and for every other question
it **interpolates** from those, filling in the gaps between what it knows.

- **Near** a knowledge point, the model is accurate.
- **Far** from one, in a wide gap, its answer is a confident-looking guess that
  can be badly off.

Crucially, the model *looks equally confident everywhere*. Its reliability is
jagged, but its presentation is smooth. The whole game is a conceptual model of
this gap between apparent confidence and true reliability, and of how a user
searches such a model for correct answers — the trade-off between
**interpolating** (relying on what the model already "knows") and **exploring**
(spending to find out).

The framing draws on Andrej Karpathy's term *"jagged intelligence"* and the
*"jagged frontier"* of Dell'Acqua et al. (2026), and the app itself is inspired
by Joshua Gans, *"A Model of Artificial Jagged Intelligence"* (2026,
arXiv:2601.07573). Links to the first two appear on the start screen.

---

## The map

Everything happens on a one-dimensional **map of questions**:

- **x-axis — the question.** Positions `1…100`. A one-dimensional space of every
  question you could ask. Questions that sit close together are *similar*, so
  their correct answers are related.
- **y-axis — the answer.** A value in `[0, 1]`: the correct answer to that
  question.

On the plot you may see:

| Mark | Meaning |
|---|---|
| **Red curve** | The **truth** — the correct answer to every question. It is rough (neighbouring questions differ a little) and is **hidden from you** while you play. It is revealed only at the end. |
| **Blue dots** | What the AI **actually knows** — the questions it has learned exactly (its training data / knowledge points). |
| **Blue line** | The AI's **answer everywhere**: it simply connects its dots and reports that value. It hugs the truth near its dots and drifts away in the wide gaps — while looking just as confident. |
| **Blue shaded band** | The AI's **uncertainty** (shown only in the "Band" condition). Roughly a 95% range: zero at the dots, widest mid-gap. The truth can occasionally fall outside it. |
| **Green "trust zone"** | A ±0.10 bracket around the AI's answer at the current question. If the hidden truth lands **inside** it, trusting beats verifying; **outside**, you should have verified. |
| **Red dots** | True answers you have **revealed** by verifying this round. |

---

## Your task and how it plays

You face **15 questions** in a round. Each one can land anywhere on the map, so
you will often fall in the AI's blind gaps. For each question you see the AI's
confident answer and choose one of two actions:

- **Trust the AI** *(free)* — submit the AI's answer as your own. You are paid
  for accuracy: **+100** if it is exactly right, losing **2 points for every
  0.01** the AI is off. (In a bad gap the score can go negative, down to a floor
  of **−40**.)
- **Verify** *(−20)* — pay 20 to look up the true answer and submit that, so you
  are right: a guaranteed **+80**.

After you choose, the true answer is revealed for that question and you get
immediate feedback: what the AI said, what the truth was, how far off it was,
whether that fell inside or outside the ±0.10 trust zone, what each action would
have scored, and whether your choice was the better call. Then you advance to
the next question.

### The core trade-off

Because verifying always locks in +80, **trusting is the better bet only when
you expect the AI to be off by less than 0.10** — that is exactly where
`100 − 200 × error = 80`. The catch is that you must make that judgement
*before* seeing the truth, reading it from how close the question sits to the
AI's known dots (and, in the Band condition, from the uncertainty band).

**Worked example.** The AI answers **0.60**.
- If the truth is 0.55 (off by 0.05) → Trust scores `100 − 200×0.05 = +90`,
  which beats +80, so **trust**.
- If the truth is 0.80 (off by 0.20) → Trust scores `100 − 200×0.20 = +60`,
  below +80, so you **should have verified**.

Displayed values (the AI's answer and the truth) are rounded to two decimals,
and the error is computed from those rounded values, so the "off by" number you
see always matches `AI answer − truth` exactly.

---

## The three experimental levers

The start screen has three toggles that reshape your playing environment. Each
maps to a real question about what turns raw model capability into value people
can actually use. A live preview ("Your playing environment under these
conditions") redraws to show what you would face, so you can compare conditions
before playing.

### 1. Coverage — Sparse / Dense *(scaling)*
How much the AI has learned. **Sparse** = few knowledge points (wide gaps, often
better to verify); **Dense** = many knowledge points (small gaps, usually safe
to trust). This is the effect of AI "scaling" — more data means denser dots.

### 2. Reliability — Blind / Band *(calibration & discoverability)*
What you can see about where the model is reliable.
- **Blind** — you see only the AI's answer for the current question and the
  trust zone. No dots, no line, no band. A truly blind user.
- **Band** *(default)* — you see the AI's known points, the line it
  interpolates, and a shaded ~95% uncertainty band. A calibrated user who can
  read where the model is unsure.

### 3. Shared learning — Off / On *(a data flywheel)*
Whether using the AI makes it better.
- **Off** — the AI's knowledge is fixed for the round.
- **On** — every point you **verify** is added to the AI's model: its line bends
  to pass through that point and its blind gaps shrink where you searched. This
  makes model improvement *endogenous* and *targeted* at the spots users probe,
  rather than exogenous scaling. It lets you explore whether verifying becomes an
  investment that pays off on later nearby questions, whether usage fills the
  widest gaps first, and the public-good externality that your checks improve the
  model for everyone.

---

## The end screen

After 15 questions the app reveals the **full true curve** drawn over the AI's
line, so you can see exactly where the AI was accurate (at its dots) and where
it drifted (in the gaps) while looking equally confident throughout.

It then compares your score against three benchmarks, as bars:

- **You** — what you actually scored.
- **Always trust** — trusting on every question.
- **Always verify** — verifying on every question.
- **Perfect play** — an oracle that always picks the better action (the maximum
  achievable score).

An insight line counts your two failure modes: how often you **over-trusted**
(trusted in a gap where the AI was off by more than 0.10) and how often you
**over-verified** (paid to check when the AI was actually fine).

---

## Why the questions feel hard — the inspection paradox

Questions are drawn **uniformly at random** across the map (distinct, and
excluding the AI's own knowledge points, so you never get a trivial freebie on a
dot). Because a uniform draw lands in a long gap more often than a short one, you
disproportionately encounter the AI's weak spots — the same reason a randomly
chosen moment tends to fall in a long interval. This makes the "trust everything"
strategy quietly costly.

---

## Privacy

**No data is collected or transmitted.** Nothing leaves your browser — there is
no analytics, no network request, no storage of results. Reload or hit
**Restart** and everything regenerates fresh.

---

## For maintainers

- The entire app is `index.html`. Game behaviour is controlled by the constants
  near the top of its `<script>` (`N_Q`, `CORRECT`, `VERIFY_FEE`, `PEN`,
  `STEP_SD`, `K_SPARSE`, `K_DENSE`, `GOOD_ERR`, …) and by the landscape logic in
  `buildLandscape` / `computeInterp`.
- `_HOW-IT-WORKS.md` documents the internals in full (the reflected Brownian
  walk, the Brownian-bridge uncertainty band, the interpolation/extrapolation
  rules, scoring, the plot renderer, and every function). Its leading underscore
  keeps Jekyll from publishing it; the only served page is `index.html`.
</content>
</invoke>
