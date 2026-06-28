import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, getDocs } from 'firebase/firestore'
import * as XLSX from 'xlsx-js-style'
import { auth, db } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import {
  CONDITIONS, CONDITION_INFO, KPIS, conditionForSession, buildRowsForSession,
  recomputeOverall, rowsToCsv, csvToRows, normalizeImportedRows, ideaText, summarize,
  matchScoresIntoRows,
} from '../utils/analyticsData'
import { scoreIdeas, fetchAISettings } from '../utils/llmClient'
import { PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById } from '../data/aiModels'
import { PYTHON_TEMPLATE, R_TEMPLATE } from '../data/analyticsTemplates'
import { runPython } from '../utils/pyodideRunner'
import { runR } from '../utils/webrRunner'
import { parseRunOutput, buildInsightsPrintHtml, kpiLabel } from '../utils/insightsReport'
import styles from './DataAnalytics.module.css'

const DESIGN_BRIEF = 'Designing a new product to improve sleep wellness.'
const condClass = cond => styles[`cond${Math.max(0, CONDITIONS.indexOf(cond))}`]
const userKey = (session, authorId) => `${session}|${authorId || ''}`

// localStorage keys for the per-section Save / Make-default persistence. Kept in
// the browser (no Firestore-rules change needed); "Save" and "Make this the
// default" both write the same key, which is loaded back on page open.
const LS = { sessions: 'da:sessions', dataset: 'da:dataset', python: 'da:code:python', r: 'da:code:r' }

