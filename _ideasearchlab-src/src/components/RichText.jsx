import DOMPurify from 'dompurify'

// Harden any new-tab links against reverse-tabnabbing.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * RichText
 *
 * Renders instructor-authored HTML copy safely. The copy is produced by the
 * admin RichTextEditor (bold, italic, underline, strikethrough, lists, colour,
 * highlight, links, line breaks) and stored on the session. We sanitise it with
 * DOMPurify before rendering and fill in {placeholders} (e.g. {minutes}).
 *
 * Props:
 *   html     - the stored HTML string
 *   vars     - optional map of {placeholder} replacements
 *   aiOn     - when set, blocks starting with "[AI]" are kept (true, marker
 *              stripped) or removed entirely (false); unset leaves them as-is
 *   inline   - render inline (span) instead of block (div)
 *   className - extra class names appended to the rich-text wrapper
 *   as       - override the wrapper element/tag
 */

// Inline-only tags for single-line fields (titles, buttons, question text).
const INLINE_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'a', 'br', 'font']
// Block tags additionally allowed for paragraph/body fields.
const BLOCK_TAGS = [...INLINE_TAGS, 'p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote']
const ALLOWED_ATTR = ['style', 'color', 'href', 'target', 'rel', 'class']

function fillVars(html, vars) {
  const str = html == null ? '' : String(html)
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, key) =>
    key in vars ? String(vars[key]) : m
  )
}

export function sanitize(html, { inline = false } = {}) {
  return DOMPurify.sanitize(html == null ? '' : String(html), {
    ALLOWED_TAGS: inline ? INLINE_TAGS : BLOCK_TAGS,
    ALLOWED_ATTR,
    // Force links to open safely in a new tab.
    ADD_ATTR: ['target'],
  })
}

/**
 * Conditional AI lines: any block (paragraph, list item, heading) whose text
 * starts with "[AI]" is removed when aiOn is false, and rendered without the
 * marker when aiOn is true. Lets one default text serve both AI conditions —
 * no more "(Remove this line if AI is turned off.)" manual editing.
 */
export function applyAiCondition(html, aiOn) {
  const str = html == null ? '' : String(html)
  if (!/\[AI\]/i.test(str)) return str

  const root = document.createElement('div')
  root.innerHTML = str
  const BLOCKS = 'p, li, h1, h2, h3, h4, div, blockquote'

  root.querySelectorAll(BLOCKS).forEach(el => {
    if (el.querySelector(BLOCKS)) return // act on the innermost block only
    const text = (el.textContent || '').trim()
    if (!text.toUpperCase().startsWith('[AI]')) return

    if (aiOn) {
      // Keep the line, drop the marker from its first non-empty text node.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim()) {
          node.nodeValue = node.nodeValue.replace(/^\s*\[AI\]\s*/i, '')
          break
        }
      }
    } else {
      const parent = el.parentNode
      el.remove()
      // Remove a list left with no items.
      if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL') && parent.children.length === 0) {
        parent.remove()
      }
    }
  })

  return root.innerHTML
}

// True when the HTML has no visible text or media once tags are stripped.
export function isHtmlEmpty(html) {
  if (html == null) return true
  const text = String(html)
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim()
  return text === ''
}

export default function RichText({ html, vars, aiOn, inline = false, className = '', as }) {
  const Tag = as || (inline ? 'span' : 'div')
  let processed = fillVars(html, vars)
  if (aiOn !== undefined) processed = applyAiCondition(processed, !!aiOn)
  const clean = sanitize(processed, { inline })
  const base = inline ? 'richText richTextInline' : 'richText'
  return (
    <Tag
      className={`${base}${className ? ' ' + className : ''}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
