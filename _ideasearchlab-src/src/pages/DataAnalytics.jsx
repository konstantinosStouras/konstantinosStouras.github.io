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
  matchScoresIntoRows,
} from '../utils/analyticsData'
import { scoreIdeas, fetchAISettings } from '../utils/llmClient'
import { PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById } from '../data/aiModels'
import { PYTHON_TEMPLATE, R_TEMPLATE } from '../data/analyticsTemplates'
import { runPython } from '../utils/pyodideRunner'
import { runR } from '../utils/webrRunner'
import { parseRunOutput, buildInsightsPrintHtml, kpiLabel } from '../utils/insightsReport'
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
        if (h === -1) { alert(`This scores file does not match the expected format and was not imported.\n\nExpected an "All Ideas Ranked" sheet with a header row containing "Idea Title" and "Novelty" columns (none found on the "${sheetName}" sheet).`); return }
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
    const col = SORT_GETTERS[sortCol]
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
        // Carry any KPI scores set in Step 3 into the Rankings tab (by Idea ID),
        // so the consolidated file reflects the scoring done on the page.
        const scoreById = new Map()
        for (const r of rows) {
          if (r.novelty !== '' || r.usefulness !== '') {
            scoreById.set(String(r.idea_id), { novelty: r.novelty, usefulness: r.usefulness, quality: r.overall_quality })
          }
        }
        merged.push(rankingsSheetFromIdeas(ideasSheet.rows, scoreById))
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
    if (scoredCount > 0 && !confirm('Clear the KPI scores and the analysis from this step? The loaded dataset in Sections 1–2 stays.')) return
    setRows(prev => recomputeOverall(prev.map(r => ({ ...r, novelty: '', usefulness: '' }))))
    setOutput(''); setImages([]); setRunError(null); setLastRun(null); setRunsByLang({})
    setScoreErr(''); setScoreLoadMsg('')
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
    const scored = analysisRows.filter(r => r.novelty !== '' && r.usefulness !== '')
    if (scored.length < 2) {
      setRunError('Need at least a couple of scored Final-Group-Pick ideas. In Step 3, score the final ideas first (the “Only score the Final Ideas” box is on by default).')
      return
    }
    setRunning(true)
    setRunError(null)
    setImages([])
    outRef.current = ''
    setOutput('')
    const dataCsv = rowsToCsv(analysisRows)
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
  // Step-5 regression dataset: scored Final-Group-Pick ideas only.
  const finalScoredCount = effectiveRows.filter(r => isFinal(r) && r.novelty !== '' && r.usefulness !== '').length

  // ── Step 4: summary statistics over the consolidated Step-3 data ──
  const isFullyScored = r => r.novelty !== '' && r.usefulness !== '' && r.overall_quality !== ''
  const statRows = useMemo(
    () => (statsOnlyScored ? effectiveRows.filter(isFullyScored) : effectiveRows),
    [effectiveRows, statsOnlyScored])
  const statSummary = useMemo(() => summarize(statRows), [statRows])
  const statFinal = statRows.filter(isFinal).length
  const statSessions = useMemo(() => new Set(statRows.map(r => r.session)).size, [statRows])
  const statConditionsPresent = CONDITIONS.filter(c => (statSummary[c]?.count || 0) > 0).length
  const statMeanQuality = useMemo(() => {
    const v = statRows.map(r => Number(r.overall_quality)).filter(Number.isFinite)
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'
  }, [statRows])

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
            {rows.length > 0 && (
              <button className="btn-primary" onClick={downloadAggregate} disabled={aggregating}>
                {aggregating ? <><span className={styles.spinner} /> Building…</> : 'Download aggregate Excel'}
              </button>
            )}
          </h2>
          <p className={styles.hint}>
            Consolidate every loaded session (and any imported export workbook) into a
            <strong> single Excel file with the same structure and format as the per-session data
            export</strong> — all the same tabs (<em>About, Participants, Ideas, Survey, Timing,
            Group&nbsp;Chat, AI&nbsp;Chat, AI&nbsp;Usage, AI&nbsp;Pricing, Groups, Conditions</em>),
            with every session's rows stacked together and condition-stamped. It adds one extra tab,
            <strong> Rankings</strong> — one row per idea with <em>Idea&nbsp;ID, Condition, Stage,
            Final&nbsp;Group&nbsp;Pick, Title, Description</em> and empty <em>Novelty / Usefulness /
            Quality</em> columns ready for blind expert rating.
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
            <span><span className={styles.stepBadge}>3</span>Score ideas, manage participants &amp; download</span>
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
                <strong>Score the Rankings rows per KPI.</strong> These are the <em>Rankings</em> rows of the
                consolidated data from Step&nbsp;2. The AI rater scores each idea on novelty and usefulness
                (1–7); quality is their mean. Choose the API and model below — it uses the matching key saved
                under AI&nbsp;Settings. The scores you set here flow back into the <em>Rankings</em> tab of the
                Step&nbsp;2 aggregate and feed the Step&nbsp;5 regressions. You can also edit any score directly
                in the table and remove participants.
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
                      {TABLE_COLS.map(key => (
                        <th key={key} className={styles.sortableTh} onClick={() => toggleSort(key)} title="Click to sort (asc → desc → original)">
                          {SORT_GETTERS[key].label}
                          <span className={styles.sortArrow}>{sortCol === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</span>
                        </th>
                      ))}
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

        {/* STEP 4 — Summary statistics of the consolidated data */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>4</span>Summary Statistics</span>
            <span className={styles.kpiPill}>KPIs: {KPIS.join(' · ')}</span>
          </h2>
          <p className={styles.hint}>
            Descriptive statistics of the consolidated dataset from Step&nbsp;3 — counts by condition and
            stage, and each KPI's mean (SD) per condition. Optionally restrict to ideas that have been
            scored on all three KPIs.
          </p>

          {effectiveRows.length === 0 ? (
            <p className={styles.emptyNote}>Load (and optionally score) ideas above to see summary statistics.</p>
          ) : (
            <>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={statsOnlyScored} onChange={e => setStatsOnlyScored(e.target.checked)} />
                <span>Only include ideas scored on all 3 KPIs (novelty, usefulness, quality)</span>
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
                      <th>Novelty mean (SD)</th><th>Usefulness mean (SD)</th><th>Quality mean (SD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONDITIONS.filter(c => (statSummary[c]?.count || 0) > 0).map(c => {
                      const s = statSummary[c]
                      const fmt = m => (m == null ? '—' : `${m.mean != null ? m.mean.toFixed(2) : '—'}${m.sd != null ? ` (${m.sd.toFixed(2)})` : ''}`)
                      const finalIn = statRows.filter(r => r.condition === c && isFinal(r)).length
                      return (
                        <tr key={c}>
                          <td><span className={`${styles.condTag} ${condClass(c)}`}>{c}</span></td>
                          <td className="num">{s.count}</td>
                          <td className="num">{finalIn}</td>
                          <td className="num">{s.scored}</td>
                          <td className="num">{fmt(s.kpis.novelty)}</td>
                          <td className="num">{fmt(s.kpis.usefulness)}</td>
                          <td className="num">{fmt(s.kpis.overall_quality)}</td>
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
            </>
          )}
        </section>

        {/* STEP 5 — Code + compile */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>5</span>Regressions — edit &amp; compile online</span>
            <span className={styles.kpiPill}>KPIs: {KPIS.join(' · ')}</span>
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
            {finalScoredCount < 2 && <><br /><span className={styles.unscored}>Score at least two Final Ideas in Step&nbsp;3 first (only {finalScoredCount} scored so far).</span></>}
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
              <button className="btn-primary" onClick={exportInsightsPdf}>⬇ Export PDF</button>
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
                    <strong>Bar charts</strong> — each condition's <em>average</em> KPI score (1–7) with 95%
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
