import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import HomePage from './pages/HomePage'
import { Logo } from './components/common/ui'

// Route-level code splitting keeps the login page light (Recharts is dashboard-only).
const ParentDashboard = lazy(() => import('./pages/ParentDashboard'))
const ChildChat = lazy(() => import('./pages/ChildChat'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function Loading() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-3">
      <span className="animate-pulse"><Logo size={40} /></span>
      <p className="text-muted text-sm m-0">Loading…</p>
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