export default function DataAnalytics() {
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [rows, setRows] = useState([])
  const [excludedUsers, setExcludedUsers] = useState(() => new Set())
  const [showUsers, setShowUsers] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [scoreLoadMsg, setScoreLoadMsg] = useState('')
  // Whether each section currently has a saved value (enables "Restore built-in default").
  const [saved, setSaved] = useState({ sessions: false, dataset: false, python: false, r: false })

  const [aiSettings, setAiSettings] = useState(null) // raw settings/ai doc (admin-readable: holds apiKeys)
  const [scoreProvider, setScoreProvider] = useState(DEFAULT_SCORING_PROVIDER)
  const [scoreModel, setScoreModel] = useState(SCORING_DEFAULT_MODEL[DEFAULT_SCORING_PROVIDER])
  const [scoring, setScoring] = useState(null) // { done, total } | null
  const [scoreErr, setScoreErr] = useState('')

  const [tab, setTab] = useState('python')
  const [pyCode, setPyCode] = useState(PYTHON_TEMPLATE)
  const [rCode, setRCode] = useState(R_TEMPLATE)
  const [running, setRunning] = useState(false)
  const [runStatus, setRunStatus] = useState('')
  const [output, setOutput] = useState('')
  const [images, setImages] = useState([])
  const [runError, setRunError] = useState(null)
  // Snapshot of the most recent successful run — drives the Step 4 "Insights
  // gained" panel + its PDF export. { lang, code, output, images, ranAt }.
  const [lastRun, setLastRun] = useState(null)

  const fileRef = useRef(null)
  const scoreFileRef = useRef(null)
  const outRef = useRef('')
  const flushQueued = useRef(false)
  const ridSeq = useRef(0)
  const tagRows = arr => arr.map(r => (r.rid ? r : { ...r, rid: `row_${ridSeq.current++}` }))

  // ── Load session list + AI settings on mount ──
  useEffect(() => { refreshSessions() }, [])
  useEffect(() => {
    fetchAISettings().then(setAiSettings).catch(() => setAiSettings({}))
  }, [])

  // Restore any saved section state from a previous visit (browser-local).
  useEffect(() => {
    try {
      const py = localStorage.getItem(LS.python); if (py != null) setPyCode(py)
      const rc = localStorage.getItem(LS.r); if (rc != null) setRCode(rc)
      const sel = localStorage.getItem(LS.sessions)
      if (sel) { const a = JSON.parse(sel); if (Array.isArray(a)) setSelected(new Set(a)) }
      const ds = localStorage.getItem(LS.dataset)
      if (ds) {
        const parsed = JSON.parse(ds)
        if (Array.isArray(parsed?.rows)) {
          setRows(parsed.rows)
          // Keep the rid counter ahead of any restored ids so future rows don't collide.
          const maxN = parsed.rows.reduce((m, r) => Math.max(m, parseInt(String(r.rid || '').replace('row_', ''), 10) || 0), 0)
          ridSeq.current = maxN + 1
        }
        if (Array.isArray(parsed?.excluded)) setExcludedUsers(new Set(parsed.excluded))
      }
      setSaved({
        sessions: localStorage.getItem(LS.sessions) != null,
        dataset: localStorage.getItem(LS.dataset) != null,
        python: localStorage.getItem(LS.python) != null,
        r: localStorage.getItem(LS.r) != null,
      })
    } catch (_) { /* localStorage unavailable / malformed — ignore */ }
  }, [])

  // ── Per-section Save / Make-default / Restore (browser-local persistence) ──
  function persist(key, value, flag) {
    try { localStorage.setItem(key, value); setSaved(s => ({ ...s, [flag]: true })) } catch (_) { /* quota / disabled */ }
  }
  function forget(key, flag) {
    try { localStorage.removeItem(key) } catch (_) { /* ignore */ }
    setSaved(s => ({ ...s, [flag]: false }))
  }
  const saveSessions = () => persist(LS.sessions, JSON.stringify([...selected]), 'sessions')
  const restoreSessions = () => { forget(LS.sessions, 'sessions'); selectNone() }
  const saveDataset = () => persist(LS.dataset, JSON.stringify({ rows, excluded: [...excludedUsers] }), 'dataset')
  const restoreDataset = () => forget(LS.dataset, 'dataset')
  const saveCode = () => (tab === 'python' ? persist(LS.python, pyCode, 'python') : persist(LS.r, rCode, 'r'))
  const restoreCode = () => {
    if (tab === 'python') { forget(LS.python, 'python'); setPyCode(PYTHON_TEMPLATE) }
    else { forget(LS.r, 'r'); setRCode(R_TEMPLATE) }
  }

  const activeProvider = providerById(scoreProvider)
  const selectedHasKey = !!aiSettings?.apiKeys?.[scoreProvider]
  function onScoreProviderChange(pid) {
    setScoreProvider(pid)
    setScoreModel(SCORING_DEFAULT_MODEL[pid] || providerById(pid).defaultModel)
  }

  async function refreshSessions() {
    setLoadingSessions(true)
    try {
      const snap = await getDocs(collection(db, 'sessions'))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setSessions(list)
    } catch (err) {
      console.error('Failed to load sessions', err)
    } finally {
      setLoadingSessions(false)
    }
  }

  function toggleSession(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll() { setSelected(new Set(sessions.map(s => s.id))) }
  function selectNone() { setSelected(new Set()) }

  // ── Build the analysis dataset from the selected sessions ──
  async function loadSelected(replace = true) {
    if (!selected.size) return
    setLoadingData(true)
    try {
      const collected = []
      for (const s of sessions.filter(x => selected.has(x.id))) {
        const [ideasSnap, partsSnap, groupsSnap] = await Promise.all([
          getDocs(collection(db, 'sessions', s.id, 'ideas')),
          getDocs(collection(db, 'sessions', s.id, 'participants')),
          getDocs(collection(db, 'sessions', s.id, 'groups')),
        ])
        const ideas = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const groups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        collected.push(...buildRowsForSession(s, ideas, parts, groups))
      }
      const tagged = tagRows(collected)
      if (replace) setExcludedUsers(new Set())
      setRows(prev => recomputeOverall(replace ? tagged : [...prev, ...tagged]))
    } catch (err) {
      console.error('Failed to load session data', err)
      alert('Failed to load session data: ' + (err.message || err))
    } finally {
      setLoadingData(false)
    }
  }

  // ── Import a spreadsheet / CSV file ──
  function onPickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        let imported
        if (/\.csv$/i.test(file.name)) {
          imported = normalizeImportedRows(csvToRows(ev.target.result))
        } else {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          // The admin Excel export is multi-sheet with an "About" guide first;
          // the per-idea analysis rows live in the "Ideas" sheet. Prefer it,
          // then any sheet that looks like idea data, else the first sheet.
          const name =
            wb.SheetNames.find(n => n.toLowerCase() === 'ideas') ||
            wb.SheetNames.find(n => /idea/i.test(n)) ||
            wb.SheetNames[0]
          const ws = wb.Sheets[name]
          imported = normalizeImportedRows(XLSX.utils.sheet_to_json(ws, { defval: '' }))
        }
        if (!imported.length) { alert('No idea rows found. For the admin Excel export, the data is on the "Ideas" sheet — import that workbook (or a CSV of it).'); return }
        const tagged = tagRows(imported)
        setRows(prev => recomputeOverall([...prev, ...tagged]))
      } catch (err) {
        alert('Could not parse file: ' + (err.message || err))
      }
    }
    if (/\.csv$/i.test(file.name)) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
    e.target.value = '' // allow re-importing the same file
  }

  // ── Load idea scores from a ranked-ideas file ("All Ideas Ranked" tab) ──
  function onPickScores(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setScoreLoadMsg('')
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        if (!rows.length) { setScoreLoadMsg('Load a session (or import ideas) first, then load the scores file to match scores onto those ideas.'); return }
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const sheetName =
          wb.SheetNames.find(n => /all ideas ranked/i.test(n)) ||
          wb.SheetNames.find(n => /rank/i.test(n)) ||
          wb.SheetNames[0]
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' })
        // The data table can sit below a preamble; find the header row that has
        // both an "Idea Title" and a "Novelty" column.
        let h = -1
        for (let i = 0; i < aoa.length; i++) {
          const cells = aoa[i].map(c => String(c).toLowerCase())
          if (cells.some(c => c.includes('idea title') || c === 'title') && cells.some(c => c.includes('novelty'))) { h = i; break }
        }
        if (h === -1) { setScoreLoadMsg(`Could not find a ranked-ideas table (a header row with "Idea Title" and "Novelty") on the "${sheetName}" sheet.`); return }
        const header = aoa[h].map(c => String(c).toLowerCase().trim())
        const find = pred => header.findIndex(pred)
        const ciTitle = find(c => c.includes('idea title') || c === 'title')
        const ciNov = find(c => c.includes('novelty'))
        const ciUse = find(c => c.includes('usefulness') || c.includes('useful'))
        const entries = []
        for (let i = h + 1; i < aoa.length; i++) {
          const r = aoa[i]
          const title = String(r[ciTitle] ?? '').trim()
          if (!title) continue
          const nov = ciNov >= 0 ? r[ciNov] : ''
          const use = ciUse >= 0 ? r[ciUse] : ''
          if ((nov === '' || nov == null) && (use === '' || use == null)) continue
          entries.push({ title, novelty: nov, usefulness: use })
        }
        if (!entries.length) { setScoreLoadMsg(`No scored idea rows found under "${sheetName}".`); return }
        // Don't let a removed participant's idea absorb a title match meant for a visible one.
        const res = matchScoresIntoRows(rows, entries, r => !excludedUsers.has(userKey(r.session, r.author_id)))
        setRows(recomputeOverall(res.rows))
        setScoreLoadMsg(`Loaded scores from "${sheetName}": updated ${res.matched} idea${res.matched === 1 ? '' : 's'} by title; ${res.unmatched} file row${res.unmatched === 1 ? '' : 's'} had no match in the loaded data.`)
      } catch (err) {
        setScoreLoadMsg('Could not read the scores file: ' + (err.message || err))
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── Derived: the dataset minus any removed participants ──
  const isExcluded = r => excludedUsers.has(userKey(r.session, r.author_id))
  const effectiveRows = useMemo(() => rows.filter(r => !isExcluded(r)), [rows, excludedUsers])

  // Distinct participants in the loaded data (for the remove/restore panel).
  const users = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = userKey(r.session, r.author_id)
      if (!map.has(key)) map.set(key, { key, session: r.session, author_id: r.author_id, author_name: r.author_name || '', author_email: r.author_email || '', count: 0, scored: 0 })
      const u = map.get(key)
      if (!u.author_email && r.author_email) u.author_email = r.author_email
      if (!u.author_name && r.author_name) u.author_name = r.author_name
      u.count++
      if (r.novelty !== '' && r.usefulness !== '') u.scored++
    }
    return [...map.values()].sort((a, b) =>
      a.session.localeCompare(b.session) ||
      String(a.author_name || a.author_id).localeCompare(String(b.author_name || b.author_id)))
  }, [rows])
  // Filter the participant list by the search box (name / email / user ID).
  const usersBySession = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    const matches = u => !q ||
      String(u.author_name).toLowerCase().includes(q) ||
      String(u.author_email).toLowerCase().includes(q) ||
      String(u.author_id).toLowerCase().includes(q)
    const m = new Map()
    for (const u of users) {
      if (!matches(u)) continue
      if (!m.has(u.session)) m.set(u.session, [])
      m.get(u.session).push(u)
    }
    return [...m.entries()]
  }, [users, userQuery])

  function toggleUser(key) {
    setExcludedUsers(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Score the unscored ideas with the configured LLM ──
  async function scoreUnscored() {
    setScoreErr('')
    const targets = effectiveRows
      .filter(r => r.novelty === '' || r.usefulness === '')
      .map(r => ({ rid: r.rid, text: r.text || ideaText(r) }))
    if (!targets.length) { setScoreErr('All ideas already have novelty and usefulness scores.'); return }
    setScoring({ done: 0, total: targets.length })
    try {
      const scores = await scoreIdeas(targets.map(t => t.text), {
        brief: DESIGN_BRIEF,
        settings: aiSettings,
        provider: scoreProvider,
        model: scoreModel,
        onProgress: ({ done, total }) => setScoring({ done, total }),
      })
      const byRid = new Map(targets.map((t, k) => [t.rid, scores[k]]))
      setRows(prev => recomputeOverall(prev.map(r => {
        const sc = byRid.get(r.rid)
        if (!sc) return r
        // Fill only the missing field(s); never overwrite a value already there
        // (hand-entered or previously scored), and ignore a null the model omitted.
        return {
          ...r,
          novelty: r.novelty === '' && sc.novelty != null ? sc.novelty : r.novelty,
          usefulness: r.usefulness === '' && sc.usefulness != null ? sc.usefulness : r.usefulness,
        }
      })))
    } catch (err) {
      setScoreErr(err.message || String(err))
    } finally {
      setScoring(null)
    }
  }

  function updateScore(rid, field, value) {
    setRows(prev => recomputeOverall(prev.map(r => {
      if (r.rid !== rid) return r
      const v = value === '' ? '' : Math.max(1, Math.min(7, Number(value)))
      return { ...r, [field]: Number.isNaN(v) ? '' : v }
    })))
  }

  // ── Downloads ──
  function downloadCsv() {
    if (!effectiveRows.length) return
    saveBlob(rowsToCsv(effectiveRows), 'idea_analytics_dataset.csv', 'text/csv;charset=utf-8')
  }

  function downloadExcel() {
    const data = effectiveRows
    if (!data.length) return
    const wb = XLSX.utils.book_new()

    // Sheet 1 — the per-idea dataset (one row per idea).
    const labels = {
      idea_id: 'Idea ID', session: 'Session', condition: 'Condition', phase: 'Phase',
      group_id: 'Group', author_id: 'Author ID', author_name: 'Author',
      novelty: 'Novelty', usefulness: 'Usefulness', overall_quality: 'Overall Quality',
      final_pick: 'Final Group Pick', text: 'Idea',
    }
    const ideaCols = Object.keys(labels)
    const ideaRows = data.map(r => Object.fromEntries(ideaCols.map(c => {
      const v = c === 'author_name' ? (r.author_name || '') : c === 'final_pick' ? (r.final_pick ? 'Yes' : 'No') : r[c]
      return [labels[c], v]
    })))
    addSheet(wb, 'Ideas', ideaRows)
    addSheet(wb, 'Summary by condition', summaryByConditionRows(data))
    addSheet(wb, 'Summary by session', summaryBySessionRows(data))
    if (excludedUsers.size) {
      addSheet(wb, 'Removed participants', users.filter(u => excludedUsers.has(u.key)).map(u => ({
        Session: u.session, Author: u.author_name || '', 'Author ID': u.author_id, 'Ideas removed': u.count,
      })))
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveBlob(out, 'idea_analytics_summary.xlsx', 'application/octet-stream')
  }

  function clearData() {
    if (rows.length && !confirm('Clear the loaded dataset?')) return
    setRows([])
    setExcludedUsers(new Set())
  }

  // ── Run code (Python via Pyodide / R via WebR) ──
  function pushLine(line) {
    outRef.current += line + '\n'
    if (!flushQueued.current) {
      flushQueued.current = true
      requestAnimationFrame(() => { flushQueued.current = false; setOutput(outRef.current) })
    }
  }

  async function runCode() {
    if (running) return
    const scored = effectiveRows.filter(r => r.novelty !== '' && r.usefulness !== '')
    if (scored.length < 2) {
      setRunError('Need at least a couple of scored ideas. Load a session and score the ideas first (or import a file with scores).')
      return
    }
    setRunning(true)
    setRunError(null)
    setImages([])
    outRef.current = ''
    setOutput('')
    const dataCsv = rowsToCsv(effectiveRows)
    try {
      const opts = { dataCsv, onStatus: setRunStatus }
      const result = tab === 'python'
        ? await runPython(pyCode, { ...opts, onStdout: pushLine })
        : await runR(rCode, { ...opts, onOutput: pushLine })
      const finalOutput = outRef.current || (tab === 'python' ? result.stdout : result.output) || ''
      setOutput(finalOutput)
      setImages(result.images || [])
      if (!result.ok) setRunError(result.error || 'Run failed.')
      // Remember this run so Step 4 can present its insights + export the PDF.
      // Kept even on a partial failure so whatever ran is still readable.
      setLastRun({
        lang: tab,
        code: tab === 'python' ? pyCode : rCode,
        output: finalOutput,
        images: result.images || [],
        ranAt: new Date(),
      })
    } catch (err) {
      setRunError(err.message || String(err))
    } finally {
      setRunStatus('')
      setRunning(false)
    }
  }

  const stats = useMemo(() => summarize(effectiveRows), [effectiveRows])
  const scoredCount = effectiveRows.filter(r => r.novelty !== '' && r.usefulness !== '').length
  const unscoredCount = effectiveRows.length - scoredCount
  const code = tab === 'python' ? pyCode : rCode
  const setCode = tab === 'python' ? setPyCode : setRCode
  const resetCode = () => (tab === 'python' ? setPyCode(PYTHON_TEMPLATE) : setRCode(R_TEMPLATE))

  // ── Step 4: insights derived from the last run ──
  const report = useMemo(() => (lastRun ? parseRunOutput(lastRun.output) : null), [lastRun])
  // "rows used for analysis: N" is printed by both scripts; surface it in the PDF header.
  const rowsUsed = useMemo(() => {
    const m = lastRun && /rows used for analysis:\s*(\d+)|N analysed:\s*(\d+)/i.exec(lastRun.output)
    return m ? Number(m[1] ?? m[2]) : (lastRun ? scoredCount : null)
  }, [lastRun, scoredCount])

  function exportInsightsPdf() {
    if (!lastRun || !report) return
    const html = buildInsightsPrintHtml({
      parsed: report.parsed,
      regressionsText: report.regressionsText,
      code: lastRun.code,
      lang: lastRun.lang,
      images: lastRun.images,
      meta: { generatedAt: (lastRun.ranAt || new Date()).toLocaleString(), rowsUsed },
    })
    const win = window.open('', '_blank')
    if (!win) { alert('Please allow pop-ups for this site to export the PDF.'); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  return (
    <div className={styles.pageWrap}>
      <header className={styles.topBar}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.topBarRight}>
          <span className={styles.role}>Instructor</span>
          <button className={styles.themeBtn} onClick={toggle} title="Toggle dark mode">{dark ? '☀' : '☾'}</button>
          <button className="btn-ghost" onClick={() => navigate('/admin')}>Admin</button>
          <button className="btn-ghost" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => navigate('/admin/data-analytics')}>Data Analytics</button>
          <button className="btn-ghost" onClick={() => navigate('/admin/ai-settings')}>AI Settings</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Data Analytics</h1>
          <p className={styles.sub}>
            Pull ideas from any session, score each idea on the three KPIs (novelty, usefulness,
            overall quality), download a single summarized Excel workbook, then run the bundled
            regressions — in Python or R, compiled right here in your browser — to see which of the
            four AI-timing conditions performs best, with p-values and plots. The four conditions are
            read automatically from each session's AI configuration.
          </p>

          <div className={styles.encodingCard}>
            <div className={styles.encodingTitle}>Condition encoding (used in every Excel/CSV export and the analyses)</div>
            <table className={styles.encodingTable}>
              <thead>
                <tr><th>Condition (paper name)</th><th>AI is present in</th><th>Encoding (Set A)</th></tr>
              </thead>
              <tbody>
                {CONDITION_INFO.map((c, i) => (
                  <tr key={c.encoding}>
                    <td>{c.paper}</td>
                    <td>{c.ai}</td>
                    <td><span className={`${styles.condTag} ${styles[`cond${i}`]}`}>{c.encoding}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* STEP 1 — Data source */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>1</span>Data source</span>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={refreshSessions} disabled={loadingSessions}>
              {loadingSessions ? 'Loading…' : 'Refresh'}
            </button>
          </h2>
          <p className={styles.hint}>
            Tick the completed or active sessions to include — each session's condition (per the
            encoding above) is read from its AI settings. You can also import the admin
            {' '}<strong>Excel export</strong>: it reads the <em>Ideas</em> sheet, takes the condition
            from its AI-stage columns, and averages any <em>Novelty/Usefulness (rater&nbsp;n)</em>
            columns into the KPI scores (or import a plain CSV with condition / novelty / usefulness columns).
          </p>

          {loadingSessions ? (
            <p className={styles.emptyNote}>Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className={styles.emptyNote}>No sessions found.</p>
          ) : (
            <div className={styles.sessionList}>
              {sessions.map(s => {
                const cond = conditionForSession(s)
                return (
                  <label key={s.id} className={styles.sessionRow}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSession(s.id)} />
                    <div className={styles.sessionMeta}>
                      <div className={styles.sessionCode}>{s.code || s.id}</div>
                      <div className={styles.sessionName}>
                        {s.name ? s.name + ' · ' : ''}{s.status || 'unknown'}
                      </div>
                    </div>
                    <span className={`${styles.condTag} ${condClass(cond)}`}>{cond}</span>
                  </label>
                )
              })}
            </div>
          )}

          <div className={styles.row} style={{ marginTop: 14 }}>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={selectAll}>Select all</button>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={selectNone}>Clear</button>
            <button className="btn-primary" onClick={() => loadSelected(true)} disabled={!selected.size || loadingData || !!scoring}>
              {loadingData ? 'Loading…' : `Load ${selected.size || ''} session${selected.size === 1 ? '' : 's'}`.trim()}
            </button>
            {rows.length > 0 && (
              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => loadSelected(false)} disabled={!selected.size || loadingData || !!scoring}>
                Append to current
              </button>
            )}
            <div className={styles.spacer} />
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => fileRef.current?.click()} disabled={!!scoring}>Import Excel / CSV</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={onPickFile} />
          </div>

          <SectionActions onSave={saveSessions} onMakeDefault={saveSessions} onRestore={restoreSessions} hasCustom={saved.sessions} />
        </section>

        {/* STEP 2 — KPI scoring + dataset */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>2</span>Score ideas, manage participants &amp; download</span>
            {rows.length > 0 && (
              <span className={styles.row}>
                <button className="btn-primary" onClick={downloadExcel} disabled={!effectiveRows.length}>Download Excel</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => scoreFileRef.current?.click()} disabled={!!scoring} title='Load idea scores from a ranked-ideas file ("All Ideas Ranked" tab)'>Load scores file</button>
                <input ref={scoreFileRef} type="file" accept=".xlsx,.xls" className={styles.fileInput} onChange={onPickScores} />
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadCsv} disabled={!effectiveRows.length}>Download CSV</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearData} disabled={!!scoring}>Clear</button>
              </span>
            )}
          </h2>

          {rows.length === 0 ? (
            <p className={styles.emptyNote}>Load a session or import a file above to build the dataset.</p>
          ) : (
            <>
              <div className={styles.stats}>
                <div className={styles.statBox}><div className={styles.statNum}>{effectiveRows.length}</div><div className={styles.statLabel}>Ideas{excludedUsers.size ? ` (${rows.length - effectiveRows.length} removed)` : ''}</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{scoredCount}</div><div className={styles.statLabel}>Scored</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{unscoredCount}</div><div className={styles.statLabel}>Unscored</div></div>
                {CONDITIONS.map(c => (
                  <div className={styles.statBox} key={c}>
                    <div className={styles.statNum}>{stats[c]?.count || 0}</div>
                    <div className={styles.statLabel}>{c}</div>
                  </div>
                ))}
              </div>

              <div className={styles.banner}>
                <strong>Extend the data — score each idea per KPI.</strong> The AI rater scores every idea
                on novelty and usefulness (1–7); overall quality is their mean. Choose the API and model
                below — it uses the matching key saved under AI&nbsp;Settings. You can also edit any score
                directly in the table, remove participants, and download the summarized workbook.
              </div>

              <div className={styles.raterRow}>
                <span className={styles.raterLabel}>AI rater</span>
                <select className={styles.miniSelect} value={scoreProvider} onChange={e => onScoreProviderChange(e.target.value)} disabled={!!scoring}>
                  {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className={styles.miniSelect} value={scoreModel} onChange={e => setScoreModel(e.target.value)} disabled={!!scoring}>
                  {activeProvider.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                {aiSettings && !selectedHasKey && (
                  <span className={styles.unscored}>no {activeProvider.name} key saved — add it under AI Settings</span>
                )}
              </div>

              <div className={styles.row} style={{ marginBottom: 12 }}>
                <button className="btn-primary" onClick={scoreUnscored} disabled={!!scoring || unscoredCount === 0}>
                  {scoring ? `Scoring ${scoring.done}/${scoring.total}…` : `Score ${unscoredCount} unscored idea${unscoredCount === 1 ? '' : 's'} with AI`}
                </button>
                {scoring && <span className={styles.statusLine}><span className={styles.spinner} /> contacting {scoreProvider}…</span>}
              </div>
              {scoring && (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${Math.round((scoring.done / scoring.total) * 100)}%` }} />
                </div>
              )}
              {scoreErr && <p className="error-msg">{scoreErr}</p>}
              {scoreLoadMsg && <p className={styles.loadMsg}>{scoreLoadMsg}</p>}

              {/* Participants manager */}
              <div className={styles.row} style={{ margin: '10px 0 6px' }}>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => setShowUsers(v => !v)}>
                  {showUsers ? '▾' : '▸'} Manage participants ({users.length}){excludedUsers.size ? ` · ${excludedUsers.size} removed` : ''}
                </button>
                {excludedUsers.size > 0 && (
                  <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => setExcludedUsers(new Set())} disabled={!!scoring}>Restore all</button>
                )}
              </div>
              {showUsers && (
                <div className={styles.userPanel}>
                  <input
                    className={`input-field ${styles.userSearch}`}
                    placeholder="Search by name, email, or user ID…"
                    value={userQuery}
                    onChange={e => setUserQuery(e.target.value)}
                  />
                  <p className={styles.hint}>
                    Remove a participant to drop all of their ideas from the dataset, the summary stats,
                    the downloaded Excel/CSV, and the regressions. Click again to restore them.
                  </p>
                  {usersBySession.length === 0 && (
                    <p className={styles.emptyNote}>No participants match “{userQuery}”.</p>
                  )}
                  {usersBySession.map(([sess, us]) => (
                    <div key={sess} className={styles.userGroup}>
                      <div className={styles.userGroupHead}>
                        {sess} <span className={styles.kpiPill}>{us.length} participant{us.length === 1 ? '' : 's'}</span>
                      </div>
                      {us.map(u => {
                        const removed = excludedUsers.has(u.key)
                        return (
                          <div key={u.key} className={`${styles.userRow} ${removed ? styles.removed : ''}`}>
                            <div className={styles.userMeta}>
                              <span className={styles.userName}>{u.author_name || u.author_email || u.author_id || '(unknown)'}</span>
                              <span className={styles.userSub}>
                                {u.count} idea{u.count === 1 ? '' : 's'} · {u.scored} scored
                                {u.author_email ? ` · ${u.author_email}` : ''}
                                {u.author_id ? ` · ${u.author_id}` : ''}
                              </span>
                            </div>
                            <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => toggleUser(u.key)} disabled={!!scoring}>
                              {removed ? 'Restore' : 'Remove'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.tableWrap} style={{ marginTop: 14 }}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Idea ID</th><th>Session</th><th>Condition</th><th>Phase</th>
                      <th>Novelty</th><th>Usefulness</th><th>Overall</th><th>Idea</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveRows.map(r => (
                      <tr key={r.rid}>
                        <td className={styles.idCell} title={r.idea_id}>{r.idea_id}</td>
                        <td>{r.session}</td>
                        <td><span className={`${styles.condTag} ${condClass(r.condition)}`}>{r.condition}</span></td>
                        <td>{r.phase}</td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="7" step="0.5"
                            value={r.novelty} onChange={e => updateScore(r.rid, 'novelty', e.target.value)} />
                        </td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="7" step="0.5"
                            value={r.usefulness} onChange={e => updateScore(r.rid, 'usefulness', e.target.value)} />
                        </td>
                        <td className={`num ${r.overall_quality === '' ? styles.unscored : ''}`}>
                          {r.overall_quality === '' ? '—' : Number(r.overall_quality).toFixed(2)}
                        </td>
                        <td className={styles.textCell}>{r.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <SectionActions onSave={saveDataset} onMakeDefault={saveDataset} onRestore={restoreDataset} hasCustom={saved.dataset} />
            </>
          )}
        </section>

        {/* STEP 3 — Code + compile */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>3</span>Regressions — edit &amp; compile online</span>
            <span className={styles.kpiPill}>KPIs: {KPIS.join(' · ')}</span>
          </h2>
          <p className={styles.hint}>
            Both tabs run the <em>same</em> analysis on your scored dataset (after any removed participants):
            one linear regression per KPI across the four conditions (<em>None</em> = no-AI baseline), the
            planned <em>Solo</em> vs <em>Group</em> contrast, a best→worst ranking, and plots. Edit the code
            and press Run — Python runs via Pyodide and R via WebR, both compiled in your browser (first run
            downloads the runtime, ~10–30&nbsp;s).
          </p>

          <div className={styles.tabs}>
            <button className={`${styles.tab} ${tab === 'python' ? styles.tabActive : ''}`} onClick={() => setTab('python')}>Python</button>
            <button className={`${styles.tab} ${tab === 'r' ? styles.tabActive : ''}`} onClick={() => setTab('r')}>R</button>
          </div>

          <div className={styles.editorBar}>
            <button className="btn-primary" onClick={runCode} disabled={running}>
              {running ? <><span className={styles.spinner} /> Running…</> : `▶ Run ${tab === 'python' ? 'Python' : 'R'}`}
            </button>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={resetCode} disabled={running}>Reset to template</button>
            {runStatus && <span className={styles.statusLine}><span className={styles.spinner} /> {runStatus}</span>}
          </div>

          <textarea
            className={styles.codeArea}
            value={code}
            spellCheck={false}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Tab') {
                e.preventDefault()
                const t = e.target
                const s = t.selectionStart
                const ne = code.slice(0, s) + '    ' + code.slice(t.selectionEnd)
                setCode(ne)
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4 })
              }
            }}
          />

          <SectionActions
            onSave={saveCode}
            onMakeDefault={saveCode}
            onRestore={restoreCode}
            hasCustom={tab === 'python' ? saved.python : saved.r}
          />

          {runError && <div className={`${styles.console} ${styles.consoleErr}`}>{runError}</div>}
          {output && <div className={styles.console}>{output}</div>}

          {images.length > 0 && (
            <div className={styles.plotGrid}>
              {images.map((src, i) => (
                <div className={styles.plotCard} key={i}><img src={src} alt={`plot ${i + 1}`} /></div>
              ))}
            </div>
          )}
        </section>

        {/* STEP 4 — Insights gained */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>4</span>Insights gained</span>
            {lastRun && (
              <button className="btn-primary" onClick={exportInsightsPdf}>⬇ Export PDF</button>
            )}
          </h2>
          <p className={styles.hint}>
            A clean, readable write-up of what the Step&nbsp;3 regressions found — each KPI's
            best→worst condition ranking, how every condition compares with the no-AI baseline,
            and the planned AI-timing contrast — with the plots shown large. <strong>Export PDF</strong>{' '}
            saves it all, including <strong>Appendix A</strong> (the regression results these insights
            are based on) and <strong>Appendix B</strong> (the{' '}
            {lastRun ? (lastRun.lang === 'r' ? 'R' : 'Python') : 'Python / R'} code that produced them).
          </p>

          {!lastRun ? (
            <p className={styles.emptyNote}>Run the analysis in Step&nbsp;3 (Python or R) first — the insights appear here.</p>
          ) : (
            <>
              <div className={styles.insightsMeta}>
                Based on the {lastRun.lang === 'r' ? 'R' : 'Python'} run
                {rowsUsed != null ? ` · ${rowsUsed} idea${rowsUsed === 1 ? '' : 's'} analysed` : ''}
                {lastRun.ranAt ? ` · ${lastRun.ranAt.toLocaleString()}` : ''}
              </div>

              {report?.hasInsights ? (
                <InsightsPanel report={report} />
              ) : (
                <div className={styles.coverageCallout}>
                  The current Step&nbsp;3 script produced no <strong>INSIGHTS</strong> section to format. The full
                  output still shows in Step&nbsp;3, and <strong>Export PDF</strong> includes it as Appendix&nbsp;A.
                </div>
              )}

              {lastRun.images.length > 0 && (
                <div className={styles.plotGridLarge}>
                  {lastRun.images.map((src, i) => (
                    <figure className={styles.plotCardLarge} key={i}>
                      <img src={src} alt={`figure ${i + 1}`} />
                      <figcaption className={styles.plotCaption}>Figure {i + 1}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Step 4 insights panel: a readable, formatted view of the INSIGHTS read-out
// parsed from the last Python/R run (the same data the PDF export renders). ────
function InsightsPanel({ report }) {
  const { parsed } = report
  if (!parsed) {
    return <pre className={styles.insightsRaw}>{report.insightsText || report.regressionsText}</pre>
  }
  return (
    <div className={styles.insightsBody}>
      {parsed.coverageWarning && (
        <div className={styles.coverageCallout}>
          <strong>Data-coverage check.</strong> {parsed.coverageWarning}
        </div>
      )}
      {parsed.conditionsWithData && (
        <p className={styles.insightsLead}>Conditions with data: <strong>{parsed.conditionsWithData}</strong>.</p>
      )}

      {parsed.kpis.map(kpi => (
        <div className={styles.kpiCard} key={kpi.name}>
          <h3 className={styles.kpiName}>{kpiLabel(kpi.name)}</h3>
          {kpi.notEstimable ? (
            <p className={styles.kpiMuted}>Not estimable (needs ≥ 2 conditions with data) — no ranking for this KPI.</p>
          ) : (
            <>
              {kpi.ranking.length > 0 && (
                <div className={styles.rankRow}>
                  <span className={styles.rankLabel}>Ranking (best → worst)</span>
                  <span className={styles.rankChips}>
                    {kpi.ranking.map((r, i) => (
                      <span className={styles.rankChipWrap} key={r.cond}>
                        <span className={styles.rankChip}>{r.rank}. <b>{r.cond}</b> <span className={styles.rankMean}>{r.mean.toFixed(2)}</span></span>
                        {i < kpi.ranking.length - 1 && <span className={styles.gt}>›</span>}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {kpi.baselines.length > 0 ? (
                <div className={styles.vsBlock}>
                  <div className={styles.vsLabel}>Versus the no-AI baseline</div>
                  <ul className={styles.vsList}>
                    {kpi.baselines.map(b => (
                      <li key={b.cond}>
                        <b>{b.cond}</b>: {Math.abs(b.delta).toFixed(2)} points {b.dir} than no-AI{' '}
                        <span className={b.sig ? styles.sigYes : styles.sigNo}>(p = {b.p.toFixed(3)}, {b.verdict})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : kpi.noSig ? (
                <p className={styles.kpiMuted}>No condition differs significantly from the no-AI baseline on this KPI.</p>
              ) : null}
              {kpi.aiTiming && <p className={styles.timingLine}>{kpi.aiTiming}</p>}
              {kpi.best && (
                <p className={styles.bestWorst}>
                  Best: <b className={styles.best}>{kpi.best}</b> · Worst: <b className={styles.worst}>{kpi.worst}</b>
                </p>
              )}
            </>
          )}
        </div>
      ))}

      {parsed.rankingSummary.length > 0 && (
        <div className={styles.kpiCard}>
          <h3 className={styles.kpiName}>Condition ranking per KPI (best → worst)</h3>
          <table className={styles.summaryTable}>
            <thead><tr><th>KPI</th><th>Ranking (best → worst)</th></tr></thead>
            <tbody>
              {parsed.rankingSummary.map(r => (
                <tr key={r.kpi}><td>{kpiLabel(r.kpi)}</td><td>{r.text}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed.reminder && <p className={styles.kpiMuted}>Note: {parsed.reminder}</p>}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Three-button row (Save / Make this the default / Restore built-in default) that
// matches the admin panel's pattern; the clicked button flashes green for ~2s.
function SectionActions({ onSave, onMakeDefault, onRestore, hasCustom }) {
  const [flash, setFlash] = useState('') // which button just fired: save|default|restore
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), []) // clear the flash timer on unmount
  function fire(which, fn) {
    try { fn && fn() } catch (_) { /* ignore */ }
    setFlash(which)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(''), 2000)
  }
  const green = which => (flash === which ? styles.btnGreen : '')
  return (
    <div className={styles.sectionActions}>
      <button type="button" className={`${styles.saveBtn} ${green('save')}`} onClick={() => fire('save', onSave)}>
        {flash === 'save' ? '✓ Saved' : 'Save'}
      </button>
      <button type="button" className={`${styles.defaultBtn} ${green('default')}`} onClick={() => fire('default', onMakeDefault)}>
        {flash === 'default' ? '✓ Saved as default' : 'Make this the default'}
      </button>
      <button type="button" className={`${styles.restoreBtn} ${green('restore')}`} onClick={() => fire('restore', onRestore)} disabled={!hasCustom && flash !== 'restore'}>
        {flash === 'restore' ? '✓ Restored built-in default' : 'Restore built-in default'}
      </button>
    </div>
  )
}

function saveBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const round3 = x => (x == null || !Number.isFinite(x)) ? '' : Number(x.toFixed(3))

function summaryByConditionRows(rs) {
  const s = summarize(rs)
  return CONDITIONS.filter(c => (s[c]?.count || 0) > 0).map(c => {
    const k = s[c].kpis
    return {
      Condition: c,
      Ideas: s[c].count,
      Scored: s[c].scored,
      'Novelty mean': round3(k.novelty.mean), 'Novelty SD': round3(k.novelty.sd), 'Novelty n': k.novelty.n,
      'Usefulness mean': round3(k.usefulness.mean), 'Usefulness SD': round3(k.usefulness.sd), 'Usefulness n': k.usefulness.n,
      'Overall mean': round3(k.overall_quality.mean), 'Overall SD': round3(k.overall_quality.sd), 'Overall n': k.overall_quality.n,
    }
  })
}

function summaryBySessionRows(rs) {
  const by = new Map()
  for (const r of rs) {
    if (!by.has(r.session)) by.set(r.session, { session: r.session, condition: r.condition, rows: [] })
    by.get(r.session).rows.push(r)
  }
  const mean = (arr, key) => {
    const v = arr.map(x => Number(x[key])).filter(Number.isFinite)
    return v.length ? round3(v.reduce((a, b) => a + b, 0) / v.length) : ''
  }
  return [...by.values()].map(g => ({
    Session: g.session,
    Condition: g.condition,
    Ideas: g.rows.length,
    Scored: g.rows.filter(r => r.novelty !== '' && r.usefulness !== '').length,
    'Novelty mean': mean(g.rows, 'novelty'),
    'Usefulness mean': mean(g.rows, 'usefulness'),
    'Overall mean': mean(g.rows, 'overall_quality'),
  }))
}

// Build a styled worksheet (bold header row + auto-fit columns) and append it.
function addSheet(wb, name, objects) {
  const ws = XLSX.utils.json_to_sheet(objects.length ? objects : [{ '(no data)': '' }])
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref'])
    const cols = []
    for (let C = range.s.c; C <= range.e.c; C++) {
      let w = 10
      for (let R = range.s.r; R <= range.e.r; R++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (cell && cell.v != null) w = Math.max(w, Math.min(60, String(cell.v).length + 2))
      }
      cols.push({ wch: w })
      const header = ws[XLSX.utils.encode_cell({ r: 0, c: C })]
      if (header) header.s = { font: { bold: true } }
    }
    ws['!cols'] = cols
  }
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
}
