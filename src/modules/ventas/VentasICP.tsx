/**
 * VentasICP — Índice de Conversión de Propina
 * Ported from SATORI PROPINAS standalone app (renderPropinasGerencial)
 *
 * ICP = (propina electrónica declarada por el salonero / ventas netas del salonero) × 100
 *
 * Numerador: la propina ELECTRÓNICA que el cliente deja voluntariamente (tarjeta/SINPE),
 * `tip_amount_crc + tip_amount_usd × TC` — la MISMA función que Mi Rendimiento
 * (`sumElectronicTips`). El 10 % de servicio es un impuesto aparte: no está en el numerador
 * ni en el denominador. Lo cobrado del reparto del pool (`payout_crc`) se muestra en su propia
 * columna y NO entra al ICP.
 *
 * «ICP restaurante» = Σ propina electrónica del mes / Σ ventas de los saloneros
 * (`icpEquipoDelMes`, el mismo benchmark de Mi Rendimiento).
 *
 * Barra (barman/barback): no tiene mesas propias, así que el ICP no aplica.
 *
 * Thresholds (from standalone app):
 *   ≥ 13%  → excellent (green)
 *   10-13% → good (gold)
 *   < 10%  → needs improvement (red)
 *
 * Las ventas salen de `dias` (FUENTE_VENTAS, las mismas del módulo); las propinas de
 * `tip_entries` (solo lectura), vinculadas por `clavesPropinaDeEmpleado`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { DiasMap } from '../../shared/types/ventas'
import type { Employee } from '../../shared/types/database'
import {
  aggSalonero, allSaloneros, allDates,
  fi, availableMonths, fmtMonthLabel,
} from './ventasUtils'

// Local normName since ventasUtils doesn't export it — keeps ICP self-contained
function normName(s: string): string {
  return s.toLowerCase()
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]/g, '')
}
import { getAttendanceHistory } from '../../shared/api/tips'
import { getAllEmployees } from '../../shared/api/admin'
import type { AttendanceRow } from '../../shared/api/tips'
import type { ProductMap } from '../../shared/types/ventas'
import { clavesPropinaDeEmpleado, nombresDeEmpleados } from '../../shared/ndf/personasNdf'
import { computeICP, electronicTipCrc, icpEquipoDelMes } from './miRendimientoUtils'

/** Roles de barra: sin mesas propias, el ICP no aplica. */
const ROLES_BARRA = new Set(['barman', 'barback'])

interface Props {
  dias: DiasMap
  pm:   ProductMap
}

// ── ICP color thresholds ───────────────────────────────────────
function icpColor(icp: number): string {
  if (icp >= 13) return 'var(--vt-green)'
  if (icp >= 10) return 'var(--vt-gold-dark, #a07830)'
  return 'var(--vt-red)'
}
function icpLabel(icp: number): string {
  if (icp >= 13) return 'Excelente'
  if (icp >= 10) return 'Bueno'
  return 'A mejorar'
}

