# How humans play *PortfolioFit* — a gameplay guide for an LLM

> **Purpose.** This file explains, for a language model, **how a human plays the
> game at https://www.stouras.com/lab/portfoliofit/** — the objective, the
> decisions, the KPIs, the constraints, and the concrete actions a player takes.
> It is a *gameplay* reference (what the player does and why), not an
> architecture reference. For how the app is *built* (Firebase, admin CMS, event
> logging, experiment flow), see the sibling `CLAUDE.md` in this folder.
>
> **Note (research integrity).** This file is deliberately **not published** by
> the site (its name starts with `_`, so Jekyll excludes it) because it spells
> out the optimal strategy and the "trap" bricks. Live participants must never be
> shown the optimum, so keep this internal.

---

## 1. One-paragraph summary

PortfolioFit is a timed, single-screen **project-portfolio packing game** framed
as a knapsack / bin-packing problem. The player is shown a **4×4 frame** (16
empty cells) and a tray of **eight differently-shaped "project bricks"**, each
tagged with a **dollar value**. The player drags/taps bricks into the frame —
rotating and flipping them to fit — trying to **maximise Net Value** before a
countdown timer expires. **Net Value = (dollar value of all placed bricks) −
($1 penalty for every empty cell left in the frame).** The catch: the bricks
with the highest value-per-cell (ROI) are usually **traps** — grabbing them
greedily blocks the frame and leaves gaps. Exactly **one** combination of bricks
both fills the whole frame *and* reaches the highest Net Value; the player's job
is to find *that* portfolio, not just *any* fit.

---

## 2. The objective (what "winning" means)

- **Primary objective:** maximise **Net Value** at the moment the timer hits
  zero. There is no other score.
- **The round does NOT end when the frame is full.** It ends **only when the
  timer runs out.** Filling the frame early is celebrated, but the player is
  expected to keep going — removing and re-placing bricks to push Net Value
  higher — until the buzzer. Whatever is on the board at time-zero is the score.
- Each puzzle has a **unique best portfolio** (see §7). A perfect play finds it
  and holds it to the end.

There is no "submit" button that ends a round early; the green button in the UI
advances the *experiment flow* (see §9), not the timer.

---

## 3. The playing field and the pieces (the givens)

### The frame (board)
- **Always the same fixed 4×4 square = 16 cells.** Every puzzle, Easy or Hard,
  uses this identical board. The board geometry never changes.
- Cells are addressed as `"row,col"` with `row` and `col` in `0..3`
  (`"0,0"` = top-left, `"3,3"` = bottom-right).

### The bricks (a fixed library of 8 polyominoes)
All eight bricks are **always shown** in the tray, but only a **4-brick subset**
can tile the 16-cell board (areas must sum to 16). The shapes and colours are
fixed; **only the dollar values change from puzzle to puzzle.**

| Brick | Type | Cells (area) | Colour |
|-------|------|--------------|--------|
| `I3` | tromino | 3 | teal (`#1abc9c`) |
| `L`  | tetromino | 4 | tan (`#c9b458`) |
| `S`  | tetromino | 4 | green (`#2ecc71`) |
| `T`  | tetromino | 4 | blue (`#3498db`) |
| `L5` | pentomino | 5 | orange (`#e67e22`) |
| `Y`  | pentomino | 5 | purple (`#9b59b6`) |
| `P`  | pentomino | 5 | red (`#e74c3c`) |
| `N`  | pentomino | 5 | yellow (`#f1c40f`) |

- There is **one tromino, three tetrominoes, four pentominoes.**
- Any full cover of the 16-cell board must therefore be
  **tromino (3) + two tetrominoes (4+4) + one pentomino (5) = 16.**
  So a filling portfolio is always `I3` + two of `{L,S,T}` + one of
  `{L5,Y,P,N}`.
- Each brick may be used **at most once** (one instance per name).

### The dollar values (what makes each puzzle different)
- Values are **whole dollars**, drawn per puzzle from **$3–$19**.
- The generator keeps every brick's **$/cell ratio distinct** (no ties) and
  accepts a value assignment only if the puzzle has a single, unique best
  portfolio (see §7). **Difficulty comes entirely from the values, never the
  board shape.**
