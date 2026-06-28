import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, getDocs } from 'firebase/firestore'
import * as XLSX from 'xlsx-js-style'
import { auth, db } from '../firebase'
import { useTheme } from '../context/ThemeContext'
import {
  CONDITIONS, KPIS, conditionForSession, buildRowsForSession,
  recomputeOverall, rowsToCsv, csvToRows, normalizeImportedRows, ideaText, summarize,
} from '../utils/analyticsData'
import { scoreIdeas, fetchAISettings, resolveProvider } from '../utils/llmClient'
import { PYTHON_TEMPLATE, R_TEMPLATE } from '../data/analyticsTemplates'
import { runPython } from '../utils/pyodideRunner'
import { runR } from '../utils/webrRunner'
import styles from './DataAnalytics.module.css'

const DESIGN_BRIEF = 'Designing a new product to improve sleep wellness.'
const condClass = cond => styles[`cond${Math.max(0, CONDITIONS.indexOf(cond))}`]

export default function DataAnalytics() {
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [rows, setRows] = useState([])

  const [aiInfo, setAiInfo] = useState(null) // { provider, model, hasKey }
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

  const fileRef = useRef(null)
  const outRef = useRef('')
  const flushQueued = useRef(false)

  // ── Load session list + AI settings on mount ──
  useEffect(() => { refreshSessions() }, [])
  useEffect(() => {
    fetchAISettings()
      .then(s => {
        const r = resolveProvider(s)
        setAiInfo({ provider: r.provider, model: r.model, hasKey: !!r.apiKey })
      })
      .catch(() => setAiInfo({ provider: 'claude', model: '', hasKey: false }))
  }, [])

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
      setRows(prev => recomputeOverall(replace ? collected : [...prev, ...collected]))
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
          const ws = wb.Sheets[wb.SheetNames[0]]
          imported = normalizeImportedRows(XLSX.utils.sheet_to_json(ws, { defval: '' }))
        }
        if (!imported.length) { alert('No rows found in that file.'); return }
        setRows(prev => recomputeOverall([...prev, ...imported]))
      } catch (err) {
        alert('Could not parse file: ' + (err.message || err))
      }
    }
    if (/\.csv$/i.test(file.name)) reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
    e.target.value = '' // allow re-importing the same file
  }

  // ── Score the unscored ideas with the configured LLM ──
  async function scoreUnscored() {
    setScoreErr('')
    const idx = rows.map((r, i) => i).filter(i => rows[i].novelty === '' || rows[i].usefulness === '')
    if (!idx.length) { setScoreErr('All rows already have novelty and usefulness scores.'); return }
    // Capture each target's id alongside its index so we can verify on write-back
    // that the row hasn't shifted underneath us (data-source buttons are also
    // disabled while scoring, so this is belt-and-suspenders).
    const targets = idx.map(i => ({ at: i, id: rows[i].idea_id, text: rows[i].text || ideaText(rows[i]) }))
    setScoring({ done: 0, total: targets.length })
    try {
      const scores = await scoreIdeas(targets.map(t => t.text), {
        brief: DESIGN_BRIEF,
        onProgress: ({ done, total }) => setScoring({ done, total }),
      })
      setRows(prev => {
        const next = prev.slice()
        targets.forEach((t, k) => {
          const sc = scores[k]
          if (sc && next[t.at] && next[t.at].idea_id === t.id) {
            next[t.at] = { ...next[t.at], novelty: sc.novelty, usefulness: sc.usefulness }
          }
        })
        return recomputeOverall(next)
      })
    } catch (err) {
      setScoreErr(err.message || String(err))
    } finally {
      setScoring(null)
    }
  }

  function updateScore(rowIndex, field, value) {
    setRows(prev => {
      const next = prev.slice()
      const v = value === '' ? '' : Math.max(1, Math.min(7, Number(value)))
      next[rowIndex] = { ...next[rowIndex], [field]: Number.isNaN(v) ? '' : v }
      return recomputeOverall(next)
    })
  }

  function downloadCsv() {
    const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'idea_analytics_dataset.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearData() {
    if (rows.length && !confirm('Clear the loaded dataset?')) return
    setRows([])
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
    const scored = rows.filter(r => r.novelty !== '' && r.usefulness !== '')
    if (scored.length < 2) {
      setRunError('Need at least a couple of scored ideas. Load a session and score the ideas first (or import a file with scores).')
      return
    }
    setRunning(true)
    setRunError(null)
    setImages([])
    outRef.current = ''
    setOutput('')
    const dataCsv = rowsToCsv(rows)
    try {
      const opts = { dataCsv, onStatus: setRunStatus }
      const result = tab === 'python'
        ? await runPython(pyCode, { ...opts, onStdout: pushLine })
        : await runR(rCode, { ...opts, onOutput: pushLine })
      setOutput(outRef.current || (tab === 'python' ? result.stdout : result.output) || '')
      setImages(result.images || [])
      if (!result.ok) setRunError(result.error || 'Run failed.')
    } catch (err) {
      setRunError(err.message || String(err))
    } finally {
      setRunStatus('')
      setRunning(false)
    }
  }

  const stats = useMemo(() => summarize(rows), [rows])
  const scoredCount = rows.filter(r => r.novelty !== '' && r.usefulness !== '').length
  const code = tab === 'python' ? pyCode : rCode
  const setCode = tab === 'python' ? setPyCode : setRCode
  const resetCode = () => (tab === 'python' ? setPyCode(PYTHON_TEMPLATE) : setRCode(R_TEMPLATE))

  return (
    <div className={styles.pageWrap}>
      <header className={styles.topBar}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <div className={styles.topBarRight}>
          <span className={styles.role}>Instructor</span>
          <button className={styles.themeBtn} onClick={toggle} title="Toggle dark mode">{dark ? '☀' : '☾'}</button>
          <button className="btn-ghost" onClick={() => navigate('/admin')}>{'←'} Back to Admin</button>
          <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Data Analytics</h1>
          <p className={styles.sub}>
            Pull ideas from any session, score each idea on the three KPIs (novelty, usefulness,
            overall quality), then run the bundled regressions — in Python or R, compiled right
            here in your browser — to see which of the four AI-timing conditions performs best,
            with p-values and plots. The four conditions are read automatically from each session's
            AI configuration.
          </p>
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
            Tick the completed or active sessions to include. Each session's condition is derived
            from its AI settings: no AI = <em>Human-Only Hybrid</em>, AI in the solo stage =
            <em> Individual + AI</em>, AI in the group stage = <em>Group + AI</em>, AI in both =
            <em> Full AI</em>. You can also import an Excel/CSV file of ideas (with or without scores).
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
        </section>

        {/* STEP 2 — KPI scoring + dataset */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span><span className={styles.stepBadge}>2</span>Score ideas &amp; review data</span>
            {rows.length > 0 && (
              <span className={styles.row}>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={downloadCsv}>Download CSV</button>
                <button className={`btn-ghost ${styles.miniBtn}`} onClick={clearData} disabled={!!scoring}>Clear</button>
              </span>
            )}
          </h2>

          {rows.length === 0 ? (
            <p className={styles.emptyNote}>Load a session or import a file above to build the dataset.</p>
          ) : (
            <>
              <div className={styles.stats}>
                <div className={styles.statBox}><div className={styles.statNum}>{rows.length}</div><div className={styles.statLabel}>Ideas</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{scoredCount}</div><div className={styles.statLabel}>Scored</div></div>
                <div className={styles.statBox}><div className={styles.statNum}>{rows.length - scoredCount}</div><div className={styles.statLabel}>Unscored</div></div>
                {CONDITIONS.map(c => (
                  <div className={styles.statBox} key={c}>
                    <div className={styles.statNum}>{stats[c]?.count || 0}</div>
                    <div className={styles.statLabel}>{c}</div>
                  </div>
                ))}
              </div>

              <div className={styles.banner}>
                <strong>Extend the data — score each idea per KPI.</strong> The configured AI rater scores
                every idea on novelty and usefulness (1–7); overall quality is their mean. Provider:{' '}
                <strong>{aiInfo ? aiInfo.provider : '…'}</strong>{aiInfo?.model ? ` (${aiInfo.model})` : ''}
                {aiInfo && !aiInfo.hasKey && <span className={styles.unscored}> — no API key saved; add one under AI Settings, or enter scores by hand / import them.</span>}
                . You can also edit any score directly in the table.
              </div>

              <div className={styles.row} style={{ marginBottom: 12 }}>
                <button className="btn-primary" onClick={scoreUnscored} disabled={!!scoring || (rows.length - scoredCount) === 0}>
                  {scoring ? `Scoring ${scoring.done}/${scoring.total}…` : `Score ${rows.length - scoredCount} unscored idea${(rows.length - scoredCount) === 1 ? '' : 's'} with AI`}
                </button>
                {scoring && <span className={styles.statusLine}><span className={styles.spinner} /> contacting {aiInfo?.provider}…</span>}
              </div>
              {scoring && (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${Math.round((scoring.done / scoring.total) * 100)}%` }} />
                </div>
              )}
              {scoreErr && <p className="error-msg">{scoreErr}</p>}

              <div className={styles.tableWrap} style={{ marginTop: 14 }}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Session</th><th>Condition</th><th>Phase</th>
                      <th>Novelty</th><th>Usefulness</th><th>Overall</th><th>Idea</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.idea_id + '_' + i}>
                        <td>{r.session}</td>
                        <td><span className={`${styles.condTag} ${condClass(r.condition)}`}>{r.condition}</span></td>
                        <td>{r.phase}</td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="7" step="0.5"
                            value={r.novelty} onChange={e => updateScore(i, 'novelty', e.target.value)} />
                        </td>
                        <td className="num">
                          <input className={styles.scoreInput} type="number" min="1" max="7" step="0.5"
                            value={r.usefulness} onChange={e => updateScore(i, 'usefulness', e.target.value)} />
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
            Both tabs run the <em>same</em> analysis on your scored dataset: one linear regression per KPI
            across the four conditions (Human-Only Hybrid = baseline), the planned Individual + AI vs
            Group + AI contrast, a best→worst ranking, and plots. Edit the code and press Run — Python runs
            via Pyodide and R via WebR, both compiled in your browser (first run downloads the runtime, ~10–30&nbsp;s).
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
      </div>
    </div>
  )
}
