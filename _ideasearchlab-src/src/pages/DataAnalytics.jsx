import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import * as XLSX from 'xlsx-js-style'
import { auth, db } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import {
  CONDITIONS, CONDITION_INFO, KPIS, conditionForSession, buildRowsForSession,
  recomputeOverall, rowsToCsv, csvToRows, normalizeImportedRows, ideaText, summarize,
  matchScoresIntoRows, buildSummaryTable, DEFAULT_REFERENCE_SET, presentKpis,
  uploadedKpiKeys, uploadedKpiDefs, uploadedKpiLabel, analysisColumns,
  matchUploadedKpisIntoRows, clearUploadedKpis, stripAllKpis, UPLOADED_KPI_PREFIX,
} from '../utils/analyticsData'
import { scoreIdeas, fetchAISettings } from '../utils/llmClient'
import { tfidfVectors } from '../utils/tfidf'
import { computeDeterministicKpis, uniqueFraction, productivityCount, cosine, simMatrix } from '../utils/deterministicKpis'
import { PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById } from '../data/aiModels'
import { PYTHON_TEMPLATE, R_TEMPLATE } from '../data/analyticsTemplates'
import { runPython } from '../utils/pyodideRunner'
import { runR } from '../utils/webrRunner'
import { parseRunOutput, buildInsightsPrintHtml, kpiLabel, tableCell } from '../utils/insightsReport'
import { buildLatexSource } from '../utils/latexReport'
import {
  fetchSessionExportData, buildSessionSheets, mergeSessionSheets,
  appendSheetsToWorkbook, rankingsSheetFromIdeas, conditionOf,
} from '../utils/sessionExport'
import styles from './DataAnalytics.module.css'

// The study task: rate ideas against THIS design brief (the smart-materials /
// colour-changing-fabric task this version of the study actually ran).
const DESIGN_BRIEF = 'Designing a completely new product using a fabric that changes colour when it reaches 37°C (body temperature), for the smart materials and wearable technology market.'
const condClass = cond => styles[`cond${Math.max(0, CONDITIONS.indexOf(cond))}`]
const userKey = (session, authorId) => `${session}|${authorId || ''}`

// Every KPI column across the three sources (AI / external / objective); a row is
// "scored" for the analysis if it carries at least one of these.
const ALL_KPI_KEYS = [
  'novelty', 'usefulness', 'overall_quality',
  'ext_novelty', 'ext_usefulness', 'ext_quality',
  'det_novelty', 'det_distinctiveness', 'det_score',
]
const hasAnyKpi = r =>
  ALL_KPI_KEYS.some(k => r[k] !== '' && r[k] != null) ||
  Object.keys(r).some(k => k.startsWith('x_') && r[k] !== '' && r[k] != null)

// localStorage keys for the per-section Save / Make-default persistence. Kept in
// the browser (no Firestore-rules change needed); "Save" and "Make this the
// default" both write the same key, which is loaded back on page open.
const LS = { sessions: 'da:sessions', dataset: 'da:dataset', python: 'da:code:python', r: 'da:code:r', refset: 'da:refset' }

