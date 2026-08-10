import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { SessionProvider } from './context/SessionContext'
import { RequireAuth, RequireStudent, RequireGuest, RequireInstructor } from './components/ProtectedRoute'

import Login from './pages/Login'
import JoinSession from './pages/JoinSession'
import Welcome from './pages/Welcome'
import DemoTour from './pages/DemoTour'
import Registration from './pages/Registration'
import SessionLobby from './pages/SessionLobby'
import IndividualPhase from './pages/IndividualPhase'
import GroupPhase from './pages/GroupPhase'
import Survey, { Done } from './pages/Survey'
import UserHistory from './pages/UserHistory'
import Admin from './pages/Admin'
import AISettings from './pages/AISettings'
import DataAnalytics from './pages/DataAnalytics'
import AdminSession from './pages/AdminSession'
import AdminBroadcast from './components/AdminBroadcast'
import PreviewRibbon from './components/PreviewRibbon'

// Wraps session pages with SessionProvider using the :sessionId param.
// AdminBroadcast rides along so an instructor's group message / removal notice
// can appear over any session page the participant is on.
function SessionWrapper({ children }) {
  const { sessionId } = useParams()
  return (
    <SessionProvider sessionId={sessionId}>
      {children}
      <AdminBroadcast />
    </SessionProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <PreviewRibbon />
      <Routes>
        {/* Guest only */}
        <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />

        {/* Participant flow */}
        <Route path="/join" element={<RequireStudent><JoinSession /></RequireStudent>} />

        <Route path="/history" element={<RequireAuth><UserHistory /></RequireAuth>} />

        <Route path="/session/:sessionId/welcome" element={
          <RequireStudent>
            <SessionWrapper>
              <Welcome />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/tour" element={
          <RequireStudent>
            <SessionWrapper>
              <DemoTour />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/register" element={
          <RequireStudent>
            <SessionWrapper>
              <Registration />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId" element={
          <RequireStudent>
            <SessionWrapper>
              <SessionLobby />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/individual" element={
          <RequireStudent>
            <SessionWrapper>
              <IndividualPhase />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/group" element={
          <RequireStudent>
            <SessionWrapper>
              <GroupPhase />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/survey" element={
          <RequireStudent>
            <SessionWrapper>
              <Survey />
            </SessionWrapper>
          </RequireStudent>
        } />

        <Route path="/session/:sessionId/done" element={
          <RequireStudent>
            <SessionWrapper>
              <Done />
            </SessionWrapper>
          </RequireStudent>
        } />

        {/* Instructor flow */}
        <Route path="/admin" element={<RequireInstructor><Admin /></RequireInstructor>} />
        <Route path="/admin/ai-settings" element={<RequireInstructor><AISettings /></RequireInstructor>} />
        <Route path="/admin/data-analytics" element={<RequireInstructor><DataAnalytics /></RequireInstructor>} />
        <Route path="/admin/session/:sessionId" element={
          <RequireInstructor>
            <SessionWrapper>
              <AdminSession />
            </SessionWrapper>
          </RequireInstructor>
        } />

        {/* Default */}
        <Route path="/" element={<Navigate to="/join" replace />} />
        <Route path="*" element={<Navigate to="/join" replace />} />
      </Routes>
    </AuthProvider>
  )
}