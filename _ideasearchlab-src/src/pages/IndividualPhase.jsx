import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession, useSessionEnded, useAIModelLabel } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import NudgeBanner from '../components/NudgeBanner'
import { getContent } from '../data/defaultContent'
import RichText from '../components/RichText'
import { Done } from './Survey'
import styles from './IndividualPhase.module.css'

// Deterministic pseudo-random pick, stable across renders for the same ideas.
// Used to select ideas "on behalf of" a participant who chose none.
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}
function pickRandomStable(arr, n) {
  return [...arr].sort((a, b) => hashStr(a.id) - hashStr(b.id)).slice(0, n)
}

export default function IndividualPhase() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { session } = useSession()
  const ended = useSessionEnded()
  const aiModel = useAIModelLabel()

  const [ideas, setIdeas] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [groupMembers, setGroupMembers] = useState([])
  const [groupId, setGroupId] = useState(null)
  const [started, setStarted] = useState(false)
  const [individualStartedAt, setIndividualStartedAt] = useState(null)
  const individualOpenedWrittenRef = useRef(false)
  const [briefOpen, setBriefOpen] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const pc = session?.phaseConfig || {}
  const maxIdeas = pc.maxIdeasIndividual || 5
  const aiEnabled = session?.aiConfig?.individualAI
  const durationMinutes = pc.individualPhaseDuration
    ? Math.round(pc.individualPhaseDuration / 60)
    : 10
  const ideasCarried = pc.ideasCarriedToGroup || 3
  const groupPhaseActive = pc.groupPhaseActive !== false
  const c = getContent(session).individual
  // Shared placeholder values so {minutes}, {maxIdeas} and {ideasCarried} all
  // resolve on both the instructions screen and the workspace task brief.
  const contentVars = { minutes: durationMinutes, maxIdeas, ideasCarried, aiModel }

  useEffect(() => {
    if (!sessionId || !user) return
    const q = query(
      collection(db, 'sessions', sessionId, 'ideas'),
      where('authorId', '==', user.uid),
      where('phase', '==', 'individual'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setIdeas(list)
      const sel = new Set()
      list.forEach(idea => { if (idea.selected) sel.add(idea.id) })
      setSelectedIds(prev => prev.size === 0 && sel.size > 0 ? sel : prev)
    })
    return unsub
  }, [sessionId, user])

  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        setIndividualStartedAt(data.individualStartedAt || null)
        // Timing: record when this participant first entered the individual
        // phase (the instructions screen), once. individualStartedAt (Start) −
        // individualOpenedAt = how long they read the instructions.
        if (!data.timing?.individualOpenedAt && !individualOpenedWrittenRef.current) {
          individualOpenedWrittenRef.current = true
          updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid),
            { 'timing.individualOpenedAt': serverTimestamp() }).catch(() => {})
        }
        // Resume the workspace (skip the instructions screen) if this
        // participant already pressed Start in an earlier visit, so a reload
        // doesn't reset their place or restart their timer.
        if (data.individualStartedAt) setStarted(true)
        const status = data.status
        if (status === 'group') navigate(`/session/${sessionId}/group`)
        else if (status === 'survey') navigate(`/session/${sessionId}/survey`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      query(
        collection(db, 'sessions', sessionId, 'participants'),
        where('groupId', '==', groupId)
      ),
      snap => setGroupMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId, groupId])

  async function submitIdea(e) {
    e.preventDefault()
    const t = title.trim()
    const d = description.trim()
    if (!t || !d || submitting || ideas.length >= maxIdeas) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'individual',
        groupId: null,
        votes: 0,
        selected: false,
        createdAt: serverTimestamp(),
      })
      setTitle('')
      setDescription('')
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  function toggleSelect(ideaId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else {
        if (next.size >= ideasCarried) return prev
        next.add(ideaId)
      }
      return next
    })
  }

  function startEdit(idea) {
    setEditingId(idea.id)
    setEditTitle(idea.title || '')
    setEditDesc(idea.description || '')
  }

  async function saveEdit(ideaId) {
    const t = editTitle.trim()
    const d = editDesc.trim()
    if (!t || !d) return
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'ideas', ideaId), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
      })
    } catch (err) {
      console.error(err)
    }
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null) }

  async function deleteIdea(ideaId) {
    try {
      await deleteDoc(doc(db, 'sessions', sessionId, 'ideas', ideaId))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(ideaId)
        return next
      })
    } catch (err) {
      console.error(err)
    }
  }

  async function markDone(selectionOverride) {
    if (done) return
    setDone(true)
    const selection = selectionOverride instanceof Set ? selectionOverride : selectedIds
    try {
      // 1. Mark participant as done (critical, should always succeed)
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { individualComplete: true, status: 'waiting_for_group' }
      )

      // 2. Try to mark selected ideas in Firestore (non-critical)
      //    Requires update rules on ideas subcollection.
      try {
        const batch = writeBatch(db)
        ideas.forEach(idea => {
          const ref = doc(db, 'sessions', sessionId, 'ideas', idea.id)
          batch.update(ref, { selected: selection.has(idea.id) })
        })
        await batch.commit()
      } catch (ideaErr) {
        console.warn('Could not update idea selection flags:', ideaErr.message)
      }
    } catch (err) {
      console.error('Failed to submit:', err)
      setDone(false)
    }
  }

  // Default decision when the phase timer expires: submit whatever exists.
  // If the participant selected nothing (e.g. inactive), the system selects on
  // their behalf, choosing a random subset of their ideas so they still carry
  // work into the group phase and never stall the rest of their group.
  function autoFinish() {
    if (done) return
    let selection = selectedIds
    if (groupPhaseActive && selection.size === 0 && ideas.length > 0) {
      const picked = pickRandomStable(ideas, ideasCarried)
      selection = new Set(picked.map(i => i.id))
      setSelectedIds(selection)
    }
    markDone(selection)
  }

  // Automatic nudge: this participant is the bottleneck — every other group
  // member has submitted and the group is waiting on them.
  const otherMembers = groupMembers.filter(m => m.id !== user?.uid)
  const autoNudgeMessage =
    !done && groupPhaseActive && otherMembers.length > 0 && otherMembers.every(m => m.individualComplete)
      ? 'everyone else in your group has submitted their ideas. Please wrap up and click Finish & Submit.'
      : null

  // Begin the individual phase for THIS participant. The countdown is
  // per-participant: it starts now (individualStartedAt), not when the shared
  // phase began — so everyone gets the full duration from when they actually
  // start. Written once; a rejoin/reload restores the workspace via the
  // participant snapshot above instead of restarting the timer.
  async function handleStart() {
    setStarted(true)
    if (individualStartedAt) return
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { individualStartedAt: serverTimestamp() }
      )
    } catch (err) {
      console.warn('Could not record individual start time:', err.message)
    }
  }

  // Instructor closed (status 'done') or deleted the session: show the same
  // end message participants see when they finish, instead of stranding them.
  if (ended) {
    return <Done />
  }

  // ─── Instructions view ───
  // The timer is shown in a non-ticking preview here (full duration). It only
  // starts counting once the participant presses Start (see handleStart).
  if (!started) {
    return (
      <div className={styles.instrPage}>
        <header className={styles.instrHeader}>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <div className={styles.instrTimer}>
            <PhaseTimer
              durationSeconds={pc.individualPhaseDuration}
              preview
            />
          </div>
        </header>
        <div className={styles.instrContainer}>
          <NudgeBanner sessionId={sessionId} autoMessage={autoNudgeMessage} />
          <div className={styles.instrCard}>
            <div className={styles.instrBody}>
              <RichText html={c.instructions} vars={contentVars} aiOn={!!aiEnabled} />
            </div>
            <button className={`btn-primary ${styles.startBtn}`} onClick={handleStart}>
              Start
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Submission confirmation view ───
  // After Finish & Submit, show a dedicated page summarising every idea that
  // was submitted (and which ones carry into the group phase) while the
  // participant waits for the instructor to advance the session.
  if (done) {
    const submitted = [...ideas].sort(
      (a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    )
    const carried = submitted.filter(i => selectedIds.has(i.id))
    const groupSize = session?.phaseConfig?.groupSize ?? 3
    const firestoreCount = groupMembers.filter(m => m.individualComplete).length
    const selfCounted = groupMembers.some(m => m.id === user?.uid && m.individualComplete)
    const doneCount = !selfCounted ? firestoreCount + 1 : firestoreCount
    return (
      <div className={styles.instrPage}>
        <header className={styles.instrHeader}>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <div className={styles.instrTimer}>
            <PhaseTimer
              phaseStartedAt={individualStartedAt}
              durationSeconds={pc.individualPhaseDuration}
            />
          </div>
        </header>
        <div className={styles.confirmContainer}>
          <div className={styles.confirmCard}>
            <div className={styles.confirmCheck}>{'✓'}</div>
            <h1 className={styles.confirmTitle}>Your ideas are submitted</h1>
            <p className={styles.confirmSub}>
              You submitted {submitted.length} idea{submitted.length === 1 ? '' : 's'}.
              {groupPhaseActive && carried.length > 0 &&
                ` ${carried.length} selected to carry into the group phase.`}
            </p>

            <div className={styles.confirmList}>
              {submitted.map(idea => {
                const sel = selectedIds.has(idea.id)
                return (
                  <div
                    key={idea.id}
                    className={`${styles.confirmItem} ${sel ? styles.confirmItemSel : ''}`}
                  >
                    <div className={styles.confirmItemHead}>
                      <h3 className={styles.confirmItemTitle}>{idea.title || idea.text}</h3>
                      {groupPhaseActive && sel && (
                        <span className={styles.confirmBadge}>Carried to group</span>
                      )}
                    </div>
                    {idea.description && (
                      <p className={styles.confirmItemDesc}>{idea.description}</p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.confirmWait}>
              {(groupSize === 1 || !groupPhaseActive)
                ? 'Your ideas are saved. Please wait for the session to advance.'
                : `${doneCount} of ${groupSize} group members have submitted. Waiting for the rest of your group...`}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Workspace view ───
  const atMax = ideas.length >= maxIdeas
  const hasSelection = selectedIds.size > 0
  const canFinish = ideas.length > 0 && (!groupPhaseActive || hasSelection) && !done

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Individual Phase</h1>
          <span className={styles.ideaCount}>{ideas.length} / {maxIdeas} ideas</span>
        </div>
        <div className={styles.topRight}>
          <PhaseTimer
            phaseStartedAt={individualStartedAt}
            durationSeconds={pc.individualPhaseDuration}
            onExpire={done ? undefined : autoFinish}
          />
          <button className={`btn-primary ${styles.doneBtn}`} onClick={() => markDone()} disabled={!canFinish}>
            {done ? 'Waiting for group...' : 'Finish & Submit'}
          </button>
        </div>
      </div>

      <NudgeBanner sessionId={sessionId} autoMessage={autoNudgeMessage} />

      {/* Group progress: where the other members stand, visible throughout */}
      {groupPhaseActive && groupId && groupMembers.length > 1 && (() => {
        const sorted = [...groupMembers].sort((a, b) =>
          (a.anonymousLabel || '').localeCompare(b.anonymousLabel || '', undefined, { numeric: true })
        )
        const finishedCount = sorted.filter(m =>
          m.individualComplete || (m.id === user?.uid && done)
        ).length
        return (
          <div className={styles.memberStrip}>
            <span className={styles.memberStripLabel}>
              Group progress: <strong>{finishedCount} / {sorted.length}</strong> submitted
            </span>
            <div className={styles.memberChips}>
              {sorted.map(m => {
                const isMe = m.id === user?.uid
                const finished = m.individualComplete || (isMe && done)
                return (
                  <span
                    key={m.id}
                    className={[
                      styles.memberChip,
                      isMe ? styles.memberChipMe : '',
                      finished ? styles.memberChipDone : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {m.anonymousLabel || 'member'}
                    {isMe && ' (you)'}
                    {finished && ' ✓'}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })()}

      {done && (() => {
        const groupSize = session?.phaseConfig?.groupSize ?? 3
        const firestoreCount = groupMembers.filter(m => m.individualComplete).length
        const selfCounted = groupMembers.some(m => m.id === user?.uid && m.individualComplete)
        const doneCount = (done && !selfCounted) ? firestoreCount + 1 : firestoreCount
        return (
          <div className={styles.waitingBanner}>
            {groupSize === 1
              ? 'Your ideas are submitted. Proceeding to the next phase...'
              : `${doneCount} of ${groupSize} group members have submitted.`}
          </div>
        )
      })()}

      {/* Collapsible task brief */}
      <div className={styles.brief}>
        <button className={styles.briefToggle} onClick={() => setBriefOpen(o => !o)} type="button">
          <span>Task Brief</span>
          <span className={styles.briefChevron}>{briefOpen ? '\u25B2' : '\u25BC'}</span>
        </button>
        {briefOpen && (
          <div className={styles.briefContent}>
            <div className={styles.exampleImgWrap}>
              <img
                src={`${import.meta.env.BASE_URL}images/sleep-mask-example.png`}
                alt="Example product"
                className={styles.exampleImg}
                onError={e => { e.target.style.display = 'none' }}
              />
            </div>
            <RichText html={c.brief} vars={contentVars} aiOn={!!aiEnabled} />
          </div>
        )}
      </div>

      {/* Selection indicator */}
      {groupPhaseActive && ideas.length > 0 && !done && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionLabel}>
            Selected ideas: <strong>{selectedIds.size} / {ideasCarried}</strong>
          </span>
          <span className={styles.selectionHint}>Double-click an idea to select or deselect it</span>
        </div>
      )}

      {/* Idea list */}
      <div className={styles.ideaList}>
        {ideas.map((idea, i) => {
          const isSelected = selectedIds.has(idea.id)
          const isEditing = editingId === idea.id

          if (isEditing) {
            return (
              <div key={idea.id} className={styles.ideaPill + ' ' + styles.ideaPillEditing}>
                <div className={styles.editFields}>
                  <input
                    className={styles.editTitleInput}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Idea title"
                    autoFocus
                  />
                  <textarea
                    className={styles.editDescInput}
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Description"
                    rows={2}
                  />
                  <div className={styles.editActions}>
                    <button
                      className={`btn-primary ${styles.editSaveBtn}`}
                      onClick={() => saveEdit(idea.id)}
                      disabled={!editTitle.trim() || !editDesc.trim()}
                    >
                      Save
                    </button>
                    <button className={`btn-ghost ${styles.editCancelBtn}`} onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div
              key={idea.id}
              className={`${styles.ideaPill} ${isSelected ? styles.ideaPillSelected : ''}`}
              onDoubleClick={() => !done && toggleSelect(idea.id)}
            >
              <div className={styles.pillTop}>
                <h3 className={styles.pillTitle}>{idea.title || idea.text}</h3>
                <div className={styles.pillActions}>
                  {isSelected && <span className={styles.selectedBadge}>Selected</span>}
                  {!done && (
                    <>
                      <button
                        className={styles.editBtn}
                        onClick={e => { e.stopPropagation(); startEdit(idea) }}
                        title="Edit idea"
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M10.08 1.34a1.17 1.17 0 0 1 1.66 0l.92.92a1.17 1.17 0 0 1 0 1.66L4.8 11.78l-3.3.92.92-3.3L10.08 1.34Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={e => { e.stopPropagation(); deleteIdea(idea.id) }}
                        title="Delete idea"
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M1.5 3.5h11M5 3.5V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M3.5 3.5l.5 8.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M5.5 6v4M8.5 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
              {idea.description && (
                <>
                  <div className={styles.pillDivider} />
                  <p className={styles.pillDesc}>{idea.description}</p>
                </>
              )}
            </div>
          )
        })}

        {!done && !atMax && (
          <form onSubmit={submitIdea} className={styles.addPill}>
            <input
              className={styles.addTitleInput}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Idea title"
              disabled={submitting || done}
            />
            <div className={styles.addDivider} />
            <textarea
              className={styles.addDescInput}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitIdea(e) } }}
              placeholder="Description (Enter to add, Shift+Enter for a new line)"
              rows={2}
              disabled={submitting || done}
            />
            <div className={styles.addFooter}>
              <span className={styles.addCount}>{ideas.length} / {maxIdeas} ideas</span>
              <button
                className={`btn-primary ${styles.addBtn}`}
                type="submit"
                disabled={submitting || !title.trim() || !description.trim() || done}
              >
                {submitting ? 'Adding...' : '+ Add Idea'}
              </button>
            </div>
          </form>
        )}

        {atMax && !done && (
          <div className={styles.maxReached}>
            Maximum ideas reached.
            {groupPhaseActive
              ? ` Double-click to select your top ${ideasCarried}, then click Finish & Submit.`
              : ' Review your ideas above and click Finish when ready.'}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className={styles.page}>
      <SplitLayout
        leftPanel={mainPanel}
        rightPanel={aiEnabled ? (
          <AIChat sessionId={sessionId} scope="individual" scopeId={user?.uid} aiConfig={session?.aiConfig} />
        ) : null}
        defaultSplit={58}
      />
    </div>
  )
}