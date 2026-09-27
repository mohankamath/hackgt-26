import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import HomePage from './pages/HomePage'

// Route-level code splitting keeps the login page light (Recharts is dashboard-only).
const ParentDashboard = lazy(() => import('./pages/ParentDashboard'))
const ChildChat = lazy(() => import('./pages/ChildChat'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function Loading() {
  return (
    <div className="min-h-screen bg-soft-peach-50 flex items-center justify-center">
      <p className="text-ink-black-300 text-sm">Loading…</p>
    </div>
  )
}

function App() {
  const { user } = useAuth()

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={user ? <Navigate to={user.role === 'parent' ? '/parent-dashboard' : '/child-chat'} replace /> : <HomePage />} />
        <Route path="/parent-dashboard" element={user?.role === 'parent' ? <ParentDashboard /> : <Navigate to="/" replace />} />
        <Route path="/child-chat" element={user?.role === 'child' ? <ChildChat /> : <Navigate to="/" replace />} />
        <Route path="/settings" element={user?.role === 'parent' ? <SettingsPage /> : <Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
