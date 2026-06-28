import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, collection, onSnapshot, getDocs, orderBy, query, where, updateDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { getPhaseSequence } from '../utils/phaseSequence'
import { getRegistration, getSurveyQuestions } from '../data/formDefaults'
import { MODEL_PRICES, USD_TO_EUR, PRICES_AS_OF, replyCostUSD } from '../data/aiPricing'
import * as XLSX from 'xlsx-js-style'
import { exportSessionWorkbook } from '../utils/sessionExport'
import styles from './AdminSession.module.css'

export default function AdminSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [participants, setParticipants] = useState([])
  const [ideas, setIdeas] = useState([])
  const [advancing, setAdvancing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [nudgedId, setNudgedId] = useState(null)
  const [expandedPid, setExpandedPid] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [removeConfirmId, setRemoveConfirmId] = useState(null)
  const [viewGroup, setViewGroup] = useState(null)     // group bucket being watched live
  const [messageTarget, setMessageTarget] = useState(null) // { kind:'group'|'participant', group?, participant? }
  const [messageText, setMessageText] = useState('')
  const [messageSending, setMessageSending] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState(() => new Set()) // group buckets drilled open

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) setSession({ id: snap.id, ...snap.data() })
    })
    return unsub
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'participants'),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  // Live ideas feed, used for the submitted-ideas confirmation summary below.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => setIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  async function advancePhase() {
    if (!session) return
    setAdvancing(true)
    try {
      await httpsCallable(functions, 'advancePhase')({ sessionId })
    } catch (err) {
      console.error('advancePhase error:', err)
    } finally {
      setAdvancing(false)
    }
  }

  // ── Data export ─────────────────────────────────────
  async function exportData() {
    if (exporting) return
    setExporting(true)
    try {
      // The full multi-tab research workbook is built by the shared sessionExport
      // util — also used by the Data Analytics "Aggregate Data" step, so the
      // per-session export and the aggregate always share one identical format.
      await exportSessionWorkbook(session)
    } catch (err) {
      console.error('Export error:', err)
      alert('Export failed. Check the console for details.')
    } finally {
      setExporting(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────

  function formatTimestamp(ts) {
    if (!ts) return ''
    const seconds = ts.seconds || ts._seconds
    if (!seconds) return String(ts)
    return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
  }

  function countVotes(ideaId, participantList) {
    let count = 0
    participantList.forEach(p => {
      if ((p.votedFor || []).includes(ideaId)) count++
    })
    return count
  }

  // Auto-fit column widths AND bold the header row (row 0) of every sheet.
  function autoWidth(ws, rows) {
    if (!rows.length) return
    const keys = Object.keys(rows[0])
    const widths = keys.map(key => {
      const maxContent = Math.max(
        key.length,
        ...rows.map(r => String(r[key] || '').length)
      )
      return { wch: Math.min(maxContent + 2, 50) }
    })
    ws['!cols'] = widths
    // Bold every cell in the header row (needs xlsx-js-style to be written out).
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
      if (cell) cell.s = { ...(cell.s || {}), font: { ...(cell.s && cell.s.font), bold: true } }
    }
  }

  // Timing helpers. Accept a Firestore Timestamp ({seconds}/{_seconds}) or a
  // client epoch-ms number (the pre-join Welcome/Registration marks are stored
  // as ms). toMs normalises both to milliseconds.
  function toMs(v) {
    if (v == null) return null
    if (typeof v === 'number') return v
    if (v.seconds != null) return v.seconds * 1000
    if (v._seconds != null) return v._seconds * 1000
    return null
  }
  function fmtMs(v) {
    const ms = toMs(v)
    return ms == null ? '' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  }
  // Duration in whole seconds between two marks of the SAME clock domain (both
  // client-ms or both server). Blank if either is missing or the order is off.
  function durSec(a, b) {
    const x = toMs(a), y = toMs(b)
    return (x != null && y != null && y >= x) ? Math.round((y - x) / 1000) : ''
  }

  // Strip any HTML/entities from instructor-authored question text so it reads
  // cleanly as an Excel column header.
  function plain(s) {
    return String(s ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (!session) return <div className={styles.loading}>Loading...</div>

  const sequence = getPhaseSequence(session.phaseConfig)
  // A session in the survey phase is already filed under "Completed Sessions"
  // (the admin list buckets both 'survey' and 'done' there) and needs no further
  // phase advancing — a session only reaches 'survey' once every participant has.
  // So the control room presents it as finished: the header badge and timeline
  // read "done", and the advance bar is replaced by the completion note.
  const isCompleted = session.status === 'done' || session.status === 'survey'
  const displayStatus = isCompleted ? 'done' : session.status
  const currentIndex = isCompleted ? sequence.indexOf('done') : sequence.indexOf(session.status)
  const nextPhase = sequence[currentIndex + 1]
  const isLast = !nextPhase || nextPhase === 'done'

  const byStatus = participants.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  // Stable display numbering for groups (G1, G2, ...) and a list sorted by
  // group then anonymous label, so progress reads group-by-group.
  const groupNumbers = {}
  participants.forEach(p => {
    if (p.groupId && !(p.groupId in groupNumbers)) {
      groupNumbers[p.groupId] = Object.keys(groupNumbers).length + 1
    }
  })
  const sortedParticipants = [...participants].sort((a, b) => {
    const ga = a.groupId ? groupNumbers[a.groupId] : 999
    const gb = b.groupId ? groupNumbers[b.groupId] : 999
    if (ga !== gb) return ga - gb
    return (a.anonymousLabel || '').localeCompare(b.anonymousLabel || '', undefined, { numeric: true })
  })

  // Bucket participants by group so the list reads group-by-group (active users
  // per session AND per group). sortedParticipants is already group-ordered.
  const groupsOrdered = []
  const groupBuckets = {}
  sortedParticipants.forEach(p => {
    const key = p.groupId || '_none'
    if (!groupBuckets[key]) {
      groupBuckets[key] = { groupId: p.groupId || null, number: p.groupId ? groupNumbers[p.groupId] : null, members: [] }
      groupsOrdered.push(groupBuckets[key])
    }
    groupBuckets[key].members.push(p)
  })

  const indivActive = session.phaseConfig?.individualPhaseActive !== false
  const groupActive = session.phaseConfig?.groupPhaseActive !== false
  const regLabelById = Object.fromEntries(getRegistration(session).fields.map(f => [f.id, f.label]))

  // Write a nudge timestamp on the participant doc; their phase page shows a
  // "please wrap up" banner until they dismiss it.
  async function nudgeParticipant(participantId) {
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'participants', participantId), {
        nudgedAt: serverTimestamp(),
      })
      setNudgedId(participantId)
      setTimeout(() => setNudgedId(curr => (curr === participantId ? null : curr)), 2500)
    } catch (err) {
      console.error('Nudge error:', err)
    }
  }

  // Remove a participant mid-session (Cloud Function: detaches them from their
  // group, leaves a backfill vacancy for a late joiner). Two-click confirm.
  function askRemove(participantId) {
    setRemoveConfirmId(participantId)
    setTimeout(() => setRemoveConfirmId(curr => (curr === participantId ? null : curr)), 4000)
  }
  async function removeParticipant(participantId) {
    setRemovingId(participantId)
    try {
      await httpsCallable(functions, 'removeParticipant')({ sessionId, participantId })
    } catch (err) {
      console.error('Remove participant error:', err)
      alert('Could not remove participant: ' + (err?.message || 'unknown error'))
    } finally {
      setRemovingId(null)
      setRemoveConfirmId(null)
    }
  }

  // Drill a group bucket open/closed to reveal its participant list.
  function toggleGroup(key) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Open the message composer for either a whole group or a single participant.
  function openMessage(target) {
    setMessageTarget(target)
    setMessageText('')
  }

  // Send a centred message window to the chosen recipient(s): the whole group,
  // or one specific participant (writes `adminMessage` to each recipient's own
  // doc; AdminBroadcast pops it up centered on their screen).
  async function sendMessage() {
    if (!messageTarget || !messageText.trim()) return
    setMessageSending(true)
    const msg = { id: Date.now(), text: messageText.trim(), from: session?.instructorName || null }
    const recipients = messageTarget.kind === 'group'
      ? messageTarget.group.members.filter(m => !m.removed && m.status !== 'removed')
      : [messageTarget.participant]
    try {
      await Promise.all(
        recipients.map(m => updateDoc(doc(db, 'sessions', sessionId, 'participants', m.id), { adminMessage: msg }))
      )
      setMessageTarget(null)
      setMessageText('')
    } catch (err) {
      console.error('Send message error:', err)
      alert('Could not send the message: ' + (err?.message || 'unknown error'))
    } finally {
      setMessageSending(false)
    }
  }

  function getAutoNote() {
    const status = session.status
    if (status === 'waiting') return 'Auto-advances when a group forms'
    if (status === 'individual') return 'Auto-advances when all groups complete'
    if (status === 'group') {
      return session.phaseConfig?.groupPhaseDuration
        ? 'Auto-advances when all votes are in or the timer expires'
        : 'Auto-advances when all members submit their votes'
    }
    return null
  }

  function phaseLabel(phase) {
    if (phase === 'group') return 'group ideation'
    return phase
  }

  const surveyCount = participants.filter(p => p.surveyAnswers).length
  const votedCount = participants.filter(p => p.votesSubmitted || (p.votedFor && p.votedFor.length > 0)).length

  // ── Submitted-ideas summary (individual phase) ────────
  // Confirmation view for the instructor: every idea each participant
  // submitted, grouped by participant, flagging the ones carried to the group.
  const individualIdeas = ideas.filter(i => i.phase === 'individual')
  // Ideas keyed by author id (each list chronological) so the Submitted Ideas
  // panel can be laid out group-by-group and then participant-by-participant,
  // reusing the same group buckets as the live participant list above.
  const ideasByAuthorId = individualIdeas.reduce((acc, i) => {
    ;(acc[i.authorId] = acc[i.authorId] || []).push(i)
    return acc
  }, {})
  Object.values(ideasByAuthorId).forEach(list =>
    list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
  )
  // Any author with no matching current participant (e.g. later removed/deleted)
  // is shown under a trailing bucket so their ideas are never silently dropped.
  const memberIds = new Set(participants.map(p => p.id))
  const orphanAuthorIds = Object.keys(ideasByAuthorId).filter(id => !memberIds.has(id))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/admin')}>{'\u2190'} Back</button>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <span className={styles.slash}>/</span>
          <span className={styles.sessionCode}>{session.code}</span>
        </div>
        <span className={`${styles.statusBadge} ${styles['status_' + displayStatus]}`}>
          {phaseLabel(displayStatus)}
        </span>
      </header>

      <main className={styles.main}>

        {/* Phase timeline */}
        <div className={styles.timelineCard}>
          <div className={styles.timeline}>
            {sequence.map((phase, i) => (
              <div
                key={phase}
                className={[
                  styles.timelineStep,
                  i < currentIndex ? styles.done : '',
                  i === currentIndex ? styles.active : '',
                ].join(' ')}
              >
                <div className={styles.timelineDot} />
                <span className={styles.timelineLabel}>{phaseLabel(phase)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Participant breakdown */}
          <div className="card">
            <h2 className={styles.cardTitle}>Participants <span className={styles.cardCount}>({participants.length})</span></h2>
            {participants.length === 0 ? (
              <p className={styles.emptyNote}>No participants have joined yet.</p>
            ) : (
              <>
                <div className={styles.breakdown}>
                  {Object.entries(byStatus).map(([status, count]) => (
                    <div key={status} className={styles.breakdownRow}>
                      <span className={styles.breakdownStatus}>{status}</span>
                      <span className={styles.breakdownCount}>{count}</span>
                    </div>
                  ))}
                </div>
                <p className={styles.panelHint}>
                  Click a group to see its participants. Reach a single participant
                  or a whole group with a message that pops up centered on their screen.
                </p>
                <div className={styles.participantGroups}>
                  {groupsOrdered.map(g => {
                    const doneIdeas = g.members.filter(m => m.individualComplete).length
                    const doneVotes = g.members.filter(m => m.votesSubmitted).length
                    const gkey = g.groupId || 'none'
                    const groupOpen = expandedGroups.has(gkey)
                    return (
                      <div key={gkey} className={styles.groupBlock}>
                        <div className={styles.groupHeader}>
                          <button
                            className={styles.groupToggle}
                            onClick={() => toggleGroup(gkey)}
                            type="button"
                            aria-expanded={groupOpen}
                          >
                            <span className={styles.gChevron}>{groupOpen ? '▾' : '▸'}</span>
                            <span className={styles.groupName}>
                              {g.number ? `Group ${g.number}` : 'Unassigned'}
                            </span>
                            <span className={styles.groupMeta}>
                              {g.members.length} member{g.members.length === 1 ? '' : 's'}
                              {indivActive && ` · ideas ${doneIdeas}/${g.members.length}`}
                              {groupActive && ` · votes ${doneVotes}/${g.members.length}`}
                            </span>
                          </button>
                          {g.groupId && (
                            <span className={styles.groupActions}>
                              <button
                                className={styles.groupActionBtn}
                                onClick={() => setViewGroup(g)}
                                type="button"
                                title="Watch this group's ideas and chat live"
                              >
                                View
                              </button>
                              <button
                                className={styles.groupActionBtn}
                                onClick={() => openMessage({ kind: 'group', group: g })}
                                type="button"
                                title="Send the whole group a message that pops up centered on their screens"
                              >
                                Message group
                              </button>
                            </span>
                          )}
                        </div>

                        {groupOpen && g.members.map(p => {
                          const canNudge = ['individual', 'group'].includes(p.status)
                          const open = expandedPid === p.id
                          const demoEntries = Object.entries(p.demographics || {})
                            .filter(([, v]) => v !== '' && v != null)
                          return (
                            <div key={p.id} className={styles.participantItem}>
                              <div
                                className={`${styles.participantRow} ${open ? styles.participantRowOpen : ''}`}
                                onClick={() => setExpandedPid(prev => (prev === p.id ? null : p.id))}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter') setExpandedPid(prev => (prev === p.id ? null : p.id)) }}
                              >
                                <span className={styles.pIdentity}>
                                  <span className={styles.pChevron}>{open ? '▾' : '▸'}</span>
                                  {p.anonymousLabel && <span className={styles.pGroupTag}>{p.anonymousLabel}</span>}
                                  <span className={styles.pName}>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                                </span>
                                <span className={styles.pRight}>
                                  {indivActive && (
                                    <span
                                      className={`${styles.pTick} ${p.individualComplete ? styles.pTickOn : ''}`}
                                      title={p.individualComplete ? 'Individual ideas submitted' : 'Individual ideas not submitted yet'}
                                    >
                                      ideas {p.individualComplete ? '✓' : '–'}
                                    </span>
                                  )}
                                  {groupActive && (
                                    <span
                                      className={`${styles.pTick} ${p.votesSubmitted ? styles.pTickOn : ''}`}
                                      title={p.votesSubmitted ? 'Votes submitted' : 'Votes not submitted yet'}
                                    >
                                      votes {p.votesSubmitted ? '✓' : '–'}
                                    </span>
                                  )}
                                  <span className={styles.pStatus}>{participantStageLabel(p)}</span>
                                </span>
                              </div>

                              {open && (
                                <div className={styles.pDetail}>
                                  <DetailRow label="Current stage" value={participantStageLabel(p)} />
                                  <DetailRow label="Email" value={p.email || '—'} />
                                  <DetailRow label="Joined" value={formatTimestamp(p.joinedAt) || '—'} />
                                  {indivActive && <DetailRow label="Individual ideas" value={p.individualComplete ? 'Submitted ✓' : 'Not yet'} />}
                                  {groupActive && <DetailRow label="Group stage" value={p.groupStage || (p.votesSubmitted ? 'voting' : '—')} />}
                                  {groupActive && <DetailRow label="Votes" value={p.votesSubmitted ? `Submitted (${(p.votedFor || []).length})` : `${(p.votedFor || []).length} selected`} />}
                                  <DetailRow label="Survey" value={p.surveyCompletedAt || p.surveyAnswers ? 'Completed ✓' : 'Not yet'} />
                                  {demoEntries.length > 0 && (
                                    <div className={styles.pDetailDemo}>
                                      {demoEntries.map(([k, v]) => (
                                        <DetailRow key={k} label={regLabelById[k] || k} value={String(v)} />
                                      ))}
                                    </div>
                                  )}
                                  <div className={styles.pActions}>
                                    <button
                                      className={styles.msgBtn}
                                      onClick={() => openMessage({ kind: 'participant', participant: p })}
                                      type="button"
                                      title="Send this participant a message that pops up centered on their screen"
                                    >
                                      Message
                                    </button>
                                    {canNudge && (
                                      <button
                                        className={styles.nudgeBtn}
                                        onClick={() => nudgeParticipant(p.id)}
                                        disabled={nudgedId === p.id}
                                        type="button"
                                        title="Show this participant a reminder banner to wrap up and submit"
                                      >
                                        {nudgedId === p.id ? 'Nudged ✓' : 'Nudge'}
                                      </button>
                                    )}
                                    {p.status !== 'removed' && p.status !== 'done' && (
                                      <button
                                        className={`${styles.removeBtn} ${removeConfirmId === p.id ? styles.removeBtnConfirm : ''}`}
                                        onClick={() => removeConfirmId === p.id ? removeParticipant(p.id) : askRemove(p.id)}
                                        disabled={removingId === p.id}
                                        type="button"
                                        title="Remove this participant from the session (frees a slot for a late joiner)"
                                      >
                                        {removingId === p.id ? 'Removing…' : removeConfirmId === p.id ? 'Confirm?' : 'Remove'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Session config summary */}
          <div className="card">
            <h2 className={styles.cardTitle}>Session Config</h2>
            <div className={styles.configList}>
              <ConfigRow label="Individual Phase" value={session.phaseConfig?.individualPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Group Phase" value={session.phaseConfig?.groupPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Phase Order" value={session.phaseConfig?.phaseOrder?.replace('_', ' ') || 'N/A'} />
              <ConfigRow label="Group size" value={session.phaseConfig?.groupSize ?? 'N/A'} />
              <ConfigRow label="Max ideas (individual)" value={session.phaseConfig?.maxIdeasIndividual ?? 'N/A'} />
              <ConfigRow label="Ideas carried to group" value={session.phaseConfig?.ideasCarriedToGroup ?? 'N/A'} />
              <ConfigRow label="Group phase timer" value={session.phaseConfig?.groupPhaseDuration ? `${Math.round(session.phaseConfig.groupPhaseDuration / 60)} min` : 'Manual'} />
              <ConfigRow label="AI (individual)" value={session.aiConfig?.individualAI ? 'On' : 'Off'} />
              <ConfigRow label="AI (group)" value={session.aiConfig?.groupAI ? 'On' : 'Off'} />
            </div>
          </div>
        </div>

        {/* Submitted ideas summary (individual-phase confirmation) */}
        {indivActive && (
          <div className="card" style={{ marginTop: 20 }}>
            <h2 className={styles.cardTitle}>
              Submitted Ideas <span className={styles.cardCount}>({individualIdeas.length})</span>
            </h2>
            <p className={styles.exportSub}>
              Every idea participants submitted in the individual phase, grouped by
              group and then by participant. Ideas carried into the group phase are
              flagged. Use “Message” to nudge a specific participant about their ideas.
            </p>
            {individualIdeas.length === 0 ? (
              <p className={styles.emptyNote}>No ideas submitted yet.</p>
            ) : (
              <div className={styles.ideaGroups}>
                {groupsOrdered.map(g => {
                  const groupIdeaCount = g.members.reduce(
                    (n, m) => n + (ideasByAuthorId[m.id]?.length || 0), 0
                  )
                  return (
                    <div key={g.groupId || 'none'} className={styles.ideaGroupBlock}>
                      <div className={styles.ideaGroupHeader}>
                        <span className={styles.ideaGroupName}>
                          {g.number ? `Group ${g.number}` : 'Unassigned'}
                        </span>
                        <span className={styles.ideaGroupCount}>
                          {groupIdeaCount} idea{groupIdeaCount === 1 ? '' : 's'}
                        </span>
                        {g.groupId && (
                          <button
                            className={styles.msgBtn}
                            style={{ marginLeft: 'auto' }}
                            onClick={() => openMessage({ kind: 'group', group: g })}
                            type="button"
                            title="Message the whole group"
                          >
                            Message group
                          </button>
                        )}
                      </div>
                      {g.members.map(p => {
                        const list = ideasByAuthorId[p.id] || []
                        const canNudge = ['individual', 'group'].includes(p.status)
                        return (
                          <div key={p.id} className={styles.ideaUserBlock}>
                            <div className={styles.ideaUserHeader}>
                              <span className={styles.ideaUserIdentity}>
                                {p.anonymousLabel && <span className={styles.pGroupTag}>{p.anonymousLabel}</span>}
                                <span className={styles.ideaUserName}>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                                <span className={styles.ideaSummaryCount}>
                                  {list.length} idea{list.length === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span className={styles.ideaUserActions}>
                                <button
                                  className={styles.msgBtn}
                                  onClick={() => openMessage({ kind: 'participant', participant: p })}
                                  type="button"
                                  title="Send this participant a message centered on their screen"
                                >
                                  Message
                                </button>
                                {canNudge && (
                                  <button
                                    className={styles.nudgeBtn}
                                    onClick={() => nudgeParticipant(p.id)}
                                    disabled={nudgedId === p.id}
                                    type="button"
                                    title="Show this participant a reminder banner to wrap up"
                                  >
                                    {nudgedId === p.id ? 'Nudged ✓' : 'Nudge'}
                                  </button>
                                )}
                              </span>
                            </div>
                            {list.length === 0 ? (
                              <div className={styles.ideaNone}>No ideas submitted.</div>
                            ) : list.map(idea => (
                              <div key={idea.id} className={styles.ideaSummaryItem}>
                                <div className={styles.ideaSummaryText}>
                                  <span className={styles.ideaSummaryTitle}>{idea.title || idea.text}</span>
                                  {idea.description && (
                                    <span className={styles.ideaSummaryDesc}>{idea.description}</span>
                                  )}
                                </div>
                                {idea.selected && (
                                  <span className={styles.ideaSummaryBadge}>carried to group</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {orphanAuthorIds.length > 0 && (
                  <div className={styles.ideaGroupBlock}>
                    <div className={styles.ideaGroupHeader}>
                      <span className={styles.ideaGroupName}>Former participants</span>
                    </div>
                    {orphanAuthorIds.map(aid => {
                      const list = ideasByAuthorId[aid]
                      return (
                        <div key={aid} className={styles.ideaUserBlock}>
                          <div className={styles.ideaUserHeader}>
                            <span className={styles.ideaUserIdentity}>
                              <span className={styles.ideaUserName}>{list[0]?.authorName || aid.slice(0, 6)}</span>
                              <span className={styles.ideaSummaryCount}>
                                {list.length} idea{list.length === 1 ? '' : 's'}
                              </span>
                            </span>
                          </div>
                          {list.map(idea => (
                            <div key={idea.id} className={styles.ideaSummaryItem}>
                              <div className={styles.ideaSummaryText}>
                                <span className={styles.ideaSummaryTitle}>{idea.title || idea.text}</span>
                                {idea.description && (
                                  <span className={styles.ideaSummaryDesc}>{idea.description}</span>
                                )}
                              </div>
                              {idea.selected && (
                                <span className={styles.ideaSummaryBadge}>carried to group</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data & Export */}
        <div className={styles.exportCard}>
          <div className={styles.exportHeader}>
            <div>
              <h2 className={styles.cardTitle}>Data &amp; Export</h2>
              <p className={styles.exportSub}>
                Download all session data as an Excel file with separate sheets for
                participants, ideas, survey responses, timing, group chat, AI chat, and groups.
              </p>
            </div>
            <button
              className={styles.exportBtn}
              onClick={exportData}
              disabled={exporting || participants.length === 0}
            >
              {exporting ? 'Exporting...' : 'Download Excel'}
            </button>
          </div>
          <div className={styles.exportStats}>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{participants.length}</span>
              <span className={styles.statLabel}>Participants</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{votedCount}</span>
              <span className={styles.statLabel}>Voted</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{surveyCount}</span>
              <span className={styles.statLabel}>Surveys</span>
            </div>
          </div>
        </div>

        {/* Advance control */}
        {!isCompleted && (
          <div className={styles.advanceBar}>
            <div className={styles.advanceInfo}>
              <span className={styles.advanceLabel}>Current phase:</span>
              <strong>{phaseLabel(session.status)}</strong>
              {nextPhase && (
                <>
                  <span className={styles.advanceArrow}>{'\u2192'}</span>
                  <span className={styles.advanceNext}>{phaseLabel(nextPhase)}</span>
                </>
              )}
            </div>
            <div className={styles.advanceRight}>
              {getAutoNote() && (
                <span className={styles.autoNote}>{getAutoNote()}</span>
              )}
              <button
                className="btn-primary"
                onClick={advancePhase}
                disabled={advancing || isLast}
              >
                {advancing ? 'Advancing...' : isLast ? 'Session Complete' : `Force advance \u2192 ${phaseLabel(nextPhase)}`}
              </button>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className={styles.doneBar}>
            {session.status === 'done'
              ? 'Session complete. All participants have finished.'
              : (() => {
                  const inSurvey = participants.filter(p => p.status === 'survey').length
                  const finished = participants.filter(p => p.status === 'done').length
                  return inSurvey > 0
                    ? `Session complete and read-only. ${finished} of ${participants.length} finished the survey; ${inSurvey} still had it open.`
                    : 'Session complete. All participants have finished.'
                })()}
          </div>
        )}
      </main>

      {viewGroup && (
        <GroupViewModal
          sessionId={sessionId}
          group={viewGroup}
          onClose={() => setViewGroup(null)}
        />
      )}

      {messageTarget && (
        <div className={styles.modalBackdrop} onClick={() => !messageSending && setMessageTarget(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>
              {messageTarget.kind === 'group'
                ? `Message ${messageTarget.group.number ? `Group ${messageTarget.group.number}` : 'group'}`
                : `Message ${messageTarget.participant.anonymousLabel || messageTarget.participant.name || 'participant'}`}
            </h3>
            <p className={styles.modalSub}>
              {messageTarget.kind === 'group'
                ? "Pops up as a window in the centre of every member's screen."
                : "Pops up as a window in the centre of this participant's screen."}
            </p>
            <textarea
              className={`input-field ${styles.modalTextarea}`}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="e.g. Please wrap up your individual ideas — about 2 minutes left."
              rows={4}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className="btn-ghost" onClick={() => setMessageTarget(null)} disabled={messageSending} type="button">
                Cancel
              </button>
              <button className="btn-primary" onClick={sendMessage} disabled={messageSending || !messageText.trim()} type="button">
                {messageSending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * GroupViewModal — a read-only live window into one group while they play:
 * each member's current stage, the group's ideas, and the group chat.
 */
function GroupViewModal({ sessionId, group, onClose }) {
  const [messages, setMessages] = useState([])
  const [ideas, setIdeas] = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'groups', group.groupId, 'messages'), orderBy('createdAt', 'asc')),
      snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [sessionId, group.groupId])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'ideas'), where('groupId', '==', group.groupId)),
      snap => setIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [sessionId, group.groupId])

  const ideasSorted = [...ideas].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={`${styles.modalCard} ${styles.viewCard}`} onClick={e => e.stopPropagation()}>
        <div className={styles.viewHead}>
          <h3 className={styles.modalTitle}>{group.number ? `Group ${group.number}` : 'Group'} — live view</h3>
          <button className={styles.closeX} onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
        <div className={styles.viewMembers}>
          {group.members.map(m => (
            <span key={m.id} className={styles.viewMemberChip}>
              {m.anonymousLabel || m.id.slice(0, 5)} · {participantStageLabel(m)}
            </span>
          ))}
        </div>
        <div className={styles.viewCols}>
          <div className={styles.viewCol}>
            <div className={styles.viewColLabel}>Ideas ({ideasSorted.length})</div>
            <div className={styles.viewScroll}>
              {ideasSorted.length === 0 && <div className={styles.viewEmpty}>No ideas yet.</div>}
              {ideasSorted.map(i => (
                <div key={i.id} className={styles.viewIdea}>
                  <div className={styles.viewIdeaTitle}>
                    {i.title || i.text || 'Untitled'}
                    <span className={styles.viewIdeaTag}>{i.phase === 'group' ? 'group' : 'individual'}</span>
                  </div>
                  {i.description && <div className={styles.viewIdeaDesc}>{i.description}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.viewCol}>
            <div className={styles.viewColLabel}>Group chat ({messages.length})</div>
            <div className={styles.viewScroll}>
              {messages.length === 0 && <div className={styles.viewEmpty}>No messages yet.</div>}
              {messages.map(msg => (
                <div key={msg.id} className={styles.viewMsg}>
                  <span className={styles.viewMsgWho}>{msg.authorLabel || 'p?'}</span>
                  <span className={styles.viewMsgText}>{msg.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className={styles.viewNote}>Read-only — use “Message” to send the group a note.</p>
      </div>
    </div>
  )
}

function ConfigRow({ label, value }) {
  return (
    <div className={styles.configRow}>
      <span className={styles.configLabel}>{label}</span>
      <strong className={styles.configValue}>{String(value)}</strong>
    </div>
  )
}

const PARTICIPANT_STAGE_LABELS = {
  waiting: 'waiting in lobby',
  waiting_for_group: 'individual submitted — waiting for group',
  individual: 'individual phase',
  group: 'group phase',
  voting: 'group voting',
  survey: 'survey',
  done: 'finished',
}
// Fine-grained "exactly where is this participant" label. Distinguishes the
// instructions screen (before they press Start) from the active workspace,
// using the per-participant signals individualStartedAt / groupStage.
function participantStageLabel(p) {
  const status = typeof p === 'string' ? p : p?.status
  if (typeof p === 'object' && p) {
    if (status === 'individual') {
      return p.individualStartedAt
        ? 'individual — writing ideas'
        : 'individual — reading instructions'
    }
    if (status === 'group') {
      if (p.votesSubmitted) return 'group — votes submitted'
      if (p.groupStage === 'voting') return 'group — voting'
      if (p.groupStage === 'ideation') return 'group — ideation'
      return 'group — reading instructions'
    }
  }
  return PARTICIPANT_STAGE_LABELS[status] || status || 'unknown'
}

function DetailRow({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  )
}