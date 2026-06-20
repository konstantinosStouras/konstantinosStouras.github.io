import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

const SessionContext = createContext(null)

export function SessionProvider({ sessionId, children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }

    const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
      if (snap.exists()) {
        setSession({ id: snap.id, ...snap.data() })
      } else {
        setSession(null)
      }
      setLoading(false)
    })

    return unsub
  }, [sessionId])

  return (
    <SessionContext.Provider value={{ session, loading }}>
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
  const { session, loading } = useContext(SessionContext)
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
