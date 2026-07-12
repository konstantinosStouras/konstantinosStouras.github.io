import { useState, useEffect } from 'react'
import { doc, onSnapshot, updateDoc, serverTimestamp, db } from '../utils/db'
import { useAuth } from '../context/AuthContext'
import styles from './NudgeBanner.module.css'

/**
 * NudgeBanner
 *
 * Shows a gentle "please wrap up" banner in two situations:
 * 1. The instructor nudges this participant from the host control room
 *    (writes `nudgedAt` on the participant doc). Dismissing writes
 *    `nudgeAckAt`, so a later nudge with a newer timestamp shows again.
 * 2. An automatic nudge: the page passes `autoMessage` when it detects this
 *    participant is the bottleneck (everyone else in the group has
 *    submitted). Dismissing hides it locally; an instructor nudge still
 *    takes precedence and shows its own text.
 */
export default function NudgeBanner({ sessionId, autoMessage }) {
  const { user } = useAuth()
  const [nudgedAt, setNudgedAt] = useState(null)
  const [ackAt, setAckAt] = useState(null)
  const [dismissedFor, setDismissedFor] = useState(0)
  const [autoDismissed, setAutoDismissed] = useState(false)

  useEffect(() => {
    if (!sessionId || !user) return
    const unsub = onSnapshot(
      doc(db, 'sessions', sessionId, 'participants', user.uid),
      snap => {
        const data = snap.data() || {}
        setNudgedAt(data.nudgedAt || null)
        setAckAt(data.nudgeAckAt || null)
      }
    )
    return unsub
  }, [sessionId, user])

  const nudgedSec = nudgedAt?.seconds || 0
  const instructorShow = nudgedSec > Math.max(ackAt?.seconds || 0, dismissedFor)
  const autoShow = !!autoMessage && !autoDismissed
  if (!instructorShow && !autoShow) return null

  function dismiss() {
    if (instructorShow) {
      setDismissedFor(nudgedSec)
      updateDoc(doc(db, 'sessions', sessionId, 'participants', user.uid), {
        nudgeAckAt: serverTimestamp(),
      }).catch(err => console.warn('Could not ack nudge:', err.message))
    } else {
      setAutoDismissed(true)
    }
  }

  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        {instructorShow ? (
          <>
            <strong>A note from your instructor:</strong> please wrap up and submit so the session can move on.
          </>
        ) : (
          <>
            <strong>Your group is waiting:</strong> {autoMessage}
          </>
        )}
      </span>
      <button className={styles.dismissBtn} onClick={dismiss} type="button" title="Dismiss">
        Got it
      </button>
    </div>
  )
}
