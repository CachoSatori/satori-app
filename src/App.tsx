import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './shared/hooks/useAuth'
import LoginPage from './pages/auth/LoginPage'
import HomePage from './pages/HomePage'
import TipsModule from './modules/tips/TipsModule'
import AdminModule from './modules/admin/AdminModule'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><span className="loading-mark">祭</span></div>
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><span className="loading-mark">祭</span></div>
  return user ? <Navigate to="/" replace /> : <>{children}</>
}

// Ruta solo para owner
function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <div className="loading-screen"><span className="loading-mark">祭</span></div>
  if (!profile) return <Navigate to="/login" replace />
  return profile.role === 'owner' ? <>{children}</> : <Navigate to="/" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/"         element={<PrivateRoute><HomePage /></PrivateRoute>} />
      <Route path="/propinas" element={<PrivateRoute><TipsModule /></PrivateRoute>} />
      <Route path="/admin"    element={<OwnerRoute><AdminModule /></OwnerRoute>} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
