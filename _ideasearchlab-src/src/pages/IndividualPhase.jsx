import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where,
  orderBy, serverTimestamp, doc, updateDoc, deleteDoc, writeBatch, db
} from '../utils/db'
import { useAuth } from '../context/AuthContext'
import { useSession, useSessionEnded, useAIModelLabel } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import NudgeBanner from '../components/NudgeBanner'
import HeaderControls from '../components/HeaderControls'
import { getContent } from '../data/defaultContent'
import { individualTimers, minutesOf } from '../utils/phaseTimers'
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

// How long the submission-confirmation screen is guaranteed to stay on screen
// before this page follows a status change to the next phase.
//
// Why it exists: the backend flips a participant to the group phase the moment
// EVERY member of their group has `individualComplete`. For whoever submits
// last that is the same instant they submit — and in a solo group (groupSize
// 1, how the app is usually tested) it is always the case — so the summary of
// which ideas carry into the group phase flashed past within one Firestore
// round-trip. The hold keeps the flow fully automatic (no click, so nobody can
// stall their group by walking away); it only refuses to leave before the
// screen has been readable, counting the remaining seconds down in the note.
const CONFIRM_HOLD_MS = 15000

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
  // Submission-confirmation hold (see CONFIRM_HOLD_MS). `submittedAtRef` is
  // stamped when this participant's submit lands, `pendingPathRef` parks a
  // phase change that arrived before the hold elapsed, and `holdLeft` is the
  // seconds still to run (0 = not holding), shown in the waiting note.
  const submittedAtRef = useRef(0)
  const pendingPathRef = useRef(null)
  const [holdLeft, setHoldLeft] = useState(0)
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

  // Stage within the individual phase: 'generation' (write ideas) then
  // 'selection' (pick the ones that carry into the group phase). Each stage
  // has its own admin-allocated countdown. Mirrored to the participant doc as
  // `individualStage` so the instructor sees where each participant is, and
  // restored from it on reload.
  const [stage, setStage] = useState('generation')
  const [selectionStartedAt, setSelectionStartedAt] = useState(null)
  const stageInit = useRef(false)
  const stageRef = useRef('generation')

  const pc = session?.phaseConfig || {}
  const maxIdeas = pc.maxIdeasIndividual || 5
  const aiEnabled = session?.aiConfig?.individualAI
  const timers = individualTimers(pc)
  const durationMinutes = minutesOf(timers.total) ?? 10
  // Per-stage minutes for the instructions/brief copy. A stage left on manual
  // (no countdown) falls back to a sensible figure so the sentence still reads
  // properly, the same way {minutes} has always fallen back to 10.
  const genMinutes = minutesOf(timers.first) ?? durationMinutes
  const selMinutes = minutesOf(timers.second) ?? 3
  const ideasCarried = pc.ideasCarriedToGroup || 3
  const groupPhaseActive = pc.groupPhaseActive !== false
  const c = getContent(session).individual
  // Shared placeholder values so {minutes}, {genMinutes}, {selMinutes},
  // {maxIdeas} and {ideasCarried} all resolve on both the instructions screen
  // and the workspace task brief.
  const contentVars = { minutes: durationMinutes, genMinutes, selMinutes, maxIdeas, ideasCarried, aiModel }

  // There is only something to select when ideas carry forward into a group
  // phase; an individual-only session finishes straight from the generation
  // stage (as it always did).
  const selectionStage = groupPhaseActive
  const isSelecting = selectionStage && stage === 'selection'

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
        setSelectionStartedAt(data.individualSelectionStartedAt || null)
        // Restore the stage once, so a reload puts the participant back where
        // they were instead of reopening the generation stage.
        if (!stageInit.current) {
          stageInit.current = true
          if (data.individualStage === 'selection' || data.individualSelectionStartedAt) {
            stageRef.current = 'selection'
            setStage('selection')
          }
        }
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
        // Restore the submission-confirmation view after a reload, so someone
        // who refreshes while waiting for their group sees the summary of what
        // they are carrying forward again rather than the workspace they have
        // already submitted.
        if (data.individualComplete) setDone(true)
        const status = data.status
        // A phase change arriving within CONFIRM_HOLD_MS of this participant's
        // own submit is parked until the hold elapses (the countdown effect
        // below performs the navigation), so the confirmation screen is never
        // flashed past. 'done' is not held: that one means the instructor
        // closed the session, which should take effect at once.
        const goNext = path => {
          const since = submittedAtRef.current
          const left = since ? CONFIRM_HOLD_MS - (Date.now() - since) : 0
          if (left <= 0) { navigate(path); return }
          pendingPathRef.current = path
          setHoldLeft(Math.ceil(left / 1000))
        }
        if (status === 'group') goNext(`/session/${sessionId}/group`)
        else if (status === 'survey') goNext(`/session/${sessionId}/survey`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // Runs the confirmation hold down and then makes the parked move. Ticks
  // faster than 1 s so the displayed second is never stale, and recomputes
  // from the stamped submit time rather than decrementing, so a backgrounded
  // tab (where intervals are throttled) still leaves on time.
  const holding = holdLeft > 0
  useEffect(() => {
    if (!holding) return
    const id = setInterval(() => {
      const left = CONFIRM_HOLD_MS - (Date.now() - submittedAtRef.current)
      if (left > 0) { setHoldLeft(Math.ceil(left / 1000)); return }
      clearInterval(id)
      setHoldLeft(0)
      const path = pendingPathRef.current
      pendingPathRef.current = null
      if (path) navigate(path)
    }, 250)
    return () => clearInterval(id)
  }, [holding, navigate])

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

  // ── Stage transitions ───────────────────────────────
  // Move on to choosing which ideas carry forward. Stamps
  // individualSelectionStartedAt once — the anchor for the selection
  // countdown (and the ideas-vs-selection split in the export's Timing sheet).
  function goToSelection() {
    if (!selectionStage || stageRef.current === 'selection' || done) return
    stageRef.current = 'selection'
    setStage('selection')
    setEditingId(null) // an idea left open in the editor isn't editable here
    if (!sessionId || !user) return
    const updates = { individualStage: 'selection' }
    if (!selectionStartedAt) updates.individualSelectionStartedAt = serverTimestamp()
    updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), updates)
      .catch(err => console.warn('Could not save individual stage:', err.message))
  }

  // Step back to the ideas list. The selection countdown, once started, keeps
  // running — it is the live clock from then on (same rule as the group
  // phase's "Back to ideation").
  function backToGeneration() {
    if (done) return
    stageRef.current = 'generation'
    setStage('generation')
    if (!sessionId || !user) return
    updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid),
      { individualStage: 'generation' })
      .catch(err => console.warn('Could not save individual stage:', err.message))
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
    // Anchors the confirmation hold. Stamped before the write, so the status
    // change it triggers can never beat it and slip past the hold.
    submittedAtRef.current = Date.now()
    const selection = selectionOverride instanceof Set ? selectionOverride : selectedIds
    try {
      // 1. Mark participant as done (critical, should always succeed)
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        {
          individualComplete: true,
          status: 'waiting_for_group',
          // Timing: closes the selection stage in the export's Timing sheet.
          individualSubmittedAt: serverTimestamp(),
        }
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
      submittedAtRef.current = 0
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

  // ── Which countdown is live right now ───────────────
  // Split sessions run two clocks: the generation clock until the participant
  // moves on, then the selection clock — which stays the live one even if they
  // step back to their ideas. A legacy (unsplit) session keeps its single
  // clock across both stages, expiring straight into the auto-submit as before.
  function timerProps() {
    if (!timers.split) {
      return {
        phaseStartedAt: individualStartedAt,
        durationSeconds: timers.total,
        onExpire: done ? undefined : autoFinish,
      }
    }
    if (selectionStartedAt) {
      return {
        phaseStartedAt: selectionStartedAt,
        durationSeconds: timers.second,
        onExpire: done ? undefined : autoFinish,
      }
    }
    return {
      phaseStartedAt: individualStartedAt,
      durationSeconds: timers.first,
      // Generation time is up: move on to choosing the ideas that carry
      // forward — but with no selection stage, or nothing written to select
      // from, submit instead so a participant is never parked on a stage they
      // cannot complete.
      onExpire: done
        ? undefined
        : (selectionStage && ideas.length > 0 ? goToSelection : autoFinish),
    }
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
              durationSeconds={timers.first || timers.total}
              preview
            />
          </div>
          <HeaderControls />
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
          {/* NO phase timer here (owner 2026-08). This screen comes AFTER the
              submit, so the selection stage's countdown is over — leaving it
              running showed the participant a clock that no longer governs
              anything (and whose expiry would re-fire autoFinish) next to the
              only countdown that does: the confirmation hold, printed in the
              card below. */}
          <HeaderControls />
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
              {holdLeft > 0
                ? `Your ideas are saved. ${groupPhaseActive ? 'The group phase' : 'The next step'} starts in ${holdLeft}s...`
                : (groupSize === 1 || !groupPhaseActive)
                  ? 'Your ideas are saved. Please wait for the session to advance.'
                  : `${doneCount} of ${groupSize} group members have submitted. The group phase will start automatically as soon as the rest of your group get here.`}
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
  // Ideas are written in the generation stage only; the selection stage is for
  // choosing which of them carry forward.
  const canAddIdeas = !done && !isSelecting

  const mainPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>
            {!selectionStage
              ? 'Individual Phase'
              : isSelecting ? 'Individual Selection Phase' : 'Individual Ideation Phase'}
          </h1>
          <span className={styles.ideaCount}>{ideas.length} / {maxIdeas} ideas</span>
        </div>
        <div className={styles.topRight}>
          <PhaseTimer {...timerProps()} />
          {selectionStage && !isSelecting ? (
            <button
              className={styles.proceedBtn}
              onClick={goToSelection}
              disabled={ideas.length === 0}
              title={ideas.length === 0
                ? 'Add at least one idea first'
                : `Move on to choosing the ${ideasCarried} ideas you carry into the group phase`}
            >
              Proceed to Selection
            </button>
          ) : (
            <button className={`btn-primary ${styles.doneBtn}`} onClick={() => markDone()} disabled={!canFinish}>
              {done ? 'Waiting for group...' : 'Finish & Submit'}
            </button>
          )}
          <HeaderControls />
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

      {/* Collapsible task brief, toggled by the always-visible
          "Hide/Show task description" pill button below it */}
      <div className={styles.briefWrap}>
        {briefOpen && (
          <div className={styles.brief}>
            <div className={styles.briefHeader}>Task Brief</div>
            <div className={styles.briefContent}>
              <RichText html={c.brief} vars={contentVars} aiOn={!!aiEnabled} />
            </div>
          </div>
        )}
        <div className={styles.briefToggleRow}>
          <button
            className={styles.briefToggleBtn}
            onClick={() => setBriefOpen(o => !o)}
            type="button"
            title={briefOpen
              ? 'Hide the task description to see the ideas and workspace more clearly.'
              : 'Show the task description.'}
          >
            <span className={styles.briefToggleChevron} aria-hidden="true">{briefOpen ? '\u25B2' : '\u25BC'}</span>
            {briefOpen ? 'Hide task description' : 'Show task description'}
          </button>
        </div>
      </div>

      {/* Generation stage hint: what happens when the ideas are in */}
      {selectionStage && !isSelecting && !done && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionLabel}>
            Write your ideas first — you&rsquo;ll choose your best <strong>{ideasCarried}</strong> in the next step
          </span>
          <span className={styles.selectionHint}>
            {timers.split && timers.second
              ? `The selection step has its own ${selMinutes} minute${selMinutes === 1 ? '' : 's'}`
              : 'Click "Proceed to Selection" when you are ready'}
          </span>
        </div>
      )}

      {/* Selection stage indicator */}
      {isSelecting && ideas.length > 0 && !done && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionLabel}>
            Selected ideas: <strong>{selectedIds.size} / {ideasCarried}</strong>
          </span>
          <span className={styles.selectionHint}>
            Tap <strong>Select</strong> on an idea (or double-click it) to choose it
            {!atMax && (
              <>
                {' · '}
                <button className={styles.backLink} onClick={backToGeneration} type="button">
                  Back to adding ideas
                </button>
              </>
            )}
          </span>
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
              onDoubleClick={() => !done && isSelecting && toggleSelect(idea.id)}
              title={isSelecting && !done
                ? (isSelected ? 'Double-click to deselect' : 'Double-click to select this idea')
                : undefined}
            >
              <div className={styles.pillTop}>
                <h3 className={styles.pillTitle}>{idea.title || idea.text}</h3>
                <div className={styles.pillActions}>
                  {/* Explicit single-tap control. Double-click still works, but
                      it is a MOUSE idiom: on a tablet a double-tap is claimed by
                      Safari's zoom gesture and the `title` tooltip that explains
                      it never appears, so selecting was effectively unreachable
                      on the devices half the class uses. This button is also the
                      keyboard path. */}
                  {isSelecting && !done && (
                    <button
                      type="button"
                      className={`${styles.selectBtn} ${isSelected ? styles.selectBtnOn : ''}`}
                      onClick={e => { e.stopPropagation(); toggleSelect(idea.id) }}
                      disabled={!isSelected && selectedIds.size >= ideasCarried}
                      aria-pressed={isSelected}
                      title={isSelected
                        ? 'Remove this idea from your selection'
                        : (selectedIds.size >= ideasCarried
                          ? `You have already chosen ${ideasCarried}`
                          : 'Carry this idea into the group phase')}
                    >
                      {isSelected ? '✓ Selected' : 'Select'}
                    </button>
                  )}
                  {isSelected && !isSelecting && <span className={styles.selectedBadge}>Selected</span>}
                  {canAddIdeas && (
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

        {canAddIdeas && !atMax && (
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

        {atMax && canAddIdeas && (
          <div className={styles.maxReached}>
            Maximum ideas reached.
            {selectionStage
              ? ` Click "Proceed to Selection" to choose your top ${ideasCarried}.`
              : ' Review your ideas above and click Finish when ready.'}
          </div>
        )}

        {isSelecting && !done && (
          <div className={styles.maxReached}>
            {ideas.length === 0
              ? 'You have no ideas to select from.'
              : `Double-click to select your top ${ideasCarried}, then click Finish & Submit.`}
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