/**
 * latexReport.js
 *
 * Builds a complete, self-contained LaTeX document (article class + booktabs) of
 * the Data Analytics results, formatted like the tables in Boussioux et al. (2024,
 * Organization Science):
 *   • Table 1 — summary statistics + correlation matrix (from Section 4), and
 *   • Tables 3–6 — the regression tables parsed from the Step-5 run.
 * The string it returns is offered via the Section-6 "Download LaTeX (.tex)" button
 * and compiles with any LaTeX engine (pdflatex/xelatex) to a publication-quality PDF
 * formatted like the paper. Only standard packages (float, booktabs, array, caption)
 * are used, so it compiles on a minimal TeX install.
 */

import { tableCell } from './insightsReport'

// Escape the characters that are special in LaTeX text mode.
function tex(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}')
}

// A data cell: an unestimable "n/a"/"—" becomes a LaTeX em dash; otherwise escape.
function cell(v) {
  const s = tableCell(v)              // maps the "n/a" sentinel to "—"
  return s === '—' ? '---' : tex(s)
}

const fnum = (x, d = 2) => (x == null || Number.isNaN(Number(x)) ? '---' : Number(x).toFixed(d))

/** Table 1 (summary statistics + lower-triangular correlation matrix) as LaTeX. */
function summaryTableTex(summary) {
  if (!summary || !summary.variables || !summary.variables.length || !summary.n) return ''
  const v = summary.variables
  const k = v.length
  const colspec = 'l' + 'r'.repeat(5) + 'r'.repeat(k)              // label + 5 stats + k corr
  const header = ['Variable', 'Mean', 'Median', 'SD', 'Min', 'Max',
    ...v.map((_, i) => String(i + 1))].map(tex).join(' & ')
  const rows = v.map((row, i) => {
    const stats = [fnum(row.mean), fnum(row.median), fnum(row.sd), fnum(row.min), fnum(row.max)]
    const corr = v.map((_, j) => (j <= i ? fnum(summary.corr?.[i]?.[j]) : ''))
    return `${tex(`${i + 1}. ${row.label}`)} & ${[...stats, ...corr].join(' & ')} \\\\`
  }).join('\n')
  return `\\begin{table}[H]\\centering
\\caption*{\\textbf{Table 1.} Summary statistics and correlations}
\\setlength{\\tabcolsep}{4pt}\\footnotesize
\\resizebox{\\ifdim\\width>\\linewidth \\linewidth\\else\\width\\fi}{!}{%
\\begin{tabular}{${colspec}}
\\toprule
${header} \\\\
\\midrule
${rows}
\\bottomrule
\\end{tabular}}
\\\\[3pt] {\\footnotesize $N = ${tex(String(summary.n ?? '—'))}$ ideas (pairwise-complete correlations; per-variable N varies by source). Lower-triangular Pearson correlations. Dummies: AI / Solo / Group / Both vs None.}
\\end{table}`
}

/** One regression table (Tables 3–6) as a booktabs LaTeX table. */
function regressionTableTex(t) {
  const k = t.columns.length
  const colspec = 'l' + 'c'.repeat(k)
  const header = ['Variable', ...t.columns].map(tex).join(' & ')
  const lines = []
  let seenStat = false
  for (const r of t.rows) {
    if (r.kind === 'rule') continue
    if (r.kind === 'stat' && !seenStat) { lines.push('\\midrule'); seenStat = true }
    // SE rows keep empty cells blank (no SE under an n/a coefficient); coef/stat
    // cells map the "n/a" sentinel to a LaTeX em dash.
    const map = r.kind === 'se' ? (v => tex(String(v ?? ''))) : cell
    const cells = (r.cells || []).map(map)
    while (cells.length < k) cells.push('')                        // pad short rows
    lines.push(`${tex(r.label || '')} & ${cells.join(' & ')} \\\\`)
  }
  return `\\begin{table}[H]\\centering
\\caption*{\\textbf{Table ${tex(String(t.num ?? ''))}.} ${tex(t.title)}\\\\[1pt] {\\small ${tex(t.sub)}}}
\\setlength{\\tabcolsep}{6pt}\\small
\\resizebox{\\ifdim\\width>\\linewidth \\linewidth\\else\\width\\fi}{!}{%
\\begin{tabular}{${colspec}}
\\toprule
${header} \\\\
\\midrule
${lines.join('\n')}
\\bottomrule
\\end{tabular}}
\\\\[3pt] {\\footnotesize ${tex(t.note)}}
\\end{table}`
}

/** A compact "summary of findings" list from the parsed insights (optional). */
function findingsTex(parsed) {
  if (!parsed || !parsed.rankingSummary || !parsed.rankingSummary.length) return ''
  const items = parsed.rankingSummary
    .map(r => `\\item \\textbf{${tex(r.kpi)}:} ${tex(r.text)}`)
    .join('\n')
  const cov = parsed.coverageWarning
    ? `\\par\\smallskip\\noindent\\textit{Data-coverage check.} ${tex(parsed.coverageWarning)}`
    : ''
  return `\\section*{Summary of findings (best $\\rightarrow$ worst per KPI)}
\\begin{itemize}\\itemsep2pt
${items}
\\end{itemize}${cov}`
}

/**
 * Assemble the full LaTeX document.
 * @param {{tables:object[], summaryTable:object, parsed:object,
 *          lang:'python'|'r', meta:{generatedAt?:string, rowsUsed?:number}}} opts
 * @returns {string} compilable LaTeX source
 */
export function buildLatexSource({ tables = [], summaryTable = null, parsed = null, lang = 'python', meta = {} } = {}) {
  const langName = lang === 'r' ? 'R' : 'Python'
  const generated = meta.generatedAt || ''
  const rowsLine = meta.rowsUsed != null ? ` Based on ${meta.rowsUsed} ideas analysed.` : ''

  const body = [
    summaryTableTex(summaryTable),
    ...tables.map(regressionTableTex),
    findingsTex(parsed),
  ].filter(Boolean).join('\n\n')

  return `\\documentclass[10pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{float}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{graphicx}
\\usepackage{caption}
\\captionsetup{labelformat=empty,skip=4pt}
\\renewcommand{\\arraystretch}{1.12}
\\setlength{\\parindent}{0pt}
\\begin{document}

\\begin{center}
{\\Large\\bfseries Ideation Challenge --- Data Analytics report}\\\\[2pt]
{\\normalsize Effects of AI Timing on Idea Generation (AsPredicted \\#298152)}\\\\[2pt]
{\\footnotesize Tables formatted after Boussioux, Lane, Zhang, Jacimovic \\& Lakhani (2024), \\textit{Organization Science}.${rowsLine ? ' ' + tex(rowsLine.trim()) : ''}${generated ? ' Generated ' + tex(generated) + '.' : ''} Analysis run in ${tex(langName)}.}
\\end{center}

\\vspace{6pt}

${body}

\\end{document}
`
}
