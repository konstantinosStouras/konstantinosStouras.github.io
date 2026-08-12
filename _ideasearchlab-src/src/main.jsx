import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import './styles/globals.css'

// ── Older-Safari safety net ────────────────────────────────────────────────
// Vite's default build target is Safari 14, but a runtime API a DEPENDENCY
// calls is neither transpiled nor polyfilled by the bundler. `marked` (the
// markdown renderer used for AI replies) calls `Array.prototype.at`, which
// only landed in Safari 15.4 — so on macOS Big Sur / Monterey < 15.4 and
// iPadOS 15.0–15.3 the AI panel would throw "…at is not a function" mid-render
// and take the page down with it. Two lines make those browsers work.
if (!Array.prototype.at) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Array.prototype, 'at', {
    value: function at(n) {
      const i = Math.trunc(n) || 0
      return this[i < 0 ? this.length + i : i]
    },
    writable: true, configurable: true,
  })
}
if (!String.prototype.at) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(String.prototype, 'at', {
    value: function at(n) {
      const i = Math.trunc(n) || 0
      return this[i < 0 ? this.length + i : i]
    },
    writable: true, configurable: true,
  })
}

/**
 * There was no error boundary anywhere above the participant flow, and React 18
 * unmounts the entire root on an uncaught render error — so one unexpected data
 * shape (a survey question with no options, a group doc that hasn't been created
 * yet) left a student staring at a blank white page mid-session, with a reload
 * reproducing it every time. A student should always get a way forward.
 */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error, info) { console.error('Unhandled render error:', error, info) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: 'var(--paper, #f5f2eb)', color: 'var(--ink, #1a1815)',
        fontFamily: 'system-ui, sans-serif', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 20 }}>
            Your work so far has been saved. Reload this page to carry on — if it happens
            again, tell your instructor.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 28px', fontSize: 15, borderRadius: 22, border: 'none',
              background: 'var(--accent, #c8562a)', color: '#fff', cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

// Nothing reported a rejected write, so an unhandled rejection vanished entirely.
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/lab/ideasearchlab">
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
) 
