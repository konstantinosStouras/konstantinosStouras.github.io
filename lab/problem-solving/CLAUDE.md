# The Problem-Solving Trap — Technical Documentation

**Author:** Prof. Kostas Stouras, UCD Smurfit Graduate Business School  
**URL:** https://www.stouras.com/lab/problem-solving/  
**File:** `index.html` (single self-contained file, ~2,500 lines)

---

## Overview

An interactive classroom simulation of the 2-4-6 confirmation bias puzzle. Players are given a seed sequence (2, 4, 8) that follows a secret rule, then test their own sequences to discover it. The actual rule is simply "any three numbers in strictly increasing order," but most players assume something more complex (e.g., doubling) and never test a sequence that could disprove their theory.

After submitting, players see a personal scorecard, class-wide analytics with 8 interactive charts, and can download a PDF report.

---

## Architecture

### Single-file HTML app
Everything is in one `index.html`: HTML structure, CSS styles, and all JavaScript. No build step or framework required — just upload to any web server.

### External dependencies (loaded via CDN)
- **Chart.js 4.4.7** — interactive charts rendered on `<canvas>` elements
- **jsPDF 2.5.2** — client-side PDF generation
- **Google Fonts** — Libre Franklin (UI labels) and STIX Two Text (LaTeX-like serif for charts)

### Data flow
```
Player submits answer
    │
    ├──▶ POST to Google Apps Script ──▶ Appends row to "Responses" sheet
    │
    └──▶ Client fetches CSV from published Google Sheet
         │
         ├──▶ computeAnalytics() — processes all rows into analytics object
         ├──▶ renderDynamicCharts() — builds 8 Chart.js charts
         ├──▶ renderInsightsTable() — builds green/red KPI panels
         └──▶ updateOutcomeText() — fills in dynamic % in the narrative
```

**Fallback:** If the CSV fetch fails (e.g., sheet not published), the app falls back to the existing Apps Script `doGet` endpoint (`?action=getAnalysis`) which returns pre-computed JSON.

---

## Configuration Constants

| Constant | Purpose |
|---|---|
| `GOOGLE_SCRIPT_URL` | Apps Script web app endpoint for POST (logging) and GET (fallback analysis) |
| `SHEET_ID` | Google Sheets document ID |
| `SHEET_CSV_URL` | Published CSV export URL, targeting the "Responses" sheet tab |
| `RULE_ANSWER` | The correct rule text displayed to players |

---

## Game Logic

### Core rule
```javascript
function checkRule(a, b, c) { return a < b && b < c; }
```

### Game flow
1. Player enters 3 numbers → `handleCheck()` evaluates against `checkRule()`, pushes result to `guesses[]` array, renders green (Yes) or red (No) feedback
2. Player can repeat as many times as desired
3. Player types their rule guess, selects confidence (1–5), clicks Submit → `handleSubmitRule()`
4. `logToSheet()` POSTs data to Apps Script
5. Outcome section reveals the rule, personal scorecard, and class results

### Data logged per player
| Column | Field | Example |
|---|---|---|
| A | Timestamp | 1 April 2026 10:05 AM |
| B | Number of attempts | 3 |
| C | Yeses | 2 |
| D | Nos | 1 |
| E | What's the rule? | "multiply by 2" |
| F | Confidence level | 4 |
| G | Yes sequences | (3, 6, 12); (4, 8, 16) |
| H | No sequences | (5, 3, 1) |
| I | Notes | (manual) |
| J | Got it right? | Yes/No (MAP formula) |
| K | Creativity index (%) | 47 (Apps Script) |

---

## Personal Scorecard

Built by `buildPersonalScorecard(rule, conf, guesses)`. Appears immediately after the rule reveal.

### Bias detection
Checks 4 signals, triggers a colored banner:
- **Red** (2+ signals): "Confirmation bias detected"
- **Yellow** (1 signal): "Some bias detected"
- **Green** (0 signals): "Good problem-solving approach"

Signals checked:
1. `nos === 0` — never tested a failing sequence
2. `yesRate >= 80 && totalGuesses > 1` — evidence overwhelmingly one-sided
3. `totalGuesses <= 2` — very few sequences tested
4. `confidence >= 4 && !gotRight` — high confidence despite wrong answer

### Two-panel layout

| ✓ Your strengths | ✗ Bias indicators |
|---|---|
| Total sequences tested | "Yes" rate |
| "No" responses heard | Confidence level |
| Distinct patterns explored (X of 6) | Tested a failing sequence |
| Got the rule right | Creativity index (High/Medium/Low) |

### Correctness check
Mirrors the Google Sheets MAP formula — regex-based keyword matching:
- **Wrong keywords** (→ No): doubl, multipl, power, fibonacci, arithmetic, twice, 2x, etc.
- **Right keywords** (→ Yes): increas, ascend, larger, bigger, higher, greater, etc.
- Logic: if no wrong keywords AND has right keywords → "Yes"

### Distinct patterns
Counts how many of 6 structural types the player tested (including seed):
increasing, decreasing, constant, non-monotonic, negatives, zero

---

## Local Creativity Index

