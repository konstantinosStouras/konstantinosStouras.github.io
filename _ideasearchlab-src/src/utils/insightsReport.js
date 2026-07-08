/**
 * insightsReport.js
 *
 * Turns the raw console output of the Data Analytics regressions run (Python via
 * Pyodide or R via WebR — both print the SAME, intentionally identical INSIGHTS
 * read-out) into:
 *   1. `parseRunOutput()` — a structured object the page renders as a clean,
 *      easy-to-read "Insights gained" panel, and that also splits off
 *      the regression results (everything BEFORE the INSIGHTS banner) so they
 *      can be shown verbatim as an appendix.
 *   2. `buildInsightsPrintHtml()` — a self-contained, print-ready HTML document
 *      (formatted insights + large figures + Appendix A: the regressions the
 *      insights are based on + Appendix B: the Python/R code that produced them),
 *      opened in a new window for the browser's "Save as PDF".
 *
 * The parser is deliberately tolerant: if a custom edit removes or reshapes the
 * INSIGHTS section it falls back to the raw text, so the page never breaks.
 */

const COND_CODES = ['None', 'Solo', 'Group', 'Both']

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Split a run's console text into the regression results and the parsed
 * insights. Returns { hasInsights, regressionsText, insightsText, parsed }.
 */
export function parseRunOutput(rawOutput) {
  let raw = String(rawOutput || '')

  // Pull out the machine-readable regression-table block (between the BEGIN/END
  // markers both scripts print) and remove it from the text, so it never shows in
  // the console appendix — it is rebuilt as the formatted Tables 3–6 instead.
  const tables = parseRegressionTables(raw)
  raw = stripRegressionTableBlock(raw)

  const lines = raw.split('\n')

  // Locate the "# INSIGHTS …" banner line that both scripts print.
  let marker = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#+\s*INSIGHTS\b/i.test(lines[i].trim())) { marker = i; break }
  }
  if (marker === -1) {
    return { hasInsights: false, regressionsText: raw.trim(), insightsText: '', parsed: null, tables }
  }

  // Back up over the row(s) of '#' that form the banner above the marker, so the
  // regression appendix doesn't end with a stray "####" line.
  let bannerStart = marker
  while (bannerStart > 0 && /^#+$/.test(lines[bannerStart - 1].trim())) bannerStart--

  const regressionsText = lines.slice(0, bannerStart).join('\n').trim()
  // Drop trailing run-log noise ("Generated figure: …", "Done.", matplotlib
  // warnings) so it neither shows in the text nor pollutes the parse.
  const isNoise = l => {
    const t = l.trim()
    return /^Generated figure:/i.test(t) || /^Done\.?$/i.test(t) ||
      /\bplot (failed|skipped)\b/i.test(t) || /Warning:/.test(t)
  }
  const insightsLines = lines.slice(marker).filter(l => !isNoise(l))
  const insightsText = insightsLines.join('\n').trim()

  return { hasInsights: true, regressionsText, insightsText, parsed: parseInsights(insightsLines), tables }
}

// ── Regression tables (Tables 3–6) parsed from the machine-readable block ──────
//
// Both scripts print, between "===BEGIN REGRESSION TABLES===" and the matching
// END marker, one block per table in this line grammar (cells split on "||"):
//   @@TABLE num=<n>||<title>||<sub>
//   @@HEAD Variable||<col1>||<col2>||…
//   @@COEF <label>||<est1>||<est2>||…   (a coefficient row)
//   @@SE   ||<se1>||<se2>||…            (its standard-error row, blank label)
//   @@RULE                             (rule before the footer statistics)
//   @@STAT <label>||<c1>||<c2>||…       (a footer statistic row)
//   @@NOTE <table note>
//   @@ENDTABLE
// We parse it ONCE here; the page renders the result as HTML (on-page + PDF) and
// as LaTeX (the .tex export), so all three views share one source of truth.

const TBL_BEGIN = '===BEGIN REGRESSION TABLES==='
const TBL_END = '===END REGRESSION TABLES==='

/** A cell that could not be estimated is printed as the ASCII sentinel "n/a";
 *  show it as a real em dash in the formatted tables. */
