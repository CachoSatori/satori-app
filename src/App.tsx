import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './shared/hooks/useAuth'
import LoginPage from './pages/auth/LoginPage'
import HomePage from './pages/HomePage'

// ── Lazy-loaded modules — each chunk only loads when navigated ─
// This reduces initial bundle from 1.26MB → ~250KB
const TipsModule    = lazy(() => import('./modules/tips/TipsModule'))
const AdminModule   = lazy(() => import('./modules/admin/AdminModule'))
const CashModule    = lazy(() => import('./modules/cash/CashModule'))
const VentasModule  = lazy(() => import('./modules/ventas/VentasModule'))
const ResumenDiario  = lazy(() => import('./modules/resumen/ResumenDiario'))
const ResumenSemanal = lazy(() => import('./modules/resumen/ResumenSemanal'))
const SOPsModule       = lazy(() => import('./modules/sops/SOPsModule'))
const MisPropinas      = lazy(() => import('./modules/tips/MisPropinas'))
const InventarioModule = lazy(() => import('./modules/inventario/InventarioModule'))

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

// ── Floating home button — always visible on sub-routes ────────
function FloatingHomeBtn() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { user }  = useAuth()
  // Don't show on home, login, or when not logged in
  if (!user || location.pathname === '/' || location.pathname === '/login') return null
  return (
    <button
      onClick={() => navigate('/')}
      aria-label="Volver al inicio"
      style={{
        position:     'fixed',
        bottom:       '1.25rem',
        right:        '1rem',
        zIndex:       9999,
        background:   '#1a1a1a',
        border:       '1px solid #333',
        borderRadius: '50%',
        width:        44,
        height:       44,
        display:      'flex',
        alignItems:   'center',
        justifyContent:'center',
        cursor:       'pointer',
        fontSize:     '1.1rem',
        boxShadow:    '0 2px 12px rgba(0,0,0,0.6)',
        color:        '#c8a96e',
        transition:   'opacity .2s, transform .2s',
        opacity:      0.85,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
    >
      🏠
    </button>
  )
}

// ── App ────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Suspense fallback={<ModuleLoading />}>
      <Routes>
        <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/"         element={<PrivateRoute><HomePage /></PrivateRoute>} />
        <Route path="/resumen"  element={<PrivateRoute><ResumenDiario /></PrivateRoute>} />
        <Route path="/semana"   element={<PrivateRoute><ResumenSemanal /></PrivateRoute>} />
        <Route path="/propinas" element={<PrivateRoute><TipsModule /></PrivateRoute>} />
        <Route path="/caja"     element={<PrivateRoute><CashModule /></PrivateRoute>} />
        <Route path="/ventas"   element={<PrivateRoute><VentasModule /></PrivateRoute>} />
        <Route path="/sops"          element={<PrivateRoute><SOPsModule /></PrivateRoute>} />
        <Route path="/mis-propinas"  element={<PrivateRoute><MisPropinas /></PrivateRoute>} />
        <Route path="/inventario"    element={<PrivateRoute><InventarioModule /></PrivateRoute>} />
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
        <FloatingHomeBtn />
      </BrowserRouter>
    </AuthProvider>
  )
}
