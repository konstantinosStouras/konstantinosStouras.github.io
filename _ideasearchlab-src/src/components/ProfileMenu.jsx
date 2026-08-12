import { useState, useRef, useEffect } from 'react'
import { isPreview } from '../utils/preview'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import styles from './ProfileMenu.module.css'

// Account menu shown in the top-right of the participant-facing pages. Click the
// avatar/name to open a dropdown with the user's activity/statistics, a shortcut
// to join a session, and log out.
export default function ProfileMenu() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const displayName = user?.displayName || user?.email || 'Account'
  const initial = (user?.displayName || user?.email || '?').trim().charAt(0).toUpperCase()

  function go(path) {
    setOpen(false)
    navigate(path)
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.avatar}>{initial}</span>
        <span className={styles.triggerName}>{displayName}</span>
        <span className={styles.caret}>{'▾'}</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHeader}>
            <span className={styles.menuName}>{user?.displayName || 'Signed in'}</span>
            {user?.email && <span className={styles.menuEmail}>{user.email}</span>}
          </div>
          <button className={styles.menuItem} onClick={() => go('/history')} role="menuitem">
            My activity &amp; statistics
          </button>
          <button className={styles.menuItem} onClick={() => go('/join')} role="menuitem">
            Join a session
          </button>
          <div className={styles.menuDivider} />
          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              setOpen(false)
              // A test round must never touch the real auth session — this used
              // to sign the instructor out of their own /admin tabs.
              if (isPreview()) return
              // Signing out mid-session mints a NEW throwaway account, so the
              // participant doc is gone and every subsequent write is rejected
              // silently. Warn, then leave the session properly.
              const inSession = /\/session\//.test(window.location.pathname)
              if (inSession && !window.confirm('Log out and leave this session? Your work so far is saved, but you will need your session code to rejoin.')) return
              signOut(auth).then(() => navigate('/join')).catch(() => navigate('/join'))
            }}
            role="menuitem"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
