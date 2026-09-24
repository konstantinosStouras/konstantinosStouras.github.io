import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import * as XLSX from 'xlsx-js-style'
import { auth, db } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import {
  CONDITIONS, CONDITION_INFO, KPIS, conditionForSession, buildRowsForSession,
  recomputeOverall, rowsToCsv, csvToRows, normalizeImportedRows, summarize,
  buildSummaryTable, DEFAULT_REFERENCE_SET, DEFAULT_NEED_SET, DEFAULT_TECH_SET, presentKpis, isNoveltyScoreHeader,
  uploadedKpiKeys, uploadedKpiDefs, uploadedKpiLabel, analysisColumns,
  matchUploadedKpisIntoRows, clearUploadedKpis, stripAllKpis, UPLOADED_KPI_PREFIX,
  enteredGroupPhase, canonicalKpiField, KPI_DEFS, canonicalCondition, scriptKpiKeys,
  exportKpiColumns, isDerivedAiKey, matchScoreTable, isBareAiScoreHeader, evaluatorMean,
} from '../utils/analyticsData'
import {
  aiFieldsFor, aiModelName, aiColumnLabel, aiModelSlugs, modelSlug, isAiModelKey, parseAiHeader,
  labelUnrecordedScores, UNRECORDED, slugOfKey, aiKpiDefs, sortModelSlugs, aiNovKey, aiUseKey, aiPanelCoverage,
} from '../utils/aiScoreColumns'
import { scoreIdeas, fetchAISettings, translateTexts } from '../utils/llmClient'
import {
  measureText, untranslatedRows, languageSummary, applyTranslationMemory, collectTexts, translateSheets, withMeasuredText,
  tmGet, tmSet, tmMerge, tmToJson, tmFromJson, tmFromTranslationsRows, estimateTranslationCost,
  detectLanguage, carryTranslationsSheet, hasEnglishVersion, TRANSLATIONS_SHEET, TRANSLATION_MODEL,
} from '../utils/translation'
// From scoreBatch, not llmClient: that module owns what is worth retrying and
// carries no Firebase import, so the offline guard can pin this rule.
import { isFatalScoringError } from '../utils/scoreBatch'
import { ideaValueLookup } from '../utils/rankingsMerge'
import {
  scoreGaps, gapSummary, shouldRunAnotherPass, mergeAiScoresIntoRows, ideaScoreState,
  scorableText, pickScoredSheet,
} from '../utils/scoreGaps'
import { objectiveKpisFromText, ideaParts } from '../utils/objectiveKpis'
import { measuredUniqueFraction, productivityCount, cosine, hasTerms } from '../utils/deterministicKpis'
import {
  usefulnessKpisFromText, pearson, partialPearson, median, quadrantCounts, FACETS,
  percentileRanks, specificityFacets, compileTerms, techTermsIn,
} from '../utils/usefulnessKpis'
import { PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById, modelOptionLabel, CATALOGUE_AS_OF } from '../data/aiModels'
import { MODEL_PRICES } from '../data/aiPricing'
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
// How many times one press of "Fill …" re-runs over whatever is still empty.
// A pass only earns the next one by having filled something (`shouldRunAnotherPass`),
// so this is a backstop against a pathological loop, not a retry budget.
const MAX_FILL_PASSES = 4
// How long to wait before re-trying a pass the provider aborted. A rate-limit
// window is what this is for, so the pause grows with each attempt (10s, 20s)
// rather than going straight back at a provider that has just refused us.
const RECOVERY_WAIT_MS = 10000
// Apply a pass's scores onto a row list, into the RATING MODEL's own two columns
// (`fields` = aiFieldsFor(model): "AI Novelty (GPT-6 Astra)" …): fill only the
// missing field(s), never overwrite a value already there (hand-entered or
// previously scored), and ignore a null the model omitted. Because it is
// fill-blank-only it is safe to apply to the LIVE state as well as to the run's
// own working copy — a score the admin typed into the table mid-run is not
// blank, so it survives. Another model's columns are never touched.
const blankCell = v => v == null || v === ''
const applyPassScores = (list, byRid, fields) => recomputeOverall(list.map(r => {
  const sc = byRid.get(r.rid)
  if (!sc) return r
  const out = { ...r }
  if (blankCell(r[fields.novelty]) && sc.novelty != null) out[fields.novelty] = sc.novelty
  if (blankCell(r[fields.usefulness]) && sc.usefulness != null) out[fields.usefulness] = sc.usefulness
  return out
}))
const condClass = cond => styles[`cond${Math.max(0, CONDITIONS.indexOf(cond))}`]
const userKey = (session, authorId) => `${session}|${authorId || ''}`

// Every KPI column across the three sources (AI / external / empirical); a row is
// "scored" for the analysis if it carries at least one of these.
const ALL_KPI_KEYS = [
  'novelty', 'usefulness', 'overall_quality',
  'ext_novelty', 'ext_usefulness', 'ext_quality',
  'det_novelty', 'det_distinctiveness', 'det_score',
  'det_need_fit', 'det_specificity', 'det_workability', 'det_usefulness',
]
const hasAnyKpi = r =>
  ALL_KPI_KEYS.some(k => r[k] !== '' && r[k] != null) ||
  Object.keys(r).some(k => (k.startsWith('x_') || isAiModelKey(k)) && r[k] !== '' && r[k] != null)

