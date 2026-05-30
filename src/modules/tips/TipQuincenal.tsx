/**
 * TipQuincenal — Vista quincenal de propinas (Q1: días 1-15, Q2: días 16-fin)
 * Para liquidación de nómina quincenal
 */
import { useState, useMemo } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'
import { formatCRC } from '../../shared/utils/tipCalculations'

interface Props {
  sessions:   TipSession[]
  calcCache:  Record<string, HistoryCalc>
  employees:  Employee[]
  rolePoints: RoleTipPoints[]
}

interface EmpQuincenal {
  id:      string
  name:    string
  role:    string
  q1Days:  number
  q1Hours: number
  q1Earn:  number
  q2Days:  number
  q2Hours: number
  q2Earn:  number
  total:   number
  promDia: number
}

// Build available month list from closed sessions
function getMonths(sessions: TipSession[]): string[] {
  const m = new Set<string>()
  sessions.filter(s => s.status === 'closed').forEach(s => m.add(s.session_date.slice(0, 7)))
  return [...m].sort().reverse()
}

export default function TipQuincenal({ sessions, calcCache, employees }: Props) {
  const months     = useMemo(() => getMonths(sessions), [sessions])
  const [month, setMonth] = useState(months[0] ?? '')

  const MONTH_NAMES: Record<string, string> = {
    '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio',
    '07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre',
  }

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Sessions for selected month, split into Q1/Q2
  const { q1Sessions, q2Sessions } = useMemo(() => {
    const closed = sessions.filter(s => s.status === 'closed' && s.session_date.startsWith(month))
    const q1 = closed.filter(s => Number(s.session_date.slice(8, 10)) <= 15)
    const q2 = closed.filter(s => Number(s.session_date.slice(8, 10)) > 15)
    return { q1Sessions: q1, q2Sessions: q2 }
  }, [sessions, month])

  // Aggregate per employee
  const empData = useMemo(() => {
    const acc: Record<string, EmpQuincenal> = {}

    const processSession = (s: TipSession, isQ1: boolean) => {
      const calc = calcCache[s.id]
      if (!calc) return
      for (const row of calc.rows) {
        const emp = empMap.get(row.employeeId)
        if (!emp) continue
        if (!acc[emp.id]) acc[emp.id] = {
          id: emp.id, name: emp.full_name, role: emp.role,
          q1Days:0, q1Hours:0, q1Earn:0, q2Days:0, q2Hours:0, q2Earn:0, total:0, promDia:0,
        }
        const e = acc[emp.id]
        if (isQ1) {
          e.q1Days++;  e.q1Hours += row.hours; e.q1Earn += row.payout_crc
        } else {
          e.q2Days++;  e.q2Hours += row.hours; e.q2Earn += row.payout_crc
        }
        e.total += row.payout_crc
      }
    }

    q1Sessions.forEach(s => processSession(s, true))
    q2Sessions.forEach(s => processSession(s, false))

    const results = Object.values(acc)
      .map(e => ({ ...e, promDia: (e.q1Days + e.q2Days) > 0 ? e.total / (e.q1Days + e.q2Days) : 0 }))
      .sort((a, b) => b.total - a.total)

    return results
  }, [q1Sessions, q2Sessions, calcCache, empMap])

  const q1Total = q1Sessions.reduce((s, sess) => s + (calcCache[sess.id]?.totalPool ?? 0), 0)
  const q2Total = q2Sessions.reduce((s, sess) => s + (calcCache[sess.id]?.totalPool ?? 0), 0)
  const grandTotal = empData.reduce((s, e) => s + e.total, 0)

  if (!months.length) {
    return (
      <div className="tips-empty-state">
        <p className="tips-empty-text">Sin turnos cerrados aún</p>
      </div>
    )
  }

  const [y, m] = month.split('-')

  return (
    <div>
      {/* Month picker */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#5a5040', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Mes:</span>
        {months.slice(0, 12).map(mo => {
          const [my, mm] = mo.split('-')
          return (
            <button key={mo}
              onClick={() => setMonth(mo)}
              className={`vt-range-btn ${month === mo ? 'active' : ''}`}
              style={{ fontSize: '0.72rem' }}>
              {(MONTH_NAMES[mm] ?? mm).slice(0, 3)} {my}
            </button>
          )
        })}
      </div>

      {/* Summary header */}
      <div style={{ background: 'var(--t-ink)', borderRadius: 2, padding: '1rem 1.25rem', marginBottom: '1rem', color: 'var(--t-paper)' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', fontWeight: 700, color: 'var(--t-gold)', marginBottom: '0.75rem' }}>
          {MONTH_NAMES[m] ?? m} {y}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          {[
            { label: 'Q1 (1-15) pool', val: formatCRC(q1Total), sub: `${q1Sessions.length} turnos` },
            { label: 'Q2 (16-fin) pool', val: formatCRC(q2Total), sub: `${q2Sessions.length} turnos` },
            { label: 'Total mes', val: formatCRC(grandTotal), sub: `${q1Sessions.length + q2Sessions.length} turnos` },
          ].map(k => (
            <div key={k.label}>
              <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#555' }}>{k.label}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: '1rem', fontWeight: 800, color: 'var(--t-gold)', lineHeight: 1.2 }}>{k.val}</div>
              <div style={{ fontSize: '0.65rem', color: '#555' }}>{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {empData.length === 0 ? (
        <div className="tips-empty-state">
          <p className="tips-empty-text">No hay datos completos para este mes</p>
          <p style={{ fontSize: '0.78rem', color: '#888', marginTop: '0.25rem' }}>Los cálculos requieren que los turnos estén cerrados y calculados</p>
        </div>
      ) : (
        <>
          {/* Quincenal table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Empleado</th>
                  <th style={{ textAlign: 'center', background: 'rgba(42,122,106,0.15)' }} colSpan={3}>Q1 — días 1-15</th>
                  <th style={{ textAlign: 'center', background: 'rgba(200,169,110,0.15)' }} colSpan={3}>Q2 — días 16-fin</th>
                  <th style={{ textAlign: 'right' }}>Total mes</th>
                  <th style={{ textAlign: 'right' }}>Prom/día</th>
                </tr>
                <tr style={{ fontSize: '0.68rem' }}>
                  <th></th>
                  <th style={{ textAlign: 'right', background: 'rgba(42,122,106,0.08)' }}>Días</th>
                  <th style={{ textAlign: 'right', background: 'rgba(42,122,106,0.08)' }}>Horas</th>
                  <th style={{ textAlign: 'right', background: 'rgba(42,122,106,0.08)', borderRight: '1px solid var(--t-border)' }}>Cobrado</th>
                  <th style={{ textAlign: 'right', background: 'rgba(200,169,110,0.08)' }}>Días</th>
                  <th style={{ textAlign: 'right', background: 'rgba(200,169,110,0.08)' }}>Horas</th>
                  <th style={{ textAlign: 'right', background: 'rgba(200,169,110,0.08)', borderRight: '1px solid var(--t-border)' }}>Cobrado</th>
                  <th style={{ textAlign: 'right' }}></th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {empData.map(e => (
                  <tr key={e.id} className="admin-row">
                    <td>
                      <div className="admin-emp-name">{e.name}</div>
                      <div style={{ fontSize: '0.65rem', color: '#888' }}>
                        {e.q1Days + e.q2Days} días · {(e.q1Hours + e.q2Hours).toFixed(1)}h
                      </div>
                    </td>
                    {/* Q1 */}
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', color: '#5a5040' }}>{e.q1Days || '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', color: '#5a5040' }}>{e.q1Hours > 0 ? e.q1Hours.toFixed(1)+'h' : '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', fontWeight: 700, color: 'var(--t-teal)', borderRight: '1px solid var(--t-border)' }}>
                      {e.q1Earn > 0 ? formatCRC(e.q1Earn) : '—'}
                    </td>
                    {/* Q2 */}
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', color: '#5a5040' }}>{e.q2Days || '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', color: '#5a5040' }}>{e.q2Hours > 0 ? e.q2Hours.toFixed(1)+'h' : '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', fontWeight: 700, color: 'var(--t-gold)', borderRight: '1px solid var(--t-border)' }}>
                      {e.q2Earn > 0 ? formatCRC(e.q2Earn) : '—'}
                    </td>
                    {/* Totals */}
                    <td style={{ textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color: 'var(--t-ink)' }}>
                      {formatCRC(e.total)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#5a5040', fontSize: '0.78rem' }}>
                      {formatCRC(e.promDia)}/día
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--t-ink)', color: 'var(--t-gold)', fontWeight: 700 }}>
                  <td style={{ padding: '0.6rem 0.75rem' }}>TOTAL</td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem', borderRight: '1px solid #333' }}>
                    {formatCRC(empData.reduce((s,e) => s + e.q1Earn, 0))}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem', borderRight: '1px solid #333' }}>
                    {formatCRC(empData.reduce((s,e) => s + e.q2Earn, 0))}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontSize: '1rem' }}>
                    {formatCRC(grandTotal)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Export hint */}
          <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: '#888', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span>💡</span>
            <span>Usá Ctrl+P (o Cmd+P) para imprimir / guardar como PDF para nómina</span>
          </div>
        </>
      )}
    </div>
  )
}
