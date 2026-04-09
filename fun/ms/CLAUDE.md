# Management Science Paper Browser — Project Summary

## Overview

A complete pipeline to scrape, store, and browse all Management Science (INFORMS) article metadata from 2011–present. Three components:

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
  - `_Inspect` — utility tab for inspecting raw JSON of a single article

---

## Google Apps Script (`MNSCScraper_Complete.gs`)

### Menu: "MNSC Scraper"

| Menu Item | Function | Description |
|---|---|---|
| 1. Extract full Crossref data | `promptFullExtract` | Fetches all articles for a year range from Crossref API → `Crossref_Full` tab (39 cols) |
| 2. Copy Crossref_Full → Data tab | `populateDataFromCrossref` | Maps 39-col data into 12-col `Data` tab. Auto-creates tab with headers if missing. |
| 3. Fill Editor/Area from INFORMS | `promptEditors` | Scrapes INFORMS article pages for "accepted by [Editor], [Area]" text. Columns K-L. |
| Quick fetch to Data tab | `promptQuickFetch` | Skips Full tab, writes directly to Data. |
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

### Behavior

- Prompts for start/end row range on each run
- Accumulates progress: reads from output file on subsequent runs
- 10 retries with random 3–15s delays on 403 errors
- 2-second base delay between requests
- Extracts "accepted by [Name], [Area]." pattern from INFORMS HTML

---

## Web GUI (`index.html`)

Single HTML file, no build step, no dependencies beyond Google Fonts CDN. Hosted at `stouras.com/fun/ms/`.

### Data Source

Pulls live from Google Sheet via CSV export URL:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Data
```

### Features

- **Background loading** — page renders instantly with welcome state; data loads silently via `fetch()`; silently retries on failure
- **Custom dropdowns** — fully styled (not native `<select>`), 18px font, searchable within dropdown, scrollable, click-outside-to-close
- **Multi-select with chips** — Editor, Area, Year filters support multiple selections shown as removable chips; OR logic within same filter type
- **Text search chips** — Title and Author search fields filter live as you type; pressing Enter converts text to a chip, allowing multiple search terms with AND logic (e.g., co-author search: "stouras" + "erat")
- **Clickable tags** — Editor/area tags on paper cards add chips when clicked
- **BibTeX generation** — green "▸ BibTeX" toggle with Copy button; title capitals protected with `{B}races`; author format: `LastName, FirstName and ...`; pages from Page column with `--` separators; omits volume/number/pages for Articles in Advance
- **Abstract cleaning** — `cleanAbstract()` strips "This paper was accepted by...", "Funding:", "Supplemental Material:", "Conflict of Interest", trailing DOI URLs
- **Articles in Advance** — shows just year tag (no "Vol. ? No. ?"); BibTeX omits missing fields
- **Pages display** — shows "pp. X-Y" in volume tag when available
- **Sort** — Year↓, Year↑, Title A-Z, Editor A-Z
- **Pagination** — 20 per page with numbered buttons
- **Fonts** — Playfair Display (serif headings), DM Sans (body)
- **Responsive** — mobile-friendly layout
- **No initial content** — blank state until user applies a filter

### Architecture

- CSS variables for theming (navy `#003087`, accent gold `#c4a052`, green `#2a7d4f`)
- All JS inline, ~580 lines total
- Custom dropdown component replaces native `<select>` for full font-size control
- Chip system shared across all filter types (categorical + text)

---

## Crossref API Notes

- **Available**: title, authors, DOI, abstract, volume/issue/page, ORCIDs, affiliations, citation counts, funders, references
- **Not available**: editor info (no `assertion` field for MNSC), `subject` always empty
- **Conclusion**: Editor/Area always requires INFORMS website scraping

---

## ~4,982 articles total (2011–present)

Abstract cleaning affects ~4,699 abstracts. Editor scraping done in batches of 500 via `scrape_editors.py`.
