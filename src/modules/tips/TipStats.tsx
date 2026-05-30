/**
 * TipStats — Estadísticas de propinas para el manager
 * Pool analytics, AM vs PM, distribución por día de semana,
 * top earners, tendencia semanal dentro del mes
 */
import { useState, useMemo } from 'react'
import type { TipSession, Employee } from '../../shared/types/database'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'
import { formatCRC } from '../../shared/utils/tipCalculations'

interface Props {
  sessions:  TipSession[]
  calcCache: Record<string, HistoryCalc>
  employees: Employee[]
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

export default function TipStats({ sessions, calcCache, employees }: Props) {
  const months = useMemo(() => getMonths(sessions), [sessions])
  const [month, setMonth] = useState(months[0] ?? '')

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Sessions for selected month
  const monthSessions = useMemo(() =>
    sessions.filter(s => s.status === 'closed' && s.session_date.startsWith(month)),
  [sessions, month])

  // AM vs PM split
  const amSessions = monthSessions.filter(s => s.shift_type === 'AM')
  const pmSessions = monthSessions.filter(s => s.shift_type === 'PM')

  const getPoolTotal = (ss: TipSession[]) =>
    ss.reduce((t, s) => {
      const c = calcCache[s.id]
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
      const calc = calcCache[s.id]
      if (!calc) continue
      const d = new Date(s.session_date + 'T12:00:00').getDay()
      if (!acc[d]) acc[d] = { sum: 0, cnt: 0 }
      acc[d].sum += calc.totalPool
      acc[d].cnt++
    }
    return acc
  }, [monthSessions, calcCache])

  // Top earners
  const earners = useMemo(() => {
    const acc: Record<string, { name: string; role: string; total: number; shifts: number }> = {}
    for (const s of monthSessions) {
      const calc = calcCache[s.id]
      if (!calc) continue
      for (const row of calc.rows) {
        const emp = empMap.get(row.employeeId)
        if (!emp || row.payout_crc <= 0) continue
        if (!acc[emp.id]) acc[emp.id] = { name: emp.full_name, role: emp.role, total: 0, shifts: 0 }
        acc[emp.id].total  += row.payout_crc
        acc[emp.id].shifts++
      }
    }
    return Object.values(acc).sort((a, b) => b.total - a.total)
  }, [monthSessions, calcCache, empMap])

  // Weekly trend within month
  const weeklyData = useMemo(() => {
    const weeks: Record<number, { pool: number; shifts: number }> = {}
    for (const s of monthSessions) {
      const day = parseInt(s.session_date.slice(8, 10))
      const week = Math.ceil(day / 7)
      if (!weeks[week]) weeks[week] = { pool: 0, shifts: 0 }
      const c = calcCache[s.id]
      weeks[week].pool   += c?.totalPool ?? 0
      weeks[week].shifts++
    }
    return Object.entries(weeks).map(([w, d]) => ({ week: Number(w), ...d })).sort((a, b) => a.week - b.week)
  }, [monthSessions, calcCache])

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
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--t-ink)', padding: '0.875rem 1rem', borderRadius: 2, borderLeft: '3px solid var(--t-gold)' }}>
                <div style={{ fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#555', marginBottom: '0.4rem' }}>{k.label}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: '1rem', fontWeight: 800, color: k.color || 'var(--t-gold)' }}>{k.val}</div>
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

          {/* Top earners */}
          {earners.length > 0 && (
            <>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a5040', marginBottom: '0.625rem' }}>
                Top empleados del mes
              </div>
              <table className="admin-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }}>Empleado</th>
                    <th style={{ textAlign: 'right' }}>Turnos</th>
                    <th style={{ textAlign: 'right' }}>Total cobrado</th>
                    <th style={{ textAlign: 'right' }}>Promedio/turno</th>
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
    </div>
  )
}