export function tableCell(value) {
  const s = String(value ?? '').trim()
  return s === 'n/a' || s === '' ? '—' : s
}

/** Remove the machine-readable table block (and its markers) from run text. */
function stripRegressionTableBlock(text) {
  const s = String(text || '')
  const a = s.indexOf(TBL_BEGIN)
  if (a === -1) return s
  const b = s.indexOf(TBL_END, a)
  const end = b === -1 ? s.length : b + TBL_END.length
  return (s.slice(0, a) + s.slice(end)).replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Parse the machine block into an array of table objects:
 *   { num, title, sub, columns:[…], rows:[{kind,label,cells}], note }
 * where kind is 'coef' | 'se' | 'rule' | 'stat'. Returns [] if absent/malformed,
 * so a custom script that drops the block simply yields no formatted tables.
 */
export function parseRegressionTables(rawOutput) {
  const raw = String(rawOutput || '')
  const a = raw.indexOf(TBL_BEGIN)
  if (a === -1) return []
  const b = raw.indexOf(TBL_END, a)
  const body = raw.slice(a + TBL_BEGIN.length, b === -1 ? raw.length : b)

  const tables = []
  let cur = null
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.startsWith('@@TABLE')) {
      const parts = line.replace(/^@@TABLE\s*/, '').split('||')
      const num = parseInt((parts[0] || '').replace(/[^0-9]/g, ''), 10)
      cur = { num: Number.isFinite(num) ? num : null, title: (parts[1] || '').trim(), sub: (parts[2] || '').trim(), columns: [], rows: [], note: '' }
      tables.push(cur)
    } else if (!cur) {
      continue
    } else if (line.startsWith('@@HEAD')) {
      cur.columns = line.replace(/^@@HEAD\s*/, '').split('||').slice(1).map(c => c.trim())
    } else if (line.startsWith('@@COEF')) {
      const p = line.replace(/^@@COEF\s*/, '').split('||')
      cur.rows.push({ kind: 'coef', label: (p[0] || '').trim(), cells: p.slice(1).map(c => c.trim()) })
    } else if (line.startsWith('@@SE')) {
      const p = line.replace(/^@@SE\s*/, '').split('||')
      cur.rows.push({ kind: 'se', label: '', cells: p.slice(1).map(c => c.trim()) })
    } else if (line.startsWith('@@RULE')) {
      cur.rows.push({ kind: 'rule' })
    } else if (line.startsWith('@@STAT')) {
      const p = line.replace(/^@@STAT\s*/, '').split('||')
      cur.rows.push({ kind: 'stat', label: (p[0] || '').trim(), cells: p.slice(1).map(c => c.trim()) })
    } else if (line.startsWith('@@NOTE')) {
      cur.note = line.replace(/^@@NOTE\s*/, '').trim()
    }
  }
  // Keep only well-formed tables (have a header and at least one body row).
  return tables.filter(t => t.columns.length && t.rows.length)
}

/** Render the parsed regression tables as booktabs-style HTML (used by the PDF). */
function regressionTablesToHtml(tables) {
  if (!tables || !tables.length) return ''
  const cell = v => esc(tableCell(v))
  const blocks = tables.map(t => {
    const head = `<tr><th class="rt-var">Variable</th>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`
    let seenStat = false
    const body = t.rows.map(r => {
      if (r.kind === 'rule') return ''        // the stat block is separated by a CSS border instead
      let cls = r.kind === 'se' ? 'rt-se' : r.kind === 'stat' ? 'rt-stat' : 'rt-coef'
      if (r.kind === 'stat' && !seenStat) { cls += ' rt-firststat'; seenStat = true } // mid-rule here
      // SE rows keep empty cells blank (no SE under an n/a coefficient); coef/stat
      // cells map the "n/a" sentinel to an em dash.
      const disp = r.kind === 'se' ? (c => esc(String(c ?? ''))) : (c => esc(tableCell(c)))
      const cells = (r.cells || []).map(c => `<td>${disp(c)}</td>`).join('')
      const filler = t.columns.length - (r.cells ? r.cells.length : 0)
      const pad = filler > 0 ? '<td></td>'.repeat(filler) : ''
      return `<tr class="${cls}"><td class="rt-var">${esc(r.label || '')}</td>${cells}${pad}</tr>`
    }).join('')
    return `<figure class="rt-fig avoid-break">
      <figcaption class="rt-cap"><b>Table ${esc(String(t.num ?? ''))}.</b> ${esc(t.title)}<br/><span class="rt-sub">${esc(t.sub)}</span></figcaption>
      <table class="rt-table"><thead>${head}</thead><tbody>${body}</tbody></table>
      <p class="rt-note">${esc(t.note)}</p>
    </figure>`
  }).join('\n')
  return `<section class="reg-tables"><h2>Regression tables (Tables 3–6)</h2>${blocks}</section>`
}