`computeLocalCreativity(guesses)` — runs entirely in the browser, mirrors the Apps Script algorithm.

### Feature vector (10 dimensions per sequence)
For each sequence (a, b, c):
1. Strictly increasing flag (0/1)
2. Strictly decreasing flag (0/1)
3. Constant flag (0/1)
4. Non-monotonic flag (0/1)
5. Uses negatives flag (0/1)
6. Uses zero flag (0/1)
7. Log spread (normalized)
8. Log magnitude (normalized)
9. Gap ratio (arithmetic vs geometric spacing, 0–1)
10. Asymmetry (position of middle value, 0–1)

### Scoring
1. Prepend seed sequence (2, 4, 8) to player's sequences
2. Extract feature vector for each sequence
3. Compute **average pairwise Euclidean distance** across all feature vectors
4. Multiply by **log₂(num_sequences)** — rewards volume with diminishing returns
5. Result: `rawScore = avgDist × log₂(n)`

### Display
- **High**: avgDist > 0.5
- **Medium**: avgDist > 0.2
- **Low**: avgDist ≤ 0.2

When class data is available, also shows "(class avg: X%)" for context.

---

## Data Processing Pipeline

### CSV parsing
`parseCSV(text)` — handles quoted fields, newlines, and edge cases.

### Column detection
`detectColumns(headers)` — auto-detects column indices by keyword matching against header names. Tries exact match first, then substring match with longer keywords prioritized.

Detected columns: `attempts`, `yeses`, `nos`, `conf`, `rule`, `yesSeq`, `noSeq`, `gotRight`, `creativity`

### Analytics computation
`computeAnalytics(rows, cols)` — produces a comprehensive analytics object:

1. **Attempts distribution** — bucketed 1–15+
2. **Confidence by attempt count** — grouped into 1, 2, ..., 7, 8+ buckets
3. **Player type breakdown** — neverNo / someNo / strongFalsifiers
4. **Yes Ratio histogram** — each player's Yes% bucketed into 10% ranges
5. **Confidence vs Correctness** — distributions for right vs wrong players
6. **Creativity analytics** — avg, by confidence, by correctness, scatter data
7. **Sequence frequency** — most/least common Yes and No sequences
8. **Aggregate stats** — mean, median, mode attempts, avg confidence, avg nos

---

## Charts (8 interactive Chart.js charts)

Organized into 3 thematic sections:

### Part 1 — Testing behavior
| Chart | Type | Function | What it shows |
|---|---|---|---|
| How many guesses? | Bar | `buildAttemptsChart` | Distribution of attempt counts |
| How one-sided was the evidence? | Bar | `buildYesRatioChart` | Histogram of each player's Yes% |
| Did players seek disconfirming evidence? | Doughnut | `buildStrategyChart` | Never No / Some No / 3+ No split |
| What did players actually test? | Tables | `buildSequenceTables` | Top/bottom 3 Yes and No sequences |

### Part 2 — Confidence & accuracy
| Chart | Type | Function | What it shows |
|---|---|---|---|
| Does more testing lead to more confidence? | Bar | `buildConfidenceChart` | Avg confidence by attempt count |
| Were confident players actually right? | Grouped bar | `buildCorrectnessChart` | Confidence distribution: right vs wrong |

### Part 3 — Exploration creativity
| Chart | Type | Function | What it shows |
|---|---|---|---|
| Quantity vs quality of exploration | Scatter | `buildScatterChart` | Attempts × creativity, colored by correctness |
| The confidence–creativity paradox | Bar | `buildConfCreativityChart` | Avg creativity by confidence level |
| Did creative testing actually help? | Bar | `buildCreativityCorrectnessChart` | Avg creativity: right vs wrong |

Part 3 includes a methodology explanation box describing how the creativity index is computed, with a worked example comparing a repetitive player vs a diverse explorer.

Part 3 only renders when the `creativity` column (K) is detected in the CSV data.

### Chart rendering
- All charts render at **3× device pixel ratio** for crisp display at any zoom level
- **Tooltips**: dark background, serif fonts, generous padding, `mode: 'nearest'` with `intersect: false` (bar charts use `axis: 'x'`, scatter uses `axis: 'xy'`, doughnut uses `intersect: true`)
- **Fonts**: STIX Two Text (Google Fonts) — a Computer Modern lookalike for LaTeX-style rendering

Each chart includes:
- **Title + subtitle** (in the HTML above the canvas)
- **"How to read"** — grey text explaining what the axes/colors represent
- **"Key insight"** — yellow box with dynamically generated interpretation that adapts to the actual data patterns

---

## Key Insights Table

`renderInsightsTable(a)` — appears below the personal scorecard, above the Summary text.

### Layout
- Large centered "N total players" counter
- Two side-by-side panels:

| ✓ Signals of good problem-solving | ✗ Signals of confirmation bias |
|---|---|
| Tested at least 3 wrong sequences | Never heard a single "No" |
| Avg "No" responses per player | Submitted after just 1 guess |
| Avg guesses before submitting | Avg confidence level |
| Median guesses before submitting | Low creativity (<20%) * |
| Avg creativity index * | |
| High creativity (50%+) * | |

\* Creativity rows only appear when column K data is available.

