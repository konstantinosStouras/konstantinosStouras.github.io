import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { collection, onSnapshot, query, where, doc, db } from '../utils/db'
import { useAuth } from '../context/AuthContext'
import { useSession, useSessionEnded } from '../context/SessionContext'
import { getContent } from '../data/defaultContent'
import RichText from '../components/RichText'
import HeaderControls from '../components/HeaderControls'
import { Done } from './Survey'
import styles from './SessionLobby.module.css'

export default function SessionLobby() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const { session, loading } = useSession()
  const ended = useSessionEnded()
  const navigate = useNavigate()
  const [participants, setParticipants] = useState([])
  const [myStatus, setMyStatus] = useState(null)

  // This participant's own doc — the routing signal, and where their group id
  // comes from. Kept separate from the group listener below so routing still
  // works before a group is known.
  const [myGroupId, setMyGroupId] = useState(null)
  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        if (!snap.exists()) return
        const data = snap.data()
        setMyStatus(data.status)
        setMyGroupId(data.groupId || null)
      },
      err => console.error('Lobby participant listener error:', err)
    )
    return unsub
  }, [sessionId, user])

  // The waiting count is about THIS participant's group, so the listener is
  // scoped to it. It used to stream the whole session's participants, which at
  // class scale is thousands of reads per waiting student — and, worse, computed
  // "your group is full" from the SESSION total, so with 70 students everyone
  // (including the lone member of the last, undersized group) was told their
  // group of 3 was full and would start soon. It never did.
  useEffect(() => {
    if (!sessionId || !myGroupId) return
    const unsub = onSnapshot(
      query(collection(db, 'sessions', sessionId, 'participants'), where('groupId', '==', myGroupId)),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('Lobby group listener error:', err)
    )
    return unsub
  }, [sessionId, myGroupId])

  // React to phase/status changes
  useEffect(() => {
    if (!session || !myStatus) return

    // Participant-level routing based on their own status
    if (myStatus === 'individual') {
      navigate(`/session/${sessionId}/individual`)
    } else if (myStatus === 'group' || myStatus === 'voting') {
      navigate(`/session/${sessionId}/group`)
    } else if (myStatus === 'survey') {
      navigate(`/session/${sessionId}/survey`)
    } else if (myStatus === 'done') {
      navigate(`/session/${sessionId}/done`)
    }
  }, [session, myStatus, sessionId, navigate])

  if (loading) {
    return <div className={styles.loading}>Loading session...</div>
  }

  // Instructor closed (status 'done') or deleted the session: show the same
  // end message participants see when they finish, instead of stranding them.
  if (ended) {
    return <Done />
  }

  if (!session) {
    return <div className={styles.loading}>Session not found.</div>
  }

  const waitingCount = participants.filter(p => p.status === 'waiting').length
  // Members of THIS group, not of the whole session.
  const totalCount = participants.length
  const c = getContent(session).lobby
  // Non-phase pages show [AI] lines when either phase's AI is enabled.
  const aiOn = !!(session?.aiConfig?.individualAI || session?.aiConfig?.groupAI)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <HeaderControls />
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.pulse} aria-hidden="true" />
          <RichText html={c.body} aiOn={aiOn} />
          <p className={styles.sessionCode}>
            Session <strong>{session.code}</strong>
          </p>
          {(() => {
            const groupSize = session?.phaseConfig?.groupSize ?? 3
            const filled = Math.min(totalCount, groupSize)
            const needed = Math.max(0, groupSize - totalCount)
            return (
              <>
                <p className={styles.desc}>
                  {needed > 0
                    ? `Waiting for ${needed} more participant${needed === 1 ? '' : 's'} to join before your group can begin.`
                    : 'Your group is full. Starting soon...'}
                </p>
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <span className={styles.statNum}>{filled}</span>
                    <span className={styles.statLabel}>of {groupSize} joined</span>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </main>
    </div>
  )
}