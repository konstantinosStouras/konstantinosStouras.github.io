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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/lab/ideasearchlab">
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
) 