---

## PDF Export

`downloadPDF()` — generates a multi-page A4 PDF using jsPDF's native text engine (no screenshots).

### Content order
1. **Title page**: "The Problem-Solving Trap", "Results & Insights", Prof. Kostas Stouras, UCD Smurfit, date, green accent line
2. **The challenge**: original prompt text and seed sequence
3. **Your guesses**: every sequence tested, numbered, with Yes (green) / No (red) labels
4. **Your answer**: submitted rule, confidence %, actual rule
5. **Personal scorecard**: bias verdict banner + two-column table with colored headers
6. **Personal insight**: dynamic "you're in the X% who..." text
7. **All outcome text**: Summary, "What's going on?", Confirmation bias sections — pulled from DOM so edits to HTML automatically reflect in PDF
8. **Part 1–3 charts**: each with title, canvas image, "How to read", "Key insight:" label + text
9. **Part 3 methodology**: creativity measurement explanation
10. **Key insights across participants**: two-column table with colored panel headers

### Styling
- **Font**: Times (jsPDF built-in serif, closest to Computer Modern)
- **Body text**: justified alignment (`align: 'justify'`)
- **Tables**: drawn with `pdf.rect()` for colored headers, alternating row backgrounds, bold right-aligned values
- **Charts**: inserted as PNG from canvas at full resolution
- **Footer**: "The Problem-Solving Trap • Prof. Kostas Stouras, UCD Smurfit" + "Page X of Y"
- **Download buttons**: appear next to Summary heading, at top-right and bottom-right of results section

---

## Auto-zoom

CSS `zoom` property on `.container`:
- **768px+** (tablets/small laptops): `zoom: 1.35`
- **1200px+** (large screens): `zoom: 1.5`

Charts render at 3× pixel ratio so they remain crisp under zoom.

---

## Google Sheets Integration

### "Responses" sheet columns
A–H populated by the web app's POST. Columns J and K added separately:

- **Column J** — "Got it right?" — `MAP` formula with regex-based classification:
  ```
  =MAP(E2:E, LAMBDA(cell, IF(cell="","", IF(REGEXMATCH(LOWER(cell), "doubl|multipl|..."), "No", IF(REGEXMATCH(LOWER(cell), "increas|ascend|..."), "Yes", "No")))))
  ```

- **Column K** — "Creativity index (%)" — computed by Apps Script function `computeSequenceDiversity()`, run via the "Creativity" menu or `onFormSubmit` trigger.

### Apps Script (`apps-script.js`)
| Function | Purpose |
|---|---|
| `doPost(e)` | Receives game submissions, appends row to Responses sheet |
| `doGet(e)` | Serves analysis JSON (fallback if CSV fetch fails) |
| `getAnalysisData()` | Computes distribution buckets + insights from raw data |
| `computeSequenceDiversity()` | Computes creativity index for all players using feature-based pairwise distance |
| `sequenceFeatures(a,b,c)` | Extracts 10-dimensional feature vector per sequence |
| `euclidean(a,b)` | Euclidean distance between two feature vectors |
| `parseSequencesForDiversity()` | Parses "(3, 6, 12); (4, 8, 16)" format from cells |
| `onOpen()` | Adds "Creativity" menu to the spreadsheet |
| `onFormSubmit(e)` | Auto-recomputes creativity when new responses arrive |

### Creativity algorithm (Apps Script)
Same as the client-side `computeLocalCreativity()`:
1. Prepend seed (2, 4, 8)
2. Extract 10-feature vectors (direction, scale, boundaries, gap pattern)
3. Average pairwise Euclidean distance × log₂(num_sequences)
4. Normalize: best player = 100%, everyone else relative

---

## File structure summary

```
index.html              — The complete simulation (single file)
apps-script.js          — Google Apps Script backend (paste into Extensions → Apps Script)
CLAUDE.md               — This documentation file
```

---

## Key design decisions

1. **Single HTML file**: No build step, no dependencies to install. Upload and it works.
2. **CSV-first, fallback to Apps Script**: The CSV approach reads raw data and computes everything client-side, giving richer analytics than the pre-computed Apps Script endpoint. Falls back gracefully if the sheet isn't published.
3. **Feature-based creativity vs cosine similarity**: Centered cosine on 3-number sequences only produces ~5 structural shapes, resulting in too few distinct scores. The 10-feature approach captures direction, scale, boundaries, and gap patterns, producing a continuous creativity distribution.
4. **Volume weighting**: `score = avgDist × log₂(n)` rewards players who tested more sequences, but with diminishing returns — quality of exploration matters more than quantity.
5. **Charts at 3× resolution**: The CSS zoom for larger screens would blur canvas-based charts. Rendering at 3× device pixel ratio ensures crisp rendering at any zoom.
6. **LaTeX-style fonts**: STIX Two Text for charts and Times for PDFs give an academic paper feel appropriate for a business school classroom tool.
7. **No letter grades**: Initially implemented (A–F) but removed — the grading formula was too crude for edge cases (e.g., a player who tested 1 failing sequence got rewarded for "balanced evidence" despite minimal effort). Replaced with contextual bias detection banners.
