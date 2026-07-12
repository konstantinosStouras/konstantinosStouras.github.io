import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { isPreview, PREVIEW_UID } from '../utils/preview'

const AuthContext = createContext(null)

// In test mode the participant flow runs without any real sign-in: supply a
// fixed synthetic user so RequireAuth passes and every page has a stable uid.
const PREVIEW_USER = { uid: PREVIEW_UID, displayName: 'Test participant', email: 'preview@test.local' }

export function AuthProvider({ children }) {
  const [user, setUser] = useState(isPreview() ? PREVIEW_USER : undefined) // undefined = loading, null = logged out

  useEffect(() => {
    if (isPreview()) return   // no real auth in the sandbox
    const unsub = onAuthStateChanged(auth, setUser)
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