- Each brick in the tray displays **its dollar value and its value-per-cell
  (ROI)**.

---

## 4. The KPIs (the dashboard the player reads)

These update live on every placement/removal. Let `occ` = occupied cells,
`empty` = 16 − occ, and `TotalValue` = sum of the dollar values of placed
bricks.

| KPI | Formula | Meaning / how the player uses it |
|-----|---------|----------------------------------|
| **Net Value** | `TotalValue − ResourceCost` | **THE objective.** Shown large and central; green when positive, red when negative. Higher is better. |
| **Total Value** | Σ value of placed bricks | Gross value packed so far. |
| **Resource Cost** | `$1 × empty` | Penalty for wasted space — every empty cell costs $1. Shown as a negative. |
| **Coverage** | `occ / 16 × 100%` | How much of the frame is filled. |
| **Value/Resource** (ROI) | `TotalValue / occ` | Efficiency = value per occupied cell. |
| **Portfolio Fitness** | geometric compactness (see below) | How tightly the placed bricks pack together. |

**Portfolio Fitness** is a *geometric* compactness score, **not** a value score:
occupied cells as a share of the *fillable* board cells that fall inside the
**convex hull** of the placed bricks. A contiguous, gap-free cluster scores
**100%**; spreading bricks apart, or leaving holes between them, pulls empty
cells into the hull and lowers the score. (With 0 bricks it reads `N/A`; with
1–2 bricks it reads 100%.)

Every KPI tile has a **hover/tap tooltip** with a plain-language explanation, so
players learn the metrics as they go.

### Worked KPI example
Frame 4×4 (16 cells). Player has placed bricks worth **$17 + $14 + $18 = $49**
covering **12 cells** (4 cells still empty):
- Resource Cost = `$1 × 4 = $4`
- Net Value = `$49 − $4 = $45`
- Coverage = `12/16 = 75%`
- Value/Resource = `$49 / 12 ≈ $4.08` per cell

If the player then adds a $10 brick that fills the last 4 cells:
- Total Value = `$59`, empty = 0, Resource Cost = `$0`
- **Net Value = $59** (a full frame ⇒ Net Value = Total Value, no penalty).

---

## 5. The constraints (the rules of legal play)

1. **Fit inside the frame.** A brick must lie entirely within the 4×4 region;
   no cell may hang outside.
2. **No overlap.** A brick cannot occupy a cell already taken by another brick.
3. **Rotation & flip allowed.** Each brick can be freely rotated (90° steps) and
   flipped, giving up to 8 orientations. The player chooses the orientation
   before/while placing.
4. **One of each brick.** Each named brick exists once; once placed it leaves
   the tray until removed.
5. **Time limit.** A countdown timer bounds the round (defaults: **Easy 120 s,
   Hard 180 s**; the training practice round is **90 s**; admins can change
   these). The round auto-ends at 0.
6. **No partial-credit gimmicks.** The only economic levers are the two in the
   Net Value formula: value of placed bricks (up) and $1 per empty cell (down).
   Coverage, ROI, and Fitness are *diagnostic read-outs*, not separately scored.

Illegal placements are rejected with a "That piece doesn't fit there — try
rotating or flipping" message; the board flashes and nothing is placed.

---

## 6. The actions a player can take (the full input vocabulary)

| Action | How (desktop) | How (touch) | Effect |
|--------|---------------|-------------|--------|
| **Select a brick** | click it in the tray | tap it | It becomes the "active" brick; hovering the board previews its footprint (green = fits, red = collides). |
| **Rotate** | `←` / `→` arrow keys, `R`, or **Rotate** button | Rotate button | Cycles the active brick's orientation (rotate CW/CCW). |
| **Flip** | `↑` / `↓` arrow keys, `F`, or **Flip** button | Flip button | Mirrors the active brick (vertical/horizontal flip). |
| **Place** | click a board cell | tap a cell | Drops the active brick with its anchor at that cell (if legal). Deselects it. |
| **Pick up / remove** | click any cell of a placed brick | tap it | Removes that brick back to the tray and re-selects it, so you can re-orient and re-place it. |
| **Reset board** | Reset button | Reset button | Clears all placements and restarts the current round's timer. |
| **Calculator** | type / click keypad | keypad | A scratch calculator for managerial arithmetic (`+ − × ÷`, parentheses). Puzzle-specific — **cleared at the start of every puzzle.** |
| **Notes pad** | type + Add | type + Add | Jot short notes. Puzzle-specific — **cleared at the start of every puzzle.** |
| **Read KPI tooltip** | hover / focus a KPI | tap a KPI | Shows what that metric means. |
| **Move / resize a panel** | drag a box by its body; drag its border/corner | same | Rearrange the Calculator / Board / Bricks / Notes panels (layout persists; a "Reset layout" button restores the default). |

