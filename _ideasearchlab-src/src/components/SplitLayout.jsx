import { useRef, useState, useEffect, useCallback } from 'react'
import styles from './SplitLayout.module.css'

/**
 * SplitLayout
 * Renders a left panel and optional right panel separated by a draggable divider.
 * When rightPanel is null, left panel fills 100% and divider is hidden.
 *
 * Props:
 *   leftPanel    - React node
 *   rightPanel   - React node | null
 *   defaultSplit - initial left panel width as percentage (default 55)
 *   minLeft      - minimum left % (default 30)
 *   maxLeft      - maximum left % (default 75)
 */
export default function SplitLayout({
  leftPanel,
  rightPanel,
  defaultSplit = 55,
  minLeft = 30,
  maxLeft = 75,
}) {
  const containerRef = useRef(null)
  const [leftPct, setLeftPct] = useState(rightPanel ? defaultSplit : 100)
  const dragging = useRef(false)

  // Sync when rightPanel appears/disappears
  useEffect(() => {
    setLeftPct(rightPanel ? defaultSplit : 100)
  }, [!!rightPanel, defaultSplit])

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    // Safari < 17 only exposes the prefixed property to CSSOM, so the unprefixed
    // assignment above is silently dropped and text highlights while dragging.
    document.body.style.webkitUserSelect = 'none'
  }, [])

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(maxLeft, Math.max(minLeft, pct)))
    }

    function onMouseUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    document.body.style.webkitUserSelect = ''
    }

    window.addEventListener('pointermove', onMouseMove)
    window.addEventListener('pointerup', onMouseUp)
    return () => {
      window.removeEventListener('pointermove', onMouseMove)
      window.removeEventListener('pointerup', onMouseUp)
    }
  }, [minLeft, maxLeft])

  const hasRight = !!rightPanel

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ '--left-pct': `${leftPct}%` }}
    >
      <div className={styles.leftPanel}>
        {leftPanel}
      </div>

      {hasRight && (
        <>
          <div
            className={styles.divider}
            onPointerDown={onMouseDown}
            title="Drag to resize"
          >
            <div className={styles.dividerHandle} />
          </div>

          <div className={styles.rightPanel}>
            {rightPanel}
          </div>
        </>
      )}
    </div>
  )
}