/** Parse the INSIGHTS block (array of lines) into structured data. */
function parseInsights(lines) {
  const res = {
    encoding: [],            // [{ code, desc }]
    coverageWarning: '',     // populated only when a condition has no data
    conditionsWithData: '',  // e.g. "3 of 4: None, Solo, Group"
    kpis: [],                // [{ name, ranking, baselines, noSig, aiTiming, best, worst, notEstimable }]
    rankingSummary: [],      // [{ kpi, text }]
    reminder: '',
  }
  let section = 'top'        // top | encoding | coverage | kpi | summary
  let cur = null            // the KPI block currently being filled

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Section switches (checked before the per-section parsing below).
    if (/^Condition encoding/i.test(line)) { section = 'encoding'; continue }
    if (/^DATA-COVERAGE CHECK:/i.test(line)) {
      section = 'coverage'
      res.coverageWarning = line.replace(/^DATA-COVERAGE CHECK:\s*/i, '').trim()
      continue
    }
    if (/^Conditions with data/i.test(line)) {
      section = 'top'
      res.conditionsWithData = line
        .replace(/^Conditions with data\s*/i, '')
        .replace(/^\(/, '')
        .replace(/\)\s*:/, ':')
        .replace(/\.$/, '')
        .trim()
      continue
    }
    if (/^CONDITION RANKING PER KPI/i.test(line)) { section = 'summary'; continue }
    if (/^KPI:\s*/i.test(line)) {
      section = 'kpi'
      cur = { name: line.replace(/^KPI:\s*/i, '').trim(), ranking: [], baselines: [], noSig: false, aiTiming: '', best: '', worst: '', notEstimable: false }
      res.kpis.push(cur)
      continue
    }
    if (/^Reminder:/i.test(line)) { res.reminder = line.replace(/^Reminder:\s*/i, '').trim(); continue }

    // Per-section content.
    if (section === 'encoding') {
      const m = line.match(/^(None|Solo|Group|Both)\s*=\s*(.+)$/)
      if (m) res.encoding.push({ code: m[1], desc: m[2].trim() })
      continue
    }
    if (section === 'coverage') {
      const cont = line.replace(/^->\s*/, '').trim()
      if (cont) res.coverageWarning += ' ' + cont
      continue
    }
    if (section === 'kpi' && cur) {
      if (/^Not estimable/i.test(line)) { cur.notEstimable = true; continue }
      const rank = line.match(/^(\d+)\.\s+(\S+)\s+mean\s*=\s*([-\d.]+)/)
      if (rank) { cur.ranking.push({ rank: +rank[1], cond: rank[2], mean: parseFloat(rank[3]) }); continue }
      const base = line.match(/^-\s+(\S+?):\s+([-\d.]+)\s+points\s+(higher|lower)\s+\(p\s*=\s*([-\d.]+),\s*(.+?)\)/i)
      if (base) {
        const verdict = base[5].trim()
        cur.baselines.push({
          cond: base[1], delta: parseFloat(base[2]), dir: base[3].toLowerCase(),
          p: parseFloat(base[4]), verdict, sig: /^significant$/i.test(verdict),
        })
        continue
      }
      if (/no condition differs significantly/i.test(line)) { cur.noSig = true; continue }
      if (/^AI timing/i.test(line)) { cur.aiTiming = line; continue }
      const bw = line.match(/=>\s*Best on .+?:\s*'([^']+)'\.\s*Worst:\s*'([^']+)'/i)
      if (bw) { cur.best = bw[1]; cur.worst = bw[2] }
      continue
    }
    if (section === 'summary') {
      // KPI labels may contain parentheses / dots ("Novelty (objective)"), so the
      // label class must accept them or those rows silently vanish from the table.
      const m = line.match(/^([A-Za-z][\w ()./-]*?)\s*:\s*(.+)$/)
      // Only keep rows whose value reads like a ranking ("Cond (1.23) > …") or a
      // "(not estimable)" note — never stray log lines that happen to have a colon.
      if (m && /(\(\s*-?\d|not estimable|>)/i.test(m[2])) {
        res.rankingSummary.push({ kpi: m[1].trim(), text: m[2].trim() })
      }
      continue
    }
  }
  return res
}