The player also receives **nudges** (small messages under the board):
encouraging cheers, an idle prompt after ~15 s of inactivity, and time-left
reminders at **60 / 30 / 15 / 10 seconds** remaining.

---

## 7. The core decision — and the trap

This is the heart of the game and the most important thing for an LLM to model.

- Because a **full frame has zero empty cells**, a full cover's Net Value equals
  its Total Value (no penalty). Empty cells cost $1 each, so leaving gaps is
  penalised — but the puzzle is *constructed* so that the single best outcome is
  a **full cover** that no partial layout can beat or tie.
- **Exactly one** brick combination is optimal. The generator guarantees:
  1. the **maximum Net Value is attained by exactly one** feasible brick-set,
  2. that set is a **full cover** (fills all 16 cells), and
  3. it tiles the board **one way** (up to the square's 8 rotations/reflections,
     which count as the same solution).
- **The trap: high ROI ≠ best portfolio.** The tempting **high value-per-cell**
  bricks often *cannot* be combined into a legal full cover, or they crowd out
  higher-total combinations. A player who greedily grabs the best-ROI bricks
  reliably ends up sub-optimal — stuck with gaps (each −$1) or a lower total.
- **Difficulty is measured by the Sahni number κ** — the *fewest* correctly
  hand-placed bricks after which a naive value-ratio greedy can finish the
  optimum without getting stuck. **Easy puzzles have κ = 1** (a greedy needs one
  hint), **Hard puzzles κ ≥ 2** (greedy gets stuck earlier / more often). κ is a
  difficulty label for the researchers; **it is hidden from participants.**

### The winning decision procedure (what good play looks like)
1. A filling portfolio must be `I3` + two of `{L,S,T}` + one of `{L5,Y,P,N}`
   (areas 3+4+4+5 = 16).
2. Among all such brick-sets, **prefer the one with the highest Total Value that
   can actually tile the 4×4 board** — because a full cover's Net Value = Total
   Value, and the optimum is guaranteed to be a full cover.
3. Do **not** just chase per-cell ROI; a slightly lower-ROI brick that *completes
   a legal tiling* beats a high-ROI brick that leaves an unfillable hole.
4. Place, check the geometry actually tiles, and if it doesn't, swap the
   offending brick (rotate/flip first; only then substitute a different brick).

### Worked strategic example (Easy puzzle #1 from the built-in set)
Values: `I3=17, L=7, S=14, T=10, L5=18, Y=12, P=11, N=13`. Best Net Value = **$59**.

- `I3` (the only tromino) is forced into any full cover: **+$17**.
- Best two tetrominoes from `{L=7, S=14, T=10}`: **S ($14) + T ($10) = $24**
  (beats S+L = $21 and T+L = $17).
- Best pentomino from `{L5=18, Y=12, P=11, N=13}`: **L5 ($18)**.
- Highest-value feasible full cover = `I3 + S + T + L5 = 17+14+10+18 = $59`,
  and it geometrically tiles the square — so **Net Value $59** is the unique
  optimum.
- A greedy ROI player is lured by ROI ordering (`I3` 5.67 ▸ `L5` 3.60 ▸ `S` 3.50
  ▸ `N` 2.60 ▸ `T` 2.50 …) and may reach for pentomino `N` for the last region,
  which doesn't fit the 4 remaining cells — the trap that costs time or Net
  Value. (This puzzle is κ = 1: one correct hint is enough for greedy to recover.)

