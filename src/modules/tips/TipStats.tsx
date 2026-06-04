/**
 * TipStats — Estadísticas de propinas para el manager
 * Pool analytics, AM vs PM, distribución por día de semana,
 * top earners, tendencia semanal dentro del mes
 */
import { useState, useMemo, useEffect } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'
import { formatCRC, calcHistory } from '../../shared/utils/tipCalculations'
import { getTipEntriesBySession, getAttendanceHistory } from '../../shared/api/tips'
import type { AttendanceRow } from '../../shared/api/tips'

interface Props {
  sessions:   TipSession[]
  calcCache:  Record<string, HistoryCalc>
  employees:  Employee[]
  rolePoints: RoleTipPoints[]
}

function getMonths(sessions: TipSession[]): string[] {
  const m = new Set<string>()
  sessions.filter(s => s.status === 'closed').forEach(s => m.add(s.session_date.slice(0, 7)))
  return [...m].sort().reverse()
}

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES: Record<string, string> = {
  '01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun',
  '07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic',
}

export default function TipStats({ sessions, calcCache, employees, rolePoints }: Props) {
  const months = useMemo(() => getMonths(sessions), [sessions])
  const [month, setMonth] = useState(months[0] ?? '')

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // ── Filtro por empleado (ver propinas de una persona por quincena/mes) ──
  const [selEmp, setSelEmp] = useState('')                 // '' = todos (vista agregada)
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  useEffect(() => {
    getAttendanceHistory(12).then(setAttendance).catch(() => {})
  }, [])

  // Resumen por mes (Q1/Q2) del empleado seleccionado — como en "Mis Propinas".
  const empByMonth = useMemo(() => {
    if (!selEmp) return []
    const acc: Record<string, { q1Days:number; q1Hours:number; q1Earn:number; q2Days:number; q2Hours:number; q2Earn:number }> = {}
    for (const r of attendance) {
      if (r.employee_id !== selEmp) continue
      const ym = r.session_date.slice(0, 7)
      const day = Number(r.session_date.slice(8, 10))
      if (!acc[ym]) acc[ym] = { q1Days:0, q1Hours:0, q1Earn:0, q2Days:0, q2Hours:0, q2Earn:0 }
      const e = acc[ym]
      if (day <= 15) { e.q1Days++; e.q1Hours += r.hours_worked; e.q1Earn += r.payout_crc ?? 0 }
      else           { e.q2Days++; e.q2Hours += r.hours_worked; e.q2Earn += r.payout_crc ?? 0 }
    }
    return Object.entries(acc).sort((a, b) => b[0].localeCompare(a[0]))
  }, [selEmp, attendance])

  const empTotals = useMemo(() => {
    const rows = attendance.filter(r => r.employee_id === selEmp)
    return {
      earn:   rows.reduce((s, r) => s + (r.payout_crc ?? 0), 0),
      hours:  rows.reduce((s, r) => s + r.hours_worked, 0),
      shifts: rows.length,
    }
  }, [selEmp, attendance])

  // Sessions for selected month
  const monthSessions = useMemo(() =>
    sessions.filter(s => s.status === 'closed' && s.session_date.startsWith(month)),
  [sessions, month])

  // ── Auto-carga: calcular el reparto de las sesiones del mes que no estén
  // ya en el cache compartido (antes Stats quedaba vacío si no se visitaba
  // Historial primero). Solo carga lo necesario del mes seleccionado.
  const [localCache, setLocalCache] = useState<Record<string, HistoryCalc>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const missing = monthSessions.filter(s => !calcCache[s.id] && !localCache[s.id])
    if (!missing.length) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const out: Record<string, HistoryCalc> = {}
      for (const s of missing) {
        try {
          const entries = await getTipEntriesBySession(s.id)
          out[s.id] = calcHistory(
            entries.map(e => ({
              employee_id: e.employee_id, hours_worked: e.hours_worked,
              tip_amount_crc: e.tip_amount_crc, tip_amount_usd: e.tip_amount_usd,
              points: e.points, payout_crc: e.payout_crc,
            })),
            employees.map(e => ({ id: e.id, full_name: e.full_name, role: e.role })),
            rolePoints,
            { pool_efectivo_crc: s.pool_efectivo_crc, pool_efectivo_usd: s.pool_efectivo_usd, pool_barra_crc: s.pool_barra_crc, exchange_rate: s.exchange_rate },
          )
        } catch { /* ignorar sesión con error y seguir */ }
      }
      if (!cancelled) { setLocalCache(prev => ({ ...prev, ...out })); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [monthSessions, calcCache, localCache, employees, rolePoints])

  // Cache efectivo = compartido + el cargado localmente
  const cache = useMemo(() => ({ ...calcCache, ...localCache }), [calcCache, localCache])

  // AM vs PM split
  const amSessions = monthSessions.filter(s => s.shift_type === 'AM')
  const pmSessions = monthSessions.filter(s => s.shift_type === 'PM')

  const getPoolTotal = (ss: TipSession[]) =>
    ss.reduce((t, s) => {
      const c = cache[s.id]
      return t + (c?.totalPool ?? 0)
    }, 0)

  const totalPool  = getPoolTotal(monthSessions)
  const amPool     = getPoolTotal(amSessions)
  const pmPool     = getPoolTotal(pmSessions)
  const avgPerShift = monthSessions.length > 0 ? totalPool / monthSessions.length : 0

  // Day of week averages
  const dowData = useMemo(() => {
    const acc: Record<number, { sum: number; cnt: number }> = {}
    for (const s of monthSessions) {
      const calc = cache[s.id]
      if (!calc) continue
      const d = new Date(s.session_date + 'T12:00:00').getDay()
      if (!acc[d]) acc[d] = { sum: 0, cnt: 0 }
      acc[d].sum += calc.totalPool
      acc[d].cnt++
    }
    return acc
  }, [monthSessions, cache])

  // Top earners with AM/PM split + datáfono generado (lo que ingresó cada uno
  // por su datáfono) vs recibido (lo que se llevó del pool).
  const earners = useMemo(() => {
    const acc: Record<string, { name: string; role: string; total: number; generated: number; shifts: number; amTotal: number; amShifts: number; pmTotal: number; pmShifts: number }> = {}
    for (const s of monthSessions) {
      const calc = cache[s.id]
      if (!calc) continue
      const isAM = s.shift_type === 'AM'
      for (const row of calc.rows) {
        const emp = empMap.get(row.employeeId)
        if (!emp) continue
        const gen = Math.round((row.propina_crc || 0) + (row.propina_usd || 0) * (s.exchange_rate || 0))
        if (row.payout_crc <= 0 && gen <= 0) continue
        if (!acc[emp.id]) acc[emp.id] = { name: emp.full_name, role: emp.role, total: 0, generated: 0, shifts: 0, amTotal: 0, amShifts: 0, pmTotal: 0, pmShifts: 0 }
        acc[emp.id].total     += row.payout_crc
        acc[emp.id].generated += gen
        acc[emp.id].shifts++
        if (isAM) { acc[emp.id].amTotal += row.payout_crc; acc[emp.id].amShifts++ }
        else       { acc[emp.id].pmTotal += row.payout_crc; acc[emp.id].pmShifts++ }
      }
    }
    return Object.values(acc).sort((a, b) => b.total - a.total)
  }, [monthSessions, cache, empMap])

  // Datáfono del mes: generado (tarjeta/efectivo individual) vs pool recibido.
  // Las sesiones viejas (pre-mayo) no tienen datáfono → generado = 0; el KPI
  // simplemente queda en ₡0 sin romper nada.
  const totalGenerated = useMemo(() => earners.reduce((s, e) => s + e.generated, 0), [earners])

  // Weekly trend within month
  const weeklyData = useMemo(() => {
    const weeks: Record<number, { pool: number; shifts: number }> = {}
    for (const s of monthSessions) {
      const day = parseInt(s.session_date.slice(8, 10))
      const week = Math.ceil(day / 7)
      if (!weeks[week]) weeks[week] = { pool: 0, shifts: 0 }
      const c = cache[s.id]
      weeks[week].pool   += c?.totalPool ?? 0
      weeks[week].shifts++
    }
    return Object.entries(weeks).map(([w, d]) => ({ week: Number(w), ...d })).sort((a, b) => a.week - b.week)
  }, [monthSessions, cache])

  if (!months.length) {
    return (
      <div className="tips-empty-state">
        <p className="tips-empty-text">Sin turnos cerrados aún</p>
      </div>
    )
  }

  // month available for future use (display label in header etc)

  return (
    <div>
      {/* Filtro por empleado */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#5a5040', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Empleado:</span>
        <select className="tips-input-dark" value={selEmp} onChange={e => setSelEmp(e.target.value)}
          style={{ minWidth: 200 }}>
          <option value="">— Todos (vista general) —</option>
          {[...employees].sort((a, b) => a.full_name.localeCompare(b.full_name)).map(e => (
            <option key={e.id} value={e.id}>{e.full_name}{e.is_active ? '' : ' (inactivo)'}</option>
          ))}
        </select>
      </div>

      {/* ── Vista por empleado (quincena/mes) ── */}
      {selEmp && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.625rem', marginBottom: '1rem' }}>
            {[
              { label: 'Total (12m)', val: formatCRC(empTotals.earn),  color: 'var(--t-gold)' },
              { label: 'Turnos',      val: String(empTotals.shifts),    color: '' },
              { label: 'Horas',       val: empTotals.hours.toFixed(1) + 'h', color: 'var(--t-teal)' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--t-ink)', padding: '0.875rem 1rem', borderRadius: 2, borderLeft: '3px solid var(--t-gold)' }}>
                <div style={{ fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#555', marginBottom: '0.4rem' }}>{k.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1rem', fontWeight: 800, color: k.color || 'var(--t-paper)' }}>{k.val}</div>
              </div>
            ))}
          </div>

          {empByMonth.length === 0 ? (
            <div className="tips-empty-state"><p className="tips-empty-text">Sin propinas registradas para este empleado</p></div>
          ) : (
            <table className="admin-table" style={{ width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Mes</th>
                  <th style={{ textAlign: 'right' }}>Turnos</th>
                  <th style={{ textAlign: 'right' }}>Horas</th>
                  <th style={{ textAlign: 'right', color: 'var(--t-teal)' }}>Q1 (1-15)</th>
                  <th style={{ textAlign: 'right', color: 'var(--t-gold)' }}>Q2 (16-fin)</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {empByMonth.map(([ym, d]) => {
                  const [y, mm] = ym.split('-')
                  const total = d.q1Earn + d.q2Earn
                  return (
                    <tr key={ym} className="admin-row">
                      <td style={{ fontWeight: 600 }}>{MONTH_NAMES[mm] ?? mm} {y}</td>
                      <td style={{ textAlign: 'right', color: '#5a5040' }}>{d.q1Days + d.q2Days}</td>
                      <td style={{ textAlign: 'right', color: '#5a5040', fontSize: '0.74rem' }}>{(d.q1Hours + d.q2Hours).toFixed(0)}h</td>
                      <td style={{ textAlign: 'right', color: 'var(--t-teal)', fontSize: '0.76rem' }}>{d.q1Earn > 0 ? formatCRC(d.q1Earn) : '—'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--t-gold)', fontSize: '0.76rem' }}>{d.q2Earn > 0 ? formatCRC(d.q2Earn) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCRC(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!selEmp && (<>
      {/* Month picker */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#5a5040', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Mes:</span>
        {months.slice(0, 12).map(mo => {
          const [, mm] = mo.split('-')
          return (
            <button key={mo} onClick={() => setMonth(mo)}
              className={`vt-range-btn ${month === mo ? 'active' : ''}`}
              style={{ fontSize: '0.72rem' }}>
              {(MONTH_NAMES[mm] ?? mm).slice(0, 3)} {mo.slice(0, 4)}
            </button>
          )
        })}
      </div>

      {monthSessions.length === 0 ? (
        <div className="tips-empty-state">
          <p className="tips-empty-text">Sin datos para este mes</p>
        </div>
      ) : loading && totalPool === 0 ? (
        <div className="tips-empty-state">
          <p className="tips-empty-text">Calculando estadísticas…</p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.625rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Pool total',      val: formatCRC(totalPool),   color: 'var(--t-gold)' },
              { label: 'Turnos',          val: String(monthSessions.length), color: '' },
              { label: 'Promedio/turno',  val: formatCRC(avgPerShift), color: 'var(--t-teal)' },
              { label: `AM (${amSessions.length} turnos)`, val: formatCRC(amPool), color: '#c8a030' },
              { label: `PM (${pmSessions.length} turnos)`, val: formatCRC(pmPool), color: 'var(--t-teal)' },
              { label: 'Datáfono generado', val: formatCRC(totalGenerated), color: '#a07830' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--t-ink)', padding: '0.875rem 1rem', borderRadius: 2, borderLeft: '3px solid var(--t-gold)' }}>
                <div style={{ fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#555', marginBottom: '0.4rem' }}>{k.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1rem', fontWeight: 800, color: k.color || 'var(--t-gold)' }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* AM vs PM bar */}
          {amPool > 0 && pmPool > 0 && (
            <div style={{ marginBottom: '1.25rem', background: 'var(--t-panel)', border: '1px solid var(--t-border)', borderRadius: 2, padding: '0.875rem 1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a5040', marginBottom: '0.5rem' }}>
                Distribución AM vs PM
              </div>
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: '0.4rem' }}>
                <div style={{ width: `${amPool / totalPool * 100}%`, background: '#c8a030' }} />
                <div style={{ flex: 1, background: 'var(--t-teal)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                <span style={{ color: '#c8a030' }}>AM {(amPool / totalPool * 100).toFixed(1)}% · {formatCRC(amPool)}</span>
                <span style={{ color: 'var(--t-teal)' }}>PM {(pmPool / totalPool * 100).toFixed(1)}% · {formatCRC(pmPool)}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            {/* Day of week */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a5040', marginBottom: '0.625rem' }}>
                Pool promedio por día
              </div>
              {[1,2,3,4,5,6,0].map(d => {
                const v = dowData[d]
                if (!v) return null
                const avg = v.sum / v.cnt
                const maxAvg = Math.max(...Object.values(dowData).map(x => x.sum / x.cnt))
                return (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ width: 28, fontSize: '0.72rem', color: '#888' }}>{DOW_LABELS[d]}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--t-border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${avg / maxAvg * 100}%`, height: '100%', background: 'var(--t-teal)', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--t-teal)', minWidth: 80, textAlign: 'right' }}>
                      {formatCRC(avg)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Weekly trend */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a5040', marginBottom: '0.625rem' }}>
                Tendencia semanal
              </div>
              {weeklyData.map(w => {
                const maxW = Math.max(...weeklyData.map(x => x.pool))
                const label = w.week === 1 ? '1-7' : w.week === 2 ? '8-14' : w.week === 3 ? '15-21' : w.week === 4 ? '22-28' : '29-fin'
                return (
                  <div key={w.week} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ width: 36, fontSize: '0.68rem', color: '#888' }}>Sem {label}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--t-border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${w.pool / maxW * 100}%`, height: '100%', background: 'var(--t-gold)', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--t-gold)', fontWeight: 600, minWidth: 80, textAlign: 'right' }}>
                      {formatCRC(w.pool)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top earners with AM/PM split */}
          {earners.length > 0 && (
            <>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a5040', marginBottom: '0.625rem' }}>
                Empleados del mes — detalle AM/PM
              </div>
              <table className="admin-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }}>Empleado</th>
                    <th style={{ textAlign: 'right' }}>Turnos</th>
                    <th style={{ textAlign: 'right', color: '#c8a030' }}>AM</th>
                    <th style={{ textAlign: 'right', color: 'var(--t-teal)' }}>PM</th>
                    <th style={{ textAlign: 'right', color: '#a07830' }} title="Lo que ingresó por su datáfono">Generó</th>
                    <th style={{ textAlign: 'right' }} title="Lo que recibió del pool">Recibió</th>
                    <th style={{ textAlign: 'right' }}>Prom/turno</th>
                  </tr>
                </thead>
                <tbody>
                  {earners.map((e, i) => (
                    <tr key={e.name} className="admin-row">
                      <td style={{ fontWeight: 700, color: i === 0 ? '#c8a96e' : '#888' }}>
                        {i === 0 ? '🏆' : i + 1}
                      </td>
                      <td className="admin-emp-name">{e.name}</td>
                      <td style={{ textAlign: 'right', color: '#5a5040' }}>{e.shifts}</td>
                      <td style={{ textAlign: 'right', color: '#c8a030', fontSize: '0.72rem' }}>
                        {e.amShifts > 0 ? `${formatCRC(e.amTotal)} (${e.amShifts}t)` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--t-teal)', fontSize: '0.72rem' }}>
                        {e.pmShifts > 0 ? `${formatCRC(e.pmTotal)} (${e.pmShifts}t)` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#a07830', fontSize: '0.72rem' }}>
                        {e.generated > 0 ? formatCRC(e.generated) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--t-teal)' }}>
                        {formatCRC(e.total)}
                      </td>
                      <td style={{ textAlign: 'right', color: '#5a5040' }}>
                        {formatCRC(e.shifts > 0 ? e.total / e.shifts : 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      </>)}
    </div>
  )
}
