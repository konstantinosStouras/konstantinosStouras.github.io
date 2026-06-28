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
  const raw = String(rawOutput || '')
  const lines = raw.split('\n')

  // Locate the "# INSIGHTS …" banner line that both scripts print.
  let marker = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#+\s*INSIGHTS\b/i.test(lines[i].trim())) { marker = i; break }
  }
  if (marker === -1) {
    return { hasInsights: false, regressionsText: raw.trim(), insightsText: '', parsed: null }
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

  return { hasInsights: true, regressionsText, insightsText, parsed: parseInsights(insightsLines) }
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
      const m = line.match(/^([A-Za-z][\w ]*?)\s*:\s*(.+)$/)
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

/**
 * Build the full print-ready HTML document.
 * @param {{parsed:object, regressionsText:string, code:string, lang:'python'|'r',
 *          images:string[], meta:{generatedAt?:string, rowsUsed?:number}}} opts
 */
export function buildInsightsPrintHtml({ parsed, regressionsText, code, lang, images = [], meta = {} }) {
  const langName = lang === 'r' ? 'R' : 'Python'
  const generated = meta.generatedAt || new Date().toLocaleString()
  const figNote =
    '<p class="muted fignote"><b>Bar charts</b> — each condition\'s average KPI score (1–7) with 95% ' +
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
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <header>
    <h1>Ideation Challenge — Insights gained</h1>
    <p class="doc-sub">Effects of AI Timing on Idea Generation (AsPredicted&nbsp;#298152)</p>
    <p class="doc-meta">Generated ${esc(generated)} · Analysis run in ${esc(langName)}${meta.rowsUsed != null ? ` · ${esc(String(meta.rowsUsed))} ideas analysed` : ''}</p>
  </header>

  <section class="insights">
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
