import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { auth } from '../firebase'
import { provisionStudentAccount } from '../utils/simplatform'

const ADMIN_EMAIL = 'admin@admin.com'

function Centered({ children }) {
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--muted)' }}>{children}</div>
}

// Blocks unauthenticated users
export function RequireAuth({ children }) {
  const { user } = useAuth()
  if (user === undefined) return <Centered>Loading...</Centered>
  if (user === null) return <Navigate to="/login" replace />
  return children
}

// Participant routes: NO account screen. A visitor without a session gets a
// silent throwaway login minted for them (see provisionStudentAccount) —
// /login remains for instructors, and as the fallback if provisioning fails.
export function RequireStudent({ children }) {
  const { user } = useAuth()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (user === null && !started.current) {
      started.current = true
      provisionStudentAccount(auth).catch(err => {
        console.error('Silent sign-in failed:', err)
        setFailed(true)
      })
    }
  }, [user])
  if (user === undefined || (user === null && !failed)) return <Centered>Preparing your session...</Centered>
  if (user === null) return <Navigate to="/login" replace />
  return children
}

// Blocks authenticated users from seeing login page
export function RequireGuest({ children }) {
  const { user } = useAuth()
  if (user === undefined) return null
  if (user !== null) {
    if (user.email === ADMIN_EMAIL) return <Navigate to="/admin" replace />
    return <Navigate to="/join" replace />
  }
  return children
}

// Only allows admin@admin.com
export function RequireInstructor({ children }) {
  const { user } = useAuth()
  if (user === undefined) return null
  if (user === null) return <Navigate to="/login" replace />
  if (user.email !== ADMIN_EMAIL) return <Navigate to="/join" replace />
  return children
}