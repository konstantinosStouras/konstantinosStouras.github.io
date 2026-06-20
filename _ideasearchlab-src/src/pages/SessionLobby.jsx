import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { collection, onSnapshot, doc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { db, auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useSession, useSessionEnded } from '../context/SessionContext'
import { getContent } from '../data/defaultContent'
import RichText from '../components/RichText'
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

  // Listen to participants list
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'participants'),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setParticipants(list)
        const me = list.find(p => p.id === user?.uid)
        if (me) setMyStatus(me.status)
      }
    )
    return unsub
  }, [sessionId, user])

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
  const totalCount = participants.length
  const c = getContent(session).lobby
  // Non-phase pages show [AI] lines when either phase's AI is enabled.
  const aiOn = !!(session?.aiConfig?.individualAI || session?.aiConfig?.groupAI)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <button className="btn-ghost" onClick={() => signOut(auth)}>Sign out</button>
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