import { useState, useEffect, useRef } from 'react'
import styles from './PhaseTimer.module.css'

/**
 * PhaseTimer
 * Props:
 *   phaseStartedAt - Firestore Timestamp
 *   durationSeconds - number | null (null = no timer)
 *   onExpire - callback when timer hits 0
 *   onTick - optional callback(remainingSeconds) fired once per second while the
 *            timer is running (not in preview). Lets a parent react to time
 *            thresholds (e.g. show a "5 minutes left" reminder) without running
 *            its own clock. Held in a ref so changing it never restarts the
 *            interval.
 *   preview - when true, the countdown has not started yet (e.g. the
 *             participant is still on the instructions screen). Shows the full
 *             duration statically without ticking down or firing onExpire/onTick.
 */
export default function PhaseTimer({ phaseStartedAt, durationSeconds, onExpire, onTick, preview = false }) {
  const [remaining, setRemaining] = useState(null)
  const onTickRef = useRef(onTick)
  useEffect(() => { onTickRef.current = onTick }, [onTick])

  useEffect(() => {
    // Preview: timer not started — show the full duration, don't tick.
    if (preview) {
      setRemaining(durationSeconds || null)
      return
    }
    if (!phaseStartedAt || !durationSeconds) {
      setRemaining(null)
      return
    }

    function tick() {
      const startMs = phaseStartedAt.toMillis ? phaseStartedAt.toMillis() : phaseStartedAt.seconds * 1000
      const endMs = startMs + durationSeconds * 1000
      const left = Math.max(0, Math.round((endMs - Date.now()) / 1000))
      setRemaining(left)
      if (onTickRef.current) onTickRef.current(left)
      if (left === 0 && onExpire) onExpire()
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phaseStartedAt, durationSeconds, onExpire])

  if (remaining === null) return null

  const mins = Math.floor(remaining / 60)
  const secs = String(remaining % 60).padStart(2, '0')
  const pct = durationSeconds ? (remaining / durationSeconds) * 100 : 100
  const urgent = remaining <= 60

  return (
    <div className={`${styles.timer} ${urgent ? styles.urgent : ''}`}>
      <svg className={styles.ring} viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.15" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeDashoffset="25"
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear' }}
        />
      </svg>
      <span className={styles.time}>{mins}:{secs}</span>
    </div>
  )
}
