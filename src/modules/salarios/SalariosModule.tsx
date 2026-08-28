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
const SalariosEmpleados     = lazy(() => import('./SalariosEmpleados'))
const SalariosHoras         = lazy(() => import('./SalariosHoras'))
const SalariosPago          = lazy(() => import('./SalariosPago'))
const SalariosFicha         = lazy(() => import('./SalariosFicha'))
const SalariosPropinas      = lazy(() => import('./SalariosPropinas'))
const SalariosLiquidaciones = lazy(() => import('./SalariosLiquidaciones'))
const SalariosHistorial     = lazy(() => import('./SalariosHistorial'))

// Las 8 pestañas del SPEC-UI v3, en su orden. Personal y Tarifas son la MISMA lista
// con dos lecturas (`vista`), no dos componentes: la edición de plata vive en un solo
// lugar.
type Tab =
  | 'personal' | 'ficha' | 'tarifas' | 'horas'
  | 'propinas' | 'pago' | 'liquidacion' | 'historial'

const TABS: { id: Tab; label: string }[] = [
  { id: 'personal',    label: 'Personal' },
  { id: 'ficha',       label: 'Ficha' },
  { id: 'tarifas',     label: 'Tarifas' },
  { id: 'horas',       label: 'Horas' },
  { id: 'propinas',    label: 'Propinas' },
  { id: 'pago',        label: 'Período de pago' },
  { id: 'liquidacion', label: 'Liquidaciones' },
  { id: 'historial',   label: 'Historial' },
]

export default function SalariosModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [tab, setTab]             = useState<Tab>('personal')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const activos = employees.filter(e => e.is_active).length

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

      {/* Nav tabs — las 8 del SPEC-UI v3. Siguen siendo una sola ruta: el módulo cambia
          de panel, no de URL. */}
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
            {t.id === 'personal' && activos > 0 && (
              <span className="sal-tab-cnt">{activos}</span>
            )}
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
          {tab === 'personal' && (
            <SalariosEmpleados employees={employees} onRefresh={loadAll} vista="personal" />
          )}
          {tab === 'ficha' && (
            <SalariosFicha employees={employees} onRefresh={loadAll} />
          )}
          {tab === 'tarifas' && (
            <SalariosEmpleados employees={employees} onRefresh={loadAll} vista="tarifas" />
          )}
          {tab === 'horas' && (
            <SalariosHoras employees={employees} />
          )}
          {tab === 'propinas' && (
            <SalariosPropinas employees={employees} />
          )}
          {tab === 'pago' && (
            <SalariosPago employees={employees} />
          )}
          {tab === 'liquidacion' && (
            <SalariosLiquidaciones employees={employees} />
          )}
          {tab === 'historial' && (
            <SalariosHistorial employees={employees} />
          )}
        </div>
      </Suspense>
    </div>
  )
}