export default function VentasICP({ dias, pm }: Props) {
  const [tipData, setTipData]       = useState<AttendanceRow[]>([])
  const [employees, setEmployees]   = useState<Employee[]>([])
  const [loading, setLoading]       = useState(true)

  const dates   = useMemo(() => allDates(dias), [dias])
  const months  = useMemo(() => availableMonths(dias, {}), [dias])
  const [month, setMonth] = useState(months[0] ?? '')

  useEffect(() => {
    Promise.all([getAttendanceHistory(12), getAllEmployees()])
      .then(([tips, emps]) => { setTipData(tips); setEmployees(emps) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const sals = useMemo(() => allSaloneros(dias), [dias])
  // `pos_login → full_name` de los empleados: el mismo mapa que usa el ranking para nombrar.
  const nombres = useMemo(() => nombresDeEmpleados(employees), [employees])

  // Bajo qué claves van las propinas de un empleado: `pos_login` si matchea; si no, `pos_name` +
  // `full_name` como siempre. La regla vive en `personasNdf` (`clavesPropinaDeEmpleado`).
  const clavesDeEmpleado = useCallback(
    (emp: Employee): string[] => clavesPropinaDeEmpleado(emp, nombres, sals, normName),
    [nombres, sals],
  )

  // Tip data indexed by normalized name — prefers pos_login, then pos_name (exact POS match)
  const empTipMap = useMemo(() => {
    const m: Record<string, { propina: number; payout: number; hours: number; shifts: number; roles: Set<string> }> = {}
    const add = (key: string, propina: number, payout: number, hours: number, role: string) => {
      if (!m[key]) m[key] = { propina: 0, payout: 0, hours: 0, shifts: 0, roles: new Set() }
      m[key].propina += propina
      m[key].payout  += payout
      m[key].hours   += hours
      m[key].shifts++
      m[key].roles.add(role)
    }
    for (const r of tipData) {
      if (month && !r.session_date.startsWith(month)) continue
      const emp = employees.find(e => e.id === r.employee_id)
      if (!emp) continue
      const propina = electronicTipCrc(r)
      const payout  = r.payout_crc ?? 0
      const hours   = r.hours_worked ?? 0
      for (const k of clavesDeEmpleado(emp)) add(k, propina, payout, hours, emp.role)
    }
    return m
  }, [tipData, employees, month, clavesDeEmpleado])

  // Ventas dates for selected month
  const monthDates = useMemo(() => {
    const all = allDates(dias)
    if (!month) return all
    return all.filter(d => d.startsWith(month))
  }, [dates, month, dias])

  // Build ICP per salonero
  const icpData = useMemo(() => {
    return sals.map(name => {
      const agg  = aggSalonero(name, monthDates, dias, pm)
      const key  = normName(name)
      const tips = empTipMap[key]
      const propina = tips?.propina ?? 0
      const payout  = tips?.payout ?? 0
      const shifts  = tips?.shifts ?? 0
      const hours   = tips?.hours  ?? 0
      // Barra: los turnos del mes que matchean esta clave son TODOS de barman/barback.
      const barra   = !!tips && tips.roles.size > 0 && [...tips.roles].every(r => ROLES_BARRA.has(r))
      const icp     = barra ? 0 : computeICP(propina, agg.total)
      const propTurno = shifts > 0 ? payout / shifts : 0
      const propHora  = hours  > 0 ? payout / hours  : 0
      return {
        name,
        ventas:    agg.total,
        pax:       agg.pax,
        promPax:   agg.promPax,
        days:      agg.days,
        propina,
        payout,
        barra,
        shifts,
        hours,
        icp,
        propTurno,
        propHora,
        matched:   !!tips,
      }
    })
    .filter(d => d.days > 0)
    // Barra al final: no compite en el ranking del ICP.
    .sort((a, b) => Number(a.barra) - Number(b.barra) || b.icp - a.icp)
  }, [sals, monthDates, dias, pm, empTipMap])

  // ICP restaurante: el MISMO benchmark de Mi Rendimiento (Σ propina electrónica del mes /
  // Σ ventas de saloneros). Lo cobrado del reparto se muestra aparte.
  const rest = useMemo(
    () => icpEquipoDelMes(tipData.filter(r => !month || r.session_date.startsWith(month)), monthDates, dias, pm),
    [tipData, month, monthDates, dias, pm],
  )
  const restVentas  = rest.ventas
  const restPropina = rest.gen
  const restICP     = rest.icp
  const restPayout  = icpData.reduce((s, d) => s + d.payout, 0)

  // Monthly historical ICP — misma fórmula, mes por mes.
  const monthlyICP = useMemo(() => {
    return months.slice(0, 6).map(ym => {
      const mDates = allDates(dias).filter(d => d.startsWith(ym))
      const r = icpEquipoDelMes(tipData.filter(t => t.session_date.startsWith(ym)), mDates, dias, pm)
      return { ym, ventas: r.ventas, propina: r.gen, icp: r.icp }
    }).reverse()
  }, [months, dias, pm, tipData])

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--vt-muted)' }}>Cargando datos…</div>
  }

  if (!months.length || icpData.length === 0) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">心</div>
        <div className="vt-empty-title">Sin datos para calcular ICP</div>
        <div className="vt-empty-sub">
          Necesitás ventas del mes y al menos un turno de propinas cerrado en el mismo mes
        </div>
      </div>
    )
  }

  return (
    <div className="vt-section">
      <div className="vt-sl" style={{ marginBottom: '0.4rem' }}>Índice de Conversión de Propina</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--vt-muted)', marginBottom: '1.25rem' }}>
        ICP = propina electrónica declarada (tarjeta/SINPE) / ventas netas × 100 · No incluye el 10 % de servicio ni lo cobrado del reparto · ≥13% excelente · 10-13% bueno · &lt;10% a mejorar · Barra: no aplica
      </div>

      {/* Month picker — desplegable */}
      <div className="vt-range-bar" style={{ marginBottom: '1.25rem' }}>
        <select className="date-filter active" value={month} onChange={e => setMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{fmtMonthLabel(m)}</option>)}
        </select>
      </div>

      {/* Restaurant ICP + historical trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Restaurant-level KPI */}
        <div className="vt-kpi" style={{ borderLeftColor: icpColor(restICP) }}>
          <div className="vt-kpi-label">ICP Restaurante — {fmtMonthLabel(month)}</div>
          <div className="vt-kpi-val" style={{ fontSize: '2rem', color: icpColor(restICP) }}>
            {restICP.toFixed(1)}%
          </div>
          <div className="vt-kpi-sub" style={{ color: icpColor(restICP) }}>
            {icpLabel(restICP)}
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#aaa' }}>
            {fi(restPropina)} propina electrónica / {fi(restVentas)} vendido por saloneros
          </div>
        </div>

        {/* Monthly trend */}
        <div className="vt-kpi">
          <div className="vt-kpi-label" style={{ marginBottom: '0.75rem' }}>Tendencia mensual</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: 60 }}>
            {monthlyICP.map(d => {
              const maxICP = Math.max(...monthlyICP.map(x => x.icp), 1)
              const h = Math.round((d.icp / maxICP) * 100)
              const [, mm] = d.ym.split('-')
              const MNAMES: Record<string, string> = { '01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic' }
              return (
                <div key={d.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ fontSize: '0.55rem', color: icpColor(d.icp), fontWeight: 700 }}>
                    {d.icp > 0 ? d.icp.toFixed(1) + '%' : '—'}
                  </div>
                  <div style={{ width: '100%', height: `${h}%`, minHeight: 2, background: icpColor(d.icp), borderRadius: 2, transition: 'height 0.3s' }} />
                  <div style={{ fontSize: '0.6rem', color: '#555' }}>{MNAMES[mm] ?? mm}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Per-salonero ICP table */}
      <div className="vt-sl">Por salonero — {fmtMonthLabel(month)}</div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Salonero</th>
              <th className="r">Ventas</th>
              <th className="r">Propina electrónica</th>
              <th className="r">ICP</th>
              <th className="r">Nivel</th>
              <th className="r">Turnos</th>
              <th className="r">Horas</th>
              <th className="r">Cobrado del reparto</th>
              <th className="r">Cobrado/turno</th>
              <th className="r">Cobrado/hora</th>
              <th className="r">Prom/PAX</th>
            </tr>
          </thead>
          <tbody>
            {icpData.map((d, i) => (
              <tr key={d.name} className={i === 0 && !d.barra ? 'tr-best' : ''}>
                <td className="vt-muted" style={{ fontWeight: 700 }}>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>
                  {d.name}
                  {!d.matched && (
                    <span style={{ fontSize: '0.62rem', color: '#888', marginLeft: '0.4rem' }}
                      title="No se encontró este salonero en los registros de propinas">⚠</span>
                  )}
                </td>
                <td className="r">{fi(d.ventas)}</td>
                <td className="r" style={{ fontWeight: 600, color: d.propina > 0 ? 'var(--vt-green)' : '#888' }}>
                  {d.propina > 0 ? fi(d.propina) : '—'}
                </td>
                <td className="r">
                  {d.barra ? (
                    <span className="vt-muted" style={{ fontSize: '0.72rem' }}
                      title="Barra no tiene mesas propias: el ICP no aplica">no aplica a barra</span>
                  ) : (
                  <span style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: '1rem',
                    fontWeight: 800,
                    color: d.icp > 0 ? icpColor(d.icp) : '#555',
                  }}>
                    {d.icp > 0 ? d.icp.toFixed(1) + '%' : '—'}
                  </span>
                  )}
                </td>
                <td className="r">
                  {!d.barra && d.icp > 0 && (
                    <span style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: 99,
                      background: `${icpColor(d.icp)}22`,
                      color: icpColor(d.icp),
                    }}>
                      {icpLabel(d.icp)}
                    </span>
                  )}
                </td>
                <td className="r vt-muted">{d.shifts > 0 ? d.shifts : '—'}</td>
                <td className="r vt-muted">{d.hours > 0 ? d.hours.toFixed(0) + 'h' : '—'}</td>
                <td className="r vt-muted">{d.payout > 0 ? fi(d.payout) : '—'}</td>
                <td className="r" style={{ fontSize:'0.8rem', color: d.propTurno > 0 ? '#7ec8a0' : '#555' }}>
                  {d.propTurno > 0 ? fi(d.propTurno) : '—'}
                </td>
                <td className="r" style={{ fontSize:'0.8rem', color: d.propHora > 0 ? '#c8a96e' : '#555' }}>
                  {d.propHora > 0 ? fi(d.propHora) : '—'}
                </td>
                <td className="r">{fi(d.promPax)}</td>
              </tr>
            ))}
          </tbody>
          {icpData.length > 0 && (
            <tfoot>
              <tr className="vt-tbl-footer">
                <td colSpan={2}>RESTAURANTE</td>
                <td className="r">{fi(restVentas)}</td>
                <td className="r">{fi(restPropina)}</td>
                <td className="r" style={{ color: icpColor(restICP), fontWeight: 800 }}>
                  {restICP.toFixed(1)}%
                </td>
                <td colSpan={3}></td>
                <td className="r">{fi(restPayout)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Per-salonero monthly ICP sparklines */}
      {icpData.filter(d => d.days > 0 && d.icp > 0 && !d.barra).length > 0 && months.length > 1 && (
        <>
          <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Tendencia ICP por salonero</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {icpData.filter(d => d.icp > 0 && !d.barra).map(d => {
              const sparkData = months.slice(0, 6).map(ym => {
                const mDates = allDates(dias).filter(date => date.startsWith(ym))
                const mAgg   = aggSalonero(d.name, mDates, dias, pm)
                const mPay   = (() => {
                  const m: Record<string, number> = {}
                  tipData.filter(r => r.session_date.startsWith(ym)).forEach(r => {
                    const emp = employees.find(e => e.id === r.employee_id)
                    if (!emp) return
                    clavesDeEmpleado(emp).forEach(k => { m[k] = (m[k] ?? 0) + electronicTipCrc(r) })
                  })
                  return m[normName(d.name)] ?? 0
                })()
                return { ym, icp: computeICP(mPay, mAgg.total) }
              }).reverse()
              const hasData = sparkData.some(s => s.icp > 0)
              if (!hasData) return null
              const MNAMES: Record<string, string> = { '01':'E','02':'F','03':'M','04':'A','05':'M','06':'J','07':'J','08':'A','09':'S','10':'O','11':'N','12':'D' }
              return (
                <div key={d.name} style={{ background: 'var(--vt-ink)', borderRadius: 2, padding: '0.75rem 0.875rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--vt-paper)', marginBottom: '0.5rem' }}>
                    {d.name}
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'flex-end', height: 32 }}>
                    {sparkData.map(s => {
                      const h = s.icp > 0 ? Math.min(100, (s.icp / 20) * 100) : 0
                      const [, mm] = s.ym.split('-')
                      return (
                        <div key={s.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <div style={{ width: '100%', height: `${h}%`, minHeight: s.icp > 0 ? 2 : 0, background: icpColor(s.icp), borderRadius: 1, transition: 'height 0.3s' }} />
                          <div style={{ fontSize: '0.5rem', color: '#444' }}>{MNAMES[mm] ?? mm}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: icpColor(d.icp), fontWeight: 700, marginTop: '0.3rem' }}>
                    {d.icp.toFixed(1)}% — {icpLabel(d.icp)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Info note about matching */}
      {icpData.some(d => !d.matched) && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: '#888', display: 'flex', gap: '0.4rem' }}>
          <span>⚠</span>
          <span>
            Algunos saloneros no matchearon con el sistema de propinas.
            Configurá el campo <strong>Nombre en POS</strong> en Admin → Empleados
            con el nombre exacto del archivo XLS (ej: "JOTA" si en el POS aparece así).
          </span>
        </div>
      )}
    </div>
  )
}
