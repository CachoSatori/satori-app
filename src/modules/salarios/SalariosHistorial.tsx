import { useState, useEffect, useCallback } from 'react'
import type { Employee, EmployeePayment, SalaryPeriod } from '../../shared/types/database'
import { getSalaryPeriods, getPeriodPayments, ESTADO_LABEL } from '../../shared/api/salarios'
import { fi } from '../../shared/utils'

// Salarios · pestaña HISTORIAL (SPEC-UI v3 §8).
//
// La trazabilidad de lo que YA se pagó: qué período, cuánto se transfirió y a cuánta
// gente. Sale de `employee_payments`, que es append-only y sobrevive a una reapertura:
// es la evidencia de lo que salió del banco.
//
// Lo que el SPEC pide y todavía NO tiene tabla —cambios de tarifa, correcciones de horas
// y reaperturas con su motivo— NO se inventa acá. Se dice qué falta y se deja el lugar.

interface Props { employees: Employee[] }

interface FilaPago {
  period: SalaryPeriod
  pagos:  EmployeePayment[]
  total:  number
}

export default function SalariosHistorial({ employees }: Props) {
  const [filas, setFilas]     = useState<FilaPago[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const ps = await getSalaryPeriods()
      // Solo los períodos que llegaron a PAGADO: el historial es de plata que salió,
      // no de períodos que existen.
      const pagados = ps.filter(p => p.estado === 'pagado')
      const out = await Promise.all(pagados.map(async period => {
        const pagos = await getPeriodPayments(period.id)
        return { period, pagos, total: pagos.reduce((s, x) => s + Number(x.monto_neto || 0), 0) }
      }))
      setFilas(out)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando el historial')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const nombreDe = (id: string) =>
    employees.find(e => e.id === id)?.full_name ?? '—'

  if (loading) {
    return <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45 }}>⏳</p>
  }

  return (
    <div className="admin-section">
      <div className="sal-phead">
        <div>
          <div className="sal-eyebrow">Trazabilidad</div>
          <h2>Historial</h2>
          <p>Cada período pagado: cuánto se transfirió, a cuánta gente y cuándo.</p>
        </div>
      </div>

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}

      {filas.length === 0 ? (
        // Vacío HONESTO: todavía no se pagó ningún período por acá. Nada de filas de
        // ejemplo — un historial inventado es peor que un historial vacío.
        <p style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontSize: '0.85rem' }}>
          Todavía no hay períodos pagados. Cuando se marque el primero en{' '}
          <strong>Período de pago</strong>, aparece acá con su monto y su detalle.
        </p>
      ) : (
        <div className="sal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Período</th>
                <th className="is-num">Transferido</th>
                <th className="is-num">Personas</th>
                <th>Método</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.period.id}>
                  <td>
                    <span className="sal-name">{f.period.fecha_ini} → {f.period.fecha_fin}</span>
                    <span className="sal-name-meta">
                      {f.pagos.slice(0, 3).map(p => nombreDe(p.employee_id)).join(', ')}
                      {f.pagos.length > 3 && ` y ${f.pagos.length - 3} más`}
                    </span>
                  </td>
                  <td className="is-num"><span className="sal-money-pagar">{fi(f.total)}</span></td>
                  <td className="is-num">{f.pagos.length}</td>
                  <td>{f.pagos[0]?.metodo ?? 'transferencia'}</td>
                  <td><span className="sal-pill is-ok is-plain">{ESTADO_LABEL[f.period.estado]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="sal-legend" style={{ padding: '0 12px' }}>
        El SPEC pide además <strong>cambios de tarifa</strong>, <strong>correcciones de
        horas</strong> y <strong>reaperturas con su motivo</strong> en esta misma línea de
        tiempo. Hoy no hay tabla de auditoría que los junte —`employee_wage_rates` guarda
        la tarifa vigente pero no quién la cambió ni cuándo— así que no se muestran:
        media auditoría se lee como la auditoría entera y es peor que ninguna.
      </p>
    </div>
  )
}