// localStorage keys for the per-section Save / Make-default persistence. Kept in
// the browser (no Firestore-rules change needed); "Save" and "Make this the
// default" both write the same key, which is loaded back on page open.
const LS = { sessions: 'da:sessions', dataset: 'da:dataset', python: 'da:code:python', r: 'da:code:r', refset: 'da:refset', needset: 'da:needset', techset: 'da:techset', translations: 'da:translations' }

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
  // Step 1b "Translate everything to English" (translation.js): the translation
  // memory (original text → { en, lang, by }), kept in this browser and written into
  // every download as a "Translations" sheet; the last scan of the loaded data; the
  // run's progress, report and error; and hand-typed edits (original → draft).
  const [tm, setTm] = useState(() => { try { return tmFromJson(localStorage.getItem(LS.translations) || '') } catch (_) { return {} } })
  const [trScan, setTrScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [translating, setTranslating] = useState(null)
  const [trMsg, setTrMsg] = useState('')
  const [trErr, setTrErr] = useState('')
  const [trDraft, setTrDraft] = useState({})
  const [trReviewOpen, setTrReviewOpen] = useState(false)
  // A browser that cannot store the memory (full or blocked) must say so: the
  // translations were paid for, and a reload would drop them without a word.
  useEffect(() => {
    try { localStorage.setItem(LS.translations, tmToJson(tm)) } catch (_) {
      setTrErr('This browser could not save the translations (its storage is full or blocked). They are kept until you leave the page: download the data in English to keep them, since importing that file brings them back.')
    }
  }, [tm])
  // Summary Statistics: restrict to ideas scored on all three KPIs (default on).
  const [statsOnlyScored, setStatsOnlyScored] = useState(true)
  // Regression scope: 'final' = group-voted Final Ideas (default); 'group' = all
  // ideas that entered the group phase (group-stage + carried-forward individual).
  const [regScope, setRegScope] = useState('final')

  // ── Section 3.1 — deterministic / empirical KPIs (in-browser TF-IDF) ──
  // No API key / billing: similarity is computed locally from the idea text.
  const [referenceSet, setReferenceSet] = useState(() => DEFAULT_REFERENCE_SET.join('\n'))
  // The need set U — the usefulness counterpart of R (what people NEED, where R is
  // what already EXISTS). Anchors the "Need fit" KPI; editable, saved like R.
  const [needSet, setNeedSet] = useState(() => DEFAULT_NEED_SET.join('\n'))
  // The extra-technology list T behind the "Workability" KPI (one term per line).
  const [techSet, setTechSet] = useState(() => DEFAULT_TECH_SET.join('\n'))
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
  const aggFileRef = useRef(null)   // Step-2 import: parse AND load immediately
  const sec4FileRef = useRef(null)  // Step-4 import: parse AND load immediately
  const scoreFileRef = useRef(null)
  const datasetFileRef = useRef(null)  // 3.2: re-upload the whole dataset to top its AI scores up
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
      const ns = localStorage.getItem(LS.needset); if (ns != null) setNeedSet(ns)
      const ts = localStorage.getItem(LS.techset); if (ts != null) setTechSet(ts)
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
  // The chosen model's OWN two columns: a run fills these and nothing else, so a
  // second model rates the same ideas into its own "AI Novelty (…)" pair.
  const scoreFields = useMemo(() => aiFieldsFor(scoreModel), [scoreModel])
  // The Step-3 AI cell being hand-edited ("rid|field"): it stays an input while it
  // has focus, even when its value is cleared (see the table's cell renderer).
  const [editingCell, setEditingCell] = useState('')
  const scoreSlug = modelSlug(scoreModel)
  const scoreModelName = aiModelName(scoreSlug)
  // "Which model made these?" — for the scores that came in with no model name.
  const [labelTarget, setLabelTarget] = useState('')
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
      const enriched = []   // session docs + their registered-participant head-count
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
        // Head-count captured now (participant docs are only fetched here), so the
        // Section-2 "participants by condition" table can show real counts — not
        // just idea authors. Every registered participant counts, including any the
        // admin detached mid-session — their ideas stay in the dataset too, so the
        // participant and idea tallies share one basis.
        enriched.push({ ...s, _participantCount: parts.length })
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
        const merged = replace ? enriched : [...prev, ...enriched]
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
  // autoLoad=false (Step 1): the file is queued in the source list and loaded only
  //   when "Load …" is pressed (deferred load).
  // autoLoad=true (Step 2): the file is queued AND its rows are loaded immediately
  //   (appended to whatever is already loaded), so Section 2 and the steps below fill
  //   in right away without scrolling back up to press "Load".
  function onPickFile(e, autoLoad = false) {
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
          restoreTranslationsFrom(bookSheets)
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
        // Step-2 import: also load the rows now (append) so the aggregate stats,
        // the Download button and Steps 3-6 populate immediately. loadedBookIds is
        // derived from rows tagged with _book, so this also marks the book "loaded".
        if (autoLoad) setRows(prev => recomputeOverall([...prev, ...bookRows]))
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
  // `fields` = { novelty, usefulness } target columns, or 'ai' for the 3.2 AI
  // upload: then every model named in the file ("AI Novelty (GPT-6 Astra)") fills
  // its own columns, and a plain "Novelty" column fills "model not recorded".
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
        // The data table can sit below a preamble; find the header row that names
        // its ideas (an Idea Title or an Idea ID) and carries a score column.
        let h = -1
        for (let i = 0; i < aoa.length; i++) {
          const cells = aoa[i].map(c => String(c).toLowerCase())
          const names = cells.some(c => c.includes('idea title') || c === 'title' || c === 'idea id' || c === 'idea_id')
          if (names && cells.some(c => c.includes('novelty') || c.includes('useful'))) { h = i; break }
        }
        if (h === -1) { alert(`This scores file does not match the expected format and was not imported.\n\nExpected an "All Ideas Ranked" (or Rankings) sheet with a header row containing "Idea Title" (or "Idea ID") and "Novelty" / "Usefulness" columns (none found on the "${sheetName}" sheet).`); return }
        // The header as written (a model's name keeps its capitals), and lower-cased.
        const headerRaw = aoa[h].map(c => String(c).trim())
        const header = headerRaw.map(c => c.toLowerCase())
        const find = pred => header.findIndex(pred)
        const ciTitle = find(c => c.includes('idea title') || c === 'title')
        const ciId = find(c => c === 'idea id' || c === 'idea_id')
        const ciSession = find(c => c === 'session code' || c === 'session' || c === 'session_code')
        // Never the 3.1 NoveltyScore or an empirical (formerly "objective") KPI,
        // and never a DERIVED AI column (the mean across models), in any order.
        const notEmpirical = c => !isNoveltyScoreHeader(c) && !/objective|empirical|\bobj\b|obj\.|need fit|distinctiveness/.test(c) && !/\(mean\b/.test(c)
        const isEvalish = c => /\beval|evaluator|external|rater|expert/.test(c)
        const numeric = v => v !== '' && v != null && typeof v !== 'boolean' && Number.isFinite(Number(v))
        const mean = vs => (vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : '')
        // What to read from each file row: [{ field, cols: [column index…], bare? }].
        // A field fed by several columns (the raters of 3.3) takes their mean.
        const reads = []
        if (fields === 'ai') {
          // Every model named in the file fills its own columns, and a score with no
          // model name fills "model not recorded": its explicit column ("AI Novelty
          // (model not recorded)") first, else a bare "Novelty" — the rule of
          // normalizeImportedRows. A bare column beside the analysis CSV's ai_nov__
          // keys is that row's derived mean, so it is read only on a row that carries
          // no per-model value.
          const bareIsDerived = header.some(c => /^ai_(nov|use)__/.test(c))
          const explicitUnrec = c => /\(model not recorded\)|^ai_(nov|use)__unrecorded$/.test(c)
          const byField = new Map()   // field -> { col, explicit }
          header.forEach((c, i) => {
            if (isEvalish(c) || !notEmpirical(c)) return
            const a = parseAiHeader(headerRaw[i])
            if (!a || a.derived) return
            const field = (a.kind === 'novelty' ? aiNovKey : aiUseKey)(a.slug)
            const prev = byField.get(field)
            // An explicit column beats a bare one for the same model.
            if (!prev || (explicitUnrec(c) && !prev.explicit)) byField.set(field, { col: i, explicit: explicitUnrec(c), bare: a.slug === UNRECORDED && !explicitUnrec(c) })
          })
          // A decorated bare column ("Novelty Rating", "Novelty (1-5)", "Avg Novelty")
          // is read as a score with no model name, but only for a side no recognised
          // column feeds (review, 2026-09-24: these files used to load, and then
          // were refused).
          for (const kind of ['novelty', 'usefulness']) {
            const prefix = kind === 'novelty' ? 'ai_nov__' : 'ai_use__'
            if ([...byField.keys()].some(f => f.startsWith(prefix))) continue
            const i = header.findIndex((c, j) => !isEvalish(c) && notEmpirical(c) && isBareAiScoreHeader(headerRaw[j]) === kind)
            if (i >= 0) byField.set((kind === 'novelty' ? aiNovKey : aiUseKey)(UNRECORDED), { col: i, explicit: false, bare: true })
          }
          for (const [field, v] of byField) reads.push({ field, cols: [v.col], bare: v.bare && bareIsDerived })
        } else {
          // Evaluator ratings, per kind, by the Step-1 importer's own rule
          // (evaluatorMean): the raters' columns ("Novelty (rater 1)", …) averaged
          // when any carries a value, else the evaluator columns ("Eval. Novelty"
          // in the Rankings tab), exact headers only — never "Eval. Novelty SD".
          // Failing both, a plain score column ("Novelty", "Novelty Rating") is an
          // offline rater sheet's; never an AI model's.
          for (const [kind, field] of [['novelty', fields.novelty], ['usefulness', fields.usefulness]]) {
            const plain = header.findIndex((c, j) => !isEvalish(c) && notEmpirical(c) && !/^ai\b/.test(c) && isBareAiScoreHeader(headerRaw[j]) === kind)
            reads.push({ field, evalKind: kind, cols: [], fallback: plain })
          }
        }
        const isExcludedRow = r => excludedUsers.has(userKey(r.session, r.author_id))
        // Step 1b: the downloads raters fill in carry each idea's ENGLISH title, while
        // the loaded idea keeps its original, so the English title matches too — from
        // this browser's translations plus the file's own Translations sheet (which
        // is also kept, like any import's).
        const trName = wb.SheetNames.find(n => n === TRANSLATIONS_SHEET)
        const fileTm = trName ? tmFromTranslationsRows(XLSX.utils.sheet_to_json(wb.Sheets[trName], { defval: '' })) : {}
        const withEn = applyTranslationMemory(rows, tmMerge(tm, fileTm).tm)
        // One entry per FILE ROW, carrying every field it has a value for, so all of
        // a row's scores go to the same idea (review, 2026-09-24: one pass per model
        // wrote two models' ratings of one row onto two different ideas).
        const perModelFields = reads.filter(x => !x.bare).map(x => x.field)
        const fileRows = []
        for (let i = h + 1; i < aoa.length; i++) {
          const r = aoa[i]
          const title = ciTitle >= 0 ? String(r[ciTitle] ?? '').trim() : ''
          const id = ciId >= 0 ? String(r[ciId] ?? '').trim() : ''
          if (!title && !id) continue
          const values = {}
          const byHeader = Object.fromEntries(headerRaw.map((c, j) => [c, r[j]]))
          for (const x of reads) {
            let v = x.evalKind ? evaluatorMean(byHeader, x.evalKind) : mean(x.cols.map(c => r[c]).filter(numeric).map(Number))
            if (v === '' && x.fallback >= 0 && numeric(r[x.fallback])) v = Number(r[x.fallback])
            // Both 3.2 uploads keep a rating on the 1–5 scale, and neither rounds
            // it (owner, 2026-09-24: "you should not round any AI score").
            if (v !== '') values[x.field] = Math.max(1, Math.min(5, v))
          }
          // The bare mean beside per-model columns belongs to a row with none.
          if (perModelFields.some(f => f in values)) for (const x of reads) if (x.bare) delete values[x.field]
          if (!Object.keys(values).length) continue
          fileRows.push({ id, session: ciSession >= 0 ? String(r[ciSession] ?? '').trim() : '', title, values })
        }
        if (!fileRows.length) { alert(`This scores file does not match the expected format and was not imported.\n\nNo scored idea rows (with a Novelty/Usefulness value) were found under "${sheetName}".`); return }
        if (Object.keys(fileTm).length) setTm(prev => tmMerge(prev, fileTm).tm)
        // Matched once per file row: by Idea ID (and session) when the file has one,
        // else by title; fill-blank only. Don't let a removed participant's idea
        // absorb a match meant for a visible one.
        const res = matchScoreTable(rows, fileRows, {
          isEligible: r => !isExcludedRow(r),
          altTitle: (_r, i) => withEn[i]?.title_en,
        })
        setRows(recomputeOverall(res.rows))
        // Say what was ADDED and what was left alone: the upload only fills ideas
        // with no score yet, so a file re-imported over already-scored ideas must
        // not read as if it had updated them.
        setMsg(
          `Loaded scores from "${sheetName}": filled the empty cells of ${res.filled} idea${res.filled === 1 ? '' : 's'}`
          + (res.kept ? `; kept the existing scores of ${res.kept} already-scored idea${res.kept === 1 ? '' : 's'}` : '')
          + `; ${res.unmatched} file row${res.unmatched === 1 ? '' : 's'} had no match in the loaded data.`
        )
      } catch (err) {
        setMsg('Could not read the scores file: ' + (err.message || err))
      }
    }
    reader.readAsArrayBuffer(file)
  }
  // 3.2 — AI scores upload (fills each named model's columns, or "model not recorded").
  function onPickScores(e) {
    loadScoresFile(e.target.files?.[0], 'ai', setScoreLoadMsg)
    e.target.value = ''
  }
  // 3.3 — external-evaluator scores upload (fills the ext_* KPI columns).
  function onPickEvalScores(e) {
    loadScoresFile(e.target.files?.[0], { novelty: 'ext_novelty', usefulness: 'ext_usefulness' }, setEvalLoadMsg)
    e.target.value = ''
  }

  // ── Section 3.1: compute the deterministic / empirical KPIs via TF-IDF ──────
  // Two sides, each with its OWN anchor so neither is a re-labelled copy of the other:
  //  • NOVELTY — vectorises every loaded idea + the reference set R with classical
  //    TF-IDF (in the browser, no API key, no model download), then per-idea Novelty
  //    (1 − max sim to R), Distinctiveness (1 − mean sim to the pool) and their mean,
  //    NoveltyScore, plus the pool-level Unique fraction and Productivity per condition.
  //  • USEFULNESS (usefulnessKpis.js) — Need fit (max sim to the need set U, in a
  //    SEPARATE vectorisation of ideas + U, so the novelty numbers are exactly what
  //    they were before U existed and neither side depends on the other's anchor),
  //    Specificity (who / what / where-when / why / how the idea states), their
  //    Workability (extra technology named) and their composite Usefulness score.
  // Then a pool-level cross-check: how the novelty and usefulness scores relate, and
  // how many ideas are novel AND useful, per condition.
  async function computeDeterministic() {
    setDetErr(''); setDetResult(null)
    const pool = effectiveRows                         // distinctiveness pool = all loaded ideas
    if (pool.length < 2) { setDetErr('Load at least two ideas first.'); return }
    // Step 1b first: every measure reads the English version of an idea.
    const notEnglish = untranslatedRows(pool)
    if (notEnglish.length) {
      setDetErr(`${languageSummary(notEnglish)} ${notEnglish.length === 1 ? 'is' : 'are'} not in English yet. Translate ${notEnglish.length === 1 ? 'it' : 'them'} in Step 1b first: these KPIs compare words with English lists and with the other ideas.`)
      return
    }
    const refLines = referenceSet.split('\n').map(s => s.trim()).filter(Boolean)
    if (!refLines.length) { setDetErr('The reference set R is empty. Add the products that already exist (one per line).'); return }
    const needLines = needSet.split('\n').map(s => s.trim()).filter(Boolean)
    if (!needLines.length) { setDetErr('The need set U is empty. Add the needs or problems people have (one per line).'); return }
    setDetComputing({ phase: 'Vectorising ideas (TF-IDF)', done: 0, total: pool.length + refLines.length + needLines.length })
    // Let the "computing…" state paint before the synchronous TF-IDF work.
    await new Promise(res => setTimeout(res, 0))
    try {
      // Ideas + R are vectorised together (one vocabulary, one IDF). An idea with
      // fewer than two meaningful words (blank, one word, only "the/and/it", Greek
      // text) cannot be scored: it is left blank and kept out of every pool and out
      // of the TF-IDF corpus — it used to score a perfect 1. See objectiveKpis.js.
      const ideaTexts = pool.map(measureText)   // the English version (Step 1b) when there is one
      // The title and each sentence are compared with R as well (ideaParts), so a long
      // description cannot make an existing product look new; English when translated.
      const parts = pool.map(r => {
        const title = r.title_en || r.idea_title || ''
        const desc = r.description_en || r.idea_description || ''
        return title || desc ? ideaParts(title, desc) : []
      })
      const res = objectiveKpisFromText(ideaTexts, refLines, { tau: 0.8, parts })
      if (res.error) { setDetErr(res.error); return }
      const { perIdea, ideaVecs, refs, unmeasured } = res
      // Usefulness side: ideas + U in their OWN vectorisation (usefulnessKpis.js), so
      // editing U never moves a novelty number; unreadable ideas are left blank there too.
      const techTerms = techSet.split('\n').map(s => s.trim()).filter(Boolean)
      const use = usefulnessKpisFromText(ideaTexts, needLines, techTerms)
      if (use.error) { setDetErr(use.error); return }
      const { perIdea: useIdea, needs } = use
      const round4 = x => (x == null ? '' : Math.round(x * 1e4) / 1e4)
      const byRid = new Map(pool.map((r, i) => [r.rid, { ...perIdea[i], use: useIdea[i] }]))
      setRows(prev => recomputeOverall(prev.map(r => {
        const d = byRid.get(r.rid)
        if (!d) return r
        return {
          ...r,
          det_novelty: round4(d.novelty), det_distinctiveness: round4(d.distinctiveness), det_score: round4(d.score),
          det_need_fit: round4(d.use.needFit), det_specificity: round4(d.use.specificity), det_workability: round4(d.use.workability),
          det_usefulness: round4(d.use.usefulness),
        }
      })))
      // Novelty × usefulness cross-check. Both composites, split at the WHOLE pool's
      // medians so every condition is judged against the same cut.
      const novAll = perIdea.map(d => d.score)
      const useAll = useIdea.map(d => d.usefulness)
      const novCut = median(novAll), useCut = median(useAll)
      // log(1 + word count): text measures rise with length, which can create or hide
      // a novelty-usefulness correlation, so r is also reported with length held fixed.
      const logLen = ideaTexts.map(t => Math.log1p(String(t || '').trim().split(/\s+/).filter(Boolean).length))
      const cross = idxs => {
        const nv = idxs.map(i => novAll[i]), us = idxs.map(i => useAll[i])
        return {
          r: pearson(nv, us), rLen: partialPearson(nv, us, idxs.map(i => logLen[i])),
          q: quadrantCounts(nv, us, novCut, useCut),
        }
      }
      // Facet coverage (share of ideas stating each of who/what/where-when/why/how),
      // plus the share that needs no extra technology (Workability = 1). Taken over
      // the MEASURED ideas only: an idea with no words has no facets to count.
      const facetShare = idxs => {
        const m = idxs.filter(i => useIdea[i].facets)
        const share = pred => (m.length ? m.filter(pred).length / m.length : null)
        return {
          ...Object.fromEntries(FACETS.map(f => [f.key, share(i => useIdea[i].facets[f.key])])),
          notech: share(i => useIdea[i].workability === 1),
        }
      }
      // Pool-level KPIs per condition (unique fraction at three thresholds + KPI 2 productivity).
      const perCond = []
      for (const cond of CONDITIONS) {
        const idxs = pool.map((r, i) => (r.condition === cond ? i : -1)).filter(i => i >= 0)
        if (!idxs.length) continue
        const vecs = idxs.map(i => ideaVecs[i])
        const items = idxs.map(i => ({ text: measureText(pool[i]), group: pool[i].group_id }))
        const prod = productivityCount(items, (a, b) => cosine(vecs[a], vecs[b]), { dedupTau: 0.9, minWords: 2 })
        perCond.push({
          // n = the ideas the Unique fraction is taken over (those with words).
          condition: cond, n: vecs.filter(hasTerms).length,
          uf80: measuredUniqueFraction(vecs, 0.8), uf75: measuredUniqueFraction(vecs, 0.75), uf85: measuredUniqueFraction(vecs, 0.85),
          productivity: prod.count,
          ...cross(idxs), facets: facetShare(idxs),
        })
      }
      const all = pool.map((_, i) => i)
      // Validation against the ratings already on the page (AI rater 3.2, evaluators
      // 3.3), where present: each empirical KPI should correlate more with the
      // matching rating (usefulness with usefulness) than with the other one.
      const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
      // Each AI model's own columns (and the mean across models, when several),
      // then the evaluators; AI Quality is left out, it is not a novelty or a
      // usefulness rating.
      const aiRatingDefs = aiKpiDefs(pool).filter(d => d.key !== 'overall_quality')
      const RATINGS = [
        ...aiRatingDefs.map(d => [d.key, d.label]),
        ['ext_novelty', 'Eval. Novelty'], ['ext_usefulness', 'Eval. Usefulness'],
      ].filter(([k]) => pool.filter(r => num(r[k]) != null).length >= 3)
      const OBJ = [
        ['Novelty (empirical)', perIdea.map(d => d.novelty)], ['NoveltyScore', novAll],
        ['Need fit (empirical)', useIdea.map(d => d.needFit)], ['Specificity (empirical)', useIdea.map(d => d.specificity)],
        ['Workability (empirical)', useIdea.map(d => d.workability)], ['Usefulness score (empirical)', useAll],
      ]
      const validation = RATINGS.length ? {
        cols: RATINGS.map(([, label]) => label),
        rows: OBJ.map(([label, vals]) => ({
          label,
          side: /Novelty/.test(label) ? 'novelty' : 'usefulness',
          cells: RATINGS.map(([k]) => {
            const ys = pool.map(r => num(r[k]))
            return { r: pearson(vals, ys), n: vals.filter((v, i) => v != null && ys[i] != null).length }
          }),
        })),
      } : null
      setDetResult({
        validation,
        perCond, refCount: refs.length, needCount: needs.length, ideas: pool.length - unmeasured, unmeasured,
        overall: { ...cross(all), facets: facetShare(all) }, novCut, useCut,
      })
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
    const sessionCol = headers.find(h => ['session code', 'session', 'session_code'].includes(lc(h)))
    const titleCol = headers.find(h => ['title', 'idea title'].includes(lc(h)))
    if (!idCol && !titleCol) { setKpiUploadMsg('The file needs an "Idea ID" (or "Title") column so the KPIs can be matched onto your ideas.'); return }
    const KPI_LABEL = Object.fromEntries(KPI_DEFS.map(d => [d.key, d.label]))
    const seen = new Set()
    const cols = []
    // Column acceptance: a value is "numeric" if finite and not boolean. Recognised
    // KPIs (Novelty/Usefulness/… are often integer 1–5 ratings) accept ANY numeric
    // column; unknown columns must carry at least one fractional value, so continuous
    // scores (prototypicality, ks, …) come in while integer-count diagnostics
    // (n_nodes, n_edges) and boolean flags (scorable) are skipped.
    const numeric = v => v !== '' && v != null && typeof v !== 'boolean' && Number.isFinite(Number(v))
    const isFrac = v => numeric(v) && !Number.isInteger(Number(v))
    for (const h of headers) {
      if (STD_KPI_COLS.has(lc(h))) continue
      // Recognised KPI columns (Novelty / Usefulness / Quality / empirical /
      // evaluator) route onto their CANONICAL row field, so a re-uploaded
      // "ideas_with_kpis" fills the right Rankings columns and feeds Steps 4–5.
      // Anything else (prototypicality, ks, …) stays an uploaded extra (x_ column).
      const canon = canonicalKpiField(h)
      if (canon ? !rawRows.some(r => numeric(r[h])) : !rawRows.some(r => isFrac(r[h]))) continue
      let key, label
      if (canon) {
        // A DERIVED AI column (the mean across models, AI Quality) is recomputed
        // from the per-model columns, never imported.
        if (isDerivedAiKey(canon)) continue
        // Several evaluator columns ("Novelty (rater 1)", "(rater 2)", …) are ONE
        // measure: collect them all and average per idea below, as the Step-1
        // importer does (review, 2026-09-24: here the first rater silently won).
        if (seen.has(canon) && (canon === 'ext_novelty' || canon === 'ext_usefulness')) {
          cols.find(c => c.key === canon).names.push(h)
          continue
        }
        if (seen.has(canon)) continue          // first column wins for any other canonical KPI
        key = canon
        label = isAiModelKey(canon)
          ? aiColumnLabel(canon.startsWith('ai_nov__') ? 'novelty' : 'usefulness', slugOfKey(canon))
          : (KPI_LABEL[canon] || canon)
      } else {
        key = sanitizeKpiKey(h)
        if (key === UPLOADED_KPI_PREFIX || seen.has(key)) key = `${key}_${cols.length + 1}`
        label = uploadedKpiLabel(key)
      }
      seen.add(key)
      cols.push({ name: h, names: [h], key, label })
    }
    if (!cols.length) { setKpiUploadMsg('No numeric KPI columns found beyond the standard idea columns.'); return }
    const keys = cols.map(c => c.key)
    // One column's value, or for an evaluator measure spread over several columns
    // the mean of the individual raters' values (the "(rater n)" columns) when any
    // carries one, else of the others (an "Eval. Novelty" column): the rule of the
    // Step-1 importer's meanRaterCols, so both uploads give the same number.
    const isRaterCol = h => /\((rater|expert)\b|\brater\s*\d|_rater/i.test(String(h))
    const meanOf = (r, hs) => {
      const v = hs.map(h => r[h]).filter(numeric).map(Number)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : ''
    }
    const valueOf = (r, c) => {
      if (c.names.length === 1) return r[c.name]
      const raters = meanOf(r, c.names.filter(isRaterCol))
      return raters !== '' ? raters : meanOf(r, c.names.filter(h => !isRaterCol(h)))
    }
    const entries = rawRows.map(r => ({
      idea_id: idCol ? r[idCol] : '',
      session: sessionCol ? r[sessionCol] : '',   // ideas are numbered per session
      title: titleCol ? r[titleCol] : '',
      values: Object.fromEntries(cols.map(c => [c.key, valueOf(r, c)])),
    }))
    const { rows: next, matched, unmatched, kept } = matchUploadedKpisIntoRows(rows, entries, keys)
    // Recompute, like every other KPI-writing path. Filling `usefulness` from an
    // upload while `overall_quality` kept the value it had when only `novelty`
    // was known left a stale mean in the exported dataset.
    setRows(recomputeOverall(next))
    const names = cols.map(c => c.label).join(', ')
    setKpiUploadMsg(
      `Loaded ${keys.length} KPI${keys.length === 1 ? '' : 's'} (${names}) from “${fileName}” onto ${matched} idea${matched === 1 ? '' : 's'}` +
      (unmatched ? `, ${unmatched} file row${unmatched === 1 ? '' : 's'} unmatched.` : '.') +
      // A recognised KPI column (Novelty/Usefulness/…) only fills ideas with no
      // score yet, so say when existing scores were left alone.
      (kept ? ` Kept the existing scores of ${kept} already-scored idea${kept === 1 ? '' : 's'}.` : '') +
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
  // Every idea with its English version from Step 1b (the originals untouched);
  // everything downstream — the measures, the tables, the downloads — reads this.
  const rowsEn = useMemo(() => applyTranslationMemory(rows, tm), [rows, tm])
  const effectiveRows = useMemo(() => rowsEn.filter(r => !isExcluded(r)), [rowsEn, excludedUsers])
  // Step 1b: what the last scan found, what is still untranslated, what that would
  // cost with Fable 5.1, and the ideas the Step 3 measures are still waiting on.
  const trItems = trScan?.items || []
  const trPending = useMemo(() => trItems.filter(it => !tmGet(tm, it.text)), [trItems, tm])
  const trCost = useMemo(() => estimateTranslationCost(trPending, MODEL_PRICES[TRANSLATION_MODEL]), [trPending])
  const ideasNotEnglish = useMemo(() => untranslatedRows(effectiveRows), [effectiveRows])
  // Once every idea has its English version, the 3.1 / 3.2 "translate first"
  // messages no longer apply.
  useEffect(() => {
    if (ideasNotEnglish.length) return
    setDetErr(e => (e && e.includes('Step 1b') ? '' : e))
    setScoreErr(e => (e && e.includes('Step 1b') ? '' : e))
  }, [ideasNotEnglish.length])
  // When an idea's ENGLISH VERSION is edited or removed in Step 1b after measures
  // exist, what was computed from the old English no longer describes it: its AI
  // ratings are cleared (the Fill button re-rates just those), and the empirical
  // KPIs are cleared for every idea, since Distinctiveness and the pool KPIs depend
  // on the whole pool (Compute again). An idea getting its FIRST English version is
  // not a change of that kind: while it had none, nothing on this page could
  // measure it (3.1 and 3.2 refuse), so any score it carries came in with a file —
  // above all the 3.2 top-up upload, whose Translations sheet and scores land in
  // the same render (review of 2026-09-24: clearing there blanked exactly the
  // scores the upload had just filled). Only an idea in the 3.1 pool (not a
  // removed participant's) clears the empirical KPIs. Nothing else is touched.
  const measuredTextRef = useRef(new Map())
  useEffect(() => {
    const prev = measuredTextRef.current
    const next = new Map(rowsEn.map(r => [r.rid, { t: measureText(r), en: hasEnglishVersion(r) }]))
    measuredTextRef.current = next
    const changed = new Set()
    for (const [rid, v] of next) {
      const p = prev.get(rid)
      if (p && p.en && p.t !== v.t) changed.add(rid)
    }
    if (!changed.size) return
    const has = v => v !== '' && v != null
    const detKeys = KPI_DEFS.filter(d => d.source === 'det').map(d => d.key)
    const inPool = rowsEn.some(r => changed.has(r.rid) && !isExcluded(r))
    const anyDet = inPool && rowsEn.some(r => detKeys.some(k => has(r[k])))
    // Every model's pair, not just the derived mean: recomputeOverall rebuilds the
    // mean from the per-model columns, so clearing only the mean would bring it back.
    const aiKeys = r => Object.keys(r).filter(isAiModelKey)
    const hasAi = r => has(r.novelty) || has(r.usefulness) || aiKeys(r).some(k => has(r[k]))
    const aiChanged = rowsEn.filter(r => changed.has(r.rid) && hasAi(r)).length
    if (!anyDet && !aiChanged) return
    setRows(prevRows => recomputeOverall(prevRows.map(r => {
      let x = r
      if (anyDet) { x = { ...x }; for (const k of detKeys) x[k] = '' }
      if (changed.has(r.rid) && hasAi(r)) {
        x = { ...x, novelty: '', usefulness: '', overall_quality: '' }
        for (const k of aiKeys(r)) x[k] = ''
      }
      return x
    })))
    if (anyDet) setDetResult(null)
    setTrMsg(`An English version changed, so the measures computed from the old text were cleared: `
      + [anyDet ? 'the empirical KPIs (press Compute in 3.1 again)' : '',
        aiChanged ? `the AI ratings of ${aiChanged} idea${aiChanged === 1 ? '' : 's'} (Fill in 3.2 re-rates just ${aiChanged === 1 ? 'it' : 'those'})` : '']
        .filter(Boolean).join(' and ') + '.')
  }, [rowsEn])
  // Uploaded extra KPIs currently present in the data (drives the 3.1 chip + Clear).
  const uploadedNow = useMemo(() => uploadedKpiDefs(effectiveRows), [effectiveRows])
  // KPI columns of the Step-3 table, in the export order (owner, 2026-09-24): the
  // empirical KPIs (3.1) and uploaded extras, then each AI model's Novelty and
  // Usefulness side by side, the mean across models and AI Quality (derived,
  // read-only), then the evaluators. The model chosen in the rater dropdown always
  // has its pair here, empty until it rates, so the admin sees where a run writes.
  // Every model the rows carry a field for keeps its pair at its catalogue place,
  // even after its last value was cleared in this table: a column must neither
  // vanish nor move under the cell being edited (review, 2026-09-24). Exports list
  // only models with values.
  const tableKpiCols = useMemo(() => {
    const cols = exportKpiColumns(effectiveRows)
    const own = d => d.source === 'ai' && d.slug
    // The chosen model before it has any field at all: its pair shows where a run
    // will write, and is read-only (a hand rating typed there would be exported as
    // that model's).
    const fresh = !effectiveRows.some(r => Object.prototype.hasOwnProperty.call(r, scoreFields.novelty)
      || Object.prototype.hasOwnProperty.call(r, scoreFields.usefulness))
    const slugs = sortModelSlugs([...aiModelSlugs(effectiveRows, { includeBlank: true }), ...(scoreSlug ? [scoreSlug] : [])])
    const models = slugs.flatMap(sl => [
      { key: aiNovKey(sl), label: aiColumnLabel('novelty', sl), source: 'ai', slug: sl, kind: 'novelty' },
      { key: aiUseKey(sl), label: aiColumnLabel('usefulness', sl), source: 'ai', slug: sl, kind: 'usefulness' },
    ].map(d => (sl === scoreSlug && fresh ? { ...d, placeholder: true } : d)))
    // Where the models' pairs go: where exportKpiColumns put them, else before the
    // derived AI columns and the evaluators.
    const rest = cols.filter(d => !own(d))
    let at = cols.findIndex(own)
    if (at < 0) {
      at = rest.findIndex(d => d.source === 'ai' || d.source === 'ext')
      if (at < 0) at = rest.length
    }
    return [...rest.slice(0, at), ...models, ...rest.slice(at)]
  }, [effectiveRows, scoreFields, scoreSlug])

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

  // ── Fill every idea that has no AI score, with the configured LLM ──
  // ONE press fills the whole gap (owner 2026-08-25: "I simply press the button
  // to fill them up and update the entire dataset"). A single `runScoring` pass
  // can still come back short three ways, and they need different answers:
  //   • it filled some and left some — the model mishandled a few replies, and
  //     a fresh pass over what is left usually gets them;
  //   • it reached every idea and filled none — sending them again will not read
  //     any better, so stop;
  //   • it was ABORTED by `runScoring`'s circuit breaker — the ideas after that
  //     point were never sent at all, which on a long run is the usual shape of
  //     a rate limit, so this one gets a bounded number of recovery passes with
  //     a growing pause.
  // `shouldRunAnotherPass` holds that rule (and `MAX_FILL_PASSES` caps the lot),
  // so a 429 storm is worked through while a dead provider costs a few attempts
  // and is then reported as the outage it is. A fatal error — a rejected key —
  // never reaches here at all: `isFatal` throws it straight out.
  async function scoreUnscored() {
    setScoreErr('')
    setScoreLoadMsg('')
    if (scopeUnscored === 0) {
      setScoreErr(scoreOnlyFinal
        ? `No Final Ideas left for ${scoreModelName} to score (none are marked Final Group Pick, or ${scoreModelName} has scored them all). Untick the box to score all ideas.`
        : `${scoreModelName} has already given every idea an AI Novelty and an AI Usefulness score.`)
      return
    }
    // The model this run rates with, pinned for the whole run: the dropdowns are
    // disabled while it runs, but the columns must not move under it regardless.
    const fields = scoreFields
    const runModelName = scoreModelName
    // Step 1b first: the rater is prompted in English and must rate the idea, not
    // its language. Only the ideas this run would score are checked.
    {
      const scope = rowsEn.filter(r =>
        !excludedUsers.has(userKey(r.session, r.author_id)) && (!scoreOnlyFinal || isFinal(r)))
        .filter(r => { const st = ideaScoreState(r, fields); return st === 'missing' || st === 'partial' })
      const notEnglish = untranslatedRows(scope)
      if (notEnglish.length) {
        setScoreErr(`${languageSummary(notEnglish)} ${notEnglish.length === 1 ? 'is' : 'are'} not in English yet. Translate ${notEnglish.length === 1 ? 'it' : 'them'} in Step 1b first.`)
        return
      }
    }
    // Ideas whose only AI scores carry no model name (an older file) would all be
    // rated again — paid for, and then averaged with scores that may well be this
    // same model's (review finding, 2026-09-24). Ask first; "Label them" is the fix
    // when the old scores are this model's.
    const unrecInScope = effectiveRows.filter(r =>
      (!scoreOnlyFinal || isFinal(r)) &&
      [`ai_nov__${UNRECORDED}`, `ai_use__${UNRECORDED}`].some(k => r[k] !== '' && r[k] != null) &&
      ['missing', 'partial'].includes(ideaScoreState(r, fields))).length
    if (unrecInScope && !confirm(
      `${unrecInScope.toLocaleString()} of these ideas already have an AI score with no model name (from an older file).\n\n`
      + `If those scores came from ${runModelName}, press Cancel and use "Label them" in the coverage panel, so they are not rated (and paid for) again.\n\n`
      + `Press OK to rate them with ${runModelName} anyway, as a separate column.`)) return
    // Always use the API keys CURRENTLY saved in AI Settings (settings/ai), even if
    // they were added/changed after this page was opened — re-read them at score
    // time and refresh the on-page "no key" hint. Falls back to the loaded copy.
    let settings = aiSettings
    try { settings = await fetchAISettings(); setAiSettings(settings) } catch (_) { /* keep the loaded copy */ }

    // Work off a local copy so each pass re-reads what the PREVIOUS pass filled;
    // `setRows` is async, so re-deriving the targets from `rows` would ask the
    // model to score the same ideas again.
    let working = applyTranslationMemory(rows, tm)   // with the Step 1b English versions
    let totalFilled = 0
    let pass = 0
    let recoveries = 0
    let aborted = false
    let stoppedOnReply = false   // the rater stopped: batches in a row answered without a rating
    let lastError = null
    let targets = []
    const startedWith = scopeUnscored

    try {
      do {
        pass++
        // Re-derive the still-empty ideas each pass, from the copy just updated.
        // `isEligible` mirrors the on-page scope exactly: removed participants'
        // ideas are excluded, and the Final-Ideas tick narrows it further.
        const pool = working.filter(r =>
          !excludedUsers.has(userKey(r.session, r.author_id)) && (!scoreOnlyFinal || isFinal(r)))
        targets = pool
          .filter(r => { const st = ideaScoreState(r, fields); return st === 'missing' || st === 'partial' })
          // `scorableText` is the SAME function `hasIdeaText` uses to decide an
          // idea is ratable, so the panel can never offer to fill an idea the
          // run then sends as an empty string.
          .map(r => ({ rid: r.rid, text: measureText(r) }))   // the English version when there is one
        if (!targets.length) break

        setScoring({ done: 0, total: targets.length, pass })
        let report = null
        let scores = []
        let threw = false
        try {
          scores = await scoreIdeas(targets.map(t => t.text), {
            brief: DESIGN_BRIEF,
            settings,
            provider: scoreProvider,
            model: scoreModel,
            onProgress: ({ done, total }) => setScoring({ done, total, pass }),
            onReport: r => { report = r },
          })
        } catch (err) {
          // `scoreIdeas` THROWS when a pass scored nothing at all — which is the
          // one case the recovery rule exists for, so it must not escape the
          // loop. A FATAL error (no key, a rejected key) is a different thing
          // and stops the run at once: retrying it only makes the admin wait
          // through the pauses before being told what is actually wrong.
          if (isFatalScoringError(err)) throw err
          lastError = err
          scores = []
          // …except when the provider ANSWERED every batch without a rating (a
          // refusal, or its whole token ceiling spent on reasoning: `replyProblem`).
          // That is not a transport failure, and sending the same ideas again gets
          // the same answer, so it earns no recovery pass (review, 2026-09-24: 16
          // ideas cost 162 calls and ended in advice about the API key).
          threw = !err?.replyProblem
        }
        // A pass that THREW failed for transport reasons whatever the report
        // says: `scoreIdeas` also throws when every batch was attempted and
        // every one failed, which the circuit breaker never sees and so leaves
        // `aborted` false. Either way the ideas got no real answer, and that is
        // what the recovery rule is deciding about.
        aborted = !!report?.aborted || threw
        stoppedOnReply = stoppedOnReply || !!report?.stoppedOnReply
        if (!threw) lastError = report?.lastError || null

        const byRid = new Map(targets.map((t, k) => [t.rid, scores[k]]))
        const before = working
        working = applyPassScores(working, byRid, fields)
        let filledThisPass = 0
        for (let i = 0; i < working.length; i++) {
          if (working[i][fields.novelty] !== before[i][fields.novelty] || working[i][fields.usefulness] !== before[i][fields.usefulness]) filledThisPass++
        }
        totalFilled += filledThisPass
        // Show each pass's progress as it lands, so a long run is not one silent
        // block — and so a run the admin interrupts still leaves its work behind.
        // Applied to `prev` rather than pushed as `working`: the table stays
        // editable while a run is going, and replacing the state wholesale would
        // discard a score the admin typed during it. `applyPassScores` fills
        // blanks only, so `prev` keeps every edit and gains the same fills.
        setRows(prev => applyPassScores(prev, byRid, fields))

        const after = scoreGaps(
          working.filter(r => !excludedUsers.has(userKey(r.session, r.author_id))),
          { onlyFinal: scoreOnlyFinal, isFinal, fields })
        if (!shouldRunAnotherPass({
          pass, maxPasses: MAX_FILL_PASSES, filled: filledThisPass,
          remaining: after.fillable, aborted, recoveries,
        })) break
        // A pass that filled nothing is only retried because the provider stopped
        // answering (see `shouldRunAnotherPass`). Going straight back at a rate
        // limit just earns another one, so wait — longer each time — and count
        // the attempt, so a provider that is genuinely down is not hammered.
        if (filledThisPass === 0) {
          recoveries++
          setScoring({ done: 0, total: targets.length, pass, waiting: true })
          await new Promise(res => setTimeout(res, RECOVERY_WAIT_MS * recoveries))
        }
      } while (true)

      // Say exactly what happened. `remaining` is what a further press would
      // retry; `unratable` ideas are counted apart because nothing can ever fill
      // them, and lumping them in would leave a panel that can never reach zero.
      const finalGaps = scoreGaps(
        working.filter(r => !excludedUsers.has(userKey(r.session, r.author_id))),
        { onlyFinal: scoreOnlyFinal, isFinal, fields })
      // What WORKED is a neutral line; only a genuine shortfall is red. A run
      // that filled every gap used to report through the same error slot, so a
      // complete success was painted as a failure.
      setScoreLoadMsg(
        `${runModelName} scored ${totalFilled.toLocaleString()} of the ${startedWith.toLocaleString()} idea${startedWith === 1 ? '' : 's'} it had not rated yet`
        + (pass > 1 ? ` (${pass} passes)` : '')
        + `. ${gapSummary(finalGaps, scoreOnlyFinal, runModelName)}`)
      const bits = []
      if (aborted) {
        bits.push(`The run stopped early — ${scoreProvider} kept failing${lastError ? ` (${lastError.message || lastError})` : ''}, so the remaining ideas were never sent. Check the API key and quota under AI Settings, then press the button again.`)
      } else if (finalGaps.fillable > 0) {
        const n = finalGaps.fillable
        const still = `${n.toLocaleString()} idea${n === 1 ? '' : 's'} still ${n === 1 ? 'has' : 'have'} an empty cell`
        const problem = lastError?.replyProblem
        bits.push(problem
          ? `${still}: ${runModelName} answered without a rating (${lastError.message || lastError}). `
            + (stoppedOnReply ? 'It stopped after two batches in a row came back like that, so the other ideas were not sent (every call is billed). ' : '')
            + (problem === 'exhausted'
              ? 'Pick a model that reasons less (or one without reasoning) and press the button again.'
              : 'Pressing the button again sends the same text and will likely get the same answer.')
          : `${still}: the model's reply for ${n === 1 ? 'it' : 'them'} could not be read. Press the button again to retry just ${n === 1 ? 'it' : 'those'}.`)
      }
      if (finalGaps.unratable > 0) {
        bits.push(`${finalGaps.unratable.toLocaleString()} ${finalGaps.unratable === 1 ? 'idea has' : 'ideas have'} no text to rate, so ${finalGaps.unratable === 1 ? 'it' : 'they'} can never be scored — they are counted apart above.`)
      }
      // A cause the provider gave (a refusal, a ceiling spent on thinking, a
      // 429 it kept answering) used to be dropped unless the run aborted; the
      // still-empty ideas then read as "could not be read" with no reason.
      if (lastError && !aborted && finalGaps.fillable > 0 && !lastError.replyProblem) {
        bits.push(`Last cause reported: ${lastError.message || lastError}`)
      }
      if (bits.length) setScoreErr(bits.join(' '))
    } catch (err) {
      setScoreErr(err.message || String(err))
    } finally {
      setScoring(null)
    }
  }

  // ── 3.2: top the loaded dataset up from a full-dataset file ──
  // "Upload my entire data set … and fill them up" (owner 2026-08-25). The
  // Step-1/2 importer APPENDS, so re-uploading your own dataset to fill its gaps
  // used to give you every idea twice; this merges by **Idea ID** (then title)
  // onto the ideas already loaded, fills only the AI cells that are still empty,
  // and never appends an unmatched row — see `mergeAiScoresIntoRows` for why.
  function onPickDatasetTopUp(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setScoreLoadMsg('')
    const isCsv = /\.csv$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        let rawRows, bookSheets = [], sheetName = isCsv ? file.name : ''
        if (isCsv) rawRows = csvToRows(ev.target.result)
        else {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          // Keep every sheet, exactly as the Step-1 importer does, so a file that
          // becomes the dataset here gives Step 2's aggregate the same material.
          bookSheets = wb.SheetNames.map(sn => ({
            name: sn, kind: 'json', rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }),
          }))
          // The sheet is chosen by what it CONTAINS, not by being called "Ideas":
          // in the admin's 13-tab aggregate export the Ideas tab holds the raw
          // session rows with NO AI scores, and the scores live on Rankings. See
          // `pickScoredSheet`.
          const picked = pickScoredSheet(bookSheets)
          sheetName = picked?.name || wb.SheetNames[0]
          rawRows = picked?.rows || XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
        }
        if (!looksLikeIdeaData(rawRows)) { alert(importFormatMsg(isCsv ? 'CSV' : 'Excel')); return }
        const incoming = normalizeImportedRows(rawRows)
        if (!incoming.length) { alert(importFormatMsg(isCsv ? 'CSV' : 'Excel')); return }

        // Nothing loaded yet: the file IS the dataset. Load it through the same
        // deferred-import bookkeeping Step 1 uses, so it shows as its own source
        // row and can be removed again — rather than becoming untracked rows.
        if (!rows.length) {
          restoreTranslationsFrom(bookSheets)
          const bookId = `book_${bookSeq.current++}`
          const bookRows = tagRows(incoming).map(r => ({ ...r, _book: bookId }))
          setImportedBooks(prev => [...prev, {
            id: bookId, label: file.name, kind: isCsv ? 'csv' : 'xlsx', sheets: bookSheets,
            count: incoming.length, conditions: [...new Set(incoming.map(r => r.condition).filter(Boolean))],
            rows: bookRows, selected: true,
          }])
          setRows(recomputeOverall(bookRows))
          const g = scoreGaps(bookRows, { fields: scoreFields })
          const inFile = aiModelSlugs(bookRows).map(aiModelName)
          setScoreLoadMsg(`Loaded ${incoming.length} idea${incoming.length === 1 ? '' : 's'} from “${file.name}”${isCsv ? '' : ` (sheet “${sheetName}”)`}`
            + (inFile.length ? `, with AI scores from: ${inFile.join(', ')}` : '')
            + `. ${gapSummary(g, false, scoreModelName)}`)
          return
        }

        restoreTranslationsFrom(bookSheets)
        // Every model's columns in the file come across into that model's own
        // columns (normalizeImportedRows has already read the model names).
        const res = mergeAiScoresIntoRows(rows, incoming)
        setRows(recomputeOverall(res.rows))
        const after = scoreGaps(
          res.rows.filter(r => !excludedUsers.has(userKey(r.session, r.author_id))),
          { onlyFinal: scoreOnlyFinal, isFinal, fields: scoreFields })
        setScoreLoadMsg(
          `Merged “${file.name}”${isCsv ? '' : ` (sheet “${sheetName}”)`} onto ${res.matched} of ${rows.length} loaded idea${rows.length === 1 ? '' : 's'} by Idea ID: `
          + `filled ${res.filled} idea${res.filled === 1 ? '' : 's'}' empty ${res.models.length ? res.models.map(aiModelName).join(' / ') : 'AI'} cells`
          + (res.kept ? `, kept the existing scores of ${res.kept}` : '')
          + (res.unmatched ? `. ${res.unmatched} file row${res.unmatched === 1 ? '' : 's'} matched no loaded idea and ${res.unmatched === 1 ? 'was' : 'were'} NOT added — clear Step 1 and import the file there to load it as the dataset` : '')
          + `. ${gapSummary(after, scoreOnlyFinal, scoreModelName)}`
        )
      } catch (err) {
        setScoreLoadMsg('Could not read the file: ' + (err.message || err))
      }
    }
    if (isCsv) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
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

  // Hand-edit one model's AI score (1–5). The derived columns (the mean across
  // models, AI Quality) follow in recomputeOverall — which also clears the quality
  // when every AI component of the idea has been cleared.
  function updateScore(rid, field, value) {
    setRows(prev => recomputeOverall(prev.map(r => {
      if (r.rid !== rid) return r
      const v = value === '' ? '' : Math.max(1, Math.min(5, Number(value)))
      return { ...r, [field]: Number.isNaN(v) ? '' : v }
    })))
  }

  // Give the "model not recorded" scores a model (they came from a file saved
  // before the columns carried a model name). Fill-blank only, like every path.
  function onLabelUnrecorded() {
    if (!labelTarget) return
    // The ideas on show only (after removals), the ones the panel counted: a removed
    // participant's hidden ideas are left as they are.
    const shown = rows.map(r => !isExcluded(r))
    const res = labelUnrecordedScores(rows.filter((_, i) => shown[i]), labelTarget)
    let k = 0
    setRows(recomputeOverall(rows.map((r, i) => (shown[i] ? res.rows[k++] : r))))
    const name = aiModelName(modelSlug(labelTarget))
    setScoreLoadMsg(
      `Labelled the scores of ${res.moved} idea${res.moved === 1 ? '' : 's'} as ${name}.`
      + (res.conflicts ? ` ${res.conflicts} idea${res.conflicts === 1 ? '' : 's'} already had a ${name} score, so ${res.conflicts === 1 ? 'its' : 'their'} unlabelled score${res.conflicts === 1 ? ' was' : 's were'} left under “model not recorded”.` : ''))
    setLabelTarget('')
  }

  // ── Downloads ──
  // One idea sheet, shared by every "ideas" download on the page, so they cannot
  // disagree: the identity columns, then the KPI columns in the page's order (owner,
  // 2026-09-24) — the EMPIRICAL proxies of novelty and usefulness first, then the AI
  // ratings MODEL BY MODEL ("AI Novelty (GPT-6 Astra)", "AI Usefulness (GPT-6
  // Astra)", then the next model's pair), then the evaluators. Every header is one
  // the importers read back, so this sheet can be re-uploaded as the dataset (3.2
  // "Upload full dataset") without losing a column or a model name.
  function ideaExportRows(data) {
    const kpis = exportKpiColumns(data)
    const stageLabel = ph => (ph === 'group' ? 'group' : ph === 'individual' ? 'individual (solo)' : (ph || ''))
    const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v))
    return data.map(r => {
      const row = {
        'Idea ID': r.idea_id,
        'Session Code': r.session || '',
        'Condition': r.condition,
        'Stage': stageLabel(r.phase),
        'Group UID': r.group_id || '',
        'Author ID': r.author_id || '',
        'Author Name': r.author_name || '',
        'Author Email': r.author_email || '',
        'Final Group Pick': r.final_pick ? 'Yes' : 'No',
        'Carried to group': r.carried ? 'Yes' : 'No',
        'Title': r.idea_title || '',
        'Description': r.idea_description || '',
        'Full Text': r.text || '',
      }
      for (const k of kpis) row[k.label] = num(r[k.key])
      return row
    })
  }

  // Step 1b: every idea download carries the ideas in English; each replaced cell's
  // original is kept on a "Translations" sheet, which an import reads back. A loaded
  // file's own Translations rows for its idea sheets are carried forward (a
  // re-imported English file replaces nothing, but its originals must not be lost).
  function translatedIdeaSheet(data) {
    const tr = translateSheets([{ name: 'ideas', kind: 'json', rows: ideaExportRows(data) }], tm)
    const trSheet = carryTranslationsSheet(tr.log,
      importedBooks.filter(b => loadedBookIds.has(b.id)).flatMap(b => b.sheets || []),
      r => /idea|ranking/i.test(String(r.Sheet ?? '')))
    return { rows: tr.sheets[0].rows, trSheet }
  }
  function addIdeaSheet(wb, data) {
    const { rows: ideaRows, trSheet } = translatedIdeaSheet(data)
    addSheet(wb, 'ideas', ideaRows)
    if (trSheet) addSheet(wb, TRANSLATIONS_SHEET, trSheet.rows)
  }

  // "Download all idea data" (owner, 2026-09-24: "there is no download button that
  // would download for me all the data collected so far"): every loaded idea with
  // every column collected so far, in the order above, plus the check of the
  // Usefulness score, the summaries, the pool KPIs and who was removed.
  function downloadAllData() {
    const data = effectiveRows
    if (!data.length) return
    const wb = XLSX.utils.book_new()
    addIdeaSheet(wb, data)
    if (data.some(r => r.det_usefulness !== '' && r.det_usefulness != null)) {
      addUsefulnessCheckSheet(wb, data, techSet)
    }
    addSheet(wb, 'Summary by condition', summaryByConditionRows(data))
    addSheet(wb, 'Summary by session', summaryBySessionRows(data))
    if (detResult?.perCond?.length) addSheet(wb, 'Pool KPIs by condition', poolKpiRows(withOverall(detResult)))
    if (excludedUsers.size) {
      addSheet(wb, 'Removed participants', users.filter(u => excludedUsers.has(u.key)).map(u => ({
        // "Author Name", not a bare "Author": Step 1b skips a *name* column, so a
        // re-imported copy of this file never sends a participant's name to translation.
        Session: u.session, 'Author Name': u.author_name || '', 'Author ID': u.author_id, 'Ideas removed': u.count,
      })))
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveBlob(out, 'idea_analytics_all_data.xlsx', 'application/octet-stream')
  }

  // The same idea sheet as a CSV, for R / Stata / SPSS.
  function downloadAllDataCsv() {
    const data = effectiveRows
    if (!data.length) return
    // The English version of every idea, like the Excel file (Step 1b); a CSV has
    // no room for the Translations sheet, so the originals travel in the Excel one.
    const objs = translatedIdeaSheet(data).rows
    const cols = Object.keys(objs[0] || {})
    const esc = v => {
      let t = v == null ? '' : String(v)
      // No formula injection when opened in Excel — for TEXT only: a number such as
      // -0.25 must stay a number for R / Stata and for re-import.
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = "'" + t
      return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
    }
    const csv = [cols.map(esc).join(','), ...objs.map(o => cols.map(c => esc(o[c])).join(','))].join('\n')
    saveBlob('\ufeff' + csv, 'idea_analytics_all_data.csv', 'text/csv;charset=utf-8')
  }

  // ── Section 3.1: download the input "ideas" file with a KPI column per idea ──
  // The same idea sheet as "Download all idea data" (so the two files never disagree),
  // plus the per-condition pool KPIs, which are per condition, not per idea.
  function downloadIdeasWithKpis() {
    const data = effectiveRows
    if (!data.length) return
    const wb = XLSX.utils.book_new()
    addIdeaSheet(wb, data)
    // Pool-level KPIs (Unique fraction / Productivity) are per condition, not per
    // idea, so they live on their own tab when a compute run produced them.
    if (detResult?.perCond?.length) {
      addSheet(wb, 'Pool KPIs by condition', poolKpiRows(withOverall(detResult)))
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveBlob(out, 'ideas_with_kpis.xlsx', 'application/octet-stream')
  }

  // Every loaded source as sheets: each Firestore session's full export (the same
  // builder as its own "Download Excel") and each loaded imported workbook. Shared
  // by Step 1b's scan and Step 2's aggregate, so both see exactly the same text.
  async function gatherSources() {
    const loadedImported = importedBooks.filter(b => loadedBookIds.has(b.id))
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
    return { sources, aboutMeta }
  }

  // ── Step 1b: translate everything to English (translation.js) ──────────────
  // A workbook that carries a "Translations" sheet (any download from this page)
  // gives its translations back: fill-empty, so nothing is paid for twice and an
  // edit made on this page is never replaced.
  function restoreTranslationsFrom(sheets) {
    const sh = (sheets || []).find(x => x && x.name === TRANSLATIONS_SHEET)
    if (!sh) return
    const extra = tmFromTranslationsRows(sh.rows)
    if (Object.keys(extra).length) setTm(prev => tmMerge(prev, extra).tm)
  }

  // Find every text in the loaded data that is not in English: each idea, and every
  // text cell of every sheet the aggregate would contain. Local and free.
  async function scanForTranslation() {
    setTrErr(''); setTrMsg('')
    if (!rows.length) { setTrErr('Load one or more sessions (or import a file) in Step 1 first.'); return }
    setScanning(true)
    try {
      const { sources } = await gatherSources()
      const sheets = sources.flatMap(x => x.sheets || []).filter(x => x && x.name !== TRANSLATIONS_SHEET)
      const found = collectTexts({ rows, sheets, tm })
      setTrScan(found)
      const pendingNow = found.items.filter(it => !tmGet(tm, it.text)).length
      setTrReviewOpen(pendingNow > 0)
      setTrMsg(found.items.length
        ? `Found ${found.items.length} text${found.items.length === 1 ? '' : 's'} not in English; ${pendingNow} still need${pendingNow === 1 ? 's' : ''} a translation.`
        : 'Everything in the loaded data is in English. Nothing to translate.')
    } catch (err) {
      setTrErr('Could not read the loaded data: ' + (err.message || err))
    } finally {
      setScanning(false)
    }
  }

  // Translate what the scan found and the memory does not have yet, with Claude
  // Fable 5.1 (Anthropic's API, the Claude key in AI Settings).
  async function translatePending() {
    setTrErr(''); setTrMsg('')
    const items = (trScan?.items || []).filter(it => !tmGet(tm, it.text))
    if (!items.length) { setTrMsg('Nothing left to translate.'); return }
    let settings = aiSettings
    try { settings = await fetchAISettings(); setAiSettings(settings) } catch (_) { /* keep the loaded copy */ }
    setTranslating({ done: 0, total: items.length })
    try {
      const report = await translateTexts(items.map(it => ({ text: it.text })), {
        settings, onProgress: ({ done, total }) => setTranslating({ done, total }),
      })
      const n = applyTranslated(items, report.results)
      const left = items.length - n
      setTrMsg(`Translated ${n} of ${items.length} text${items.length === 1 ? '' : 's'} with Claude Fable 5.1.`
        + (left
          ? ` ${left} could not be translated this run${report.lastError ? ` (${report.lastError.message || report.lastError})` : ''}: press Translate again, type the English below, or press It is English where a text already is.`
          : ' Check them below, then download the data in English.'))
    } catch (err) {
      // A rejected key mid-run still hands back what was already translated (and paid for).
      const n = err?.partial ? applyTranslated(items, err.partial.results) : 0
      setTrErr((err.message || String(err)) + (n ? ` (${n} text${n === 1 ? ' was' : 's were'} translated before this and kept.)` : ''))
    } finally {
      setTranslating(null)
    }
  }
  // Put a run's translations into the memory; returns how many there were.
  function applyTranslated(items, results) {
    const add = {}
    let n = 0
    items.forEach((it, k) => {
      const t = results?.[k]
      if (!t) return
      add[it.text] = { en: t.text, lang: t.lang || it.lang, by: 'Claude Fable 5.1' }
      n++
    })
    if (n) {
      setTm(prev => tmMerge(prev, add).tm)
      setTrDraft(prev => { const next = { ...prev }; for (const t of Object.keys(add)) delete next[t]; return next })
      setTrReviewOpen(true)
    }
    return n
  }

  const trDraftOf = text => (Object.prototype.hasOwnProperty.call(trDraft, text) ? trDraft[text] : (tmGet(tm, text)?.en || ''))
  function saveTranslationEdit(it) {
    setTrErr('')
    const en = String(trDraftOf(it.text) || '').trim()
    if (!en) { setTrErr('Type the English version first.'); return }
    if (en !== it.text && !detectLanguage(en).english) {
      setTrErr('Saved, but this does not read as English: the measures will read exactly what is saved here.')
    }
    setTm(prev => tmSet(prev, it.text, { en, lang: tmGet(prev, it.text)?.lang || it.lang, by: 'by hand' }))
    setTrDraft(prev => { const n = { ...prev }; delete n[it.text]; return n })
  }
  // A false alarm: the text is English already, so it stands as its own English version.
  function keepAsWritten(it) {
    setTm(prev => tmSet(prev, it.text, { en: it.text, lang: 'English (checked by hand)', by: 'kept as written' }))
    setTrDraft(prev => { const n = { ...prev }; delete n[it.text]; return n })
  }
  function removeTranslation(it) {
    setTm(prev => tmSet(prev, it.text, null))
    setTrDraft(prev => { const n = { ...prev }; delete n[it.text]; return n })
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
      const { sources, aboutMeta } = await gatherSources()
      const merged = mergeSessionSheets(sources, aboutMeta)
      const ideasSheet = merged.find(s => s.name === 'Ideas')
      if (ideasSheet) {
        // Carry every KPI set on the page into the Rankings tab (by Idea ID), in the
        // page's order: the empirical KPIs (3.1, all seven columns even before they
        // are computed) and the uploaded extras, then each AI model's pair, then the
        // evaluator columns (kept, empty, for blind expert raters).
        const cols = exportKpiColumns(rows, { allEmpirical: true, evaluatorColumns: true })
        // One record per idea (session + Idea ID): copies of an idea loaded twice are
        // merged per column, and the derived means rebuilt from the merged record.
        const lookup = ideaValueLookup(rows, cols, r => recomputeOverall([r])[0])
        merged.push(rankingsSheetFromIdeas(ideasSheet.rows, lookup, cols))
      }
      // The per-pool deterministic KPIs (Unique fraction / Productivity) are batch-
      // level, not per idea, so the consolidated aggregate carries them on their own
      // tab (the per-idea KPIs already sit as columns in Rankings).
      if (detResult?.perCond?.length) {
        merged.push({ name: 'Pool KPIs by condition', kind: 'json', rows: poolKpiRows(withOverall(detResult)) })
      }
      // Step 1b: every text in English (owner, 2026-09-23: "show me updated file with
      // all data collected in English"); the original of each replaced cell is kept
      // on the "Translations" sheet, which an import of this file reads back.
      // A loaded workbook's own Translations sheet is carried forward too (its cells
      // are English already, so this run replaces nothing there).
      const tr = translateSheets(merged, tm)
      const trSheet = carryTranslationsSheet(tr.log, sources.flatMap(x => x.sheets || []))
      const finalSheets = trSheet ? [...tr.sheets, trSheet] : tr.sheets
      const wb = XLSX.utils.book_new()
      appendSheetsToWorkbook(wb, finalSheets)
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveBlob(out, trSheet ? 'idea_analytics_aggregate_english.xlsx' : 'idea_analytics_aggregate.xlsx', 'application/octet-stream')
    } catch (err) {
      console.error('Aggregate export failed', err)
      alert('Could not build the aggregate file: ' + (err.message || err))
    } finally {
      setAggregating(false)
    }
  }

  // Section-3 "Clear": removes ONLY the KPI data added in THIS step — AI scores (3.2),
  // empirical KPIs (3.1), evaluator scores (3.3) and any uploaded extra KPIs (e.g.
  // Prototypicality). The loaded ideas (Sections 1–2) and the Step-5/6 analysis are
  // left untouched. `stripAllKpis` blanks every built-in KPI and drops all x_ columns
  // while keeping the idea data.
  function clearData() {
    const hasUploaded = uploadedKpiKeys(rows).length > 0
    if ((scoredCount > 0 || extScoredCount > 0 || detScoredCount > 0 || hasUploaded) &&
        !confirm('Clear the KPIs added in this step — every model\'s AI scores, the empirical KPIs, evaluator scores and any uploaded extra KPIs (e.g. Prototypicality)? Your loaded ideas in Sections 1–2 stay.')) return
    setRows(prev => stripAllKpis(prev))
    setDetResult(null); setDetErr('')
    setScoreErr(''); setScoreLoadMsg(''); setEvalLoadMsg(''); setKpiUploadMsg('')
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
    // Analysis scope (admin's choice): the group-voted Final Ideas (Final Group
    // Pick = 1), or every idea that entered the group phase (group-stage ideas +
    // individual ideas carried forward — excludes only the individual ideas a
    // participant didn't select).
    const analysisRows = regScope === 'group'
      ? effectiveRows.filter(enteredGroupPhase)
      : effectiveRows.filter(r => Number(r.final_pick) === 1)
    // Need ≥2 ideas in scope carrying at least one KPI from any source.
    const scored = analysisRows.filter(hasAnyKpi)
    if (scored.length < 2) {
      const where = regScope === 'group' ? 'ideas that entered the group phase' : 'Final-Group-Pick ideas'
      setRunError(`Need at least a couple of ${where} with a KPI. In Step 3, score them with AI (3.2), upload evaluator scores (3.3), or compute the empirical KPIs (3.1).`)
      return
    }
    setRunning(true)
    setRunError(null)
    setImages([])
    outRef.current = ''
    setOutput('')
    // The regressions' word-count control reads `text`: give it the English the
    // measures read (Step 1b), not an unspaced Chinese original.
    const measuredRows = withMeasuredText(analysisRows)
    const dataCsv = rowsToCsv(measuredRows, analysisColumns(measuredRows))
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
  // Ideas that entered the group phase (Section-5 alternative regression scope).
  const groupPhaseCount = useMemo(() => effectiveRows.filter(enteredGroupPhase).length, [effectiveRows])
  // Ideas in the currently-selected regression scope that carry at least one KPI.
  const regScopedScored = useMemo(
    () => (regScope === 'group' ? effectiveRows.filter(enteredGroupPhase) : effectiveRows.filter(isFinal)).filter(hasAnyKpi).length,
    [effectiveRows, regScope])
  const sessionCount = useMemo(() => new Set(rows.filter(r => !r._book).map(r => r.session)).size, [rows])
  // Imported files actually loaded into the dataset (have rows present), for the
  // Step-2 aggregate; and the count of ticked imported files for the Load button.
  const loadedBookIds = useMemo(() => new Set(rows.filter(r => r._book).map(r => r._book)), [rows])
  const selectedBookCount = importedBooks.filter(b => b.selected).length
  // ── Step 2: participants per condition (by the None/Solo/Group/Both encoding) ──
  // Every registered participant counts — including any the admin detached
  // mid-session, whose ideas stay in the dataset — so the participant and idea
  // tallies share one basis (same as the export's Conditions-sheet counts).
  // Firestore-loaded sessions use the real head-count captured at Load time
  // (_participantCount); a loaded imported workbook is counted from its
  // condition-stamped Participants sheet when it has one; anything else (plain
  // CSV imports, a dataset restored from a saved default) falls back to distinct
  // idea authors. Unrecognised condition labels surface as an "Other" row.
  const participantsByCondition = useMemo(() => {
    const OTHER = 'Other'
    const counts = Object.fromEntries([...CONDITIONS, OTHER].map(c => [c, 0]))
    const bucket = c => (counts[c] != null ? c : OTHER)
    const counted = new Set()   // session codes whose real head-count is known
    for (const s of loadedSessions) {
      if (Number.isFinite(s._participantCount)) {
        counts[bucket(conditionForSession(s))] += s._participantCount
        counted.add(s.code || s.id)
      }
    }
    const booksFromSheet = new Set()
    for (const b of importedBooks) {
      if (!loadedBookIds.has(b.id)) continue
      const partSheet = (b.sheets || []).find(sh => String(sh.name).toLowerCase() === 'participants')
      if (!partSheet?.rows?.length) continue
      booksFromSheet.add(b.id)
      for (const row of partSheet.rows) {
        counts[bucket(canonicalCondition(row['Condition'] || row['AI Condition'] || row['Condition Code'] || ''))]++
      }
    }
    const seen = new Set()
    for (const r of rows) {
      if (r._book ? booksFromSheet.has(r._book) : counted.has(r.session)) continue
      if (!r.author_id) continue   // an idea without an author can't be attributed
      const key = userKey(r.session, r.author_id)
      if (seen.has(key)) continue
      seen.add(key)
      counts[bucket(canonicalCondition(r.condition))]++
    }
    const out = CONDITIONS.map(c => ({ condition: c, count: counts[c] }))
    // Unrecognised condition labels are surfaced, not silently dropped.
    if (counts[OTHER] > 0) out.push({ condition: OTHER, count: counts[OTHER] })
    return out
  }, [rows, loadedSessions, importedBooks, loadedBookIds])
  const participantTotal = participantsByCondition.reduce((s, c) => s + c.count, 0)
  // Step-3 scoring scope (all ideas vs only Final Ideas) and its AI-score coverage.
  // `gaps.fillable` — not "every empty cell" — is what the Fill button offers to do:
  // an idea with no text at all can never be rated, so counting it as outstanding
  // would leave a panel that never reaches zero however many times it is pressed.
  const scorePool = scoreOnlyFinal ? effectiveRows.filter(isFinal) : effectiveRows
  // Coverage is PER MODEL: "how many ideas has the model chosen above not rated
  // yet", so pressing Fill with a second model fills that model's own columns.
  const gaps = useMemo(
    () => scoreGaps(effectiveRows, { onlyFinal: scoreOnlyFinal, isFinal, fields: scoreFields }),
    [effectiveRows, scoreOnlyFinal, scoreFields])
  // Coverage over the WHOLE dataset, regardless of the Final-Ideas tick — so the
  // panel can say when the tick is what is hiding a gap ("0 final ideas to score"
  // over a dataset that still has 24 unscored ideas is the reading that misled).
  const allGaps = useMemo(() => scoreGaps(effectiveRows, { fields: scoreFields }), [effectiveRows, scoreFields])
  const scopeUnscored = gaps.fillable
  // Every OTHER model with scores in the data, with how many ideas it has rated
  // (both columns), for the line under the coverage panel.
  const otherModelCoverage = useMemo(() => aiModelSlugs(effectiveRows)
    .filter(sl => sl !== scoreSlug)
    .map(sl => {
      const f = { novelty: `ai_nov__${sl}`, usefulness: `ai_use__${sl}` }
      const g = scoreGaps(effectiveRows, { onlyFinal: scoreOnlyFinal, isFinal, fields: f })
      return { slug: sl, name: aiModelName(sl), scored: g.scored, total: g.total }
    }), [effectiveRows, scoreSlug, scoreOnlyFinal])
  // Over the ideas on show (after removals), like the coverage line beside it.
  const unrecordedCount = useMemo(
    () => effectiveRows.filter(r => [`ai_nov__${UNRECORDED}`, `ai_use__${UNRECORDED}`].some(k => r[k] !== '' && r[k] != null)).length,
    [effectiveRows])
  // Steps 4–5 read AI Novelty / AI Usefulness as each idea's mean over the models
  // that rated it. When the ideas in scope were not all rated by the same models, a
  // difference between conditions can come from WHICH models rated which ideas
  // (review, 2026-09-24: a second model that stopped part-way moved the Both-vs-
  // Group contrast by 0.19), so the two steps say so, naming the groups.
  function panelNote(scopeRows) {
    const cov = aiPanelCoverage(scopeRows)
    if (!cov.uneven) return null
    const name = sl => (sl === UNRECORDED ? 'a model not recorded' : aiModelName(sl))
    const shown = cov.groups.slice(0, 4).map(g => `${g.n.toLocaleString()} by ${g.slugs.map(name).join(' and ')}${g.slugs.length === 1 ? ' only' : ''}`)
    const more = cov.groups.length > 4 ? `; ${cov.groups.slice(4).reduce((t, g) => t + g.n, 0).toLocaleString()} by other sets` : ''
    return (
      <p className={styles.hint}>
        <strong className={styles.unscored}>Not every idea here was rated by the same AI models</strong>: {shown.join('; ')}{more}.
        {' '}AI&nbsp;Novelty and AI&nbsp;Usefulness here are each idea&apos;s mean over the models that rated it, so a difference
        {' '}between conditions can come from which models rated which ideas. Fill the missing ratings in 3.2 (pick each
        {' '}model in turn) so every idea has the same models.
      </p>
    )
  }
  const regScopeRows = useMemo(
    () => (regScope === 'group' ? effectiveRows.filter(enteredGroupPhase) : effectiveRows.filter(isFinal)),
    [effectiveRows, regScope])
  // Step-5 regression dataset: Final-Group-Pick ideas carrying at least one KPI
  // (from any source — AI / evaluator / empirical).
  const finalScoredCount = effectiveRows.filter(r => isFinal(r) && hasAnyKpi(r)).length

  // ── Step 4: summary statistics over the consolidated Step-3 data ──
  // "scored" = carries at least one KPI from ANY source (AI / evaluator / empirical
  // / uploaded), so Section 4 reflects whatever Step 3 produced — not only AI-rated
  // ideas (empirical KPIs alone now populate the summary).
  const statRows = useMemo(
    () => withMeasuredText(statsOnlyScored ? effectiveRows.filter(hasAnyKpi) : effectiveRows),
    [effectiveRows, statsOnlyScored])
  // Per-condition counts + mean (SD) for EVERY present KPI (each KPI over its own
  // non-missing rows), so the table shows empirical / uploaded KPIs, not just AI.
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
    // Blank ('') quality cells are missing, not 0 — Number('') is 0 and would drag
    // the mean down for every unscored idea in the Section-4 subset.
    const v = statRows.map(r => r.overall_quality).filter(x => x !== '' && x != null).map(Number).filter(Number.isFinite)
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'
  }, [statRows])
  // Table 1 (summary statistics + correlation matrix), in the style of the paper's
  // Table 1 — computed over the fully-scored ideas in the Section-4 dataset.
  const summaryTable = useMemo(() => buildSummaryTable(statRows), [statRows])

  const code = tab === 'python' ? pyCode : rCode
  const setCode = tab === 'python' ? setPyCode : setRCode
  const resetCode = () => (tab === 'python' ? setPyCode(PYTHON_TEMPLATE) : setRCode(R_TEMPLATE))
  // A script saved before a KPI existed (browser-local "Save" / "Make this the
  // default") keeps its old KPI list and silently SKIPS that KPI: uploaded x_ columns
  // are discovered at run time, but built-in keys (det_need_fit, …) are only analysed
  // when the script names them. Flag every KPI in the data that the built-in template
  // analyses and this script does not mention.
  const staleKpis = useMemo(() => {
    const lang = tab === 'python' ? 'python' : 'r'
    const want = scriptKpiKeys(tab === 'python' ? PYTHON_TEMPLATE : R_TEMPLATE, lang)
    const have = scriptKpiKeys(code, lang)
    if (!want || !have) return []   // a restructured script: no registry to compare
    return presentKpis(effectiveRows).filter(d => want.has(d.key) && !have.has(d.key))
  }, [effectiveRows, code, tab])

  // ── Step 6: insights derived from the last run ──
  const report = useMemo(() => (lastRun ? parseRunOutput(lastRun.output) : null), [lastRun])
  // "rows used for analysis: N" is printed by both scripts; surface it in the PDF
  // header. No fallback guess — a run that doesn't print it just shows no count
  // (the old scoredCount fallback reported the wrong scope: AI-scored ideas over
  // the WHOLE dataset, not the analysed subset).
  const rowsUsed = useMemo(() => {
    const m = lastRun && /rows used for analysis:\s*(\d+)|N analysed:\s*(\d+)/i.exec(lastRun.output)
    return m ? Number(m[1] ?? m[2]) : null
  }, [lastRun])

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
            <div className={styles.spacer} />
            <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => fileRef.current?.click()} disabled={!!scoring}>Import Excel / CSV</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={onPickFile} />
          </div>

          <SectionActions onSave={saveSessions} onMakeDefault={saveSessions} onRestore={restoreSessions} hasCustom={saved.sessions} />
        </section>

        {/* STEP 1b — Translate everything to English (translation.js) */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>1b</span>Translate everything to English</span>
            <span className={styles.row}>
              <button className={`btn-ghost ${styles.miniBtn}`} onClick={scanForTranslation} disabled={scanning || !!translating || !rows.length}>
                {scanning ? <><span className={styles.spinner} /> Reading the loaded data…</> : 'Find text not in English'}
              </button>
              {rows.length > 0 && (
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadAggregate} disabled={aggregating || !!translating}
                  title="The aggregate workbook (Step 2) with every translated text in English and the originals on a Translations sheet">
                  {aggregating ? <><span className={styles.spinner} /> Building…</> : 'Download all data in English (Excel)'}
                </button>
              )}
            </span>
          </h2>
          <p className={styles.hint}>
            Everything participants wrote that is not in English is translated before any analysis: their ideas, survey
            answers, group-chat messages, their prompts to the AI assistant and its replies, in every loaded session and
            imported file. <strong>Find text not in English</strong> checks every text locally (no cost): text in another
            script (Chinese, Japanese, Korean, Greek, Cyrillic, Persian or Arabic, and others) or in another Latin-script
            language (French, Spanish, German, Italian, Portuguese, Dutch, Indonesian or Malay). Names, e-mails, IDs,
            labels and codes are never translated. Only the texts found are sent to <strong>Claude Fable 5.1</strong> through
            Anthropic&apos;s API, using the Claude key saved in AI Settings. The originals are never lost: every download
            carries a <em>Translations</em> sheet with each original beside its English, and importing that file again
            brings the translations back. <strong>Step 3&apos;s measures read the English and stay locked until every idea
            not in English has been translated.</strong>
          </p>
          {rows.length > 0 && (
            <p className={styles.loadMsg}>
              {ideasNotEnglish.length
                ? <><strong>{languageSummary(ideasNotEnglish)}</strong> {ideasNotEnglish.length === 1 ? 'is' : 'are'} not in English yet, so Step 3 is locked.</>
                : `✓ Every loaded idea can be measured in English${Object.keys(tm).length ? ` (${Object.keys(tm).length} translation${Object.keys(tm).length === 1 ? '' : 's'} on record)` : ''}.`}
              {!trScan && ' Press Find text not in English to check the survey answers and chats as well.'}
            </p>
          )}
          {trScan && trItems.length > 0 && (
            <>
              <p className={styles.loadMsg}>
                {trItems.length} text{trItems.length === 1 ? '' : 's'} not in English
                {' '}({Object.entries(trScan.byLanguage).map(([l, n]) => `${l} ${n}`).join(', ')}) in
                {' '}{Object.entries(trScan.bySheet).map(([sh, n]) => `${sh} ${n}`).join(', ')}.
                {' '}{trPending.length ? `${trPending.length} still to translate.` : 'All translated.'}
              </p>
              {trPending.length > 0 && (
                <div className={styles.row} style={{ marginBottom: 8 }}>
                  <button className="btn-primary" onClick={translatePending} disabled={!!translating || scanning || !!scoring || !!detComputing}>
                    {translating
                      ? `Translating… ${translating.done}/${translating.total}`
                      : `Translate ${trPending.length} text${trPending.length === 1 ? '' : 's'} with Claude Fable 5.1`}
                  </button>
                  <span className={styles.statusLine}>
                    {trCost ? `about $${trCost.usd < 1 ? trCost.usd.toFixed(2) : trCost.usd.toFixed(0)} at Fable 5.1 prices (an estimate)` : ''}
                    {aiSettings && !aiSettings?.apiKeys?.claude ? ' · no Claude key saved: add one in AI Settings, or type the English below' : ''}
                  </span>
                </div>
              )}
            </>
          )}
          {trErr && <p className="error-msg">{trErr}</p>}
          {trMsg && <p className={styles.loadMsg}>{trMsg}</p>}
          {trScan && trItems.length > 0 && (
            <details open={trReviewOpen} onToggle={e => setTrReviewOpen(e.currentTarget.open)}>
              <summary className={styles.raterLabel}>Review the translations ({trItems.length - trPending.length} of {trItems.length} done)</summary>
              <div className={styles.tableWrap} style={{ marginTop: 6, maxHeight: '70vh' }}>
                <table className={styles.trTable}>
                  <thead>
                    <tr><th>Where</th><th>Language</th><th>Original</th><th>English</th><th /></tr>
                  </thead>
                  <tbody>
                    {[...trPending, ...trItems.filter(it => tmGet(tm, it.text))].map(it => {
                      const e = tmGet(tm, it.text)
                      return (
                        <tr key={it.text}>
                          <td className={styles.trMeta}>{Object.entries(it.where).map(([w, n]) => <div key={w}>{w}{n > 1 ? ` ×${n}` : ''}</div>)}</td>
                          <td className={styles.trMeta}>{e ? e.lang : it.lang}{e?.by ? <><br />{e.by}</> : null}</td>
                          <td><div className={styles.trText}>{it.text}</div></td>
                          <td>
                            <textarea className={styles.trInput} rows={Math.min(8, Math.max(2, Math.ceil(String(trDraftOf(it.text)).length / 70)))}
                              placeholder="English" value={trDraftOf(it.text)} disabled={!!translating || !!scoring || !!detComputing}
                              onChange={ev => { const v = ev.target.value; setTrDraft(prev => ({ ...prev, [it.text]: v })) }} />
                          </td>
                          <td><div className={styles.trActions}>
                            <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => saveTranslationEdit(it)} disabled={!!translating || !!scoring || !!detComputing}>
                              {e ? 'Save edit' : 'Save'}
                            </button>
                            {e ? (
                              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => removeTranslation(it)} disabled={!!translating || !!scoring || !!detComputing}
                                title="Remove this translation (the text goes back to needing one)">Remove</button>
                            ) : (
                              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => keepAsWritten(it)} disabled={!!translating || !!scoring || !!detComputing}
                                title="The check got it wrong: this text is English, keep it as written">It is English</button>
                            )}
                          </div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>

        {/* STEP 2 — Consolidate every loaded source into one clean Excel */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>2</span>Aggregate Data</span>
            <span className={styles.row}>
              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => aggFileRef.current?.click()} disabled={!!scoring}>Import Excel / CSV</button>
              <input ref={aggFileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={e => onPickFile(e, true)} />
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
            <strong> Rankings</strong> — one row per idea with <em>Idea&nbsp;ID, Session&nbsp;Code, Condition, Stage,
            Final&nbsp;Group&nbsp;Pick, Title, Description</em>, then first the Section&nbsp;3.1
            <strong>empirical</strong> KPIs (novelty side and usefulness side), then the <strong>AI
            ratings model by model</strong> (e.g. <em>AI&nbsp;Novelty&nbsp;(GPT-6&nbsp;Astra)</em> beside
            {' '}<em>AI&nbsp;Usefulness&nbsp;(GPT-6&nbsp;Astra)</em>, then the next model's pair), and the
            {' '}<em>Eval.&nbsp;Novelty / Eval.&nbsp;Usefulness / Eval.&nbsp;Quality</em> columns, empty and ready
            for blind expert rating (raters fill the first two; Eval.&nbsp;Quality is always their mean).
            You can also <strong>Import Excel / CSV</strong>
            here (same importer as Step&nbsp;1): the file is added to the source list above <strong>and
            loaded right away</strong>, so the aggregate, the stats below and Steps&nbsp;3–6 fill in
            immediately — no need to scroll back up and press “Load …”. (It is appended to whatever is
            already loaded; use Section&nbsp;1’s <em>Clear</em> first if you want only this file.)
          </p>
          {rows.length === 0 ? (
            <p className={styles.emptyNote}>Tick sessions (or imported files) above and press “Load …”, then build the consolidated file here.</p>
          ) : (
            <>
              <div className={styles.stats}>
                <div className={styles.statBox}><div className={styles.statNum}>{rows.length}</div><div className={styles.statLabel}>Ideas generated</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{finalCount}</div><div className={styles.statLabel}>Total final ideas</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{sessionCount}</div><div className={styles.statLabel}>Number of sessions</div></div>
              </div>
              <div className={styles.condCountCard}>
                <div className={styles.encodingTitle}>Participants per condition ({participantTotal} total)</div>
                <table className={styles.encodingTable}>
                  <thead>
                    <tr><th>Encoding</th><th>Participants</th></tr>
                  </thead>
                  <tbody>
                    {participantsByCondition.map(p => (
                      <tr key={p.condition} className={p.count ? '' : styles.condCountZero}>
                        <td><span className={`${styles.condTag} ${condClass(p.condition)}`}>{p.condition}</span></td>
                        <td>{p.count} participant{p.count === 1 ? '' : 's'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={styles.condCountNote}>
                  Every registered participant of each loaded session, counted under its
                  session&rsquo;s condition. An imported workbook is counted from its Participants
                  sheet; a plain CSV (or a restored dataset) by its distinct idea authors —
                  ideas without an author ID can&rsquo;t be attributed. Reflects the full loaded
                  dataset, before any Step-3 participant removals.
                </div>
              </div>
            </>
          )}
        </section>

        {/* STEP 3 — KPI scoring + dataset */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>3</span>Score &amp; extend ideas across KPI sources, manage participants &amp; download</span>
            {rows.length > 0 && (
              <span className={styles.row}>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearData} disabled={!!scoring}>Clear</button>
              </span>
            )}
          </h2>
          <p className={styles.hint}>
            Each idea can carry KPIs from independent sources, kept separate so the analysis
            can compare them: <strong>3.1 empirical</strong> KPIs computed from the idea
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
                <div className={styles.statBox}><div className={styles.statNum}>{detScoredCount}</div><div className={styles.statLabel}>Empirical computed (3.1)</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{scoredCount}</div><div className={styles.statLabel}>AI scored, any model (3.2)</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{extScoredCount}</div><div className={styles.statLabel}>Eval. rated (3.3)</div></div>
                {CONDITIONS.map(c => (
                  <div className={styles.statBox} key={c}>
                    <div className={styles.statNum}>{stats[c]?.count || 0}</div>
                    <div className={styles.statLabel}>{c}</div>
                  </div>
                ))}
              </div>

              {/* ── Sub-step 3.1 — Empirical KPIs ─────────────────────────────── */}
              <h3 className={styles.subTitle}><span className={styles.subBadge}>3.1</span>Empirical KPIs</h3>
              <div className={styles.banner}>
                <strong>Empirical, repeatable proxies computed from the idea text</strong>, in your browser with classical
                {' '}<strong>TF-IDF</strong> similarity (no&nbsp;API key, no&nbsp;model download). They come in two sides, and each
                side has its own anchor, so one is never just the other turned upside down.
                <ul className={styles.bannerList}>
                  <li>
                    <strong>Novelty side</strong> (Lee&nbsp;&amp;&nbsp;Chung 2024; Meincke et&nbsp;al. 2025; Bouschery et&nbsp;al. 2024):
                    {' '}<em>Novelty</em> (1&nbsp;−&nbsp;highest similarity to the reference set R of products that already
                    exist), <em>Pool distinctiveness</em> (1&nbsp;−&nbsp;average similarity to the other ideas) and the
                    {' '}<em>NoveltyScore</em> (the mean of the two as percentile ranks, 0 to 1, so both count equally:
                    Pool distinctiveness varies over a narrow range, and a plain mean was Novelty alone). Per condition:
                    {' '}<em>Unique fraction</em> and <em>Productivity</em> (KPI&nbsp;2). Words are compared after dropping
                    common words, folding UK spelling to US (colour, color), reducing each word to its stem (sock, socks)
                    and merging a short list of synonyms (tee and t-shirt, pullover and hoodie, cup and mug). The title and
                    each sentence of an idea are also compared with R and the closest counts, so a longer description
                    cannot make an existing product look new.
                  </li>
                  <li>
                    <strong>Usefulness side</strong> (Dean, Hender, Rodgers &amp; Santanen 2006; Rietzschel, Nijstad &amp;
                    Stroebe 2010): <em>Need fit</em> (highest similarity to the need set U of problems people have: close
                    to what people need, where Novelty is far from what already exists), <em>Specificity</em> (the share of
                    five things the idea spells out: who it is for, what it is, where or when it is used, why it helps,
                    how it works), <em>Workability</em> (can it be built with the fabric alone: 1 when it needs no extra
                    technology from list T, ½ with one such as an app or a battery, ⅓ with two, and so on) and their
                    {' '}<em>Usefulness score</em> (the mean of the three as percentile ranks, 0 to 1).
                  </li>
                </ul>
                Novelty and usefulness are different things and research finds they often pull against each other
                (Runco &amp; Charles 1993; Rietzschel et&nbsp;al. 2010), so the cross-check below shows how the two scores
                relate and how many ideas are both novel and useful. Longer ideas tend to score higher on text measures,
                so compare with the word count in Section&nbsp;4; Step&nbsp;5&apos;s Table&nbsp;7 repeats the condition comparison with
                {' '}length held fixed. <em>Prototypicality (KS)</em> is not computed in the
                browser yet: compute it elsewhere and <strong>Upload additional KPIs</strong> below. Every numeric column
                (matched to your ideas by Idea&nbsp;ID) becomes a KPI that flows into Section&nbsp;4, the Step-2 aggregate
                {' '}<em>Rankings</em> tab and the Step-5 regressions. <em>Download ideas&nbsp;+&nbsp;KPIs</em> exports the ideas
                with a column per KPI.
                <br /><br />
                <strong>Ideas that cannot be scored are left blank.</strong> An idea needs at least <strong>two meaningful
                words</strong>: two different words that are not common English words such as <em>the</em>, <em>and</em> or
                {' '}<em>it</em> (NLTK&apos;s English stop-word list). A blank idea, a single word (a made-up name like
                {' '}<em>Zorblax</em>, or just <em>Thermochromic</em>), only common words, or text in a non-Latin script such as
                Greek gets no KPI on either side, and is left out of the other ideas&apos; comparisons and of the Unique
                fraction. This is the &ldquo;cannot be scored&rdquo; rule of Bouschery et&nbsp;al.&nbsp;(2024), who drop
                single-word ideas; before it, such an idea shared no words with anything and scored a perfect 1 on the
                novelty side, ranking first. Blank KPIs are dropped from the Step-5 regressions, not counted as 0.
              </div>
              <div className={styles.anchorGrid}>
                <div>
                  <div className={styles.raterLabel} style={{ marginBottom: 4 }}>Reference set R: products that already exist (one per line) · novelty side</div>
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
                <div>
                  <div className={styles.raterLabel} style={{ marginBottom: 4 }}>Need set U: problems people have (one per line) · usefulness side</div>
                  <textarea
                    className={styles.refsArea}
                    value={needSet}
                    spellCheck={false}
                    disabled={!!detComputing}
                    onChange={e => { setNeedSet(e.target.value); try { localStorage.setItem(LS.needset, e.target.value) } catch (_) {} }}
                  />
                  <div className={styles.row} style={{ marginTop: 4 }}>
                    <button className={`btn-ghost ${styles.miniBtn}`} disabled={!!detComputing}
                      onClick={() => { setNeedSet(DEFAULT_NEED_SET.join('\n')); try { localStorage.removeItem(LS.needset) } catch (_) {} }}>
                      Reset need set
                    </button>
                    <span className={styles.kpiPill}>{needSet.split('\n').filter(s => s.trim()).length} needs</span>
                  </div>
                </div>
                <div>
                  <div className={styles.raterLabel} style={{ marginBottom: 4 }}>Extra technology T: what the fabric alone does not supply (one per line) · Workability</div>
                  <textarea
                    className={styles.refsArea}
                    value={techSet}
                    spellCheck={false}
                    disabled={!!detComputing}
                    onChange={e => { setTechSet(e.target.value); try { localStorage.setItem(LS.techset, e.target.value) } catch (_) {} }}
                  />
                  <div className={styles.row} style={{ marginTop: 4 }}>
                    <button className={`btn-ghost ${styles.miniBtn}`} disabled={!!detComputing}
                      onClick={() => { setTechSet(DEFAULT_TECH_SET.join('\n')); try { localStorage.removeItem(LS.techset) } catch (_) {} }}>
                      Reset technology list
                    </button>
                    <span className={styles.kpiPill}>{techSet.split('\n').filter(s => s.trim()).length} terms</span>
                  </div>
                </div>
              </div>
              <p className={styles.kpiMuted}>
                Write R, U and T before you look at the ideas, and keep them fixed across conditions: they are the
                researcher&apos;s only inputs, like the rubric a human rater would use. U lists problems, not products, and
                should not reuse R&apos;s product words, or Need fit would partly copy &quot;close to R&quot;.
              </p>
              <div className={styles.row} style={{ marginBottom: 8 }}>
                <button className="btn-primary" onClick={computeDeterministic} disabled={!!detComputing || effectiveRows.length < 2}>
                  {detComputing ? `${detComputing.phase}… ${detComputing.done}/${detComputing.total}` : `Compute empirical KPIs for ${effectiveRows.length} idea${effectiveRows.length === 1 ? '' : 's'}`}
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
              {detResult && <ObjectiveKpiResults res={detResult} />}

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
                idea on novelty and usefulness (1–5); quality is their mean. <strong>The rater only accepts whole numbers
                from 1 to 5</strong>: a model that answers 3.5 (or 0, or 7) for an idea is asked again for that idea, and no
                AI score is ever rounded. <strong>Every model gets its own two
                columns</strong>, named after it: <em>AI&nbsp;Novelty&nbsp;(GPT-6&nbsp;Astra)</em> and
                {' '}<em>AI&nbsp;Usefulness&nbsp;(GPT-6&nbsp;Astra)</em>, and beside them the next model's pair. When two or
                more models rated an idea, <em>AI&nbsp;Novelty&nbsp;(mean across models)</em> and <em>AI&nbsp;Usefulness&nbsp;(mean
                across models)</em> are their average, and that average is what Steps&nbsp;4–5 analyse as the AI score. Choose the API provider and the model below —
                the run uses that provider's key saved under AI&nbsp;Settings, and the model is named on every request
                (a key unlocks all of a provider's models; it is not tied to one). Scores flow into the <em>Rankings</em> tab of the Step&nbsp;2
                aggregate and the Step&nbsp;5 regressions. <strong>Both the AI run and an uploaded file only fill ideas
                that have no score yet</strong> — ideas already scored (in an earlier sitting, by a past AI rater, or by
                hand) keep their scores. To change one, edit it directly in the table below.
                {' '}<strong>Coming back to a dataset with empty cells?</strong> Press <em>Upload full dataset</em>, pick the
                workbook you downloaded, and its scores are merged onto the loaded ideas <strong>by Idea&nbsp;ID</strong> —
                nothing is duplicated and nothing already scored is overwritten. The panel below then says exactly how many
                ideas are still missing an AI&nbsp;Novelty or AI&nbsp;Usefulness, and one press of <em>Fill …</em> keeps
                running over what is left until they are all filled.
              </div>

              <div className={styles.raterRow}>
                <span className={styles.raterLabel}>AI rater</span>
                <select className={styles.miniSelect} value={scoreProvider} onChange={e => onScoreProviderChange(e.target.value)} disabled={!!scoring} title="Which provider's API key to use">
                  {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {/* Five models of each provider's newest generation, most capable first,
                    with the price per 1M tokens (catalogue in src/data/aiModels.js). */}
                <select className={styles.miniSelect} value={scoreModel} onChange={e => setScoreModel(e.target.value)} disabled={!!scoring} title="Which of that provider's models rates the ideas">
                  {activeProvider.models.map(m => <option key={m.id} value={m.id}>{modelOptionLabel(m, MODEL_PRICES)}</option>)}
                </select>
                {aiSettings && !selectedHasKey && (
                  <span className={styles.unscored}>no {activeProvider.name} key saved — add it under AI Settings</span>
                )}
              </div>
              {activeProvider.note && <p className={styles.hint}><strong>{activeProvider.name}:</strong> {activeProvider.note}</p>}
              <p className={styles.hint}>
                Why pick a model as well as a provider? An API key belongs to your {activeProvider.name} account, not to
                one model — it unlocks every model that provider serves, and each request names the model it runs on.
                The list shows the provider's newest models (five each for Claude, OpenAI and Gemini), most capable
                first, with each model's price per 1M tokens beside it (as of {CATALOGUE_AS_OF}); the pre-selected one
                is a cheap current model, which is enough for a 1–5 rating over hundreds of ideas.
                The run fills <em>this model's own</em> columns and only where they are still empty, so a second
                model rates the same ideas into a new pair of columns without touching the first model's scores
                (to re-rate with the SAME model, clear its cells in the table, or press <em>Clear</em> in this section).
              </p>

              <label className={styles.checkRow}>
                <input type="checkbox" checked={scoreOnlyFinal} onChange={e => setScoreOnlyFinal(e.target.checked)} disabled={!!scoring} />
                <span>Only score the <strong>Final Ideas</strong> — the group-selected ideas (Final&nbsp;Group&nbsp;Pick&nbsp;=&nbsp;1)</span>
                <span className={styles.kpiPill}>{finalCount} final</span>
              </label>

              {/* AI-score coverage — the answer to "how many rows are still empty?".
                  Always on screen while a dataset is loaded, because the only number
                  here used to be the Score button's own scope count, and that follows
                  the Final-Ideas tick: a dataset with 24 unscored ideas could read
                  "Score 0 final ideas with AI" and look finished. */}
              {effectiveRows.length > 0 && (
                <div className={`${styles.coverage} ${gaps.complete ? styles.coverageDone : ''}`}>
                  <div className={styles.coverageHead}>
                    <strong>AI score coverage · {scoreModelName}</strong>
                    <span className={styles.kpiPill}>{gaps.scored.toLocaleString()} of {gaps.total.toLocaleString()} scored</span>
                    {gaps.fillable > 0 && <span className={styles.unscored}>{gaps.fillable.toLocaleString()} still empty</span>}
                    {gaps.unratable > 0 && <span className={styles.kpiPill}>{gaps.unratable.toLocaleString()} unratable</span>}
                  </div>
                  <p className={styles.coverageLine}>{gapSummary(gaps, scoreOnlyFinal, scoreModelName)}</p>
                  {otherModelCoverage.length > 0 && (
                    <p className={styles.coverageLine}>
                      Other models in the data:{' '}
                      {otherModelCoverage.map((m, i) => (
                        <span key={m.slug}>{i ? ' · ' : ''}<strong>{m.name}</strong> {m.scored.toLocaleString()} of {m.total.toLocaleString()} rated</span>
                      ))}
                      . Each model keeps its own columns; where two or more rated an idea, <em>AI Novelty (mean across models)</em> is their average.
                    </p>
                  )}
                  {unrecordedCount > 0 && (
                    <div className={styles.coverageLine}>
                      <strong>{unrecordedCount.toLocaleString()} idea{unrecordedCount === 1 ? ' has' : 's have'} AI scores with no model name</strong>
                      {' '}(from a file saved before the columns named their model). Which model rated {unrecordedCount === 1 ? 'it' : 'them'}?{' '}
                      <select className={styles.miniSelect} value={labelTarget} onChange={e => setLabelTarget(e.target.value)} disabled={!!scoring}>
                        <option value="">Choose the model…</option>
                        {PROVIDERS.map(p => (
                          <optgroup key={p.id} label={p.name}>
                            {p.models.map(m => <option key={m.id} value={m.id}>{aiModelName(modelSlug(m.id))}</option>)}
                          </optgroup>
                        ))}
                      </select>{' '}
                      <button className={`btn-ghost ${styles.miniBtn}`} onClick={onLabelUnrecorded} disabled={!labelTarget || !!scoring}>Label them</button>
                    </div>
                  )}
                  {/* A gap the tick is hiding: say so, rather than letting the scope
                      count read as "there is nothing left to do". */}
                  {scoreOnlyFinal && allGaps.fillable > gaps.fillable && (
                    <p className={styles.coverageLine}>
                      Across the <strong>whole</strong> dataset {allGaps.fillable.toLocaleString()} idea{allGaps.fillable === 1 ? '' : 's'} still
                      need a score from {scoreModelName} — untick <em>Only score the Final Ideas</em> above to fill those too.
                    </p>
                  )}
                  {gaps.unratable > 0 && (
                    <p className={styles.hint}>
                      An “unratable” idea carries no text, so no rater — AI or human — can score it;
                      it is counted apart so this panel can reach zero.
                    </p>
                  )}
                </div>
              )}

              <div className={styles.row} style={{ marginBottom: 12 }}>
                <button className="btn-primary" onClick={scoreUnscored} disabled={!!scoring || scopeUnscored === 0}>
                  {scoring
                    ? scoring.waiting
                      ? `Waiting for ${scoreProvider} to recover…`
                      : `Scoring ${scoring.done}/${scoring.total}…${scoring.pass > 1 ? ` (pass ${scoring.pass})` : ''}`
                    : scopeUnscored === 0
                      ? `${scoreModelName} has rated all ${scoreOnlyFinal ? 'final ' : ''}ideas`
                      : `Fill the ${scopeUnscored.toLocaleString()} missing ${scoreModelName} score${scopeUnscored === 1 ? '' : 's'}`}
                </button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => datasetFileRef.current?.click()} disabled={!!scoring}
                  title="Upload your whole dataset (the ideas_with_kpis / analysis Excel or CSV you downloaded) → its AI scores are merged onto the loaded ideas by Idea ID, filling only the cells that are still empty. Nothing is duplicated and nothing already scored is overwritten.">
                  Upload full dataset (top up AI scores)
                </button>
                <input ref={datasetFileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={onPickDatasetTopUp} />
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => scoreFileRef.current?.click()} disabled={!!scoring}
                  title='Upload an offline AI-scoring file ("All Ideas Ranked" / Rankings sheet, matched by Idea ID and Session Code when it has them, else by idea title) → fills the AI KPI columns of ideas that have no score yet (already-scored ideas keep theirs)'>Load AI scores file</button>
                <input ref={scoreFileRef} type="file" accept=".xlsx,.xls" className={styles.fileInput} onChange={onPickScores} />
                {scoring && (
                  <span className={styles.statusLine}>
                    <span className={styles.spinner} />
                    {scoring.waiting
                      ? ` ${scoreProvider} stopped answering — pausing before the next attempt…`
                      : ` contacting ${scoreProvider}…`}
                  </span>
                )}
              </div>
              {scoring && (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${scoring.total ? Math.round((scoring.done / scoring.total) * 100) : 0}%` }} />
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

              {/* Everything collected so far, in the page's column order (owner, 2026-09-24). */}
              <div className={styles.row} style={{ marginTop: 14, alignItems: 'center', gap: 10 }}>
                <button className="btn-primary" onClick={downloadAllData} disabled={!effectiveRows.length}
                  title="Every loaded idea with every column collected so far: the empirical KPIs first, then each AI model's Novelty and Usefulness, then the evaluators">
                  Download all idea data (Excel)
                </button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadAllDataCsv} disabled={!effectiveRows.length}>CSV</button>
                <span className={styles.hint} style={{ margin: 0 }}>
                  Every idea in the table with every column collected so far, in this order: the ideas&apos; details, the
                  {' '}<strong>empirical</strong> KPIs, then the <strong>AI</strong> scores model by model, then the evaluators.
                  The ideas are in English where Step&nbsp;1b translated them; the Excel file keeps the originals on a
                  {' '}<em>Translations</em> sheet and adds a <em>Usefulness score check</em> sheet (each idea&apos;s three
                  parts, their ranks and the mean), summaries by condition and by session, and the pool KPIs. For the
                  whole study (surveys, chats, every tab) use <strong>Download all data in English</strong> in Step&nbsp;1b.
                </span>
              </div>
              <div className={styles.tableWrap} style={{ marginTop: 10 }}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      {TABLE_COLS.map(key => {
                        // Inject the KPI headers (empirical, then AI per model, then
                        // evaluators) just before the Idea text column.
                        const head = []
                        if (key === 'idea') {
                          for (const d of tableKpiCols) head.push(
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
                        {tableKpiCols.map(d => {
                          const v = r[d.key]
                          // A score a model GAVE can be corrected here (1–5); a blank
                          // cell cannot be typed into, because a hand rating there would
                          // be exported, and averaged, as that model's (review,
                          // 2026-09-24): a blank is filled by the model's own run. The
                          // cell being edited stays an input while it has focus, so
                          // clearing it and typing a new value is one edit. Every other
                          // column (empirical, derived means, evaluators) is read-only.
                          const cellId = `${r.rid}|${d.key}`
                          const hasScore = v !== '' && v != null
                          if (d.source === 'ai' && d.slug && !d.placeholder && (hasScore || editingCell === cellId)) {
                            return (
                              <td key={d.key} className="num">
                                <input className={styles.scoreInput} type="number" min="1" max="5" step="0.5"
                                  value={v ?? ''} onChange={e => updateScore(r.rid, d.key, e.target.value)}
                                  onFocus={() => setEditingCell(cellId)}
                                  onBlur={() => setEditingCell(c => (c === cellId ? '' : c))} />
                              </td>
                            )
                          }
                          const blank = v === '' || v == null || !Number.isFinite(Number(v))
                          return (
                            <td key={d.key} className={`num ${blank ? styles.unscored : ''}`}
                              title={blank && d.source === 'ai' && d.slug && d.slug !== UNRECORDED ? `Not rated by ${aiModelName(d.slug)} yet: its own run in 3.2 fills this cell` : undefined}>
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
                columns (separate from the AI scores), so Step&nbsp;4 and Step&nbsp;5 can compare the two. As in 3.2, an
                upload only fills ideas with no evaluator rating yet — existing ones are never overwritten.
              </div>
              <div className={styles.row} style={{ marginBottom: 8 }}>
                <button className="btn-primary" onClick={() => evalScoreFileRef.current?.click()}>Load evaluator scores file</button>
                <input ref={evalScoreFileRef} type="file" accept=".xlsx,.xls" className={styles.fileInput} onChange={onPickEvalScores} />
                <span className={styles.kpiPill}>{extScoredCount} of {effectiveRows.length} ideas rated</span>
              </div>
              {evalLoadMsg && <p className={styles.loadMsg}>{evalLoadMsg}</p>}

              {/* Download the UPDATED consolidated workbook: the same multi-tab
                  idea_analytics_aggregate.xlsx as Step 2, but with the KPIs added here
                  (AI / empirical / evaluator / uploaded like Prototypicality) merged into
                  the Rankings tab by Idea ID. This file is the input to the next stages. */}
              <div className={styles.row} style={{ marginTop: 18, alignItems: 'center', gap: 10 }}>
                <button className="btn-primary" onClick={downloadAggregate} disabled={aggregating || !effectiveRows.length}>
                  {aggregating ? <><span className={styles.spinner} /> Building…</> : 'Download Excel'}
                </button>
                <span className={styles.hint} style={{ margin: 0 }}>
                  Downloads the updated <strong>idea_analytics_aggregate.xlsx</strong> — every tab from Step&nbsp;2
                  plus the KPIs added here, merged into the <em>Rankings</em> tab by Idea&nbsp;ID.
                </span>
              </div>
              {(() => {
                // Show exactly which KPI columns will be written into the Rankings tab,
                // so the admin can confirm (before downloading) that every KPI they loaded
                // — AI, empirical and any uploaded extra like Prototypicality — is included.
                // Exactly the columns downloadAggregate writes, in its order: the
                // empirical KPIs first, then each AI model, then the evaluators.
                const labels = exportKpiColumns(rows, { allEmpirical: true, evaluatorColumns: true }).map(k => k.label)
                return (
                  <p className={styles.hint} style={{ marginTop: 8, marginBottom: 0 }}>
                    {labels.length
                      ? <>The <em>Rankings</em> tab will carry these KPIs, in this order (matched by Idea&nbsp;ID): <strong>{labels.join(', ')}</strong>. Columns not computed yet stay in the tab, empty.</>
                      : <>No KPIs loaded yet — compute/score/upload them above, then download.</>}
                  </p>
                )
              })()}
            </>
          )}
        </section>

        {/* STEP 4 — Summary statistics of the consolidated data */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>4</span>Summary Statistics</span>
            <span className={styles.row}>
              <span className={styles.kpiPill}>KPIs: Empirical · AI · Evaluator (per source)</span>
              <button className={`btn-ghost ${styles.miniBtn}`} onClick={() => sec4FileRef.current?.click()} disabled={!!scoring}>Upload data</button>
              <input ref={sec4FileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={e => onPickFile(e, true)} />
              {rows.length > 0 && (
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearSection1} disabled={!!scoring}>Clear</button>
              )}
            </span>
          </h2>
          <p className={styles.hint}>
            Descriptive statistics of the consolidated dataset from Step&nbsp;3 — counts by condition and
            stage, and <strong>every available KPI's</strong> mean (SD) per condition (AI, evaluator, empirical
            and any uploaded KPI). Optionally restrict to ideas that carry at least one KPI. You can also
            <strong> Upload data</strong> here to skip Steps 1–3 and chart a file directly (e.g. an
            <em> idea_analytics_aggregate</em> / <em>ideas_with_kpis</em> workbook); it stays loaded until you
            press <em>Clear</em>.
          </p>

          {effectiveRows.length === 0 ? (
            <p className={styles.emptyNote}>Load or score ideas above — or <strong>Upload data</strong> here — to see summary statistics.</p>
          ) : (
            <>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={statsOnlyScored} onChange={e => setStatsOnlyScored(e.target.checked)} />
                <span>Only include ideas that carry at least one KPI (any source — AI, evaluator, empirical or uploaded)</span>
              </label>
              {panelNote(statRows)}

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
            <span className={styles.kpiPill}>KPIs: Empirical · AI · Evaluator (per source)</span>
          </h2>
          <p className={styles.hint}>
            Both tabs run the <em>same</em> analysis (after any removed participants) on the
            {' '}<strong>scope you pick below</strong>: one linear regression per KPI across the four
            conditions (<em>None</em> = no-AI baseline; Tables 3–6 in the paper's layout), the planned
            {' '}<em>Solo</em> vs <em>Group</em> contrast, a best→worst ranking, and plots. <strong>Table&nbsp;7</strong> repeats
            {' '}Table&nbsp;4 with each idea&apos;s length held fixed (log of 1&nbsp;+&nbsp;word count), because longer ideas score
            {' '}higher on most KPIs, text measures and raters alike; a line after it names any condition effect that
            {' '}appears or disappears once length is held fixed, so you can tell a real effect from wordiness. Tables
            {' '}3–6 do not change. The conditions are
            {' '}<strong>unbalanced</strong> (different n per condition), so every model uses
            {' '}<strong>HC3 heteroscedasticity-robust standard errors</strong>, a condition with fewer than 2
            ideas for a KPI is dropped from that KPI's model, and each condition's n is printed. Edit
            the code and press Run — Python runs via Pyodide and R via WebR, both compiled in your browser
            (first run downloads the runtime, ~10–30&nbsp;s).
          </p>

          <label className={styles.checkRow}>
            <input type="checkbox" checked={regScope === 'group'}
              onChange={e => setRegScope(e.target.checked ? 'group' : 'final')} disabled={running} />
            <span>
              Run on <strong>all ideas that entered the group phase</strong> — group-stage ideas plus the
              individual ideas each participant carried forward (ignores which ideas the group voted for;
              excludes only individual ideas a participant didn't select). Unticked = only the group-voted
              {' '}<strong>Final&nbsp;Ideas</strong> (Final&nbsp;Group&nbsp;Pick&nbsp;=&nbsp;1).
            </span>
            <span className={styles.kpiPill}>{regScope === 'group' ? `${groupPhaseCount} in group phase` : `${finalCount} final`}</span>
          </label>
          {panelNote(regScopeRows)}
          {regScopedScored < 2 && (
            <p className={styles.hint}>
              <span className={styles.unscored}>Give at least two {regScope === 'group' ? 'ideas that entered the group phase' : 'Final Ideas'} a KPI in Step&nbsp;3 first — via AI&nbsp;(3.2), evaluator upload&nbsp;(3.3) or empirical compute&nbsp;(3.1). Only {regScopedScored} so far.</span>
            </p>
          )}

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
          {staleKpis.length > 0 && (
            <p className={styles.hint}>
              <span className={styles.unscored}>
                This {tab === 'python' ? 'Python' : 'R'} script is an older saved copy and will skip{' '}
                {staleKpis.length === 1 ? 'a KPI' : `${staleKpis.length} KPIs`} your data has: {staleKpis.map(d => d.label).join(', ')}.
                {' '}Press <em>Reset to template</em> to use the current script (it replaces your edited copy), or add
                {' '}{staleKpis.length === 1 ? 'it' : 'them'} to the script&apos;s KPI list yourself.
              </span>
            </p>
          )}

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
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={exportLatex} title="Download the LaTeX (.tex) source of Table 1 + the regression tables — compile with pdflatex for a publication-quality PDF formatted like the paper">⬇ Download LaTeX (.tex)</button>
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

// ── Section 3.1: results of a Compute run ─────────────────────────────────────
// Three small tables: the novelty side's pool KPIs, the novelty × usefulness
// cross-check, and which parts of an idea (who / what / where-when / why / how)
// each condition's ideas spell out. Everything here is per condition, not per idea
// (the per-idea KPIs are columns of the Step-3 table and the downloads).
function ObjectiveKpiResults({ res }) {
  const f2 = x => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2))
  const pct = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : '—')
  const crossRow = (label, c, key) => (
    <tr key={key}>
      <td className={styles.regVar}>{label}</td>
      <td>{c.q.n}</td>
      <td>{f2(c.r)}</td>
      <td>{f2(c.rLen)}</td>
      <td>{pct(c.q.both, c.q.n)}</td>
      <td>{pct(c.q.novelOnly, c.q.n)}</td>
      <td>{pct(c.q.usefulOnly, c.q.n)}</td>
      <td>{pct(c.q.neither, c.q.n)}</td>
    </tr>
  )
  const facetRow = (label, fs, key) => (
    <tr key={key}>
      <td className={styles.regVar}>{label}</td>
      {FACETS.map(f => <td key={f.key}>{fs[f.key] == null ? '—' : `${Math.round(fs[f.key] * 100)}%`}</td>)}
      <td>{fs.notech == null ? '—' : `${Math.round(fs.notech * 100)}%`}</td>
    </tr>
  )
  const tag = c => <span className={`${styles.condTag} ${condClass(c)}`}>{c}</span>
  return (
    <div style={{ marginTop: 8 }}>
      <p className={styles.loadMsg}>
        Computed the novelty side for {res.ideas} idea{res.ideas === 1 ? '' : 's'} against {res.refCount} existing
        product{res.refCount === 1 ? '' : 's'} (R), and the usefulness side against {res.needCount} need{res.needCount === 1 ? '' : 's'} (U).
        {res.unmeasured > 0 && (
          <>{' '}{res.unmeasured} idea{res.unmeasured === 1 ? ' has' : 's have'} fewer than two meaningful words
          {' '}(blank, a single word, only common words, or text in a non-Latin script) and {res.unmeasured === 1 ? 'was' : 'were'} left
          {' '}blank on both sides and kept out of the pools.</>
        )}
      </p>

      <div className={styles.regBlock}>
        <div className={styles.regCap}>
          <strong>Novelty side.</strong> Pool-level KPIs per condition
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.regTable}>
            <thead>
              <tr><th className={styles.regVar}>Condition</th><th>Ideas</th><th>Unique fraction (τ=.80)</th><th>τ=.75</th><th>τ=.85</th><th>Productivity (KPI 2)</th></tr>
            </thead>
            <tbody>
              {res.perCond.map(c => (
                <tr key={c.condition}>
                  <td className={styles.regVar}>{tag(c.condition)}</td>
                  <td>{c.n}</td>
                  <td>{f2(c.uf80)}</td>
                  <td>{f2(c.uf75)}</td>
                  <td>{f2(c.uf85)}</td>
                  <td>{c.productivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.regBlock}>
        <div className={styles.regCap}>
          <strong>Novelty × usefulness.</strong> How the two sides relate
          <span className={styles.regSub}> NoveltyScore (novelty side) against Usefulness score (usefulness side).</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.regTable}>
            <thead>
              <tr><th className={styles.regVar}>Condition</th><th>Ideas</th><th>Correlation r</th><th>r, same length</th><th>Novel and useful</th><th>Novel only</th><th>Useful only</th><th>Neither</th></tr>
            </thead>
            <tbody>
              {res.perCond.map(c => crossRow(tag(c.condition), c, c.condition))}
              {crossRow(<strong>All ideas</strong>, res.overall, 'all')}
            </tbody>
          </table>
        </div>
        <p className={styles.regNote}>
          r is the Pearson correlation between the two scores: below 0 means the more novel ideas tend to be the less
          useful-looking ones, above 0 that they go together. &quot;r, same length&quot; is the same correlation with the
          ideas&apos; length held fixed (log word count), since longer ideas score higher on most text measures. &quot;Novel&quot; and &quot;useful&quot; mean above the median of all
          loaded ideas (NoveltyScore {f2(res.novCut)}, Usefulness score {f2(res.useCut)}), so every condition is judged
          against the same line. &quot;Novel and useful&quot; is the standard definition of a creative idea (Runco &amp; Jaeger 2012).
        </p>
      </div>

      {res.validation && (
        <div className={styles.regBlock}>
          <div className={styles.regCap}>
            <strong>Check against the ratings.</strong> Correlation of each empirical KPI with the scores already loaded
            <span className={styles.regSub}> A usefulness KPI should go with the usefulness ratings more than with the novelty ones, and the reverse for a novelty KPI.</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.regTable}>
              <thead>
                <tr><th className={styles.regVar}>Empirical KPI</th>{res.validation.cols.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {res.validation.rows.map(row => (
                  <tr key={row.label}>
                    <td className={styles.regVar}>{row.label} <span className={styles.kpiMuted}>({row.side} side)</span></td>
                    {row.cells.map((c, i) => <td key={i} title={`n = ${c.n}`}>{f2(c.r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.regNote}>
            Pearson r over the ideas that have both values (hover a cell for n). Expect modest numbers: even GPT-4 agreed
            with human &quot;value&quot; ratings at only about r = .33 (Kern &amp; Chao 2026), and human raters often let novelty
            colour their usefulness scores, so the ratings may correlate with each other more than these KPIs do.
          </p>
        </div>
      )}

      <div className={styles.regBlock}>
        <div className={styles.regCap}>
          <strong>Specificity and workability.</strong> Share of ideas that spell out each part
          <span className={styles.regSub}> The five parts behind the Specificity KPI (Dean et al. 2006), and the share of ideas that name no extra technology from list T (Workability = 1).</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.regTable}>
            <thead>
              <tr><th className={styles.regVar}>Condition</th>{FACETS.map(f => <th key={f.key}>{f.label}</th>)}<th>Needs no extra technology</th></tr>
            </thead>
            <tbody>
              {res.perCond.map(c => facetRow(tag(c.condition), c.facets, c.condition))}
              {facetRow(<strong>All ideas</strong>, res.overall.facets, 'all')}
            </tbody>
          </table>
        </div>
      </div>
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
      <h3 className={styles.kpiName}>Regression tables (Tables {tables.map(t => t.num).filter(n => n != null).join(', ')})</h3>
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
// from the per-idea columns, then the novelty × usefulness cross-check and the
// specificity facet shares. Shared by the standalone 3.1 download and the aggregate.
// The per-condition rows plus one "All ideas" row carrying the pooled cross-check.
const withOverall = res => [
  ...(res?.perCond || []),
  ...(res?.overall ? [{ condition: 'All ideas', n: res.ideas, ...res.overall }] : []),
]
const poolKpiRows = perCond => (perCond || []).map(c => {
  const q = c.q || { n: 0 }
  const share = k => (q.n ? round3(k / q.n) : '')
  const row = {
    Condition: c.condition,
    Ideas: c.n,
    'Unique fraction (τ=.80)': round3(c.uf80),
    'Unique fraction (τ=.75)': round3(c.uf75),
    'Unique fraction (τ=.85)': round3(c.uf85),
    'Productivity (KPI 2)': c.productivity,
    'Novelty x usefulness r': round3(c.r),
    'Novelty x usefulness r (same length)': round3(c.rLen),
    'Share novel and useful': share(q.both),
    'Share novel only': share(q.novelOnly),
    'Share useful only': share(q.usefulOnly),
    'Share neither': share(q.neither),
  }
  for (const f of FACETS) row[`States: ${f.label}`] = round3(c.facets?.[f.key])
  row['Needs no extra technology'] = round3(c.facets?.notech)
  return row
})

// Step-3 table columns: header label + how to read/sort each one. `condition`
// sorts by the canonical None<Solo<Group<Both order, scores numerically (blanks
// last), the rest as text.
const SORT_GETTERS = {
  idea_id: { label: 'Idea ID', get: r => r.idea_id, type: 'str' },
  session: { label: 'Session', get: r => r.session, type: 'str' },
  condition: { label: 'Condition', get: r => CONDITIONS.indexOf(r.condition), type: 'num' },
  phase: { label: 'Phase', get: r => r.phase, type: 'str' },
  final: { label: 'Final', get: r => Number(r.final_pick) || 0, type: 'num' },
  // The KPI columns (empirical, then each AI model's pair, then the evaluators)
  // are not listed here: they come from `tableKpiCols` and sort numerically by
  // their row field.
  idea: { label: 'Idea', get: r => r.text, type: 'str' },
}
const TABLE_COLS = ['idea_id', 'session', 'condition', 'phase', 'final', 'idea']

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

// Mean / SD / n of every KPI with data, per condition — in the page's column order
// (empirical first, then each AI model, then the evaluators).
function summaryByConditionRows(rs) {
  const kpis = exportKpiColumns(rs)
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return CONDITIONS.map(c => {
    const sub = rs.filter(r => r.condition === c)
    if (!sub.length) return null
    const row = { Condition: c, Ideas: sub.length }
    for (const d of kpis) {
      const vals = sub.map(r => num(r[d.key])).filter(v => v != null)
      const n = vals.length
      const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null
      const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
      row[`${d.label} mean`] = round3(mean)
      row[`${d.label} SD`] = round3(sd)
      row[`${d.label} n`] = n
    }
    return row
  }).filter(Boolean)
}

function summaryBySessionRows(rs) {
  const kpis = exportKpiColumns(rs)
  const by = new Map()
  for (const r of rs) {
    if (!by.has(r.session)) by.set(r.session, { session: r.session, condition: r.condition, rows: [] })
    by.get(r.session).rows.push(r)
  }
  const mean = (arr, key) => {
    // Blank ('') cells are missing, not 0 — Number('') is 0 and would skew the mean.
    const v = arr.map(x => x[key]).filter(x => x !== '' && x != null).map(Number).filter(Number.isFinite)
    return v.length ? round3(v.reduce((a, b) => a + b, 0) / v.length) : ''
  }
  return [...by.values()].map(g => {
    const row = { Session: g.session, Condition: g.condition, Ideas: g.rows.length }
    for (const d of kpis) row[`${d.label} mean`] = mean(g.rows, d.key)
    return row
  })
}

// "Usefulness score check" (owner, 2026-09-24: "show me … examples … to understand
// and test it"): for every idea with an empirical Usefulness score, its three parts,
// each part's rank among the ideas in this file (0 = lowest, 1 = highest, ties
// share the average of their places), the mean of the three ranks, and the score
// the page computed. The two last columns agree unless ideas were removed or added
// after the score was computed (the ranks are taken over the ideas in the pool).
// The parts an idea states and the extra technology it names are read again from
// its text, with the technology list T as it is now.
function addUsefulnessCheckSheet(wb, data, techSet) {
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const rows = data.filter(r => num(r.det_usefulness) != null)
  const nf = rows.map(r => num(r.det_need_fit))
  const sp = rows.map(r => num(r.det_specificity))
  const wk = rows.map(r => num(r.det_workability))
  const pn = percentileRanks(nf), ps = percentileRanks(sp), pw = percentileRanks(wk)
  const compiled = compileTerms(String(techSet || '').split('\n').map(t => t.trim()).filter(Boolean))
  // Four decimals, the precision the stored KPIs carry (review, 2026-09-24: at three,
  // a mean and a score that agree to four decimals printed as 0.459 and 0.458).
  const r4 = v => (v == null ? '' : Math.round(v * 10000) / 10000)
  const notes = [
    ['How the empirical Usefulness score is built, idea by idea'],
    [`Each of the three parts is turned into a rank among these ${rows.length} ideas: the lowest gets 0, the highest 1, and ideas with the same value share the average of their places (rank = (average place − 1) / (number of ideas − 1)). The Usefulness score is the mean of the ranks the idea has.`],
    ['Need fit = how close the idea\'s words are to the closest need in the list U. Specificity = the share of five things the idea states (who it is for, what it is, where or when it is used, why it helps, how it works). Workability = 1 / (1 + the number of extra technologies from the list T it needs).'],
    ['The ranks here are taken again from the stored parts, which are rounded to 4 decimals. Where that rounding makes two ideas tie, the mean can differ from the stored score in the last decimal; a larger difference is named in the Note column.'],
    [],
  ]
  const header = [
    'Idea ID', 'Condition', 'Title', 'Need fit', 'Need fit rank (0–1)',
    'Specificity', 'Parts stated', 'Specificity rank (0–1)',
    'Workability', 'Extra technology named', 'Workability rank (0–1)',
    'Mean of the three ranks', 'Usefulness score (as computed)', 'Note',
  ]
  const body = rows.map((r, i) => {
    // The text 3.1 measured: the English version (Step 1b) when there is one.
    const text = measureText(r)
    const facets = specificityFacets(text)
    const stated = facets ? FACETS.filter(f => facets[f.key]).map(f => f.label).join('; ') : ''
    const tech = techTermsIn(text, compiled).join(', ')
    const ranks = [pn[i], ps[i], pw[i]].filter(v => v != null)
    const meanRank = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null
    // The parts and the technology are read from the text NOW; the stored values
    // were computed when 3.1 was last pressed. Say so when the two disagree (an
    // older rule, or a list T edited since), rather than printing a row that
    // contradicts itself.
    const nTech = techTermsIn(text, compiled).length
    const nStated = facets ? FACETS.filter(f => facets[f.key]).length : null
    const stale = []
    if (wk[i] != null && Math.abs(wk[i] - 1 / (1 + nTech)) > 0.001) stale.push('Workability')
    if (sp[i] != null && nStated != null && Math.abs(sp[i] - nStated / FACETS.length) > 0.001) stale.push('Specificity')
    // The mean and the stored score disagree beyond rounding: the pool changed
    // since the score was computed (ideas added or removed).
    const stored = num(r.det_usefulness)
    if (meanRank != null && stored != null && Math.abs(meanRank - stored) > 0.002) stale.push('Usefulness score')
    const note = stale.length
      ? `${stale.join(' and ')} stored from an earlier computation (an older rule, lists edited, or ideas added or removed since); press "Compute empirical KPIs" again to refresh.`
      : ''
    return [
      r.idea_id, r.condition, (hasEnglishVersion(r) && r.title_en) || r.idea_title || String(text).split(': ')[0],
      r4(nf[i]), r4(pn[i]), r4(sp[i]), stated || '(none)', r4(ps[i]),
      r4(wk[i]), tech || '(none)', r4(pw[i]), r4(meanRank), r4(stored), note,
    ]
  })
  const ws = XLSX.utils.aoa_to_sheet([...notes, header, ...body])
  const hr = notes.length
  header.forEach((_, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: hr, c })]
    if (cell) cell.s = { font: { bold: true } }
  })
  const title = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })]
  if (title) title.s = { font: { bold: true } }
  ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 60 }, { wch: 12 }, { wch: 11 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Usefulness score check')
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
