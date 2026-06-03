import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './shared/hooks/useAuth'
import type { UserRole } from './shared/types/database'
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
const ReporteMensual = lazy(() => import('./modules/resumen/ReporteMensual'))
const SOPsModule       = lazy(() => import('./modules/sops/SOPsModule'))
const MisPropinas      = lazy(() => import('./modules/tips/MisPropinas'))
const InventarioModule  = lazy(() => import('./modules/inventario/InventarioModule'))
const MiRendimientoWrap = lazy(() => import('./modules/ventas/MiRendimientoWrap'))
const ClientesModule    = lazy(() => import('./modules/crm/ClientesModule'))
const FinanzasModule    = lazy(() => import('./modules/finanzas/FinanzasModule'))
const RegistroCliente   = lazy(() => import('./pages/RegistroCliente'))

// ── Loading fallback — same spinner used for auth ──────────────
function ModuleLoading({ kanji = '祭' }: { kanji?: string }) {
  return <div className="loading-screen"><span className="loading-mark">{kanji}</span></div>
}

// ── Pantalla: cuenta creada pero pendiente de aprobación ───────
function PendingApproval() {
  const { profile, signOut } = useAuth()
  return (
    <div className="login-container">
      <div className="pending-card">
        <div className="pending-mark">承</div>
        <h1>Cuenta pendiente</h1>
        <p>
          Hola{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}. Tu cuenta se creó
          correctamente pero todavía no está habilitada.<br />
          La gerencia debe asignarte un rol para darte acceso. Probá de nuevo más tarde.
        </p>
        <button className="login-btn" style={{ maxWidth: 200 }} onClick={() => signOut()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

// ── Route guards ───────────────────────────────────────────────
// `roles` opcional: si se pasa, el rol del perfil debe estar incluido,
// si no → redirige al inicio (defensa por URL, además de ocultar tiles).
function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: UserRole[] }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <ModuleLoading />
  if (!user) return <Navigate to="/login" replace />
  // Cuenta creada pero aún no aprobada por la gerencia → sin acceso
  if (profile && !profile.is_active) return <PendingApproval />
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />
  return <>{children}</>
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
        <Route path="/registro" element={<RegistroCliente />} />
        <Route path="/"         element={<PrivateRoute><HomePage /></PrivateRoute>} />
        <Route path="/resumen"  element={<PrivateRoute roles={['owner','manager','contador']}><ResumenDiario /></PrivateRoute>} />
        <Route path="/semana"   element={<PrivateRoute roles={['owner','manager','contador']}><ResumenSemanal /></PrivateRoute>} />
        <Route path="/reporte-mensual" element={<PrivateRoute roles={['owner','manager','contador']}><ReporteMensual /></PrivateRoute>} />
        <Route path="/propinas" element={<PrivateRoute roles={['owner','manager','cajero','salonero','barman','barback','runner','cocina']}><TipsModule /></PrivateRoute>} />
        <Route path="/caja"     element={<PrivateRoute roles={['owner','manager','cajero','contador']}><CashModule /></PrivateRoute>} />
        <Route path="/ventas"   element={<PrivateRoute roles={['owner','manager','contador']}><VentasModule /></PrivateRoute>} />
        <Route path="/sops"          element={<PrivateRoute><SOPsModule /></PrivateRoute>} />
        <Route path="/mis-propinas"  element={<PrivateRoute roles={['salonero','barman','barback','runner','cocina']}><MisPropinas /></PrivateRoute>} />
        <Route path="/inventario"    element={<PrivateRoute roles={['owner','manager','contador']}><InventarioModule /></PrivateRoute>} />
        <Route path="/clientes"      element={<PrivateRoute roles={['owner','manager','cajero']}><ClientesModule /></PrivateRoute>} />
        <Route path="/finanzas"      element={<PrivateRoute roles={['owner','manager','contador']}><FinanzasModule /></PrivateRoute>} />
        <Route path="/mi-rendimiento" element={<PrivateRoute roles={['salonero','barman','barback','runner','cocina']}><MiRendimientoWrap /></PrivateRoute>} />
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
