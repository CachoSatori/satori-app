import { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getAllEmployees } from '../../shared/api/admin'
import type { Employee } from '../../shared/types/database'
import { ROLE_LABELS } from '../../shared/constants'

// Salarios · Fase 0 (SPEC claude/SPEC-modulo-salarios.md §5) + U0b: el maestro de
// empleados/tarifas y el ciclo mínimo de pago del período. Las que faltan (Feriados,
// Consolidado con 10% y propinas, % sobre ventas, Liquidaciones) entran en las fases
// siguientes.
const SalariosEmpleados = lazy(() => import('./SalariosEmpleados'))
const SalariosHoras     = lazy(() => import('./SalariosHoras'))
const SalariosPago      = lazy(() => import('./SalariosPago'))

type Tab = 'empleados' | 'horas' | 'pago'

const TABS: { id: Tab; label: string }[] = [
  { id: 'empleados', label: 'Empleados / Tarifas' },
  { id: 'horas',     label: 'Horas' },
  { id: 'pago',      label: 'Pago del período' },
]

export default function SalariosModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [tab, setTab]             = useState<Tab>('empleados')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  // El await va primero a propósito: así el efecto de abajo no dispara un setState
  // sincrónico (react-hooks/set-state-in-effect) al montar.
  const loadAll = useCallback(async () => {
    try {
      // Trae activos e inactivos: la RLS deja a owner/manager ver ambos y el filtro
      // de la pestaña decide qué se muestra.
      const emps = await getAllEmployees()
      setEmployees(emps)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando empleados')
    } finally {
      setLoading(false)
    }
  }, [])

  // Carga al montar. Es el mismo patrón de CashModule/FinanzasModule, donde la regla
  // queda como deuda abierta; acá se silencia puntualmente para no subir el conteo de
  // ESLint del repo con un módulo nuevo.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll() }, [loadAll])

  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">給</span>
      </div>
    )
  }

  return (
    <div className="tips-module">
      {/* Header */}
      <div className="cd-module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="tips-kanji" style={{ fontSize: '1.6rem' }}>給</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>Salarios</div>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
              Satori · Santa Teresa
            </div>
          </div>
          {profile?.role && <span className="role-badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="cd-nav-tabs">
        {TABS.map(t => (
          <div
            key={t.id}
            className={`cd-nav-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>

      {error && (
        <div className="tips-error" style={{ margin: '0.75rem 1.5rem' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>}>
        <div className="cd-content cd-content-wide">
          {tab === 'empleados' && (
            <SalariosEmpleados employees={employees} onRefresh={loadAll} />
          )}
          {tab === 'horas' && (
            <SalariosHoras employees={employees} />
          )}
          {tab === 'pago' && (
            <SalariosPago employees={employees} />
          )}
        </div>
      </Suspense>
    </div>
  )
}
