# Management Science Paper Browser — Project Summary

## Overview

A complete pipeline to scrape, store, and browse all Management Science (INFORMS) article metadata from 1954–present. Three components:

1. **Google Apps Script** (`MNSCScraper_Complete.gs`) — fetches metadata from Crossref API and INFORMS website into Google Sheets
2. **Python scraper** (`scrape_editors.py`) — scrapes editor/area info from INFORMS article pages (runs locally)
3. **Web GUI** (`index.html`) — single-file paper browser hosted at `stouras.com/fun/ms/`

---

## Google Sheet

- **Sheet ID**: `11MKt6uzfnxTNTbK4Kb1jwW32cEsKZcBRncubV2omJzQ`
- **Must be shared publicly** (Anyone with the link → Viewer) for the web GUI to work
- **Tabs**:
  - `Data` — 12 columns: Year, Volume, Issue, Page, Title, Authors, Cite As, DOI, Abstract, Status, Accepting Editor, Area
  - `Crossref_Full` — 39 columns with full Crossref metadata (DOI, affiliations, ORCIDs, citation counts, funders, etc.)
  - `mnsc_articles_editors` — editor/area data scraped via Python (source for bulk copy)
  - `_Inspect` — utility tab for inspecting raw JSON of a single article
  - `_BatchLog` — auto-batch progress log (timestamp + message per year processed)
  - `Authors` — pre-computed author stats: Papers (count), Author (name), Areas (comma-separated)

---

## Google Apps Script (`MNSCScraper_Complete.gs`)

### Menu: "MNSC Scraper"

| Menu Item | Function | Description |
|---|---|---|
| 1. Extract full Crossref data | `promptFullExtract` | Fetches all articles for a year range from Crossref API → `Crossref_Full` tab (39 cols). **Auto-batches** via time triggers: processes ~4 min, pauses 30s, auto-resumes until done. Progress logged to `_BatchLog` tab. |
| 2. Copy Crossref_Full → Data tab | `populateDataFromCrossref` | Maps 39-col data into 12-col `Data` tab. Auto-creates tab with headers if missing. Includes Page column. **Deduplicates by DOI** — skips rows already in Data tab. |
| 3. Fill Editor/Area from INFORMS | `promptEditors` | Scrapes INFORMS article pages for "accepted by [Editor], [Area]" text. Columns K-L. |
| 4. Copy editors from mnsc_articles_editors | `copyEditorsFromEditorTab` | Bulk copies editor/area data from `mnsc_articles_editors` tab to `Data` tab, matching by DOI. Skips rows that already have an editor. |
| 5. Build Authors tab | `buildAuthorsTab` | Aggregates unique authors from Data tab with paper counts and areas. Normalizes names (accents, hyphens). Writes to `Authors` tab (Papers, Author, Areas). |
| Quick fetch to Data tab | `promptQuickFetch` | Skips Full tab, writes directly to Data. **Auto-batches** like option 1. |
| ⏹ Stop auto-batch | `stopAutoBatch` | Cancels a running auto-batch and removes pending triggers. |
| Inspect one article | `inspectArticle` | Dumps raw Crossref JSON to `_Inspect` tab. |
| Setup tabs | `setupTabs` | Creates/resets both tabs with headers. |

### Key Constants

- `ISSN`: `0025-1909` (Management Science)
- `EMAIL`: `kstouras@gmail.com` (for Crossref polite pool)
- `TIME_LIMIT`: 5 minutes (Apps Script execution limit safety)
- `PER_PAGE`: 100 (Crossref pagination)

### Status Logic

- **"Published"** — has a volume number
- **"Articles in Advance"** — no volume assigned yet
- **"Other"** — title matches skip patterns (editorials, errata, management insights, etc.)

### Column Layout (Data tab, 1-indexed)

A=Year, B=Volume, C=Issue, D=Page, E=Title, F=Authors, G=CiteAs, H=DOI, I=Abstract, J=Status, K=AcceptingEditor, L=Area

---

## Python Scraper (`scrape_editors.py`)

