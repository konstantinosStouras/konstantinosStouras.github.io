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