export default function DataAnalytics() {
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [rows, setRows] = useState([])
  // Sources for the Step-2 aggregate (the full multi-tab consolidation): the
  // Firestore session docs currently loaded, and any imported per-session export
  // workbooks (kept whole, all sheets — not just the Ideas rows that feed `rows`).
  const [loadedSessions, setLoadedSessions] = useState([])
  const [importedBooks, setImportedBooks] = useState([])
  const [aggregating, setAggregating] = useState(false)
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
  // Score only the group-selected ideas (Final Group Pick = 1) vs every idea.
  const [scoreOnlyFinal, setScoreOnlyFinal] = useState(true)
  // Summary Statistics: restrict to ideas scored on all three KPIs (default on).
  const [statsOnlyScored, setStatsOnlyScored] = useState(true)

  // ── Section 3.1 — deterministic / objective KPIs (in-browser TF-IDF) ──
  // No API key / billing: similarity is computed locally from the idea text.
  const [referenceSet, setReferenceSet] = useState(() => DEFAULT_REFERENCE_SET.join('\n'))
  const [detComputing, setDetComputing] = useState(null) // { phase, done, total } | null
  const [detErr, setDetErr] = useState('')
  const [detResult, setDetResult] = useState(null)       // per-condition pool KPIs
  // 3.1 — admin-uploaded extra KPIs (e.g. externally-computed Prototypicality/KS)
  const [kpiUploadMsg, setKpiUploadMsg] = useState('')
  // ── Section 3.3 — external-evaluator KPI upload ──
  const [evalLoadMsg, setEvalLoadMsg] = useState('')
  // Step-3 table sorting: which column + direction (0 = original order).
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState(0) // 1 asc, -1 desc, 0 none

  const [tab, setTab] = useState('python')
  const [pyCode, setPyCode] = useState(PYTHON_TEMPLATE)
  const [rCode, setRCode] = useState(R_TEMPLATE)
  const [running, setRunning] = useState(false)
  const [runStatus, setRunStatus] = useState('')
  const [output, setOutput] = useState('')
  const [images, setImages] = useState([])
  const [runError, setRunError] = useState(null)
  // Snapshot of the most recent successful run — drives the Step 6 "Insights
  // gained" panel + its PDF export. { lang, code, output, images, ranAt }.
  const [lastRun, setLastRun] = useState(null)
  // The console output / plots / insights belong to whichever language produced
  // them. We stash each language's last run here and restore it on tab switch, so
  // switching Python↔R shows that tab's own results (and a clean panel if it has
  // never been run) rather than the other language's output.
  const [runsByLang, setRunsByLang] = useState({}) // { python:{output,images,runError,lastRun}, r:{...} }

  const fileRef = useRef(null)
  const scoreFileRef = useRef(null)
  const evalScoreFileRef = useRef(null)
  const kpiFileRef = useRef(null)
  const outRef = useRef('')
  const flushQueued = useRef(false)
  const ridSeq = useRef(0)
  const bookSeq = useRef(0)
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
      const rs = localStorage.getItem(LS.refset); if (rs != null) setReferenceSet(rs)
      const sel = localStorage.getItem(LS.sessions)
      if (sel) { const a = JSON.parse(sel); if (Array.isArray(a)) setSelected(new Set(a)) }
      const ds = localStorage.getItem(LS.dataset)
      if (ds) {
        const parsed = JSON.parse(ds)
        if (Array.isArray(parsed?.rows)) {
          // Default = NO pre-computed KPIs: strip any saved KPI values so a refresh
          // starts clean across all of Section 3 (the admin re-computes/uploads).
          setRows(stripAllKpis(parsed.rows))
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
  // The dataset default deliberately carries NO KPIs (stripAllKpis), so a refresh
  // never reloads pre-computed/uploaded KPI values — only the loaded ideas + removals.
  const saveDataset = () => persist(LS.dataset, JSON.stringify({ rows: stripAllKpis(rows), excluded: [...excludedUsers] }), 'dataset')
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
      // Only the instructor's OWN sessions (their active + completed sessions) —
      // same `instructorId` filter the Admin panel uses — so orphan / foreign
      // sessions never show up here.
      const uid = auth.currentUser?.uid
      const ref = uid
        ? query(collection(db, 'sessions'), where('instructorId', '==', uid))
        : collection(db, 'sessions')
      const snap = await getDocs(ref)
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
  function selectAll() {
    setSelected(new Set(sessions.map(s => s.id)))
    setImportedBooks(prev => prev.map(b => ({ ...b, selected: true })))
  }
  function selectNone() { setSelected(new Set()) }
  // Tick / untick an imported file (loaded into the dataset on the next "Load").
  function toggleBook(id) {
    setImportedBooks(prev => prev.map(b => (b.id === id ? { ...b, selected: !b.selected } : b)))
  }

  // ── Build the analysis dataset from the TICKED sessions + imported files ──
  async function loadSelected(replace = true) {
    const loaded = sessions.filter(x => selected.has(x.id))
    const tickedBooks = importedBooks.filter(b => b.selected)
    if (!loaded.length && !tickedBooks.length) return
    setLoadingData(true)
    try {
      const collected = []
      for (const s of loaded) {
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
      const bookRows = tickedBooks.flatMap(b => b.rows || [])   // already tagged with _book + rid
      if (replace) setExcludedUsers(new Set())
      setRows(prev => {
        if (replace) return recomputeOverall([...tagged, ...bookRows])
        // Append: add the ticked sessions + any ticked books not already loaded.
        const present = new Set(prev.filter(r => r._book).map(r => r._book))
        const freshBooks = bookRows.filter(r => !present.has(r._book))
        return recomputeOverall([...prev, ...tagged, ...freshBooks])
      })
      // Remember the loaded session docs so Step 2 can rebuild their full export.
      setLoadedSessions(prev => {
        const merged = replace ? loaded : [...prev, ...loaded]
        return [...new Map(merged.map(s => [s.id, s])).values()]
      })
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
    const isCsv = /\.csv$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        let rawRows, bookSheets = []
        if (isCsv) {
          rawRows = csvToRows(ev.target.result)
        } else {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          // The admin Excel export is multi-sheet with an "About" guide first;
          // the per-idea analysis rows live in the "Ideas" sheet. Prefer it,
          // then any sheet that looks like idea data, else the first sheet.
          const name =
            wb.SheetNames.find(n => n.toLowerCase() === 'ideas') ||
            wb.SheetNames.find(n => /idea/i.test(n)) ||
            wb.SheetNames[0]
          rawRows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
          // Keep the WHOLE workbook (every sheet) so Step 2's "Aggregate Data" can
          // consolidate this file with the same multi-tab structure.
          bookSheets = wb.SheetNames.map(sn => ({
            name: sn, kind: 'json', rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }),
          }))
        }
        // Format check: reject anything that doesn't look like idea data (a
        // condition column + idea/KPI columns) with a pop-up, and do NOT import.
        if (!looksLikeIdeaData(rawRows)) { alert(importFormatMsg(isCsv ? 'CSV' : 'Excel')); return }
        const imported = normalizeImportedRows(rawRows)
        if (!imported.length) { alert(importFormatMsg(isCsv ? 'CSV' : 'Excel')); return }
        // DEFERRED LOAD: keep the parsed rows in the book (tagged by source file,
        // ticked by default) and add them to the dataset only when the admin
        // presses "Load …" — importing alone no longer changes Section 2.
        const bookId = `book_${bookSeq.current++}`
        const bookRows = tagRows(imported).map(r => ({ ...r, _book: bookId }))
        const conditions = [...new Set(imported.map(r => r.condition).filter(Boolean))]
        setImportedBooks(prev => [...prev, {
          id: bookId, label: file.name, kind: isCsv ? 'csv' : 'xlsx',
          sheets: bookSheets, count: imported.length, conditions,
          rows: bookRows, selected: true,
        }])
      } catch (err) {
        alert('Could not read the file: ' + (err.message || err))
      }
    }
    if (isCsv) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
    e.target.value = '' // allow re-importing the same file
  }

  // Remove a previously-imported file and all of its rows.
  function removeImportedBook(id) {
    setImportedBooks(prev => prev.filter(b => b.id !== id))
    setRows(prev => recomputeOverall(prev.filter(r => r._book !== id)))
  }

  // Section-1 "Clear": drop the selection AND the loaded dataset, so Section 2
  // (and the rest of the page) shows nothing.
  function clearSection1() {
    if ((rows.length || importedBooks.length) && !confirm('Clear the selection and the loaded data?')) return
    setSelected(new Set())
    setRows([])
    setExcludedUsers(new Set())
    setLoadedSessions([])
    setImportedBooks([])
  }

  // ── Load idea scores from a ranked-ideas file ("All Ideas Ranked" tab) ──
  // Shared by the 3.2 AI-scores upload (→ novelty/usefulness) and the 3.3
  // external-evaluator upload (→ ext_novelty/ext_usefulness). `fields` chooses the
  // target KPI columns; `setMsg` reports the result for that subsection.
  function loadScoresFile(file, fields, setMsg) {
    if (!file) return
    setMsg('')
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        if (!rows.length) { setMsg('Load a session (or import ideas) first, then load the scores file to match scores onto those ideas.'); return }
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
        if (h === -1) { alert(`This scores file does not match the expected format and was not imported.\n\nExpected an "All Ideas Ranked" (or Rankings) sheet with a header row containing "Idea Title" and "Novelty" columns (none found on the "${sheetName}" sheet).`); return }
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
        if (!entries.length) { alert(`This scores file does not match the expected format and was not imported.\n\nNo scored idea rows (with a Novelty/Usefulness value) were found under "${sheetName}".`); return }
        // Don't let a removed participant's idea absorb a title match meant for a visible one.
        const res = matchScoresIntoRows(rows, entries, r => !excludedUsers.has(userKey(r.session, r.author_id)), fields)
        setRows(recomputeOverall(res.rows))
        setMsg(`Loaded scores from "${sheetName}": updated ${res.matched} idea${res.matched === 1 ? '' : 's'} by title; ${res.unmatched} file row${res.unmatched === 1 ? '' : 's'} had no match in the loaded data.`)
      } catch (err) {
        setMsg('Could not read the scores file: ' + (err.message || err))
      }
    }
    reader.readAsArrayBuffer(file)
  }
  // 3.2 — AI scores upload (fills the AI KPI columns).
  function onPickScores(e) {
    loadScoresFile(e.target.files?.[0], { novelty: 'novelty', usefulness: 'usefulness' }, setScoreLoadMsg)
    e.target.value = ''
  }
  // 3.3 — external-evaluator scores upload (fills the ext_* KPI columns).
  function onPickEvalScores(e) {
    loadScoresFile(e.target.files?.[0], { novelty: 'ext_novelty', usefulness: 'ext_usefulness' }, setEvalLoadMsg)
    e.target.value = ''
  }

  // ── Section 3.1: compute the deterministic / objective KPIs via TF-IDF ──────
  // Vectorises every loaded idea + the reference set R with classical TF-IDF
  // (in the browser, no API key, no model download), then computes per-idea
  // Novelty (1 − max sim to R), Distinctiveness (1 − mean sim to the pool) and
  // the combined Score, plus the pool-level Unique fraction and Productivity per
  // condition. Cosine over TF-IDF vectors → fully reproducible from the data.
  async function computeDeterministic() {
    setDetErr(''); setDetResult(null)
    const pool = effectiveRows                         // distinctiveness pool = all loaded ideas
    if (pool.length < 2) { setDetErr('Load at least two ideas first.'); return }
    const refs = referenceSet.split('\n').map(s => s.trim()).filter(Boolean)
    if (!refs.length) { setDetErr('The reference set R is empty. Add the products that already exist (one per line).'); return }
    setDetComputing({ phase: 'Vectorising ideas (TF-IDF)', done: 0, total: pool.length + refs.length })
    // Let the "computing…" state paint before the synchronous TF-IDF work.
    await new Promise(res => setTimeout(res, 0))
    try {
      // Vectorise ideas + reference set TOGETHER so they share one vocabulary and
      // IDF space — required for the idea-vs-R cosine in Novelty to be meaningful.
      const ideaTexts = pool.map(r => r.text || ideaText(r))
      const { vectors } = tfidfVectors([...ideaTexts, ...refs])
      const ideaVecs = vectors.slice(0, pool.length)
      const refVecs = vectors.slice(pool.length)
      // Per-idea KPIs over the full pool.
      const { perIdea } = computeDeterministicKpis(ideaVecs, refVecs, { tau: 0.8 })
      const round4 = x => (x == null ? '' : Math.round(x * 1e4) / 1e4)
      const byRid = new Map(pool.map((r, i) => [r.rid, perIdea[i]]))
      setRows(prev => recomputeOverall(prev.map(r => {
        const d = byRid.get(r.rid)
        if (!d) return r
        return { ...r, det_novelty: round4(d.novelty), det_distinctiveness: round4(d.distinctiveness), det_score: round4(d.score) }
      })))
      // Pool-level KPIs per condition (unique fraction at three thresholds + KPI 2 productivity).
      const perCond = []
      for (const cond of CONDITIONS) {
        const idxs = pool.map((r, i) => (r.condition === cond ? i : -1)).filter(i => i >= 0)
        if (!idxs.length) continue
        const vecs = idxs.map(i => ideaVecs[i])
        const M = simMatrix(vecs)
        const items = idxs.map(i => ({ text: pool[i].text || ideaText(pool[i]), group: pool[i].group_id }))
        const prod = productivityCount(items, (a, b) => cosine(vecs[a], vecs[b]), { dedupTau: 0.9, minWords: 2 })
        perCond.push({
          condition: cond, n: idxs.length,
          uf80: uniqueFraction(M, 0.8), uf75: uniqueFraction(M, 0.75), uf85: uniqueFraction(M, 0.85),
          productivity: prod.count,
        })
      }
      setDetResult({ perCond, refCount: refs.length, ideas: pool.length })
    } catch (err) {
      setDetErr(err.message || String(err))
    } finally {
      setDetComputing(null)
    }
  }

  // ── Section 3.1: upload additional, externally-computed KPIs ────────────────
  // The admin uploads an Excel/CSV with an Idea ID column plus their own KPI
  // columns (e.g. Prototypicality / KS). EVERY non-standard numeric column is read
  // and matched onto the loaded ideas by Idea ID; once loaded the KPIs flow into
  // Section 4, the Step-2 aggregate "Rankings" tab, the Step-5 regressions and the
  // downloads like any other KPI. Stored per row as x_<column>.
  const STD_KPI_COLS = new Set([
    'idea id', 'idea_id', 'id', 'ideaid', 'condition', 'stage', 'phase',
    'final group pick', 'final_pick', 'final pick', 'title', 'idea title', 'description',
    'session', 'session code', 'group uid', 'group id', 'author id', 'author name',
    'author email', 'text', 'full text',
  ])
  const sanitizeKpiKey = h =>
    UPLOADED_KPI_PREFIX + String(h).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

  // Read every non-standard numeric column from the file and match onto the loaded
  // ideas by Idea ID (then title). No manual picking — all calculated KPI columns
  // (prototypicality, ks, …) are loaded at once.
  function importKpisFromRows(rawRows, fileName) {
    if (!rawRows?.length) { setKpiUploadMsg('That file has no rows.'); return }
    const headers = Object.keys(rawRows[0])
    const lc = h => String(h).toLowerCase().trim()
    const idCol = headers.find(h => ['idea id', 'idea_id', 'id', 'ideaid'].includes(lc(h)))
    const titleCol = headers.find(h => ['title', 'idea title'].includes(lc(h)))
    if (!idCol && !titleCol) { setKpiUploadMsg('The file needs an "Idea ID" (or "Title") column so the KPIs can be matched onto your ideas.'); return }
    const seen = new Set()
    const cols = []
    // A KPI column is numeric AND has at least one fractional (non-integer) value:
    // continuous scores (prototypicality, ks, …) come in, while integer-count
    // diagnostics (n_nodes, n_edges) and boolean flags (scorable) are skipped — they
    // aren't KPIs and aren't used anywhere downstream.
    const isKpiNum = v => v !== '' && v != null && typeof v !== 'boolean' && Number.isFinite(Number(v)) && !Number.isInteger(Number(v))
    for (const h of headers) {
      if (STD_KPI_COLS.has(lc(h))) continue
      if (!rawRows.some(r => isKpiNum(r[h]))) continue
      let key = sanitizeKpiKey(h)
      if (key === UPLOADED_KPI_PREFIX || seen.has(key)) key = `${key}_${cols.length + 1}`
      seen.add(key)
      cols.push({ name: h, key })
    }
    if (!cols.length) { setKpiUploadMsg('No numeric KPI columns found beyond the standard idea columns.'); return }
    const keys = cols.map(c => c.key)
    const entries = rawRows.map(r => ({
      idea_id: idCol ? r[idCol] : '',
      title: titleCol ? r[titleCol] : '',
      values: Object.fromEntries(cols.map(c => [c.key, r[c.name]])),
    }))
    const { rows: next, matched, unmatched } = matchUploadedKpisIntoRows(rows, entries, keys)
    setRows(next)
    const names = cols.map(c => uploadedKpiLabel(c.key)).join(', ')
    setKpiUploadMsg(
      `Loaded ${keys.length} KPI${keys.length === 1 ? '' : 's'} (${names}) from “${fileName}” onto ${matched} idea${matched === 1 ? '' : 's'}` +
      (unmatched ? `, ${unmatched} file row${unmatched === 1 ? '' : 's'} unmatched.` : '.') +
      ' Added to the Step-2 aggregate Rankings tab and the Step-5 regressions.'
    )
  }

  function onPickKpiFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!effectiveRows.length) { setKpiUploadMsg('Load ideas first (Steps 1–2), then upload KPIs to match onto them.'); return }
    const isCsv = /\.csv$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        let rawRows
        if (isCsv) rawRows = csvToRows(ev.target.result)
        else {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          const name = wb.SheetNames.find(n => /idea|score|sheet/i.test(n)) || wb.SheetNames[0]
          rawRows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
        }
        importKpisFromRows(rawRows, file.name)
      } catch (err) {
        setKpiUploadMsg('Could not read the file: ' + (err.message || err))
      }
    }
    if (isCsv) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  }

  // Remove every uploaded KPI (x_*) from the data, and update the stored dataset
  // default so a reload starts with NO past KPIs available.
  function onClearUploadedKpis() {
    const cleared = clearUploadedKpis(rows)
    setRows(cleared)
    try {
      if (localStorage.getItem(LS.dataset) != null) {
        localStorage.setItem(LS.dataset, JSON.stringify({ rows: stripAllKpis(cleared), excluded: [...excludedUsers] }))
      }
    } catch (_) { /* ignore storage errors */ }
    setKpiUploadMsg('Cleared all uploaded KPIs.')
  }

  // ── Derived: the dataset minus any removed participants ──
  const isExcluded = r => excludedUsers.has(userKey(r.session, r.author_id))
  const effectiveRows = useMemo(() => rows.filter(r => !isExcluded(r)), [rows, excludedUsers])
  // Uploaded extra KPIs currently present in the data (drives the 3.1 chip + Clear).
  const uploadedNow = useMemo(() => uploadedKpiDefs(effectiveRows), [effectiveRows])
  // KPI columns shown in the Step-3 table beyond the editable AI ones (Novelty /
  // Usefulness / Quality already have their own columns): the objective KPIs (3.1),
  // evaluator KPIs (3.3) and any uploaded KPIs — appended read-only after Quality.
  const AI_KPI_KEYS = ['novelty', 'usefulness', 'overall_quality']
  const extraKpiCols = useMemo(
    () => presentKpis(effectiveRows).filter(d => !AI_KPI_KEYS.includes(d.key)),
    [effectiveRows])

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
    // Score either every idea, or only the group-selected Final Ideas, per the toggle.
    const pool = scoreOnlyFinal ? effectiveRows.filter(r => Number(r.final_pick) === 1) : effectiveRows
    const targets = pool
      .filter(r => r.novelty === '' || r.usefulness === '')
      .map(r => ({ rid: r.rid, text: r.text || ideaText(r) }))
    if (!targets.length) {
      setScoreErr(scoreOnlyFinal
        ? 'No unscored Final Ideas to score (none are marked Final Group Pick, or they are all scored). Untick the box to score all ideas.'
        : 'All ideas already have novelty and usefulness scores.')
      return
    }
    // Always use the API keys CURRENTLY saved in AI Settings (settings/ai), even if
    // they were added/changed after this page was opened — re-read them at score
    // time and refresh the on-page "no key" hint. Falls back to the loaded copy.
    let settings = aiSettings
    try { settings = await fetchAISettings(); setAiSettings(settings) } catch (_) { /* keep the loaded copy */ }
    setScoring({ done: 0, total: targets.length })
    try {
      const scores = await scoreIdeas(targets.map(t => t.text), {
        brief: DESIGN_BRIEF,
        settings,
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

  // Click a Step-3 table header to sort by that column: 1st click ascending,
  // 2nd descending, 3rd back to the original (loaded) order.
  function toggleSort(colKey) {
    if (sortCol !== colKey) { setSortCol(colKey); setSortDir(1) }
    else if (sortDir === 1) setSortDir(-1)
    else { setSortCol(null); setSortDir(0) }
  }
  const sortedRows = useMemo(() => {
    if (!sortCol || !sortDir) return effectiveRows
    // Built-in columns have a getter; dynamic KPI columns (det_* / ext_* / x_*)
    // fall back to reading the row field numerically.
    const col = SORT_GETTERS[sortCol] || { get: r => r[sortCol], type: 'num' }
    if (!col) return effectiveRows
    const arr = effectiveRows.map((r, i) => [r, i])  // keep original index for a stable sort
    arr.sort(([ra, ia], [rb, ib]) => {
      const a = col.get(ra), b = col.get(rb)
      let d
      if (col.type === 'num') {
        const x = (a === '' || a == null || Number.isNaN(Number(a))) ? -Infinity : Number(a)
        const y = (b === '' || b == null || Number.isNaN(Number(b))) ? -Infinity : Number(b)
        d = x - y
      } else {
        d = String(a ?? '').localeCompare(String(b ?? ''))
      }
      return d === 0 ? ia - ib : d * sortDir
    })
    return arr.map(([r]) => r)
  }, [effectiveRows, sortCol, sortDir])

  function updateScore(rid, field, value) {
    setRows(prev => recomputeOverall(prev.map(r => {
      if (r.rid !== rid) return r
      const v = value === '' ? '' : Math.max(1, Math.min(5, Number(value)))
      return { ...r, [field]: Number.isNaN(v) ? '' : v }
    })))
  }

  // ── Downloads ──
  function downloadCsv() {
    if (!effectiveRows.length) return
    saveBlob(rowsToCsv(effectiveRows, analysisColumns(effectiveRows)), 'idea_analytics_dataset.csv', 'text/csv;charset=utf-8')
  }

  function downloadExcel() {
    const data = effectiveRows
    if (!data.length) return
    const wb = XLSX.utils.book_new()
    addSheet(wb, 'Ideas', ideaSheetRows(data))
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

  // ── Section 3.1: download the input "ideas" file with a KPI column per idea ──
  // Re-emits each idea in the original Rankings/"ideas" layout (Idea ID, Condition,
  // Stage, Final Group Pick, Title, Description) and appends one column for every
  // computed KPI that has data (the 3.1 objective KPIs, plus AI/evaluator scores if
  // present). A second tab carries the per-condition pool KPIs (not per-idea).
  function downloadIdeasWithKpis() {
    const data = effectiveRows
    if (!data.length) return
    const kpis = presentKpis(data)
    const stageLabel = ph => (ph === 'group' ? 'group' : ph === 'individual' ? 'individual (solo)' : (ph || ''))
    const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v))
    const ideaRows = data.map(r => {
      const row = {
        'Idea ID': r.idea_id,
        'Condition': r.condition,
        'Stage': stageLabel(r.phase),
        'Final Group Pick': r.final_pick ? 'Yes' : 'No',
        'Title': r.idea_title || '',
        'Description': r.idea_description || '',
      }
      for (const k of kpis) row[k.label] = num(r[k.key])
      return row
    })
    const wb = XLSX.utils.book_new()
    addSheet(wb, 'ideas', ideaRows)
    // Pool-level KPIs (Unique fraction / Productivity) are per condition, not per
    // idea, so they live on their own tab when a compute run produced them.
    if (detResult?.perCond?.length) {
      addSheet(wb, 'Pool KPIs by condition', poolKpiRows(detResult.perCond))
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveBlob(out, 'ideas_with_kpis.xlsx', 'application/octet-stream')
  }

  // ── Step 2: consolidate every loaded source into ONE workbook ──
  // Rebuilds the full multi-tab research export for each loaded Firestore session
  // (via the shared sessionExport builder, so it is byte-for-byte the same format
  // as the per-session "Download Excel"), stacks the same tab from every session +
  // any imported export workbook, and appends the extra "Rankings" tab.
  async function downloadAggregate() {
    if (aggregating) return
    const loadedImported = importedBooks.filter(b => loadedBookIds.has(b.id))
    if (!loadedSessions.length && !loadedImported.length) {
      alert('Load one or more sessions above (or import + load session export files), then build the aggregate file.')
      return
    }
    setAggregating(true)
    try {
      const sources = []
      const aboutMeta = []
      // Firestore-loaded sessions: fetch their full data and build all tabs.
      for (const s of loadedSessions) {
        const data = await fetchSessionExportData(s)
        sources.push({ sheets: buildSessionSheets(s, data) })
        const c = conditionOf(s)
        aboutMeta.push({
          code: c.sessionCode, placement: c.placement, paperName: c.paperName,
          participants: data.participants.length, ideas: data.ideas.length,
        })
      }
      // Imported export workbooks that have been LOADED: contribute their sheets.
      for (const b of loadedImported) {
        sources.push({ sheets: b.sheets })
        aboutMeta.push(...bookAboutMeta(b))
      }
      const merged = mergeSessionSheets(sources, aboutMeta)
      const ideasSheet = merged.find(s => s.name === 'Ideas')
      if (ideasSheet) {
        // Carry any KPI set on the page into the Rankings tab (by Idea ID), so the
        // consolidated file reflects the AI scoring (3.2), the objective KPIs
        // computed in 3.1, AND any uploaded extra KPIs. Include a row if it has any.
        const has = v => v !== '' && v != null
        const upDefs = uploadedKpiDefs(rows)         // [{ key:'x_…', label }]
        const scoreById = new Map()
        for (const r of rows) {
          const hasAi = has(r.novelty) || has(r.usefulness)
          const hasDet = has(r.det_novelty) || has(r.det_distinctiveness) || has(r.det_score)
          const extra = {}
          let hasUp = false
          for (const d of upDefs) { extra[d.key] = r[d.key]; if (has(r[d.key])) hasUp = true }
          if (hasAi || hasDet || hasUp) {
            scoreById.set(String(r.idea_id), {
              novelty: r.novelty, usefulness: r.usefulness, quality: r.overall_quality,
              detNovelty: r.det_novelty, detDistinctiveness: r.det_distinctiveness, detScore: r.det_score,
              extra,
            })
          }
        }
        merged.push(rankingsSheetFromIdeas(ideasSheet.rows, scoreById, upDefs))
      }
      // The per-pool deterministic KPIs (Unique fraction / Productivity) are batch-
      // level, not per idea, so the consolidated aggregate carries them on their own
      // tab (the per-idea KPIs already sit as columns in Rankings).
      if (detResult?.perCond?.length) {
        merged.push({ name: 'Pool KPIs by condition', kind: 'json', rows: poolKpiRows(detResult.perCond) })
      }
      const wb = XLSX.utils.book_new()
      appendSheetsToWorkbook(wb, merged)
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveBlob(out, 'idea_analytics_aggregate.xlsx', 'application/octet-stream')
    } catch (err) {
      console.error('Aggregate export failed', err)
      alert('Could not build the aggregate file: ' + (err.message || err))
    } finally {
      setAggregating(false)
    }
  }

  // Section-3 "Clear": only removes what THIS step produced — the KPI scores and
  // the regression run/insights — leaving the loaded dataset (Sections 1–2)
  // untouched. Steps 5 & 6 (which depend on the scores) end up empty as a result.
  function clearData() {
    if ((scoredCount > 0 || extScoredCount > 0 || detScoredCount > 0) &&
        !confirm('Clear ALL KPI scores (AI, evaluator and objective) and the analysis from this step? The loaded dataset in Sections 1–2 stays.')) return
    setRows(prev => recomputeOverall(prev.map(r => ({
      ...r, novelty: '', usefulness: '', ext_novelty: '', ext_usefulness: '',
      det_novelty: '', det_distinctiveness: '', det_score: '',
    }))))
    setOutput(''); setImages([]); setRunError(null); setLastRun(null); setRunsByLang({})
    setScoreErr(''); setScoreLoadMsg(''); setEvalLoadMsg(''); setDetErr(''); setDetResult(null)
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
    // The analysis compares conditions on the ideas the groups selected after the
    // group phase (Final Group Pick = 1). Scored final ideas only.
    const analysisRows = effectiveRows.filter(r => Number(r.final_pick) === 1)
    // Need ≥2 final ideas carrying at least one KPI from any source (AI / evaluator / objective).
    const scored = analysisRows.filter(hasAnyKpi)
    if (scored.length < 2) {
      setRunError('Need at least a couple of Final-Group-Pick ideas with a KPI. In Step 3, score the final ideas with AI (3.2), upload evaluator scores (3.3), or compute the objective KPIs (3.1).')
      return
    }
    setRunning(true)
    setRunError(null)
    setImages([])
    outRef.current = ''
    setOutput('')
    const dataCsv = rowsToCsv(analysisRows, analysisColumns(analysisRows))
    try {
      const opts = { dataCsv, onStatus: setRunStatus }
      const result = tab === 'python'
        ? await runPython(pyCode, { ...opts, onStdout: pushLine })
        : await runR(rCode, { ...opts, onOutput: pushLine })
      const lang = tab
      const finalOutput = outRef.current || (lang === 'python' ? result.stdout : result.output) || ''
      const runErr = result.ok ? null : (result.error || 'Run failed.')
      setOutput(finalOutput)
      setImages(result.images || [])
      if (runErr) setRunError(runErr)
      // Remember this run so Step 6 can present its insights + export the PDF.
      // Kept even on a partial failure so whatever ran is still readable.
      const thisRun = {
        lang,
        code: lang === 'python' ? pyCode : rCode,
        output: finalOutput,
        images: result.images || [],
        ranAt: new Date(),
      }
      setLastRun(thisRun)
      // Stash under this language so switching tabs restores the right results.
      setRunsByLang(prev => ({ ...prev, [lang]: { output: finalOutput, images: result.images || [], runError: runErr, lastRun: thisRun } }))
    } catch (err) {
      const msg = err.message || String(err)
      setRunError(msg)
      setRunsByLang(prev => ({ ...prev, [tab]: { output: outRef.current || '', images: [], runError: msg, lastRun: prev[tab]?.lastRun || null } }))
    } finally {
      setRunStatus('')
      setRunning(false)
    }
  }

  // Switch language tab, restoring that tab's own last run (or a clean panel).
  function selectTab(next) {
    if (next === tab || running) return
    setTab(next)
    const r = runsByLang[next]
    setOutput(r?.output || '')
    setImages(r?.images || [])
    setRunError(r?.runError || null)
    setLastRun(r?.lastRun || null)
  }

  const stats = useMemo(() => summarize(effectiveRows), [effectiveRows])
  const scoredCount = effectiveRows.filter(r => r.novelty !== '' && r.usefulness !== '').length
  const unscoredCount = effectiveRows.length - scoredCount
  // Coverage of the other two KPI sources (Section 3.1 / 3.3).
  const extScoredCount = effectiveRows.filter(r => r.ext_novelty !== '' && r.ext_usefulness !== '').length
  const detScoredCount = effectiveRows.filter(r => r.det_score !== '' && r.det_score != null).length
  // Section 2 / dataset tallies.
  const isFinal = r => Number(r.final_pick) === 1
  const finalCount = rows.filter(isFinal).length
  const sessionCount = useMemo(() => new Set(rows.filter(r => !r._book).map(r => r.session)).size, [rows])
  // Imported files actually loaded into the dataset (have rows present), for the
  // Step-2 aggregate; and the count of ticked imported files for the Load button.
  const loadedBookIds = useMemo(() => new Set(rows.filter(r => r._book).map(r => r._book)), [rows])
  const selectedBookCount = importedBooks.filter(b => b.selected).length
  // Step-3 scoring scope (all ideas vs only Final Ideas) and its unscored count.
  const scorePool = scoreOnlyFinal ? effectiveRows.filter(isFinal) : effectiveRows
  const scopeUnscored = scorePool.filter(r => r.novelty === '' || r.usefulness === '').length
  // Step-5 regression dataset: Final-Group-Pick ideas carrying at least one KPI
  // (from any source — AI / evaluator / objective).
  const finalScoredCount = effectiveRows.filter(r => isFinal(r) && hasAnyKpi(r)).length

  // ── Step 4: summary statistics over the consolidated Step-3 data ──
  // "scored" = carries at least one KPI from ANY source (AI / evaluator / objective
  // / uploaded), so Section 4 reflects whatever Step 3 produced — not only AI-rated
  // ideas (objective KPIs alone now populate the summary).
  const statRows = useMemo(
    () => (statsOnlyScored ? effectiveRows.filter(hasAnyKpi) : effectiveRows),
    [effectiveRows, statsOnlyScored])
  // Per-condition counts + mean (SD) for EVERY present KPI (each KPI over its own
  // non-missing rows), so the table shows objective / uploaded KPIs, not just AI.
  const statByCondition = useMemo(() => {
    const present = presentKpis(statRows)
    const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
    const rows = CONDITIONS.map(c => {
      const sub = statRows.filter(r => r.condition === c)
      const kpis = present.map(d => {
        const vals = sub.map(r => num(r[d.key])).filter(v => v != null)
        const n = vals.length
        const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null
        const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
        return { key: d.key, label: d.label, n, mean, sd }
      })
      return { condition: c, count: sub.length, final: sub.filter(isFinal).length, scored: sub.filter(hasAnyKpi).length, kpis }
    }).filter(r => r.count > 0)
    return { present, rows }
  }, [statRows])
  const statFinal = statRows.filter(isFinal).length
  const statSessions = useMemo(() => new Set(statRows.map(r => r.session)).size, [statRows])
  const statConditionsPresent = statByCondition.rows.length
  const statMeanQuality = useMemo(() => {
    const v = statRows.map(r => Number(r.overall_quality)).filter(Number.isFinite)
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'
  }, [statRows])
  // Table 1 (summary statistics + correlation matrix), in the style of the paper's
  // Table 1 — computed over the fully-scored ideas in the Section-4 dataset.
  const summaryTable = useMemo(() => buildSummaryTable(statRows), [statRows])

  const code = tab === 'python' ? pyCode : rCode
  const setCode = tab === 'python' ? setPyCode : setRCode
  const resetCode = () => (tab === 'python' ? setPyCode(PYTHON_TEMPLATE) : setRCode(R_TEMPLATE))

  // ── Step 6: insights derived from the last run ──
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
      tables: report.tables || [],            // Tables 3–6 (booktabs style)
      summaryTable,                            // Table 1 (summary stats + correlations)
      meta: { generatedAt: (lastRun.ranAt || new Date()).toLocaleString(), rowsUsed },
    })
    const win = window.open('', '_blank')
    if (!win) { alert('Please allow pop-ups for this site to export the PDF.'); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  // Download the genuine LaTeX source (Table 1 + Tables 3–6, booktabs) — compiles
  // with pdflatex/xelatex to a publication-quality PDF formatted like the paper.
  function exportLatex() {
    if (!report) return
    const tex = buildLatexSource({
      tables: report.tables || [],
      summaryTable,
      parsed: report.parsed,
      lang: lastRun?.lang || 'python',
      meta: { generatedAt: (lastRun?.ranAt || new Date()).toLocaleString(), rowsUsed },
    })
    saveBlob(tex, 'idea_analytics_tables.tex', 'application/x-tex;charset=utf-8')
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
                <tr><th>Encoding</th><th>AI is present in</th></tr>
              </thead>
              <tbody>
                {CONDITION_INFO.map((c, i) => (
                  <tr key={c.encoding}>
                    <td><span className={`${styles.condTag} ${styles[`cond${i}`]}`}>{c.encoding}</span></td>
                    <td>{c.ai}</td>
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

          {/* Imported Excel / CSV files appear here as their own rows. Tick to
              include; they load into the dataset only when "Load …" is pressed. */}
          {importedBooks.length > 0 && (
            <div className={styles.sessionList} style={{ marginTop: 10 }}>
              {importedBooks.map(b => (
                <div key={b.id} className={styles.sessionRow} style={{ cursor: 'default' }}>
                  <input type="checkbox" checked={!!b.selected} onChange={() => toggleBook(b.id)} />
                  <div className={styles.sessionMeta}>
                    <div className={styles.sessionCode}>{b.label}</div>
                    <div className={styles.sessionName}>
                      {b.count} idea{b.count === 1 ? '' : 's'}{b.conditions?.length ? ` · ${b.conditions.join(', ')}` : ''} · {b.kind.toUpperCase()}
                      {loadedBookIds.has(b.id) ? ' · loaded' : ''}
                    </div>
                  </div>
                  <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => removeImportedBook(b.id)} disabled={!!scoring}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.row} style={{ marginTop: 14 }}>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={selectAll}>Select all</button>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearSection1} disabled={!!scoring}>Clear</button>
            <button className="btn-primary" onClick={() => loadSelected(true)} disabled={(!selected.size && !selectedBookCount) || loadingData || !!scoring}>
              {loadingData ? 'Loading…' : (() => {
                const parts = []
                if (selected.size) parts.push(`${selected.size} session${selected.size === 1 ? '' : 's'}`)
                if (selectedBookCount) parts.push(`${selectedBookCount} imported file${selectedBookCount === 1 ? '' : 's'}`)
                return parts.length ? `Load ${parts.join(' and ')}` : 'Load'
              })()}
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

        {/* STEP 2 — Consolidate every loaded source into one clean Excel */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>2</span>Aggregate Data</span>
            <span className={styles.row}>
              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => fileRef.current?.click()} disabled={!!scoring}>Import Excel / CSV</button>
              {rows.length > 0 && (
                <button className="btn-primary" onClick={downloadAggregate} disabled={aggregating}>
                  {aggregating ? <><span className={styles.spinner} /> Building…</> : 'Download aggregate Excel'}
                </button>
              )}
            </span>
          </h2>
          <p className={styles.hint}>
            Consolidate every loaded session (and any imported export workbook) into a
            <strong> single Excel file with the same structure and format as the per-session data
            export</strong> — all the same tabs (<em>About, Participants, Ideas, Survey, Timing,
            Group&nbsp;Chat, AI&nbsp;Chat, AI&nbsp;Usage, AI&nbsp;Pricing, Groups, Conditions</em>),
            with every session's rows stacked together and condition-stamped. It adds one extra tab,
            <strong> Rankings</strong> — one row per idea with <em>Idea&nbsp;ID, Condition, Stage,
            Final&nbsp;Group&nbsp;Pick, Title, Description</em>, the <em>Novelty / Usefulness / Quality</em>
            columns ready for blind expert rating, and the Section&nbsp;3.1 objective KPIs
            (<em>Obj.&nbsp;Novelty / Obj.&nbsp;Distinctiveness / Obj.&nbsp;Score</em>) when computed.
            You can also <strong>Import Excel / CSV</strong>
            here (same importer as Step&nbsp;1): the file is added to the source list above — tick it and press
            “Load …” to include it in the aggregate.
          </p>
          {rows.length === 0 ? (
            <p className={styles.emptyNote}>Tick sessions (or imported files) above and press “Load …”, then build the consolidated file here.</p>
          ) : (
            <div className={styles.stats}>
              <div className={styles.statBox}><div className={styles.statNum}>{rows.length}</div><div className={styles.statLabel}>Ideas generated</div></div>
              <div className={styles.statBox}><div className={styles.statNum}>{finalCount}</div><div className={styles.statLabel}>Total final ideas</div></div>
              <div className={styles.statBox}><div className={styles.statNum}>{sessionCount}</div><div className={styles.statLabel}>Number of sessions</div></div>
            </div>
          )}
        </section>

        {/* STEP 3 — KPI scoring + dataset */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>3</span>Score &amp; extend ideas across KPI sources, manage participants &amp; download</span>
            {rows.length > 0 && (
              <span className={styles.row}>
                <button className="btn-primary" onClick={downloadExcel} disabled={!effectiveRows.length}>Download Excel</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadCsv} disabled={!effectiveRows.length}>Download CSV</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearData} disabled={!!scoring}>Clear</button>
              </span>
            )}
          </h2>
          <p className={styles.hint}>
            Each idea can carry KPIs from independent sources, kept separate so the analysis
            can compare them: <strong>3.1 deterministic/objective</strong> KPIs computed from the idea
            text (plus any <strong>extra KPIs you upload</strong>, e.g. Prototypicality&nbsp;/&nbsp;KS),
            <strong> 3.2 AI-generated</strong> KPIs (scored now via an API or uploaded), and
            <strong> 3.3 external-evaluator</strong> KPIs (uploaded). Every available KPI flows into the
            Step&nbsp;4 summary, the Step&nbsp;2 aggregate <em>Rankings</em> tab and the Step&nbsp;5 regressions.
          </p>

          {rows.length === 0 ? (
            <p className={styles.emptyNote}>Load a session or import a file above to build the dataset.</p>
          ) : (
            <>
              <div className={styles.stats}>
                <div className={styles.statBox}><div className={styles.statNum}>{effectiveRows.length}</div><div className={styles.statLabel}>Ideas{excludedUsers.size ? ` (${rows.length - effectiveRows.length} removed)` : ''}</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{detScoredCount}</div><div className={styles.statLabel}>Obj. computed (3.1)</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{scoredCount}</div><div className={styles.statLabel}>AI scored (3.2)</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{extScoredCount}</div><div className={styles.statLabel}>Eval. rated (3.3)</div></div>
                {CONDITIONS.map(c => (
                  <div className={styles.statBox} key={c}>
                    <div className={styles.statNum}>{stats[c]?.count || 0}</div>
                    <div className={styles.statLabel}>{c}</div>
                  </div>
                ))}
              </div>

              {/* ── Sub-step 3.1 — Deterministic & objective KPIs ───────────── */}
              <h3 className={styles.subTitle}><span className={styles.subBadge}>3.1</span>Deterministic and objective KPIs</h3>
              <div className={styles.banner}>
                <strong>Objective, repeatable KPIs computed from the idea text</strong> (Lee&nbsp;&amp;&nbsp;Chung 2024;
                Meincke et&nbsp;al. 2025; Bouschery et&nbsp;al. 2024). Using classical <strong>TF-IDF</strong> similarity computed
                {' '}entirely in your browser (no&nbsp;API key, no&nbsp;model download), it computes, per idea,
                {' '}<em>Novelty</em> (1&nbsp;−&nbsp;max similarity to the reference set R), <em>Distinctiveness</em>
                {' '}(1&nbsp;−&nbsp;mean similarity to the other ideas) and their mean <em>Score</em>; and per condition the
                pool-level <em>Unique fraction</em> and <em>Productivity</em> (KPI&nbsp;2). <em>Prototypicality (KS)</em> and the
                KS-based creativity count are not computed in the browser yet — compute them elsewhere and
                {' '}<strong>Upload additional KPIs</strong> below: every numeric column (matched to your ideas by Idea&nbsp;ID)
                becomes a KPI that flows into Section&nbsp;4, the Step-2 aggregate <em>Rankings</em> tab and the Step-5
                regressions. Once computed, <em>Download ideas&nbsp;+&nbsp;KPIs</em> exports the input file with a column added per idea for each KPI.
              </div>
              <div style={{ margin: '8px 0' }}>
                <div className={styles.raterLabel} style={{ marginBottom: 4 }}>Reference set R — products that already exist (one per line)</div>
                <textarea
                  className={styles.refsArea}
                  value={referenceSet}
                  spellCheck={false}
                  disabled={!!detComputing}
                  onChange={e => { setReferenceSet(e.target.value); try { localStorage.setItem(LS.refset, e.target.value) } catch (_) {} }}
                />
                <div className={styles.row} style={{ marginTop: 4 }}>
                  <button className={`btn-ghost ${styles.miniBtn}`} disabled={!!detComputing}
                    onClick={() => { setReferenceSet(DEFAULT_REFERENCE_SET.join('\n')); try { localStorage.removeItem(LS.refset) } catch (_) {} }}>
                    Reset reference set
                  </button>
                  <span className={styles.kpiPill}>{referenceSet.split('\n').filter(s => s.trim()).length} items</span>
                </div>
              </div>
              <div className={styles.row} style={{ marginBottom: 8 }}>
                <button className="btn-primary" onClick={computeDeterministic} disabled={!!detComputing || effectiveRows.length < 2}>
                  {detComputing ? `${detComputing.phase}… ${detComputing.done}/${detComputing.total}` : `Compute objective KPIs for ${effectiveRows.length} idea${effectiveRows.length === 1 ? '' : 's'}`}
                </button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadIdeasWithKpis}
                  disabled={!!detComputing || !effectiveRows.some(r => r.det_score !== '' && r.det_score != null)}
                  title='Download the input "ideas" file with a column added per idea for each computed KPI'>
                  Download ideas + KPIs (Excel)
                </button>
                {detComputing && <span className={styles.statusLine}><span className={styles.spinner} /> computing TF-IDF in your browser…</span>}
              </div>
              {detComputing && (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${Math.round((detComputing.done / Math.max(1, detComputing.total)) * 100)}%` }} />
                </div>
              )}
              {detErr && <p className="error-msg">{detErr}</p>}
              {detResult && (
                <div style={{ marginTop: 8 }}>
                  <p className={styles.loadMsg}>
                    Computed Novelty / Distinctiveness / Score for {detResult.ideas} idea{detResult.ideas === 1 ? '' : 's'}
                    {' '}against {detResult.refCount} reference item{detResult.refCount === 1 ? '' : 's'}. Pool-level KPIs per condition:
                  </p>
                  <div className={styles.tableWrap} style={{ marginTop: 8 }}>
                    <table className={styles.regTable}>
                      <thead>
                        <tr><th className={styles.regVar}>Condition</th><th>Ideas</th><th>Unique fraction (τ=.80)</th><th>τ=.75</th><th>τ=.85</th><th>Productivity (KPI 2)</th></tr>
                      </thead>
                      <tbody>
                        {detResult.perCond.map(c => (
                          <tr key={c.condition}>
                            <td className={styles.regVar}><span className={`${styles.condTag} ${condClass(c.condition)}`}>{c.condition}</span></td>
                            <td>{c.n}</td>
                            <td>{c.uf80 == null ? '—' : c.uf80.toFixed(2)}</td>
                            <td>{c.uf75 == null ? '—' : c.uf75.toFixed(2)}</td>
                            <td>{c.uf85 == null ? '—' : c.uf85.toFixed(2)}</td>
                            <td>{c.productivity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Upload additional, externally-computed KPIs (matched by Idea ID). */}
              <div className={styles.row} style={{ marginTop: 12 }}>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => kpiFileRef.current?.click()}
                  title="Upload an Excel/CSV with an Idea ID column plus your own KPI columns (e.g. Prototypicality / KS); every numeric column is matched onto the loaded ideas">
                  Upload additional KPIs (Excel/CSV)
                </button>
                <input ref={kpiFileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={onPickKpiFile} />
                {uploadedNow.length > 0 && (
                  <>
                    <button className={`btn-ghost ${styles.miniBtn}`} onClick={onClearUploadedKpis}
                      title="Remove every uploaded KPI; the default is no uploaded KPIs">
                      Clear uploaded KPIs
                    </button>
                    <span className={styles.kpiPill}>{uploadedNow.length} uploaded: {uploadedNow.map(d => d.label).join(', ')}</span>
                  </>
                )}
              </div>
              {kpiUploadMsg && <p className={styles.loadMsg}>{kpiUploadMsg}</p>}

              {/* ── Sub-step 3.2 — AI-generated KPIs ────────────────────────── */}
              <h3 className={styles.subTitle} style={{ marginTop: 22 }}><span className={styles.subBadge}>3.2</span>AI-generated KPIs</h3>
              <div className={styles.banner}>
                <strong>Score each idea with an LLM, or upload an offline AI-scoring file.</strong> The AI rater scores each
                idea on novelty and usefulness (1–5); quality is their mean. Choose the API and model below — it uses the
                matching key saved under AI&nbsp;Settings. Scores flow into the <em>Rankings</em> tab of the Step&nbsp;2
                aggregate and the Step&nbsp;5 regressions. You can also edit any score directly in the table below.
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

              <label className={styles.checkRow}>
                <input type="checkbox" checked={scoreOnlyFinal} onChange={e => setScoreOnlyFinal(e.target.checked)} disabled={!!scoring} />
                <span>Only score the <strong>Final Ideas</strong> — the group-selected ideas (Final&nbsp;Group&nbsp;Pick&nbsp;=&nbsp;1)</span>
                <span className={styles.kpiPill}>{finalCount} final</span>
              </label>

              <div className={styles.row} style={{ marginBottom: 12 }}>
                <button className="btn-primary" onClick={scoreUnscored} disabled={!!scoring || scopeUnscored === 0}>
                  {scoring
                    ? `Scoring ${scoring.done}/${scoring.total}…`
                    : `Score ${scopeUnscored} ${scoreOnlyFinal ? 'final ' : ''}idea${scopeUnscored === 1 ? '' : 's'} with AI`}
                </button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => scoreFileRef.current?.click()} disabled={!!scoring}
                  title='Upload an offline AI-scoring file ("All Ideas Ranked" / Rankings sheet) → fills the AI KPI columns'>Load AI scores file</button>
                <input ref={scoreFileRef} type="file" accept=".xlsx,.xls" className={styles.fileInput} onChange={onPickScores} />
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
                      {TABLE_COLS.map(key => {
                        // Inject the computed/uploaded KPI headers just before the Idea text column.
                        const head = []
                        if (key === 'idea') {
                          for (const d of extraKpiCols) head.push(
                            <th key={d.key} className={styles.sortableTh} onClick={() => toggleSort(d.key)} title={`${d.label} — click to sort`}>
                              {d.label}
                              <span className={styles.sortArrow}>{sortCol === d.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</span>
                            </th>
                          )
                        }
                        head.push(
                          <th key={key} className={styles.sortableTh} onClick={() => toggleSort(key)} title="Click to sort (asc → desc → original)">
                            {SORT_GETTERS[key].label}
                            <span className={styles.sortArrow}>{sortCol === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</span>
                          </th>
                        )
                        return head
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(r => (
                      <tr key={r.rid}>
                        <td className={styles.idCell} title={r.idea_id}>{r.idea_id}</td>
                        <td>{r.session}</td>
                        <td><span className={`${styles.condTag} ${condClass(r.condition)}`}>{r.condition}</span></td>
                        <td>{r.phase}</td>
                        <td>{isFinal(r) ? 'Yes' : 'No'}</td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="5" step="0.5"
                            value={r.novelty} onChange={e => updateScore(r.rid, 'novelty', e.target.value)} />
                        </td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="5" step="0.5"
                            value={r.usefulness} onChange={e => updateScore(r.rid, 'usefulness', e.target.value)} />
                        </td>
                        <td className={`num ${r.overall_quality === '' ? styles.unscored : ''}`}>
                          {r.overall_quality === '' ? '—' : Number(r.overall_quality).toFixed(2)}
                        </td>
                        {extraKpiCols.map(d => {
                          const v = r[d.key]
                          const blank = v === '' || v == null || !Number.isFinite(Number(v))
                          return (
                            <td key={d.key} className={`num ${blank ? styles.unscored : ''}`}>
                              {blank ? '—' : Number(v).toFixed(2)}
                            </td>
                          )
                        })}
                        <td className={styles.textCell}>{r.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <SectionActions onSave={saveDataset} onMakeDefault={saveDataset} onRestore={restoreDataset} hasCustom={saved.dataset} />

              {/* ── Sub-step 3.3 — KPIs by external evaluators ──────────────── */}
              <h3 className={styles.subTitle} style={{ marginTop: 24 }}><span className={styles.subBadge}>3.3</span>KPIs by external evaluators</h3>
              <div className={styles.banner}>
                <strong>Upload human-evaluator ratings</strong> from an Excel file in the same layout as the aggregate's
                {' '}<em>Rankings</em> / <em>All Ideas Ranked</em> sheet — a header row with an <em>Idea Title</em> (or Title)
                column plus <em>Novelty</em> and <em>Usefulness</em> columns (one or more rater columns are averaged); quality
                is their mean. They are matched onto the loaded ideas by title and kept in their own <em>Evaluator</em> KPI
                columns (separate from the AI scores), so Step&nbsp;4 and Step&nbsp;5 can compare the two.
              </div>
              <div className={styles.row} style={{ marginBottom: 8 }}>
                <button className="btn-primary" onClick={() => evalScoreFileRef.current?.click()}>Load evaluator scores file</button>
                <input ref={evalScoreFileRef} type="file" accept=".xlsx,.xls" className={styles.fileInput} onChange={onPickEvalScores} />
                <span className={styles.kpiPill}>{extScoredCount} of {effectiveRows.length} ideas rated</span>
              </div>
              {evalLoadMsg && <p className={styles.loadMsg}>{evalLoadMsg}</p>}
            </>
          )}
        </section>

        {/* STEP 4 — Summary statistics of the consolidated data */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>4</span>Summary Statistics</span>
            <span className={styles.kpiPill}>KPIs: AI · Evaluator · Objective (per source)</span>
          </h2>
          <p className={styles.hint}>
            Descriptive statistics of the consolidated dataset from Step&nbsp;3 — counts by condition and
            stage, and <strong>every available KPI's</strong> mean (SD) per condition (AI, evaluator, objective
            and any uploaded KPI). Optionally restrict to ideas that carry at least one KPI.
          </p>

          {effectiveRows.length === 0 ? (
            <p className={styles.emptyNote}>Load (and optionally score) ideas above to see summary statistics.</p>
          ) : (
            <>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={statsOnlyScored} onChange={e => setStatsOnlyScored(e.target.checked)} />
                <span>Only include ideas that carry at least one KPI (any source — AI, evaluator, objective or uploaded)</span>
              </label>

              <div className={styles.stats} style={{ marginTop: 12 }}>
                <div className={styles.statBox}><div className={styles.statNum}>{statRows.length}</div><div className={styles.statLabel}>Ideas analysed</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statFinal}</div><div className={styles.statLabel}>Final ideas</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statSessions}</div><div className={styles.statLabel}>Sessions</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statConditionsPresent}</div><div className={styles.statLabel}>Conditions with data</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statMeanQuality}</div><div className={styles.statLabel}>Mean quality</div></div>
              </div>

              <div className={styles.tableWrap} style={{ marginTop: 14 }}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Condition</th><th>Ideas</th><th>Final</th><th>Scored</th>
                      {statByCondition.present.map(d => <th key={d.key}>{d.label} mean (SD)</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {statByCondition.rows.map(row => {
                      const fmt = m => (m.mean == null ? '—' : `${m.mean.toFixed(2)}${m.sd != null ? ` (${m.sd.toFixed(2)})` : ''}`)
                      return (
                        <tr key={row.condition}>
                          <td><span className={`${styles.condTag} ${condClass(row.condition)}`}>{row.condition}</span></td>
                          <td className="num">{row.count}</td>
                          <td className="num">{row.final}</td>
                          <td className="num">{row.scored}</td>
                          {row.kpis.map(m => <td key={m.key} className="num">{fmt(m)}</td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.stats} style={{ marginTop: 14 }}>
                <div className={styles.statBox}><div className={styles.statNum}>{statRows.filter(r => /individual|solo/i.test(r.phase)).length}</div><div className={styles.statLabel}>Individual-stage ideas</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statRows.filter(r => /group/i.test(r.phase)).length}</div><div className={styles.statLabel}>Group-stage ideas</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{statRows.length ? (statFinal / statRows.length * 100).toFixed(0) + '%' : '—'}</div><div className={styles.statLabel}>Final-pick rate</div></div>
              </div>

              {/* Table 1 — summary statistics + correlation matrix (paper style) */}
              <SummaryStatsTable summary={summaryTable} />
            </>
          )}
        </section>

        {/* STEP 5 — Code + compile */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>5</span>Regressions — edit &amp; compile online</span>
            <span className={styles.kpiPill}>KPIs: AI · Evaluator · Objective (per source)</span>
          </h2>
          <p className={styles.hint}>
            Both tabs run the <em>same</em> analysis on the <strong>group-selected Final Ideas</strong>
            {' '}(Final&nbsp;Group&nbsp;Pick&nbsp;=&nbsp;1, after any removed participants): one linear
            regression per KPI across the four conditions (<em>None</em> = no-AI baseline), the planned
            {' '}<em>Solo</em> vs <em>Group</em> contrast, a best→worst ranking, and plots. The conditions are
            <strong> unbalanced</strong> (different n per condition), so the analysis uses
            <strong> HC3 heteroscedasticity-robust standard errors</strong> and <strong>Welch</strong>
            {' '}(unequal-variance) pairwise tests, and prints each condition's n. Edit the code and press
            Run — Python runs via Pyodide and R via WebR, both compiled in your browser (first run downloads
            the runtime, ~10–30&nbsp;s).
            {finalScoredCount < 2 && <><br /><span className={styles.unscored}>Give at least two Final Ideas a KPI in Step&nbsp;3 first — via AI&nbsp;(3.2), evaluator upload&nbsp;(3.3) or objective compute&nbsp;(3.1). Only {finalScoredCount} so far.</span></>}
          </p>

          <div className={styles.tabs}>
            <button className={`${styles.tab} ${tab === 'python' ? styles.tabActive : ''}`} onClick={() => selectTab('python')} disabled={running}>Python</button>
            <button className={`${styles.tab} ${tab === 'r' ? styles.tabActive : ''}`} onClick={() => selectTab('r')} disabled={running}>R</button>
          </div>

          <div className={styles.editorBar}>
            <button className="btn-primary" onClick={runCode} disabled={running}>
              {running ? <><span className={styles.spinner} /> Running…</> : `▶ Run ${tab === 'python' ? 'Python' : 'R'}`}
            </button>
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={resetCode} disabled={running}>Reset to template</button>
            {runStatus && <span className={styles.statusLine}><span className={styles.spinner} /> {runStatus}</span>}
          </div>

          <div className={styles.codeWrap}>
            <CopyButton text={code} />
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
          </div>

          <SectionActions
            onSave={saveCode}
            onMakeDefault={saveCode}
            onRestore={restoreCode}
            hasCustom={tab === 'python' ? saved.python : saved.r}
          />

          {runError && <div className={`${styles.console} ${styles.consoleErr}`}>{runError}</div>}
          {output && <div className={styles.console}>{output}</div>}

          {images.length > 0 && (
            <div className={styles.plotGridLarge}>
              {images.map((src, i) => (
                <figure className={styles.plotCardLarge} key={i}>
                  <img src={src} alt={`figure ${i + 1}`} />
                  <figcaption className={styles.plotCaption}>Figure {i + 1}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>

        {/* STEP 6 — Insights gained */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>6</span>Insights gained</span>
            {lastRun && (
              <span className={styles.row}>
                <button className="btn-primary" onClick={exportInsightsPdf}>⬇ Export PDF</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={exportLatex} title="Download the LaTeX (.tex) source of Table 1 + Tables 3–6 — compile with pdflatex for a publication-quality PDF formatted like the paper">⬇ Download LaTeX (.tex)</button>
              </span>
            )}
          </h2>
          <p className={styles.hint}>
            A clean, readable write-up of what the Step&nbsp;5 regressions found — each KPI's
            best→worst condition ranking, how every condition compares with the no-AI baseline,
            and the planned AI-timing contrast — with the plots shown large. <strong>Export PDF</strong>{' '}
            saves it all, including <strong>Appendix A</strong> (the regression results these insights
            are based on) and <strong>Appendix B</strong> (the{' '}
            {lastRun ? (lastRun.lang === 'r' ? 'R' : 'Python') : 'Python / R'} code that produced them).
          </p>

          {!lastRun ? (
            <p className={styles.emptyNote}>Run the analysis in Step&nbsp;5 (Python or R) first — the insights appear here.</p>
          ) : (
            <>
              <div className={styles.insightsMeta}>
                Based on the {lastRun.lang === 'r' ? 'R' : 'Python'} run
                {rowsUsed != null ? ` · ${rowsUsed} idea${rowsUsed === 1 ? '' : 's'} analysed` : ''}
                {lastRun.ranAt ? ` · ${lastRun.ranAt.toLocaleString()}` : ''}
              </div>

              {/* Tables 3–6 (paper layout) parsed from the run, shown formatted */}
              {report?.tables?.length > 0 && <RegressionTables tables={report.tables} />}

              {report?.hasInsights ? (
                <InsightsPanel report={report} />
              ) : (
                <div className={styles.coverageCallout}>
                  The current Step&nbsp;5 script produced no <strong>INSIGHTS</strong> section to format. The full
                  output still shows in Step&nbsp;5, and <strong>Export PDF</strong> includes it as Appendix&nbsp;A.
                </div>
              )}

              {lastRun.images.length > 0 && (
                <>
                  <h3 className={styles.kpiName} style={{ marginTop: 18 }}>Figures</h3>
                  <p className={styles.figureNote}>
                    <strong>Bar charts</strong> — each condition's <em>average</em> KPI score (1–5) with 95%
                    confidence intervals: a taller bar means ideas in that condition were rated higher, the
                    whisker shows the uncertainty, and the n under each bar is its number of final ideas
                    (the conditions have different sizes). <strong>Effect plots</strong> — each AI condition's
                    mean <em>difference from the no-AI baseline</em> (None): a dot to the right of the dashed
                    zero line scored higher than no-AI, and a <span style={{ color: '#c8562a', fontWeight: 700 }}>red</span>
                    {' '}dot (its 95% CI not crossing zero) marks a statistically significant difference.
                  </p>
                  <div className={styles.plotGridLarge}>
                    {lastRun.images.map((src, i) => (
                      <figure className={styles.plotCardLarge} key={i}>
                        <img src={src} alt={`figure ${i + 1}`} />
                        <figcaption className={styles.plotCaption}>Figure {i + 1}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Step 6 insights panel: a readable, formatted view of the INSIGHTS read-out
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

// ── Section 4: Table 1 — summary statistics + correlation matrix (paper style) ──
// Renders the structure from buildSummaryTable(): five descriptive columns then a
// lower-triangular Pearson correlation matrix, in the booktabs look of the paper.
function SummaryStatsTable({ summary }) {
  if (!summary || !summary.variables || !summary.variables.length || !summary.n) return null
  const v = summary.variables
  const f2 = x => (x == null || Number.isNaN(Number(x)) ? '—' : Number(x).toFixed(2))
  return (
    <div className={styles.regBlock}>
      <div className={styles.regCap}>
        <strong>Table 1.</strong> Summary statistics and correlations
        <span className={styles.regSub}> Descriptive statistics and the Pearson correlation matrix between the main variables.</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.regTable}>
          <thead>
            <tr>
              <th className={styles.regVar}>Variable</th>
              <th>Mean</th><th>Median</th><th>SD</th><th>Min</th><th>Max</th>
              {v.map((_, i) => <th key={i}>{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.map((row, i) => (
              <tr key={row.key}>
                <td className={styles.regVar}>{i + 1}. {row.label}</td>
                <td>{f2(row.mean)}</td><td>{f2(row.median)}</td><td>{f2(row.sd)}</td>
                <td>{f2(row.min)}</td><td>{f2(row.max)}</td>
                {v.map((_, j) => <td key={j}>{j <= i ? f2(summary.corr?.[i]?.[j]) : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.regNote}>
        N = {summary.n} fully-scored ideas. Cells are Pearson correlations (lower triangle).
        Dummies: AI (any) / Solo / Group / Both are coded vs the None baseline.
      </p>
    </div>
  )
}

// ── Section 6: Tables 3–6 — the regression tables parsed from the Step-5 run ────
// One booktabs-style table per parsed block; coefficient rows show the estimate
// (with stars) over its (standard error); an "n/a" cell renders as an em dash.
function RegressionTables({ tables }) {
  if (!tables || !tables.length) return null
  return (
    <div className={styles.regTablesWrap}>
      <h3 className={styles.kpiName}>Regression tables (Tables 3–6)</h3>
      {tables.map((t, ti) => {
        const firstStat = t.rows.findIndex(r => r.kind === 'stat')
        return (
          <div className={styles.regBlock} key={t.num ?? ti}>
            <div className={styles.regCap}>
              <strong>Table {t.num}.</strong> {t.title}
              <span className={styles.regSub}> {t.sub}</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.regTable}>
                <thead>
                  <tr>
                    <th className={styles.regVar}>Variable</th>
                    {t.columns.map((c, i) => <th key={`${c}-${i}`}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, idx) => {
                    if (r.kind === 'rule') return null
                    // SE rows keep empty cells blank; coef/stat map "n/a" → em dash.
                    const disp = r.kind === 'se' ? (c => String(c ?? '')) : (c => tableCell(c))
                    const cls = [
                      r.kind === 'se' ? styles.regSe : '',
                      r.kind === 'stat' && idx === firstStat ? styles.regFirstStat : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <tr key={idx} className={cls}>
                        <td className={styles.regVar}>{r.label || ''}</td>
                        {t.columns.map((_, i) => <td key={i}>{disp(r.cells?.[i] ?? '')}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.regNote}>{t.note}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Floating "Copy code" button (top-right of the code editor) styled to look like
// the copy button developers know from Claude / Claude Code: clipboard glyph +
// "Copy", flipping to a green check + "Copied" for ~2s after a successful copy.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for older / non-secure contexts where the async API is absent.
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch (_) { /* clipboard blocked — silently ignore */ }
  }
  return (
    <button
      type="button"
      className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
      onClick={copy}
      title="Copy code"
      aria-label={copied ? 'Code copied' : 'Copy code'}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

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

// Rows for the "Pool KPIs by condition" tab — the per-pool deterministic KPIs
// (Unique fraction at three thresholds + Productivity) the spec reports separately
// from the per-idea columns. Shared by the standalone 3.1 download and the aggregate.
const poolKpiRows = perCond => (perCond || []).map(c => ({
  Condition: c.condition,
  Ideas: c.n,
  'Unique fraction (τ=.80)': round3(c.uf80),
  'Unique fraction (τ=.75)': round3(c.uf75),
  'Unique fraction (τ=.85)': round3(c.uf85),
  'Productivity (KPI 2)': c.productivity,
}))

// Step-3 table columns: header label + how to read/sort each one. `condition`
// sorts by the canonical None<Solo<Group<Both order, scores numerically (blanks
// last), the rest as text.
const SORT_GETTERS = {
  idea_id: { label: 'Idea ID', get: r => r.idea_id, type: 'str' },
  session: { label: 'Session', get: r => r.session, type: 'str' },
  condition: { label: 'Condition', get: r => CONDITIONS.indexOf(r.condition), type: 'num' },
  phase: { label: 'Phase', get: r => r.phase, type: 'str' },
  final: { label: 'Final', get: r => Number(r.final_pick) || 0, type: 'num' },
  novelty: { label: 'Novelty', get: r => r.novelty, type: 'num' },
  usefulness: { label: 'Usefulness', get: r => r.usefulness, type: 'num' },
  quality: { label: 'Quality', get: r => r.overall_quality, type: 'num' },
  idea: { label: 'Idea', get: r => r.text, type: 'str' },
}
const TABLE_COLS = ['idea_id', 'session', 'condition', 'phase', 'final', 'novelty', 'usefulness', 'quality', 'idea']

// Does an imported sheet/CSV look like idea data we can analyse? Requires a
// condition column AND at least one idea/KPI column (matches what
// normalizeImportedRows reads). Used to reject mis-formatted imports with a pop-up.
function looksLikeIdeaData(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return false
  const keys = new Set()
  for (const r of rawRows.slice(0, 8)) for (const k of Object.keys(r || {})) keys.add(String(k).toLowerCase().trim())
  const has = cands => cands.some(c => [...keys].some(k => k === c || k.startsWith(c)))
  const cond = ['condition', 'ai condition', 'condition code', 'cond', 'treatment', 'group_condition', 'ai solo (0/1)', 'ai group (0/1)', 'ai solo stage', 'ai group stage']
  const kpi = ['novelty', 'usefulness', 'overall_quality', 'overall quality', 'quality', 'nov', 'useful']
  const idea = ['idea title', 'title', 'idea id', 'idea_id', 'full text', 'idea', 'description']
  return has(cond) && (has(kpi) || has(idea))
}

const importFormatMsg = kind =>
  `This ${kind} file does not match the expected format and was not imported.\n\n` +
  `Expected the admin Excel export (its "Ideas" sheet — a Condition column plus the idea / score columns), ` +
  `or a plain CSV with condition / novelty / usefulness columns.`

// The "Ideas" sheet (one row per idea) — shared by the Download Excel and the
// Step-2 aggregate workbook so both keep an identical Ideas tab.
function ideaSheetRows(data) {
  const labels = {
    idea_id: 'Idea ID', session: 'Session', condition: 'Condition', phase: 'Phase',
    group_id: 'Group', author_id: 'Author ID', author_name: 'Author',
    novelty: 'Novelty', usefulness: 'Usefulness', overall_quality: 'Overall Quality',
    final_pick: 'Final Group Pick', text: 'Idea',
  }
  const cols = Object.keys(labels)
  return data.map(r => Object.fromEntries(cols.map(c => {
    const v = c === 'author_name' ? (r.author_name || '') : c === 'final_pick' ? (r.final_pick ? 'Yes' : 'No') : r[c]
    return [labels[c], v]
  })))
}

// About-sheet metadata for an imported export workbook (one entry per session it
// contains): prefer its "Conditions" rows, else infer from its "Ideas" sheet.
function bookAboutMeta(book) {
  const num = v => Number(v) || 0
  const cond = book.sheets.find(s => s.name === 'Conditions')
  if (cond && cond.rows.length) {
    return cond.rows.map(r => ({
      code: r['Session Code'] || book.label || 'imported',
      placement: r['Condition'] || '',
      paperName: r['Condition (paper name)'] || '',
      participants: num(r['Participants']),
      ideas: num(r['Individual-stage ideas']) + num(r['Group-stage ideas']),
    }))
  }
  const ideas = book.sheets.find(s => s.name === 'Ideas')
  const first = ideas?.rows?.[0] || {}
  return [{
    code: first['Session Code'] || book.label || 'imported',
    placement: first['Condition'] || '',
    paperName: first['Condition (paper name)'] || '',
    participants: 0,
    ideas: ideas ? ideas.rows.length : 0,
  }]
}

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
