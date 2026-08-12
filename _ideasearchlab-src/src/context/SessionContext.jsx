import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot, db } from '../utils/db'

const SessionContext = createContext(null)

export function SessionProvider({ sessionId, children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }

    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        if (snap.exists()) {
          setSession({ id: snap.id, ...snap.data() })
        } else {
          setSession(null)
        }
        setLoading(false)
      },
      (err) => {
        // A listener error is NOT the same as "the instructor deleted the
        // session", though both used to resolve to `session === null` — so a
        // token that failed to refresh, or one permission-denied blip, showed a
        // mid-phase student the "all done, your responses have been recorded"
        // screen (which also stamped their platform card Completed). Record it
        // as an error and KEEP the last known session.
        console.error('Session listener error:', err)
        setError(err)
        setLoading(false)
      }
    )

    return unsub
  }, [sessionId])

  return (
    <SessionContext.Provider value={{ session, loading, error }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}

// True once the session has ended for participants: either the instructor
// closed it (status === 'done') or deleted it (the doc no longer exists, so
// the snapshot resolved to null). Stays false while the session is still
// loading so pages can show their own loading state first.
export function useSessionEnded() {
  const { session, loading, error } = useContext(SessionContext)
  // An unreadable session is not a finished one.
  if (error) return false
  return !loading && (!session || session.status === 'done')
}

// Friendly name of the AI model currently configured in the admin AI panel,
// read from the non-secret settings/aiPublic mirror (written by the
// saveAISettings Cloud Function). Falls back to the app's default model name
// when the doc is missing or unreadable (e.g. before the rules/functions are
// deployed), so the AI note is never blank or wrong.
const DEFAULT_AI_MODEL_LABEL = "Anthropic's Claude Sonnet 4.6"
export function useAIModelLabel() {
  const [label, setLabel] = useState(DEFAULT_AI_MODEL_LABEL)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'aiPublic'),
      snap => {
        const l = snap.exists() && snap.data().modelLabel
        if (l) setLabel(l)
      },
      () => {} // read denied / offline: keep the default label
    )
    return unsub
  }, [])
  return label
}
