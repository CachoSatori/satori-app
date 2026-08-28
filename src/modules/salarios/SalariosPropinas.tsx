import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, SalaryPeriod } from '../../shared/types/database'
import { getSalaryPeriods } from '../../shared/api/salarios'
import { getTipPayoutsPorEmpleado } from '../../shared/api/tips'
import { fi } from '../../shared/utils'
import { iniciales } from './salariosUi'

// Salarios · pestaña PROPINAS (SPEC-UI v3 §5) — SOLO LECTURA.
//
// El reparto del pozo lo hace el módulo Propinas: acá se VE, no se edita. Está en
// Salarios para que el ingreso real de la persona se entienda de una sola mirada, al
// lado del salario y del 10% de servicio.
//
// Las propinas NO van al banco: se pagan en efectivo. Por eso esta pantalla no tiene
// ni Excel ni "marcar pagado" — sumarlas a la transferencia sería pagarlas dos veces.

interface Props { employees: Employee[] }

export default function SalariosPropinas({ employees }: Props) {
  const [periods, setPeriods]   = useState<SalaryPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [pozo, setPozo]         = useState<Map<string, number>>(new Map())
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const period = periods.find(p => p.id === periodId) ?? null

  const loadPeriods = useCallback(async () => {
    try {
      const ps = await getSalaryPeriods()
      setPeriods(ps)
      setPeriodId(prev => prev || (ps[0]?.id ?? ''))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando los períodos')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPeriods() }, [loadPeriods])

  const loadPozo = useCallback(async (p: SalaryPeriod | null) => {
    if (!p) { setPozo(new Map()); return }
    try {
      setPozo(await getTipPayoutsPorEmpleado(p.fecha_ini, p.fecha_fin))
      setError(null)
    } catch (e) {
      setPozo(new Map())
      setError(e instanceof Error ? e.message : 'No se pudieron leer las propinas del período')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPozo(period) }, [loadPozo, period])

  const filas = useMemo(() => {
    const activos = employees.filter(e => e.is_active)
    return activos
      .map(e => ({ emp: e, monto: pozo.get(e.id) ?? 0 }))
      .filter(f => f.monto > 0)
      .sort((a, b) => b.monto - a.monto)
  }, [employees, pozo])

  const total = filas.reduce((s, f) => s + f.monto, 0)

  if (loading) {
    return <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45 }}>⏳</p>
  }

  return (
    <div className="admin-section">
      <div className="sal-phead">
        <div>
          <div className="sal-eyebrow">Solo lectura</div>
          <h2>Propinas</h2>
          <p>El reparto lo hace el módulo de Propinas. Acá se ve, no se edita.</p>
        </div>
      </div>

      <div className="sal-periodsel">
        <span className="sal-periodsel-cur">📅</span>
        <select
          className="tip-input"
          aria-label="Período"
          value={periodId}
          onChange={e => setPeriodId(e.target.value)}
        >
          <option value="">— elegir —</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.fecha_ini} → {p.fecha_fin} · {p.estado}</option>
          ))}
        </select>
      </div>

      <p className="sal-note sal-note-teal">
        <span className="sal-note-mk">◆</span>
        <span>
          Las propinas del <strong>pozo</strong> son distintas del <strong>10% de
          servicio</strong> y del <strong>salario</strong>. El pozo se paga aparte (por
          ahora en efectivo); el 10% de servicio sí va con el salario por transferencia.
        </span>
      </p>

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}

      {!period ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Elegí un período para ver las propinas repartidas.
        </p>
      ) : filas.length === 0 ? (
        // Vacío HONESTO: no hay sesiones de propinas cerradas en el rango. No se
        // inventan filas en ₡0 para que la tabla se vea llena.
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Sin propinas repartidas en este período. El pozo se reparte y se cierra en el
          módulo <strong>Propinas</strong>.
        </p>
      ) : (
        <div className="sal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Persona</th>
                <th className="is-num">Total pozo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.emp.id}>
                  <td>
                    <div className="sal-who">
                      <span className="sal-ini">{iniciales(f.emp.full_name)}</span>
                      <span className="sal-name">{f.emp.full_name}</span>
                    </div>
                  </td>
                  <td className="is-num"><span className="sal-money-tip">{fi(f.monto)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sal-foot">
                <td>Pozo del período</td>
                <td className="is-num"><span className="sal-money-tip">{fi(total)}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="sal-legend" style={{ padding: '0 12px' }}>
        El desglose <strong>efectivo vs electrónico</strong> no se muestra: el reparto por
        empleado (<code>tip_entries.payout_crc</code>) guarda el take-home ya sumado, sin
        separar de qué medio salió. Está en el módulo Propinas, que sí tiene el dato por
        sesión. Acá se pone lo que se puede afirmar, no una estimación.
      </p>
    </div>
  )
}
