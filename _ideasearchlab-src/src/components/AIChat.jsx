import { useState, useEffect, useRef } from 'react'
import {
  collection, addDoc, onSnapshot, orderBy, query, serverTimestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAuth } from '../context/AuthContext'
import styles from './AIChat.module.css'

/**
 * AIChat
 * Props:
 *   sessionId  - string
 *   scope      - 'individual' | 'group'
 *   scopeId    - uid (individual) or groupId (group)
 *   aiConfig   - session aiConfig object
 */
export default function AIChat({ sessionId, scope, scopeId, aiConfig }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [userHeight, setUserHeight] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const chatPath = `sessions/${sessionId}/aiMessages`

  // Listen to messages for this scope
  useEffect(() => {
    if (!sessionId || !scopeId) return
    const q = query(
      collection(db, chatPath),
      orderBy('timestamp', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      const msgs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.scopeId === scopeId && m.scope === scope)
      setMessages(msgs)
    })
    return unsub
  }, [sessionId, scopeId, scope])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Grow the input box with its content so the whole message stays visible
  // (up to a cap, after which it scrolls) — UNLESS the user has manually
  // resized it by dragging the top handle, in which case keep their height.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (userHeight != null) { el.style.height = `${userHeight}px`; return }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [input, userHeight])

  async function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)

    try {
      // Optimistically add user message to Firestore
      await addDoc(collection(db, chatPath), {
        role: 'user',
        text,
        scope,
        scopeId,
        authorId: user.uid,
        authorName: user.displayName || user.email,
        timestamp: serverTimestamp(),
      })

      // Call Cloud Function to get AI response
      const sendAIMessage = httpsCallable(functions, 'sendAIMessage')
      await sendAIMessage({
        sessionId,
        scope,
        scopeId,
        userMessage: text,
      })
    } catch (err) {
      console.error('AI message error:', err)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e)
    }
  }

  // Let the user drag the top border of the input to resize it — dragging up
  // makes it taller. Sets an explicit height that overrides the content
  // auto-grow (kept sticky until they drag again).
  function startResize(e) {
    e.preventDefault()
    const el = inputRef.current
    if (!el) return
    const startY = e.clientY
    const startH = el.getBoundingClientRect().height
    const maxH = Math.min(460, Math.round(window.innerHeight * 0.6))
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    function move(ev) {
      setUserHeight(Math.max(52, Math.min(maxH, startH + (startY - ev.clientY))))
    }
    function up() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>AI Assistant</span>
        <span className={styles.badge}>{scope}</span>
      </div>

      <div className={styles.messageList}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>◈</div>
            <p>Ask the AI anything to help with your ideation.</p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : styles.aiMsg}`}
          >
            {msg.role === 'assistant' && (
              <span className={styles.aiLabel}>AI</span>
            )}
            {msg.role === 'user' && (
              <span className={styles.userLabel}>{msg.authorName?.split(' ')[0] || 'You'}</span>
            )}
            <div className={styles.bubble}>
              {msg.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className={`${styles.message} ${styles.aiMsg}`}>
            <span className={styles.aiLabel}>AI</span>
            <div className={`${styles.bubble} ${styles.typing}`}>
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className={styles.inputRow} onSubmit={sendMessage}>
        <div className={styles.inputWrap}>
          {/* Drag this top handle to resize the input (taller when dragged up) */}
          <div
            className={styles.resizeHandle}
            onMouseDown={startResize}
            title="Drag to resize"
            role="separator"
            aria-orientation="horizontal"
          >
            <div className={styles.resizeGrip} />
          </div>
          {/* Not disabled while sending: the participant can keep typing their
              next question while the AI is thinking. Submitting is still gated on
              `sending` (button + handleKeyDown) so requests don't overlap. */}
          <textarea
            ref={inputRef}
            className={styles.input}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something... (Enter to send)"
            rows={2}
          />
        </div>
        <button
          className={`btn-primary ${styles.sendBtn}`}
          type="submit"
          disabled={sending || !input.trim()}
        >
          {sending ? '...' : '→'}
        </button>
      </form>
    </div>
  )
}