---

## 8. The state representation (for reasoning about a position)

The game exposes a machine-readable snapshot; an LLM can reason over it.

- **FrameMatrix** — the board as a 4×4 matrix; each cell is `0` (empty) or the
  **name of the brick** occupying it. Example (frame after placing `I3` down the
  left column and `S` beside it):
  ```
  [ "I3", "S",  0,   0  ]
  [ "I3", "S",  "S", 0  ]
  [ "I3", 0,    "S", 0  ]
  [ 0,    0,    0,   0  ]
  ```
- **Placements** — a list of `{ name, value, cells:[[r,c]…] }` for each placed
  brick.
- **Metrics** — the live KPIs: `{ net, value, cost, coverage, fitness,
  bricks (count placed), placed (occupied cells), total (16), time, limit,
  remaining }`. (`bestValue` and `kappa` also exist internally but are hidden
  from participants.)
- **Puzzle spec** — `{ diff, rows:4, cols:4, region:["r,c"…],
  values:{brick:$…}, solution:[…], bestValue }`. The `values` map *is* the
  difficulty.

---

## 9. The game session flow (what a human actually walks through)

At the bare URL the site runs a **session-gated research flow** (the default).
The phases, in order:

1. **Welcome.** A short intro. A **session code** is **required** to start (the
   organiser provides one, or it arrives via `?session=CODE`). No anonymous play.
2. **Onboarding tour.** An iPhone-style spotlight walkthrough over a live board
   — it explains the board, the bricks, runs a **slow scripted demo** that
   places/rotates/removes bricks while the KPIs update, then points out Net
   Value, each KPI, the calculator, the notes pad, the nudges, the draggable
   panels, and the green continue button. The timer is paused during the tour.
3. **Training phase.** **One practice puzzle** (Easy, ~90 s), clearly badged
   "Training Phase," to learn the controls. It doesn't count.
4. **Registration.** A form (compulsory **UCD Student ID** + demographics: age,
   gender, nationality, country of residence, level of study, work experience,
   occupation, English fluency).
5. **Main game.** A **series of real, timed puzzles** — by default **2 Easy + 2
   Hard** (admins can change counts or freeze a fixed reviewed set). Every player
   sees the **same** puzzles, only the **order** is shuffled. Between puzzles a
   **per-puzzle results screen** shows that puzzle's own metrics; the button
   reads "Continue to the Nth puzzle."
6. **Post-game survey.** Questions on satisfaction, perceived difficulty,
   clarity, whether time was adequate, the strategy used, the hardest part, and
   suggested improvements.
7. **Thank-you.** The run is complete.

Two non-default entry points exist for completeness: `?classic` = the original
plain game (no research flow, and it *does* show the optimum/best-value
feedback), and `?admin` = the researcher CMS.

**What is deliberately hidden from participants** during the research flow: the
κ difficulty number, the "best possible" / optimum Net Value, any personal-best
pill, and any nudge that would reveal the answer. Players get encouragement and
their own live KPIs — never the target.

---

## 10. Quick reference (cheat sheet)

- **Board:** fixed 4×4, 16 cells.
- **Bricks:** 8 fixed shapes (`I3, L, S, T, L5, Y, P, N`); a full cover is
  `I3` + two tetrominoes + one pentomino.
- **Values:** whole dollars $3–$19, re-drawn per puzzle; distinct $/cell ratios.
- **Objective:** maximise **Net Value = Total Value − $1 × empty cells** at the
  timer's end.
- **Round ends:** on the **timer** (Easy 120 s / Hard 180 s / training 90 s),
  never on filling the frame.
- **Actions:** select → rotate (`←/→`, `R`) / flip (`↑/↓`, `F`) → place (click a
  cell) → pick up (click a placed brick). Plus calculator, notes, panel
  move/resize, reset.
- **Constraints:** stay inside the frame, no overlap, one of each brick.
- **The trap:** highest-ROI bricks are usually not the best portfolio; only one
  full-cover combination reaches the maximum Net Value — find *that*.
- **Difficulty (hidden):** Sahni κ = 1 (Easy) or ≥ 2 (Hard).
