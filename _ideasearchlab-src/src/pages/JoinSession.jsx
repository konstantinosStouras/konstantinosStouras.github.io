import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { platformHandoff } from '../utils/simplatform'
import HeaderControls from '../components/HeaderControls'
import styles from './JoinSession.module.css'

export default function JoinSession() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // A launch from stouras.com/simulation carries the Session ID in the
  // handoff — it is entered SILENTLY and never shown to the student (per the
  // owner: an unshown code is harder to pass to classmates outside class).
  // If the silent join fails, the normal form appears (empty) so nobody
  // dead-ends; students without a handoff see the form exactly as before.
  const [autoCode] = useState(() =>
    ((platformHandoff()?.session) || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
  const [auto, setAuto] = useState(() => autoCode.length >= 3)
  const autoTried = useRef(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function joinWithCode(raw, silent) {
    setError('')
    setLoading(true)

    try {
      const trimmedCode = raw.trim().toUpperCase()

      // Validate the session code via a client-side Firestore query
      const sessionsQuery = query(
        collection(db, 'sessions'),
        where('code', '==', trimmedCode),
        where('status', '!=', 'done')
      )
      const snap = await getDocs(sessionsQuery)

      if (snap.empty) {
        if (silent) {
          setAuto(false)
          setError('Your class session could not be joined — ask your instructor, or enter a session code below.')
        } else {
          setError('Session not found. Check the code and try again.')
        }
        setLoading(false)
        return
      }

      const sessionId = snap.docs[0].id

      // Check if this participant already registered (rejoining)
      const participantRef = doc(db, 'sessions', sessionId, 'participants', user.uid)
      const participantSnap = await getDoc(participantRef)

      if (participantSnap.exists()) {
        // Already registered, skip welcome/registration and go to lobby
        navigate(`/session/${sessionId}`)
      } else {
        // New participant, show welcome page first
        navigate(`/session/${sessionId}/welcome`)
      }
    } catch (err) {
      console.error(err)
      if (silent) {
        setAuto(false)
        setError('Your class session could not be joined — ask your instructor, or enter a session code below.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Silent auto-join on a platform launch (once).
  useEffect(() => {
    if (!auto || autoTried.current) return
    autoTried.current = true
    joinWithCode(autoCode, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleJoin(e) {
    e.preventDefault()
    joinWithCode(code, false)
  }

  // Platform launch: joining silently — the code is never displayed.
  if (auto) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <HeaderControls />
        </header>
        <main className={styles.main}>
          <div className={styles.card}>
            <div className={styles.icon} aria-hidden="true">&#x25C8;</div>
            <h1 className={styles.title}>Joining your class session...</h1>
            <p className={styles.desc}>One moment — your session is set by your instructor.</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
        <HeaderControls />
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.icon} aria-hidden="true">&#x25C8;</div>
          <h1 className={styles.title}>Join a Session</h1>
          <p className={styles.desc}>
            Enter the session code provided by your instructor to begin.
          </p>

          <form onSubmit={handleJoin} className={styles.form}>
            <input
              className={`input-field ${styles.codeInput}`}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="e.g. ABC123"
              maxLength={40}
              required
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="error-msg">{error}</p>}
            <button
              className={`btn-primary ${styles.joinBtn}`}
              type="submit"
              disabled={loading || code.trim().length < 3}
            >
              {loading ? 'Looking up session...' : 'Join Session'}
            </button>
          </form>
        </div>

        <p className={styles.hint}>
          Don't have a code? Ask your instructor for the session code before joining.
        </p>
      </main>
    </div>
  )
}