Runs locally on Windows at `C:\Users\LENOVO\Desktop\mnsc_scraper\`. Uses `cloudscraper` to bypass Cloudflare on INFORMS website.

### Usage

```bash
pip install cloudscraper openpyxl
python scrape_editors.py
```

Reads `mnsc_articles.csv` or `.xlsx`, outputs `mnsc_articles_editors.xlsx`.

### Controls

- **Ctrl+C once** (during retries) → skip current row, continue to next
- **Ctrl+C twice quickly** → stop entire process, save all progress to xlsx

### Modes

On startup, choose:
1. **Scrape editors (normal)** — scrape INFORMS pages, fall back to Crossref API abstract on 403
2. **Fix bad entries** — re-parse existing editor/area fields (fixes "Name for the Special Issue..." patterns, strips "Funding:" junk from areas)

### Behavior

- Prompts for start/end row range on each run
- Accumulates progress: reads from output file on subsequent runs
- 5 retries on INFORMS 403, then falls back to Crossref API abstract
- Title-based skip: ~25 patterns auto-skip non-research content (referees, special sections, in memoriam, best AE awards, etc.)
- `split_editor_area()` handles 3 patterns: "Name, area.", "Name for the Special Issue on...", "Name served as editor"
- `clean_area()` strips trailing junk (Funding:, Supplemental Material:, DOI URLs)
- 2-second base delay between requests
- Extracts "accepted by [Name], [Area]." pattern from INFORMS HTML or Crossref abstract

---

## Web GUI (`index.html`)

Single HTML file, no build step, no dependencies beyond Google Fonts CDN. Hosted at `stouras.com/fun/ms/`.

### Data Source

Pulls live from Google Sheet via CSV export URL:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Data
```

### Features

- **Background loading** — page renders instantly with welcome state; data loads silently via `fetch()`; silently retries on failure. No spinner, no loading text — user sees welcome message immediately.
- **Custom dropdowns** — fully styled (not native `<select>`), 18px font, searchable within dropdown, scrollable 350px max-height, click-outside-to-close. Editor and Area dropdowns show paper counts next to each option, e.g., "Amit Seru (54)", "finance (980)".
- **Multi-select with chips** — Editor, Area, Year filters support multiple selections shown as removable chips; OR logic within same filter type
- **Cascading/dependent filters** — when any filter is active, the other dropdowns dynamically update to show only options that exist in the cross-filtered result set (e.g., selecting year 2026 hides editors and areas with no papers that year). Each dropdown is rebuilt using papers that match all *other* active filters except its own, via `updateDropdownOptions()`. Counts update accordingly. Summary tabs also reflect filtered counts. Dropdowns reset to full options when all filters are cleared.
- **Text search chips** — Title and Author search fields filter live as you type (150ms debounce); pressing Enter converts text to a chip, allowing multiple search terms with AND logic (e.g., co-author search: "stouras" + "erat")
- **Clickable tags** — all metadata on paper cards is interactive: editor/area tags add filter chips; year/volume tag adds year chip; individual author names add author search chips. Enables quick drill-down (e.g., click an author → see all their papers → click a co-author → narrow to co-authored papers).
- **BibTeX generation** — green "▸ BibTeX" toggle with Copy button; title capitals protected with `{B}races`; author format: `LastName, FirstName and ...`; pages from Page column with `--` separators; omits volume/number/pages for Articles in Advance
- **Abstract cleaning** — `cleanAbstract()` strips "This paper was accepted by...", "Funding:", "Supplemental Material:", "Conflict of Interest", "The online appendix...", trailing DOI URLs. Affects ~4,699 abstracts.
- **Articles in Advance** — shows just year tag (no "Vol. ? No. ?"); BibTeX omits missing fields
- **Pages display** — shows "pp. X-Y" in volume tag when available
- **Sort** — Year↓, Year↑, Title A-Z, Editor A-Z
- **Summary tabs** — "Editors", "Areas", and "Authors" toggle buttons inside the filters bar. Click to expand/collapse a two-column list sorted by paper count (e.g., "179 papers accepted by David Simchi-Levi", "987 papers in finance", "89 papers written by Konstantinos Stouras across 3 areas"). Clicking paper count / author name adds author search chip. Clicking "across N areas" adds those areas as filter chips. Clicking any editor/area item adds it as a filter chip. Clear button collapses tabs.
- **No pagination** — all matching results shown on one scrollable page (pagination code preserved in comments for re-enabling)
- **Fonts** — Playfair Display (serif headings), DM Sans (body)
- **Responsive** — mobile-friendly layout
- **No initial content** — blank welcome state until user applies a filter; no paper count shown until first filter
- **Dynamic year range** — header shows actual min year from data (e.g., "1954–present") instead of hardcoded value

### Data Normalization (client-side, no sheet modifications)

Three functions run after CSV loads to clean raw data for display:

**`normalizeEditors(paper)`** — sets `paper._editors` (array) and `paper._area` (string) on each paper.