/** Pretty KPI label: "overall_quality" -> "Overall quality". */
export function kpiLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

// ── PDF (print-to-PDF) document ──────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/** Render the structured insights as HTML (shared shape with the on-page panel). */
function insightsToHtml(parsed) {
  if (!parsed) return ''
  const parts = []

  if (parsed.coverageWarning) {
    parts.push(`<div class="callout"><strong>Data-coverage check.</strong> ${esc(parsed.coverageWarning)}</div>`)
  }
  if (parsed.conditionsWithData) {
    parts.push(`<p class="lead">Conditions with data: <strong>${esc(parsed.conditionsWithData)}</strong>.</p>`)
  }

  for (const kpi of parsed.kpis) {
    const rows = []
    rows.push(`<h3>${esc(kpiLabel(kpi.name))}</h3>`)
    if (kpi.notEstimable) {
      rows.push(`<p class="muted">Not estimable (needs ≥ 2 conditions with data) — no ranking for this KPI.</p>`)
      parts.push(`<div class="kpi">${rows.join('')}</div>`)
      continue
    }
    if (kpi.ranking.length) {
      const chips = kpi.ranking.map((r, i) =>
        `<span class="chip">${r.rank}. <b>${esc(r.cond)}</b> <span class="mean">${r.mean.toFixed(2)}</span></span>` +
        (i < kpi.ranking.length - 1 ? '<span class="gt">›</span>' : '')
      ).join('')
      rows.push(`<div class="rank"><span class="rank-label">Ranking (best → worst):</span> ${chips}</div>`)
    }
    if (kpi.baselines.length) {
      const items = kpi.baselines.map(b =>
        `<li><b>${esc(b.cond)}</b>: ${Math.abs(b.delta).toFixed(2)} points ${esc(b.dir)} than no-AI ` +
        `<span class="${b.sig ? 'sig' : 'nsig'}">(p = ${b.p.toFixed(3)}, ${esc(b.verdict)})</span></li>`
      ).join('')
      rows.push(`<div class="vs"><div class="vs-label">Versus the no-AI baseline</div><ul>${items}</ul></div>`)
    } else if (kpi.noSig) {
      rows.push(`<p class="muted">No condition differs significantly from the no-AI baseline on this KPI.</p>`)
    }
    if (kpi.aiTiming) {
      rows.push(`<p class="timing">${esc(kpi.aiTiming)}</p>`)
    }
    if (kpi.best) {
      rows.push(`<p class="bw">Best: <b class="best">${esc(kpi.best)}</b> &nbsp;·&nbsp; Worst: <b class="worst">${esc(kpi.worst)}</b></p>`)
    }
    parts.push(`<div class="kpi">${rows.join('')}</div>`)
  }

  if (parsed.rankingSummary.length) {
    const rows = parsed.rankingSummary
      .map(r => `<tr><td>${esc(kpiLabel(r.kpi))}</td><td>${esc(r.text)}</td></tr>`)
      .join('')
    parts.push(
      `<div class="kpi"><h3>Condition ranking per KPI (best → worst)</h3>` +
      `<table class="summary"><thead><tr><th>KPI</th><th>Ranking</th></tr></thead><tbody>${rows}</tbody></table></div>`
    )
  }
  if (parsed.reminder) {
    parts.push(`<p class="muted reminder">Note: ${esc(parsed.reminder)}</p>`)
  }
  if (parsed.encoding.length) {
    const rows = parsed.encoding.map(e => `<tr><td><b>${esc(e.code)}</b></td><td>${esc(e.desc)}</td></tr>`).join('')
    parts.push(
      `<div class="kpi key"><h3>Condition key (Set A / placement encoding)</h3>` +
      `<table class="summary"><tbody>${rows}</tbody></table></div>`
    )
  }
  return parts.join('\n')
}

