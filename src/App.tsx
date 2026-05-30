import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './shared/hooks/useAuth'
import LoginPage from './pages/auth/LoginPage'
import HomePage from './pages/HomePage'

// ── Lazy-loaded modules — each chunk only loads when navigated ─
// This reduces initial bundle from 1.26MB → ~250KB
const TipsModule    = lazy(() => import('./modules/tips/TipsModule'))
const AdminModule   = lazy(() => import('./modules/admin/AdminModule'))
const CashModule    = lazy(() => import('./modules/cash/CashModule'))
const VentasModule  = lazy(() => import('./modules/ventas/VentasModule'))
const ResumenDiario = lazy(() => import('./modules/resumen/ResumenDiario'))
const SOPsModule    = lazy(() => import('./modules/sops/SOPsModule'))

// ── Loading fallback — same spinner used for auth ──────────────
function ModuleLoading({ kanji = '祭' }: { kanji?: string }) {
  return <div className="loading-screen"><span className="loading-mark">{kanji}</span></div>
}

// ── Route guards ───────────────────────────────────────────────
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <ModuleLoading />
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <ModuleLoading />
  return user ? <Navigate to="/" replace /> : <>{children}</>
}

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <ModuleLoading />
  if (!profile) return <Navigate to="/login" replace />
  return profile.role === 'owner' ? <>{children}</> : <Navigate to="/" replace />
}

// ── App ────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Suspense fallback={<ModuleLoading />}>
      <Routes>
        <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/"         element={<PrivateRoute><HomePage /></PrivateRoute>} />
        <Route path="/resumen"  element={<PrivateRoute><ResumenDiario /></PrivateRoute>} />
        <Route path="/propinas" element={<PrivateRoute><TipsModule /></PrivateRoute>} />
        <Route path="/caja"     element={<PrivateRoute><CashModule /></PrivateRoute>} />
        <Route path="/ventas"   element={<PrivateRoute><VentasModule /></PrivateRoute>} />
        <Route path="/sops"     element={<PrivateRoute><SOPsModule /></PrivateRoute>} />
        <Route path="/admin"    element={<OwnerRoute><AdminModule /></OwnerRoute>} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/satori-app">
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
