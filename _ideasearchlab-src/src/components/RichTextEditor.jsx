import { useEffect, useRef, useState } from 'react'
import styles from './RichTextEditor.module.css'

/**
 * RichTextEditor
 *
 * A self-contained WYSIWYG editor (no external editor dependency) used in the
 * admin panel so instructors can format participant-facing copy like in Word:
 * font family, font size, bold, italic, underline, strikethrough, text colour,
 * highlight, bullet/numbered lists, alignment (left/centre/right/justify),
 * links, line breaks. The value is plain HTML, stored on the session and
 * rendered by <RichText />.
 *
 * The font and size dropdowns reflect the formatting at the caret (they update
 * as you move the cursor), and applying one changes the current selection.
 *
 * Props:
 *   value       - current HTML string
 *   onChange    - (html) => void, called on every edit
 *   inline      - single-line mode (hides block controls, blocks Enter)
 *   placeholder - faint hint shown when empty
 */

const FONTS = [
  { label: 'Default', value: '' },
  { label: 'DM Sans', value: '"DM Sans", sans-serif' },
  { label: 'DM Serif Display', value: '"DM Serif Display", Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
]

const SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '40', '48']

const normFam = s => (s || '').toLowerCase().replace(/["']/g, '').replace(/\s+/g, '')

// Small alignment glyph (four lines arranged per alignment).
function AlignIcon({ type }) {
  const widths = type === 'justify' ? [10, 10, 10, 10] : [10, 6, 9, 5]
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      {widths.map((w, i) => {
        const y = 2.5 + i * 3
        let x1 = 2, x2 = 2 + w
        if (type === 'center') { x1 = (14 - w) / 2; x2 = x1 + w }
        else if (type === 'right') { x2 = 12; x1 = 12 - w }
        return <line key={i} x1={x1} y1={y} x2={x2} y2={y} />
      })}
    </svg>
  )
}

export default function RichTextEditor({ value, onChange, inline = false, placeholder = '' }) {
  const ref = useRef(null)
  const savedRange = useRef(null)
  const wrapRef = useRef(null)
  const resizeStart = useRef(null)
  const [curFont, setCurFont] = useState('')
  const [curSize, setCurSize] = useState('')

  // Sync external value (initial load + "reset to defaults") without stealing
  // the caret while the user is actively typing.
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== (value || '')) {
      el.innerHTML = value || ''
    }
  }, [value])

  // Reflect the font family / size at the caret in the dropdowns (like Word).
  useEffect(() => {
    function readActiveFormats() {
      const root = ref.current
      if (!root) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.anchorNode
      if (!node || !root.contains(node)) return
      // Remember the in-editor selection so we can restore it after a dropdown
      // or colour picker steals focus.
      savedRange.current = sel.getRangeAt(0).cloneRange()
      const el = node.nodeType === 3 ? node.parentElement : node
      if (!el) return
      const cs = window.getComputedStyle(el)
      const px = Math.round(parseFloat(cs.fontSize) || 0)
      setCurSize(px ? String(px) : '')
      const match = FONTS.find(o => o.value && normFam(o.value) === normFam(cs.fontFamily))
      setCurFont(match ? match.value : '')
    }
    document.addEventListener('selectionchange', readActiveFormats)
    return () => document.removeEventListener('selectionchange', readActiveFormats)
  }, [])

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML)
  }

  // Re-focus the editor and restore the last in-editor selection. Needed before
  // applying a command from a control (font/size dropdown, colour picker) that
  // took focus away from the contentEditable.
  function focusAndRestore() {
    const el = ref.current
    if (!el) return
    el.focus()
    const r = savedRange.current
    if (r) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  // Run an execCommand using CSS styling (so colour/font/align produce inline
  // styles rather than deprecated <font> attributes).
  function exec(command, arg) {
    focusAndRestore()
    try { document.execCommand('styleWithCSS', false, true) } catch { /* ignore */ }
    document.execCommand(command, false, arg)
    emit()
    ref.current?.focus()
  }

  // Apply an arbitrary pixel font size. execCommand('fontSize') only accepts
  // 1–7, so we tag the selection with size 7 then rewrite it to the real px.
  function applyFontSize(px) {
    const el = ref.current
    if (!el) return
    focusAndRestore()
    try { document.execCommand('styleWithCSS', false, false) } catch { /* ignore */ }
    document.execCommand('fontSize', false, '7')
    el.querySelectorAll('font[size="7"]').forEach(f => {
      f.removeAttribute('size')
      f.style.fontSize = `${px}px`
    })
    emit()
    el.focus()
  }

  function applyFont(family) {
    // "Default" maps to the app body font rather than removeFormat, so picking
    // it never strips bold/italic/etc. from the selection.
    exec('fontName', family || '"DM Sans", sans-serif')
  }

  function addLink() {
    const url = window.prompt('Link URL (include https://):', 'https://')
    if (url) exec('createLink', url)
  }

  function handleKeyDown(e) {
    if (inline && e.key === 'Enter') e.preventDefault()
  }

  // Custom corner drag-handle resize (the native CSS `resize` grip renders
  // inconsistently across browsers/themes). Grows the whole editor window
  // right/down; CSS min-width/min-height stop it collapsing.
  function resizePointerDown(e) {
    const el = wrapRef.current
    if (!el) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight }
  }

  function resizePointerMove(e) {
    const s = resizeStart.current
    const el = wrapRef.current
    if (!s || !el) return
    el.style.width = `${s.w + e.clientX - s.x}px`
    el.style.height = `${s.h + e.clientY - s.y}px`
  }

  function resizePointerUp(e) {
    resizeStart.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // mouseDown + preventDefault keeps the text selection inside the editor.
  const btn = (label, title, onClick) => (
    <button
      type="button"
      className={styles.toolBtn}
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
    >
      {label}
    </button>
  )

  const sizeOptions = curSize && !SIZES.includes(curSize) ? [curSize, ...SIZES] : SIZES

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${inline ? '' : styles.wrapBlock}`}>
      <div className={styles.toolbar}>
        {!inline && (
          <>
            <select
              className={styles.toolSelect}
              value={curFont}
              title="Font"
              onChange={e => { applyFont(e.target.value); setCurFont(e.target.value) }}
            >
              {FONTS.map(f => (
                <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className={`${styles.toolSelect} ${styles.sizeSelect}`}
              value={curSize}
              title="Font size"
              onChange={e => { const v = e.target.value; if (v) applyFontSize(v); setCurSize(v) }}
            >
              <option value="">Size</option>
              {sizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className={styles.sep} />
          </>
        )}

        {btn(<b>B</b>, 'Bold (Ctrl+B)', () => exec('bold'))}
        {btn(<i>I</i>, 'Italic (Ctrl+I)', () => exec('italic'))}
        {btn(<u>U</u>, 'Underline (Ctrl+U)', () => exec('underline'))}
        {btn(<s>S</s>, 'Strikethrough', () => exec('strikeThrough'))}

        <span className={styles.sep} />
        <label className={styles.colorBtn} title="Text colour">
          <span className={styles.colorGlyph}>A</span>
          <input type="color" defaultValue="#c8562a"
            onChange={e => exec('foreColor', e.target.value)} onMouseDown={e => e.stopPropagation()} />
        </label>
        <label className={styles.colorBtn} title="Highlight">
          <span className={styles.colorGlyph} style={{ background: '#ffe27a' }}>H</span>
          <input type="color" defaultValue="#ffe27a"
            onChange={e => exec('hiliteColor', e.target.value)} onMouseDown={e => e.stopPropagation()} />
        </label>

        {!inline && (
          <>
            <span className={styles.sep} />
            {btn('• List', 'Bullet list', () => exec('insertUnorderedList'))}
            {btn('1. List', 'Numbered list', () => exec('insertOrderedList'))}
            <span className={styles.sep} />
            {btn(<AlignIcon type="left" />, 'Align left', () => exec('justifyLeft'))}
            {btn(<AlignIcon type="center" />, 'Align centre', () => exec('justifyCenter'))}
            {btn(<AlignIcon type="right" />, 'Align right', () => exec('justifyRight'))}
            {btn(<AlignIcon type="justify" />, 'Justify', () => exec('justifyFull'))}
          </>
        )}

        <span className={styles.sep} />
        {btn('🔗', 'Insert link', addLink)}
        {btn('⨯', 'Clear formatting', () => exec('removeFormat'))}
      </div>

      <div
        ref={ref}
        className={`${styles.editable} ${inline ? styles.editableInline : ''} richText`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyDown={handleKeyDown}
      />

      {!inline && (
        <div
          className={styles.resizeHandle}
          title="Drag to resize"
          onPointerDown={resizePointerDown}
          onPointerMove={resizePointerMove}
          onPointerUp={resizePointerUp}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M10 1 1 10M10 5.5 5.5 10M10 10h0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