/** Render the Section-4 summary statistics + correlation matrix as Table 1 HTML. */
function summaryTableToHtml(summary) {
  if (!summary || !summary.variables || !summary.variables.length || !summary.n) return ''
  const v = summary.variables
  const num = x => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(2))
  const head =
    `<tr><th class="rt-var">Variable</th><th>Mean</th><th>Median</th><th>SD</th><th>Min</th><th>Max</th>` +
    v.map((_, i) => `<th>${i + 1}</th>`).join('') + `</tr>`
  const body = v.map((row, i) => {
    const corr = v.map((_, j) => (j <= i ? `<td>${num(summary.corr?.[i]?.[j])}</td>` : '<td></td>')).join('')
    return `<tr class="rt-coef"><td class="rt-var">${esc(`${i + 1}. ${row.label}`)}</td>` +
      `<td>${num(row.mean)}</td><td>${num(row.median)}</td><td>${num(row.sd)}</td>` +
      `<td>${num(row.min)}</td><td>${num(row.max)}</td>${corr}</tr>`
  }).join('')
  return `<section class="reg-tables"><h2>Table 1. Summary statistics and correlations</h2>
    <figure class="rt-fig avoid-break">
      <table class="rt-table"><thead>${head}</thead><tbody>${body}</tbody></table>
      <p class="rt-note">N = ${esc(String(summary.n ?? '—'))} fully-scored ideas. Cells are Pearson correlations (lower triangle). Dummies: AI / Solo / Group / Both vs None.</p>
    </figure></section>`
}

/**
 * Build the full print-ready HTML document.
 * @param {{parsed:object, regressionsText:string, code:string, lang:'python'|'r',
 *          images:string[], meta:{generatedAt?:string, rowsUsed?:number},
 *          tables?:object[], summaryTable?:object}} opts
 */
