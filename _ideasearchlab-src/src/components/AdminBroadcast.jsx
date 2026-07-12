import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, db } from '../utils/db'
import { useAuth } from '../context/AuthContext'
import styles from './AdminBroadcast.module.css'

/**
 * AdminBroadcast
 *
 * Mounted once around every session page (via SessionWrapper). Subscribes to
 * the signed-in participant's own doc and renders two instructor-driven
 * overlays on top of whatever page they're on:
 *
 *  1. A centred message window when the instructor sends their group a note
 *     (`adminMessage = { id, text, from }` on each member's participant doc).
 *     Dismissing records the message id in `adminMessageAckId`, so a newer
 *     message (new id) shows again.
 *  2. A full-screen "you've been removed" notice when the instructor removes
 *     them from the session (`status === 'removed'`).
 *
 * For the instructor (no participant doc) and the pre-registration pages (doc
 * not created yet) the snapshot is empty, so nothing renders.
 */
export default function AdminBroadcast() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!sessionId || !user) { setData(null); return }
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => setData(snap.exists() ? snap.data() : null),
      () => setData(null)
    )
    return unsub
  }, [sessionId, user])

  if (!data) return null

  // ── Removed from the session ──
  if (data.status === 'removed') {
    return (
      <div className={styles.removedOverlay}>
        <div className={styles.removedCard}>
          <div className={styles.removedIcon}>🚪</div>
          <h2 className={styles.removedTitle}>You've left this session</h2>
          <p className={styles.removedText}>
            The instructor has removed you from this session. You can close this window.
            If you think this was a mistake, please contact your instructor.
          </p>
        </div>
      </div>
    )
  }

  // ── Instructor message to the group ──
  const msg = data.adminMessage
  const show = msg && msg.text && msg.id && msg.id !== data.adminMessageAckId
  if (!show) return null

  function dismiss() {
    updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), {
      adminMessageAckId: msg.id,
    }).catch(err => console.warn('Could not acknowledge message:', err.message))
  }

  return (
    <div className={styles.msgBackdrop} role="dialog" aria-modal="true">
      <div className={styles.msgWindow}>
        <div className={styles.msgHeader}>
          <span className={styles.msgDot} />
          {msg.from ? `Message from ${msg.from}` : 'A message from your instructor'}
        </div>
        <p className={styles.msgText}>{msg.text}</p>
        <button className={`btn-primary ${styles.msgBtn}`} onClick={dismiss} type="button">
          Got it
        </button>
      </div>
    </div>
  )
}
