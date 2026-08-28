import { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getAllEmployees } from '../../shared/api/admin'
import type { Employee } from '../../shared/types/database'
import { ROLE_LABELS } from '../../shared/constants'
// Piel v3 (SPEC-UI Empleados v3). El archivo es SCOPED: todo cuelga de `.sal-v3` y no
// toca index.css ni :root, así que ningún otro módulo cambia de color por este import.
import './salarios.css'

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
    <div className="tips-module sal-v3">
      {/* Header */}
      <div className="sal-header">
        <div className="sal-brand">
          <span className="sal-kanji">給</span>
          <div>
            <div className="sal-title">Satori</div>
            <div className="sal-sub">Nómina &amp; Empleados</div>
          </div>
        </div>
        <span className="sal-spacer" />
        {profile?.role && <span className="role-badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
      </div>

      {/* Nav tabs — las MISMAS tres pestañas de siempre, con la piel v3. Este pase no
          abre rutas ni pantallas nuevas. */}
      <div className="sal-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`sal-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
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
