import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, addDoc, onSnapshot, query, where, orderBy,
  serverTimestamp, doc, updateDoc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession } from '../context/SessionContext'
import SplitLayout from '../components/SplitLayout'
import AIChat from '../components/AIChat'
import PhaseTimer from '../components/PhaseTimer'
import NudgeBanner from '../components/NudgeBanner'
import { getContent } from '../data/defaultContent'
import RichText from '../components/RichText'
import styles from './GroupPhase.module.css'

const MAX_VOTES = 3

// ── Format timestamp for chat bubbles ───────────────
function formatTime(timestamp) {
  if (!timestamp?.seconds) return ''
  const d = new Date(timestamp.seconds * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Deterministic pseudo-random pick: stable across renders for the same set of
// ideas. Used to pick ideas "on behalf of" a participant who selected none, so
// the carried-forward subset is random (not just the latest) and never reshuffles.
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}
function pickRandomStable(arr, n) {
  return [...arr].sort((a, b) => hashStr(a.id) - hashStr(b.id)).slice(0, n)
}

// IdeaPill and ChatBubble are defined at module scope (not inside GroupPhase) so
// their component identity stays stable. Defining them inside the component made
// React remount every idea card and chat bubble on each keystroke, which is what
// caused the list to flicker/jump while typing in the group chat.
function IdeaPill({
  idea, variant, label, isMe, isVoting, votesLocked,
  voteCount, votedByMe, canVote, onVote,
}) {
  return (
    <div
      className={[
        styles.ideaPill,
        variant === 'group' ? styles.ideaPillGroup : '',
        isVoting && votedByMe ? styles.ideaPillVoted : '',
        isVoting && !canVote && !votedByMe ? styles.ideaPillMaxed : '',
        isVoting ? styles.ideaPillClickable : '',
      ].filter(Boolean).join(' ')}
      onDoubleClick={isVoting && canVote ? () => onVote(idea.id) : undefined}
      title={isVoting
        ? (votesLocked ? 'Votes locked' : votedByMe ? 'Double-click to remove vote' : canVote ? 'Double-click to vote' : 'Maximum votes reached')
        : undefined
      }
    >
      {isVoting && voteCount > 0 && (
        <div className={`${styles.voteBadge} ${votedByMe ? styles.voteBadgeMine : ''}`}>
          Votes: {voteCount}
        </div>
      )}
      <div className={styles.pillTop}>
        <div className={styles.pillMeta}>
          <span className={styles.pillAuthor}>{label}</span>
          {isMe && <span className={styles.youTag}>you</span>}
          {isVoting && (
            <span className={styles.phaseTag}>
              {idea.phase === 'group' ? 'group' : 'individual'}
            </span>
          )}
        </div>
      </div>
      <h4 className={styles.pillTitle}>{idea.title || idea.text}</h4>
      {idea.description && (
        <>
          <div className={styles.pillDivider} />
          <p className={styles.pillDesc}>{idea.description}</p>
        </>
      )}
    </div>
  )
}

function ChatBubble({ msg, isMe, label }) {
  return (
    <div className={`${styles.chatBubble} ${isMe ? styles.chatBubbleMe : styles.chatBubbleOther}`}>
      {!isMe && <span className={styles.chatBubbleAuthor}>{label}</span>}
      <p className={styles.chatBubbleText}>{msg.text}</p>
      <span className={styles.chatBubbleTime}>{formatTime(msg.createdAt)}</span>
    </div>
  )
}

// The chat composer keeps its own input state so typing never re-renders the
// rest of the group phase (the ideas list, member chips, etc.).
function ChatComposer({ onSend, disabled }) {
  const [text, setText] = useState('')
  async function submit(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t || disabled) return
    setText('')
    try { await onSend(t) } catch (_) { /* surfaced by caller */ }
  }
  return (
    <form className={styles.chatInputBar} onSubmit={submit}>
      <input
        className={styles.chatInput}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type a message..."
      />
      <button
        className={styles.chatSendBtn}
        type="submit"
        disabled={!text.trim() || disabled}
      >
        Send
      </button>
    </form>
  )
}