export function buildInsightsPrintHtml({ parsed, regressionsText, code, lang, images = [], meta = {}, tables = [], summaryTable = null }) {
  const langName = lang === 'r' ? 'R' : 'Python'
  const generated = meta.generatedAt || new Date().toLocaleString()
  const figNote =
    '<p class="muted fignote"><b>Bar charts</b> — each condition\'s average KPI score (1–5) with 95% ' +
    'confidence intervals (taller bar = rated higher; whisker = uncertainty; n under each bar = number of ' +
    'final ideas). <b>Effect plots</b> — each AI condition\'s mean difference from the no-AI baseline (None): ' +
    'a dot right of the dashed zero line scored higher than no-AI, and a red dot (95% CI not crossing zero) ' +
    'marks a statistically significant difference.</p>'
  const figs = images.length
    ? `<section class="figures"><h2>Figures</h2>${figNote}${images
        .map((src, i) => `<figure class="avoid-break"><img src="${src}" alt="Figure ${i + 1}"/><figcaption>Figure ${i + 1}</figcaption></figure>`)
        .join('')}</section>`
    : ''

  const insightsHtml = insightsToHtml(parsed) ||
    `<pre class="mono">${esc(parseRunOutput('').insightsText || '')}</pre>`
  const summaryHtml = summaryTableToHtml(summaryTable)   // Table 1 (from Section 4)
  const regHtml = regressionTablesToHtml(tables)         // Tables 3–6 (from the run)

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Data Analytics — Insights gained</title>
<style>
  :root { --ink:#1d1b18; --muted:#6b6660; --accent:#c8562a; --border:#e3ded6; --paper:#faf8f4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); font-size: 13.5px; line-height: 1.6; padding: 28px 34px;
  }
  h1 { font-size: 26px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 19px; margin: 26px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); }
  h3 { font-size: 15.5px; margin: 0 0 8px; }
  p { margin: 6px 0; }
  .doc-sub { font-size: 14px; color: var(--muted); margin: 0 0 4px; }
  .doc-meta { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
  .lead { font-size: 14px; }
  .muted { color: var(--muted); }
  .reminder { font-size: 12px; }
  .callout {
    border: 1px solid var(--border); border-left: 4px solid var(--accent);
    background: var(--paper); padding: 10px 14px; border-radius: 6px; margin: 12px 0; font-size: 13px;
  }
  .kpi {
    border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin: 12px 0; background: #fff;
  }
  .kpi.key { background: var(--paper); }
  .rank { margin: 6px 0 10px; }
  .rank-label, .vs-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
  .chip { display: inline-block; padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--paper); margin: 2px 0; white-space: nowrap; }
  .chip .mean { color: var(--accent); font-weight: 700; }
  .gt { color: var(--muted); margin: 0 6px; font-weight: 700; }
  .vs { margin: 8px 0; }
  .vs ul { margin: 4px 0 0; padding-left: 20px; }
  .vs li { margin: 3px 0; }
  .sig { color: #2e7d32; font-weight: 700; }
  .nsig { color: var(--muted); }
  .timing { background: var(--paper); border-radius: 6px; padding: 8px 12px; margin: 8px 0; font-weight: 600; }
  .bw { margin-top: 8px; }
  .best { color: #2e7d32; } .worst { color: var(--accent); }
  table.summary { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 4px; }
  table.summary th, table.summary td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  table.summary th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .fignote { font-size: 12px; line-height: 1.5; margin: 0 0 12px; }
  figure { margin: 0 0 18px; text-align: center; }
  figure img { width: 100%; max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 6px; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 5px; }
  pre.mono {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    background: var(--paper); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px;
  }
  .appendix { page-break-before: always; }
  .avoid-break, figure, .kpi { page-break-inside: avoid; }
  /* Booktabs-style regression / summary tables (Tables 1, 3–6) */
  .reg-tables h2 { margin-top: 22px; }
  .rt-fig { margin: 10px 0 20px; text-align: left; }
  .rt-cap { font-size: 13px; margin: 0 0 6px; line-height: 1.4; }
  .rt-cap .rt-sub { color: var(--muted); font-weight: 400; font-size: 12px; }
  table.rt-table { border-collapse: collapse; width: 100%; font-size: 12px; font-variant-numeric: tabular-nums; }
  table.rt-table th, table.rt-table td { padding: 4px 8px; text-align: right; white-space: nowrap; }
  table.rt-table th.rt-var, table.rt-table td.rt-var { text-align: left; }
  table.rt-table thead th { border-top: 1.6px solid var(--ink); border-bottom: 1px solid var(--ink); font-weight: 700; }
  table.rt-table tbody tr:last-child td { border-bottom: 1.6px solid var(--ink); }
  table.rt-table tr.rt-se td { color: var(--muted); padding-top: 0; }
  table.rt-table tr.rt-firststat td { border-top: 1px solid var(--ink); }
  table.rt-table tr.rt-stat td { font-size: 11.5px; }
  .rt-note { font-size: 10.5px; color: var(--muted); margin: 5px 0 0; line-height: 1.45; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <header>
    <h1>Ideation Challenge — Insights gained</h1>
    <p class="doc-sub">Effects of AI Timing on Idea Generation (AsPredicted&nbsp;#298152)</p>
    <p class="doc-meta">Generated ${esc(generated)} · Analysis run in ${esc(langName)}${meta.rowsUsed != null ? ` · ${esc(String(meta.rowsUsed))} ideas analysed` : ''}</p>
  </header>

  ${summaryHtml}

  ${regHtml}

  <section class="insights">
    <h2>Insights</h2>
    ${insightsHtml}
  </section>

  ${figs}

  <section class="appendix">
    <h2>Appendix A — Regression results</h2>
    <p class="muted">The full statistical output (regression tables, planned contrasts and pairwise comparisons) these insights are read directly from.</p>
    <pre class="mono">${esc(regressionsText || '(no regression output captured)')}</pre>
  </section>

  <section class="appendix">
    <h2>Appendix B — ${esc(langName)} code</h2>
    <p class="muted">The exact ${esc(langName)} script that produced the regressions in Appendix A.</p>
    <pre class="mono">${esc(code || '(no code captured)')}</pre>
  </section>

  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 350);
    });
  </script>
</body></html>`
}

export { COND_CODES }
