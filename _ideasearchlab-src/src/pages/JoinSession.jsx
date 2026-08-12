import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { platformHandoff } from '../utils/simplatform'
import { joinCodeFromSearch, normalizeJoinCode } from '../utils/joinLink'
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
    normalizeJoinCode(platformHandoff()?.session || ''))
  const [auto, setAuto] = useState(() => autoCode.length >= 3)
  const autoTried = useRef(false)
  // A shared join link carries the session code: the admin's "Copy link" copies
  // …/lab/ideasearchlab/?code=BALI (`?s=` accepted too — Answer Arena's spelling).
  // It PRE-FILLS the field and the student presses Join, exactly like arena's
  // `?s=CODE`; it deliberately does NOT auto-join, so they can see which session
  // they are entering and a stale link fails on the normal form instead of a
  // dead end. The platform launch above is the only silent path — its code stays
  // hidden because the instructor never handed it out.
  const [code, setCode] = useState(() => joinCodeFromSearch(window.location.search))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function joinWithCode(raw, silent) {
    setError('')
    setLoading(true)

    try {
      // Same normalisation as the input, the admin's create form and the
      // shared join link — one rule, so a code can never fail to match because
      // one of the four sites sanitised it differently.
      const trimmedCode = normalizeJoinCode(raw)

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
        // Already registered, skip welcome/registration and go to lobby —
        // UNLESS the consent/demographics write never landed (a dropped
        // network right after `joinSession` created the doc). That participant
        // would otherwise never see this form again and would finish the study
        // with no consent record, so send them back through it once; the form
        // re-calls joinSession, which only refreshes name/email on a rejoin and
        // never re-groups them.
        const p = participantSnap.data() || {}
        const registered = p.consentGiven || (p.demographics && Object.keys(p.demographics).length > 0)
        navigate(registered ? `/session/${sessionId}` : `/session/${sessionId}/register`)
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
              onChange={e => setCode(normalizeJoinCode(e.target.value))}
              placeholder="e.g. ABC123"
              maxLength={40}
              required
              autoFocus
              spellCheck={false}
              autoComplete="off"
              /* iOS/Android otherwise open a lowercase keyboard and run
                 autocorrect over the code as it is typed. */
              autoCapitalize="characters"
              autoCorrect="off"
              enterKeyHint="go"
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