**`cleanEditorField(raw)` → string[]**
1. Extracts name from junk text containing "accepted by"
2. Splits multi-editor fields on " and " (e.g., "Bertsimas and Yinyu Ye" → two entries)
3. Normalizes each name via `normalizeEditorName()`

**`normalizeEditorName(name)` → string**
- Strips "Prof." / "Professor" prefix
- Normalizes Unicode hyphens and accents (NFD normalization)
- Looks up in `EDITOR_ALIASES` (~90 entries): typos (Brain→Brian Bushee, Kay Gieseke→Kay Giesecke, Manuel→Manel Baucells, Scholtes Stefan→Stefan Scholtes), accent variants (Renée→Renee Adams), middle initials (Brad M.→Brad Barber), name consolidation (Teck Ho→Teck-Hua Ho, Jay→Jayashankar Swaminathan, D.J./DJ Wu→D.J. Wu)
- Discards junk entries via `EDITOR_JUNK` list

**`fuzzyMergeEditors()`** — second-pass auto-merger that runs after initial normalization:
- Counts papers per editor; separates rare (≤3 papers) from common (>3 papers)
- For each rare name, computes Levenshtein distance against all common names
- Also checks reversed name order ("Scholtes Stefan" ↔ "Stefan Scholtes")
- Also checks last-name match + close first name separately
- Threshold: distance ≤ 2 for names ≥ 8 chars, ≤ 1 for shorter
- Merges rare name → closest common name (e.g., "Carrie Chan" (1) → "Carri Chan" (16))
- Logs merges to browser console for debugging

**`normalizeArea(raw)` → string**
- Truncates at HTML tags
- Strips trailing junk: Funding:, Supplemental Material:, Conflict of Interest, DOI URLs
- Fixes colon spacing (" :" → ":")
- Looks up in `AREA_ALIASES` (~40 entries): typos (entepreneurship→entrepreneurship), capitalization (Finance→finance), HTML junk removal, consolidation (strategy→business strategy, stochastic models→stochastic models and simulation, organization→organizations)
- Extracts area from patterns like "Renee, finance" → "finance"
- Discards junk via `AREA_JUNK` list

**`fuzzyMergeAreas()`** — second-pass auto-merger for areas:
- Counts papers per area; separates rare (≤3 papers) from common (>3 papers)
- For each rare area, computes Levenshtein distance against all common areas
- Also checks singular/plural variants ("organization" ↔ "organizations")
- Threshold: distance ≤ 2 for areas ≥ 10 chars, ≤ 1 for shorter
- Merges rare variant → closest common area
- Logs merges to browser console

**Result**: ~210 raw editor values → ~140 unique names (via explicit aliases + fuzzy matching). ~63 raw area values → ~22 clean categories (via explicit aliases + fuzzy matching).

**`normalizeAuthors`** — removed from client-side. Author normalization now runs server-side via GAS menu item "5. Build Authors tab" (exact normalization of accents/hyphens, no fuzzy merge). The web GUI loads pre-computed data from the `Authors` tab CSV.

### Architecture

- CSS variables for theming (navy `#003087`, accent gold `#c4a052`, green `#2a7d4f`)
- All JS inline, ~1250 lines total
- Custom dropdown component replaces native `<select>` for full font-size control
- Chip system shared across all 5 filter types (editor, area, year, title, author)
- 50px fixed height for all filter inputs/buttons for alignment

### SEO & Social Sharing

- Open Graph meta tags (title, description, image, URL) — previews on LinkedIn, WhatsApp, Facebook
- Twitter Card (`summary_large_image`)
- JSON-LD structured data (`WebApplication` schema) for Google
- OG image: `og-image.jpg` (840×350, INFORMS Management Science header) — must be uploaded alongside `index.html`
- Canonical URL: `https://stouras.com/fun/ms/`
- Theme color: `#003087`

---

## Crossref API Notes

- **Available**: title, authors, DOI, abstract, volume/issue/page, ORCIDs, affiliations, citation counts, funders, references
- **Not available**: editor info (no `assertion` field for MNSC), `subject` always empty
- **Conclusion**: Editor/Area always requires INFORMS website scraping

---

## ~17,000+ articles total (1954–present)

Abstract cleaning affects ~4,699 abstracts. Editor scraping done in batches of 500 via `scrape_editors.py`, then bulk-copied to Data tab via menu item 4.

### Hosted files at `stouras.com/fun/ms/`

| File | Purpose |
|------|---------|
| `index.html` | Single-file web GUI |
| `og-image.jpg` | Social sharing preview image (840×350) |