export default function GroupPhase() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session } = useSession()
  const navigate = useNavigate()
  const [groupId, setGroupId] = useState(null)
  const [memberLabels, setMemberLabels] = useState({})
  const [members, setMembers] = useState([])
  const [ideas, setIdeas] = useState({ individual: [], group: [] })
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [started, setStarted] = useState(false)
  const [briefOpen, setBriefOpen] = useState(true)
  const [briefHintDismissed, setBriefHintDismissed] = useState(false)
  const [showConsensus, setShowConsensus] = useState(false)
  const consensusSeen = useRef(false)

  // Sub-phase: 'ideation' or 'voting'. Mirrored to the participant doc as
  // `groupStage` so other members can see where everyone stands; restored
  // from the doc on reload.
  const [subPhase, setSubPhase] = useState('ideation')
  const [votesLocked, setVotesLocked] = useState(false)
  const subPhaseInit = useRef(false)

  // Chat state
  const [messages, setMessages] = useState([])
  const [sendingChat, setSendingChat] = useState(false)
  const chatEndRef = useRef(null)

  const pc = session?.phaseConfig || {}
  const aiEnabled = session?.aiConfig?.groupAI
  const ideasCarried = pc.ideasCarriedToGroup || 3
  // Group-only sessions never run an individual phase, so there are no
  // "individual ideas" to show — the group ideation list becomes the primary
  // workspace instead of an empty left column.
  const individualActive = pc.individualPhaseActive !== false
  const durationMinutes = pc.groupPhaseDuration
    ? Math.round(pc.groupPhaseDuration / 60)
    : 15
  const c = getContent(session).group
  const contentVars = { minutes: durationMinutes, votes: MAX_VOTES }

  const isVoting = subPhase === 'voting'

  // ── Derive voting data from members ──────────────────
  const myVotes = (members.find(m => m.id === user?.uid)?.votedFor) || []
  const myVoteCount = myVotes.length

  // Votes needed before "Submit Votes" unlocks. Normally MAX_VOTES, but capped
  // at the number of ideas available so a small or solo group (e.g. one user in
  // a group-only session) can still complete voting instead of being stuck on a
  // 3-vote requirement it can never reach.
  const totalIdeaCount = (ideas.individual?.length || 0) + (ideas.group?.length || 0)
  const requiredVotes = Math.max(1, Math.min(MAX_VOTES, totalIdeaCount))

  const voteCounts = {}
  members.forEach(m => {
    (m.votedFor || []).forEach(id => {
      voteCounts[id] = (voteCounts[id] || 0) + 1
    })
  })

  // ── Get groupId and react to status changes ─────────
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setGroupId(data.groupId)
        if (data.votesSubmitted) setVotesLocked(true)
        if (!subPhaseInit.current) {
          subPhaseInit.current = true
          if (data.votesSubmitted || data.groupStage === 'voting') setSubPhase('voting')
        }
        const status = data.status
        if (status === 'survey') navigate(`/session/${sessionId}/survey`)
        else if (status === 'individual') navigate(`/session/${sessionId}/individual`)
        else if (status === 'done') navigate(`/session/${sessionId}/done`)
      }
    )
    return unsub
  }, [sessionId, user, navigate])

  // ── Load member labels from group document ──────────
  useEffect(() => {
    if (!sessionId || !groupId) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'groups', groupId),
      snap => {
        if (snap.exists()) setMemberLabels(snap.data().memberLabels || {})
      }
    )
    return unsub
  }, [sessionId, groupId])

  // ── Listen to group members ─────────────────────────
  useEffect(() => {
    if (!sessionId || !groupId) return
    const q = query(
      collection(db, 'sessions', sessionId, 'participants'),
      where('groupId', '==', groupId)
    )
    const unsub = onSnapshot(q, snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, groupId])

  // ── Listen to all ideas for this group ──────────────
  useEffect(() => {
    if (!sessionId || !groupId || members.length === 0) return
    const memberIds = members.map(m => m.id)

    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'ideas'),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        const individualIdeas = memberIds.flatMap(uid => {
          const mine = all.filter(i => i.authorId === uid && i.phase === 'individual')
          const selected = mine.filter(i => i.selected)
          if (selected.length > 0) return selected
          // Participant never selected any ideas (e.g. inactive): the system
          // selects on their behalf, choosing a random (deterministic, stable)
          // subset so the group still gets a fair carry-forward.
          return pickRandomStable(mine, ideasCarried)
        })

        const groupIdeas = all.filter(i => i.phase === 'group' && i.groupId === groupId)

        setIdeas({ individual: individualIdeas, group: groupIdeas })
      }
    )
    return unsub
  }, [sessionId, groupId, members, ideasCarried])

  // ── Listen to chat messages ─────────────────────────
  useEffect(() => {
    if (!sessionId || !groupId) return
    const q = query(
      collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [sessionId, groupId])

  // ── Auto-scroll chat on new messages ────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Consensus reminder: pop up once when voting opens ─
  useEffect(() => {
    if (isVoting && !votesLocked && !consensusSeen.current) {
      consensusSeen.current = true
      setShowConsensus(true)
    }
  }, [isVoting, votesLocked])

  // ── Toggle vote on double-click ─────────────────────
  const toggleVote = useCallback(async (ideaId) => {
    if (!isVoting || votesLocked || !sessionId || !user) return
    const isVoted = myVotes.includes(ideaId)
    let newVotes
    if (isVoted) {
      newVotes = myVotes.filter(id => id !== ideaId)
    } else {
      if (myVotes.length >= MAX_VOTES) return
      newVotes = [...myVotes, ideaId]
    }
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { votedFor: newVotes }
      )
    } catch (err) {
      console.error('Vote toggle error:', err)
    }
  }, [isVoting, votesLocked, sessionId, user, myVotes])

  // ── Switch sub-phase and share it with the group ────
  function goToStage(stage) {
    setSubPhase(stage)
    if (!sessionId || !user) return
    updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), { groupStage: stage })
      .catch(err => console.warn('Could not save stage:', err.message))
  }

  // ── Submit / lock votes ─────────────────────────────
  async function submitVotes() {
    if (myVoteCount < requiredVotes || votesLocked || !sessionId || !user) return
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { votesSubmitted: true, votedAt: serverTimestamp() }
      )
      setVotesLocked(true)
    } catch (err) {
      console.error('Submit votes error:', err)
    }
  }

  // ── Default decision when the phase timer expires ───
  // Locks in whatever votes the participant has (possibly none) so the group
  // can never stall on one member; the onParticipantUpdated trigger then
  // tallies and advances the group once everyone is locked.
  const autoSubmitVotes = useCallback(async () => {
    if (votesLocked || !sessionId || !user) return
    setVotesLocked(true)
    setSubPhase('voting')
    try {
      await updateDoc(
        doc(db, 'sessions', sessionId, 'participants', user.uid),
        { votesSubmitted: true, votedAt: serverTimestamp(), groupStage: 'voting' }
      )
    } catch (err) {
      console.error('Auto-submit votes error:', err)
    }
  }, [votesLocked, sessionId, user])

  // ── Submit new group idea ───────────────────────────
  async function submitGroupIdea(e) {
    e.preventDefault()
    const t = newTitle.trim()
    const d = newDesc.trim()
    if (!t || !d || submitting || !groupId) return

    setSubmitting(true)
    try {
      await addDoc(collection(db, 'sessions', sessionId, 'ideas'), {
        title: t,
        description: d,
        text: `${t}: ${d}`,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        phase: 'group',
        groupId,
        votes: 0,
        createdAt: serverTimestamp(),
      })
      setNewTitle('')
      setNewDesc('')
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Send chat message ───────────────────────────────
  async function sendChat(text) {
    const t = (text || '').trim()
    if (!t || sendingChat || !groupId) return
    setSendingChat(true)
    try {
      await addDoc(
        collection(db, 'sessions', sessionId, 'groups', groupId, 'messages'),
        {
          text: t,
          authorId: user.uid,
          authorLabel: memberLabels[user.uid] || 'you',
          createdAt: serverTimestamp(),
        }
      )
    } catch (err) {
      console.error('Chat send error:', err)
    } finally {
      setSendingChat(false)
    }
  }

  // ── Sort helpers ────────────────────────────────────
  const sortByVotes = (a, b) => {
    const va = voteCounts[a.id] || 0
    const vb = voteCounts[b.id] || 0
    if (vb !== va) return vb - va
    return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
  }

  const sortByTime = (a, b) =>
    (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)

  const sortedIndividual = [...(ideas.individual || [])].sort(isVoting ? sortByVotes : sortByTime)
  const sortedGroup = [...(ideas.group || [])].sort(isVoting ? sortByVotes : sortByTime)

  // For voting mode: merge all ideas into one list sorted by votes
  const allIdeasForVoting = [...(ideas.individual || []), ...(ideas.group || [])].sort(sortByVotes)

  /** Renders one idea pill card (uses the stable module-scope IdeaPill) */
  function renderPill(idea, variant) {
    const votedByMe = myVotes.includes(idea.id)
    const canVote = !votesLocked && (votedByMe || myVoteCount < MAX_VOTES)
    return (
      <IdeaPill
        key={idea.id}
        idea={idea}
        variant={variant}
        label={memberLabels[idea.authorId] || idea.anonymousLabel || '?'}
        isMe={idea.authorId === user.uid}
        isVoting={isVoting}
        votesLocked={votesLocked}
        voteCount={voteCounts[idea.id] || 0}
        votedByMe={votedByMe}
        canVote={canVote}
        onVote={toggleVote}
      />
    )
  }

  // Automatic nudge: this participant is the bottleneck — every other group
  // member has locked in their votes and the group is waiting on them.
  const otherMembers = members.filter(m => m.id !== user?.uid)
  const autoNudgeMessage =
    !votesLocked && otherMembers.length > 0 && otherMembers.every(m => m.votesSubmitted)
      ? 'everyone else in your group has submitted their votes. Please pick your votes and click Submit Votes.'
      : null

  /** Member chips with each member's live stage (shared by both sub-phases):
      plain = still ideating, "voting" tag = picking votes, ✓ = votes submitted */
  const sortedMembers = [...members].sort((a, b) =>
    (memberLabels[a.id] || a.anonymousLabel || '').localeCompare(
      memberLabels[b.id] || b.anonymousLabel || '', undefined, { numeric: true }
    )
  )
  const memberChips = (
    <div className={styles.memberPills}>
      {sortedMembers.map(m => {
        const isMe = m.id === user.uid
        const voted = !!m.votesSubmitted
        const voting = !voted && m.groupStage === 'voting'
        return (
          <span
            key={m.id}
            className={[
              styles.memberChip,
              isMe ? styles.memberChipMe : '',
              voted ? styles.memberChipVoted : '',
            ].filter(Boolean).join(' ')}
          >
            {memberLabels[m.id] || m.anonymousLabel || 'Member'}
            {isMe && ' (you)'}
            {voted && ' ✓'}
            {voting && <span className={styles.memberStageTag}>voting</span>}
          </span>
        )
      })}
    </div>
  )

  /** Chat panel (reused in both modes) */
  const chatPanel = (
    <div className={styles.chatSection}>
      <div className={styles.chatHeader}>
        <h3 className={styles.chatHeading}>Group Chat</h3>
        <span className={styles.chatSub}>Discuss and refine your ideas</span>
      </div>
      <div className={styles.chatMessages}>
        {messages.length === 0 && (
          <p className={styles.chatEmpty}>No messages yet. Start the conversation!</p>
        )}
        {messages.map(msg => (
          <ChatBubble
            key={msg.id}
            msg={msg}
            isMe={msg.authorId === user.uid}
            label={memberLabels[msg.authorId] || msg.authorLabel || '?'}
          />
        ))}
        <div ref={chatEndRef} />
      </div>
      <ChatComposer onSend={sendChat} disabled={sendingChat} />
    </div>
  )

  /** One-time notice telling participants they can minimize the task brief
      to free up room for the ideas and workspace (task instructions hint). */
  const briefNotice = (briefOpen && !briefHintDismissed) ? (
    <div className={styles.briefNotice}>
      <span className={styles.briefNoticeIcon} aria-hidden="true">i</span>
      <span className={styles.briefNoticeText}>
        Tip: you can minimize the Task Brief below (click its header) to see the
        ideas and workspace more clearly.
      </span>
      <button
        className={styles.briefNoticeClose}
        onClick={() => setBriefHintDismissed(true)}
        type="button"
        aria-label="Dismiss tip"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  ) : null

  /** Collapsible task brief (shown in both sub-phases) */
  const taskBrief = (
    <div className={styles.brief}>
      <button className={styles.briefToggle} onClick={() => setBriefOpen(o => !o)} type="button">
        <span>Task Brief</span>
        <span className={styles.briefChevron}>{briefOpen ? '▲' : '▼'}</span>
      </button>
      {briefOpen && (
        <div className={styles.briefContent}>
          <RichText html={c.brief} vars={contentVars} aiOn={!!aiEnabled} />
        </div>
      )}
    </div>
  )

  /** Consensus reminder modal for the group selection (voting) phase. */
  const consensusModal = showConsensus ? (
    <div className={styles.modalOverlay} onClick={() => setShowConsensus(false)}>
      <div className={styles.consensusModal} onClick={e => e.stopPropagation()}>
        <h3 className={styles.consensusTitle}>Reach consensus on your group&rsquo;s ideas</h3>
        <p className={styles.consensusBody}>
          Discuss with your group and try to agree on the {requiredVotes} idea
          {requiredVotes === 1 ? '' : 's'} that best represent your work, then cast your votes.
        </p>
        <p className={styles.consensusBody}>
          If your group does not reach consensus, the system will select ideas at
          random on your behalf, and this can lower your performance score.
        </p>
        <button
          className={`btn-primary ${styles.consensusBtn}`}
          onClick={() => setShowConsensus(false)}
          type="button"
        >
          Got it
        </button>
      </div>
    </div>
  ) : null

  /** Group ideas list + add-idea form (reused in both ideation layouts) */
  const groupIdeasList = (
    <div className={styles.ideaList}>
      {sortedGroup.map(idea => renderPill(idea, 'group'))}

      <form onSubmit={submitGroupIdea} className={styles.addPill}>
        <input
          className={styles.addTitleInput}
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Idea title"
          disabled={submitting}
        />
        <div className={styles.addDivider} />
        <textarea
          className={styles.addDescInput}
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="Description"
          rows={2}
          disabled={submitting}
        />
        <div className={styles.addFooter}>
          <button
            className={`btn-primary ${styles.addBtn}`}
            type="submit"
            disabled={submitting || !newTitle.trim() || !newDesc.trim()}
          >
            {submitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  )

  // ─── Instructions view ───
  // The timer runs here too: a participant who never clicks Start still gets
  // their votes auto-submitted on expiry instead of stalling their group.
  if (!started) {
    return (
      <div className={styles.instrPage}>
        <header className={styles.instrHeader}>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <div className={styles.instrTimer}>
            <PhaseTimer
              phaseStartedAt={session?.phaseStartedAt}
              durationSeconds={pc.groupPhaseDuration}
              onExpire={votesLocked ? undefined : autoSubmitVotes}
            />
          </div>
        </header>
        <div className={styles.instrContainer}>
          <NudgeBanner sessionId={sessionId} autoMessage={autoNudgeMessage} />
          <div className={styles.instrCard}>
            <div className={styles.instrBody}>
              <RichText html={c.instructions} vars={contentVars} aiOn={!!aiEnabled} />
            </div>
            <button className={`btn-primary ${styles.startBtn}`} onClick={() => setStarted(true)}>
              Start
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VOTING MODE layout: left = all ideas, right = chat
  // ═══════════════════════════════════════════════════
  if (isVoting) {
    const votingPanel = (
      <div className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.topLeft}>
            <h1 className={styles.phaseTitle}>Group Voting Phase</h1>
            {memberChips}
          </div>
          <div className={styles.topRight}>
            <PhaseTimer
              phaseStartedAt={session?.phaseStartedAt}
              durationSeconds={pc.groupPhaseDuration}
              onExpire={votesLocked ? undefined : autoSubmitVotes}
            />
            <div className={styles.voteCounter}>
              <span className={styles.voteNum}>{myVoteCount}</span>
              <span className={styles.voteDen}>/ {requiredVotes}</span>
            </div>
            {votesLocked ? (
              <span className={styles.votesLockedBadge}>Votes submitted &#10003;</span>
            ) : (
              <button
                className={styles.proceedBtn}
                onClick={submitVotes}
                disabled={myVoteCount < requiredVotes}
              >
                Submit Votes
              </button>
            )}
          </div>
        </div>

        <NudgeBanner sessionId={sessionId} autoMessage={autoNudgeMessage} />

        {briefNotice}
        {taskBrief}

        {!votesLocked && (
          <div className={styles.votingHint}>
            Double-click any idea to vote. Select {requiredVotes} idea{requiredVotes === 1 ? '' : 's'} to represent your group.
            {' '}<button className={styles.backLink} onClick={() => goToStage('ideation')}>
              Back to ideation
            </button>
          </div>
        )}

        <div className={styles.votingColumns}>
          {/* Left: all ideas merged */}
          <div className={styles.votingIdeasColumn}>
            <div className={styles.ideaList}>
              {allIdeasForVoting.map(idea => renderPill(idea, idea.phase === 'group' ? 'group' : 'individual'))}
            </div>
          </div>

          {/* Right: chat only */}
          <div className={styles.votingChatColumn}>
            {chatPanel}
          </div>
        </div>
      </div>
    )

    return (
      <div className={styles.page}>
        {consensusModal}
        <SplitLayout
          leftPanel={votingPanel}
          rightPanel={aiEnabled ? (
            <AIChat
              sessionId={sessionId}
              scope="group"
              scopeId={groupId}
              aiConfig={session?.aiConfig}
            />
          ) : null}
          defaultSplit={58}
        />
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // IDEATION MODE layout: left = individual, right = group + chat
  // ═══════════════════════════════════════════════════
  const ideationPanel = (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h1 className={styles.phaseTitle}>Group Ideation Phase</h1>
          {memberChips}
        </div>
        <div className={styles.topRight}>
          <PhaseTimer
            phaseStartedAt={session?.phaseStartedAt}
            durationSeconds={pc.groupPhaseDuration}
            onExpire={votesLocked ? undefined : autoSubmitVotes}
          />
          <button
            className={styles.proceedBtn}
            onClick={() => goToStage('voting')}
          >
            Proceed to Voting
          </button>
        </div>
      </div>

      <NudgeBanner sessionId={sessionId} autoMessage={autoNudgeMessage} />

      {briefNotice}
      {taskBrief}

      {individualActive ? (
        <div className={styles.columns}>
          {/* Left: individual ideas */}
          <div className={styles.column}>
            <h2 className={styles.columnTitle}>Individual Ideas</h2>
            <p className={styles.columnSub}>Selected ideas from each member</p>
            <div className={styles.ideaList}>
              {sortedIndividual.map(idea => renderPill(idea, 'individual'))}
            </div>
          </div>

          {/* Right: group ideas + add form + chat */}
          <div className={styles.columnRight}>
            <div className={styles.groupIdeasSection}>
              <h2 className={styles.columnTitle}>Group Ideas</h2>
              <p className={styles.columnSub}>Generated together in this phase</p>
              {groupIdeasList}
            </div>

            {chatPanel}
          </div>
        </div>
      ) : (
        /* Group-only session: no individual phase, so make the group ideas
           list the primary column instead of an empty "Individual Ideas" panel. */
        <div className={styles.columns}>
          <div className={styles.column}>
            <h2 className={styles.columnTitle}>Group Ideas</h2>
            <p className={styles.columnSub}>Add and develop ideas with your group</p>
            {groupIdeasList}
          </div>
          <div className={styles.columnRight}>
            {chatPanel}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className={styles.page}>
      <SplitLayout
        leftPanel={ideationPanel}
        rightPanel={aiEnabled ? (
          <AIChat
            sessionId={sessionId}
            scope="group"
            scopeId={groupId}
            aiConfig={session?.aiConfig}
          />
        ) : null}
        defaultSplit={58}
      />
    </div>
  )
}