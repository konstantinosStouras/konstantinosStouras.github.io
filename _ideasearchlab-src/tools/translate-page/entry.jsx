// Renders ONLY the admin Data Analytics page — no RequireInstructor, no
// AuthProvider, no real Firebase (vite resolves every firebase import to
// ./stubs, see ../translate-page-guard.mjs). Same providers the app wraps it in.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../src/context/ThemeContext'
import DataAnalytics from '../../src/pages/DataAnalytics'
import '../../src/styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/admin/data-analytics']}>
      <ThemeProvider>
        <DataAnalytics />
      </ThemeProvider>
    </MemoryRouter>
  </React.StrictMode>
)
