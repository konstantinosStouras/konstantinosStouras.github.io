import { useEffect, useRef } from 'react'
import styles from './ResizeDivider.module.css'

/**
 * ResizeDivider
 * A draggable splitter bar that lets the user resize the region *before* it
 * inside a flex container, by dragging its border. The parent owns the size
 * state and applies it (e.g. as flex-basis); this component only reports the
 * dragged-to percentage so the surrounding layout structure is unchanged.
 *
 * Props:
 *   direction    - 'x' vertical bar dragged left/right (resizes width)
 *                  'y' horizontal bar dragged up/down (resizes height)
 *   containerRef - ref to the flex container the percentage is measured against
 *   onResize     - (pct: number) => void, leading region size as % of container
 *   min, max     - clamp for pct (defaults 15 / 85)
 */
export default function ResizeDivider({ direction = 'x', containerRef, onResize, min = 15, max = 85 }) {
  const dragging = useRef(false)
  const vertical = direction === 'y' // horizontal bar, dragged up/down

  function onDown(e) {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    function move(e) {
      if (!dragging.current || !containerRef?.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = vertical
        ? ((e.clientY - rect.top) / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width) * 100
      onResize(Math.min(max, Math.max(min, pct)))
    }
    function up() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [containerRef, onResize, min, max, vertical])

  return (
    <div
      className={vertical ? styles.dividerY : styles.dividerX}
      onMouseDown={onDown}
      title="Drag to resize"
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
    >
      <div className={vertical ? styles.gripY : styles.gripX} />
    </div>
  )
}
