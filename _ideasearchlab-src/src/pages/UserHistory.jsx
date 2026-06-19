import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import ProfileMenu from '../components/ProfileMenu'
import styles from './UserHistory.module.css'

// Human-friendly labels for the participant's own status within a session.
const STATUS_LABELS = {
  waiting: 'Waiting in lobby',
  waiting_for_group: 'Waiting for group',
  individual: 'Individual phase',
  group: 'Group phase',
  survey: 'Survey',
  done: 'Completed',
}

function statusLabel(s) {
  return STATUS_LABELS[s] || s || 'Unknown'
}

function formatDate(ts) {
  if (!ts?.seconds) return null
  const d = new Date(ts.seconds * 1000)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function UserHistory() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')

  // Find every session this user has joined. Participant records live under
  // each session (sessions/{id}/participants/{uid}); a user can always read
  // their OWN participant doc, so we read all sessions and pick out the ones
  // where our participant doc exists. No backend changes required.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const sessSnap = await getDocs(collection(db, 'sessions'))
        const found = []
        await Promise.all(
          sessSnap.docs.map(async sDoc => {
            const pSnap = await getDoc(
              doc(db, 'sessions', sDoc.id, 'participants', user.uid)
            )
            if (pSnap.exists()) {
              found.push({ sessionId: sDoc.id, session: sDoc.data(), participant: pSnap.data() })
            }
          })
        )
        if (cancelled) return
        found.sort(
          (a, b) =>
            (b.participant.joinedAt?.seconds || 0) - (a.participant.joinedAt?.seconds || 0)
        )
        setItems(found)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Could not load your activity. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const completed = items.filter(i => i.participant.status === 'done').length
  const inProgress = items.length - completed

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <ProfileMenu />
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Your activity</h1>
          <p className={styles.subtitle}>The sessions you&rsquo;ve joined and where you left off.</p>
        </div>

        {!loading && !error && items.length > 0 && (
          <div className={styles.stats}>
            <Stat label="Sessions joined" value={items.length} />
            <Stat label="Completed" value={completed} />
            <Stat label="In progress" value={inProgress} />
          </div>
        )}

        {loading ? (
          <div className={styles.state}>Loading your sessions&hellip;</div>
        ) : error ? (
          <div className={styles.state}>{error}</div>
        ) : items.length === 0 ? (
          <div className={styles.emptyCard}>
            <p className={styles.emptyText}>You haven&rsquo;t joined any sessions yet.</p>
            <button className="btn-primary" onClick={() => navigate('/join')}>Join a session</button>
          </div>
        ) : (
          <div className={styles.list}>
            {items.map(({ sessionId, session, participant }) => {
              const done = participant.status === 'done'
              const joined = formatDate(participant.joinedAt)
              return (
                <div key={sessionId} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTop}>
                      <span className={styles.code}>{session.code || '—'}</span>
                      <span className={`${styles.badge} ${done ? styles.badgeDone : styles.badgeActive}`}>
                        {statusLabel(participant.status)}
                      </span>
                    </div>
                    <div className={styles.meta}>
                      {joined && <span>Joined {joined}</span>}
                      {participant.anonymousLabel && <span>&middot; You were {participant.anonymousLabel}</span>}
                      {participant.surveyCompletedAt && <span>&middot; Survey submitted</span>}
                    </div>
                  </div>
                  <div className={styles.itemActions}>
                    {done ? (
                      <span className={styles.completedNote}>Completed</span>
                    ) : (
                      <button
                        className="btn-primary"
                        style={{ padding: '8px 18px', fontSize: 13 }}
                        onClick={() => navigate(`/session/${sessionId}`)}
                      >
                        Continue
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}
