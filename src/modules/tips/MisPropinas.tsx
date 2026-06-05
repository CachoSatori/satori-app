/**
 * MisPropinas — Vista personal del empleado
 * Accesible para: salonero, barman, barback, runner, cocina, cajero
 * Muestra: historial mensual de propinas cobradas + Q1/Q2 breakdown
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getAttendanceHistory } from '../../shared/api/tips'
import { getEmployeeByProfileId } from '../../shared/api/admin'
import type { AttendanceRow } from '../../shared/api/tips'
import type { Employee } from '../../shared/types/database'
import { formatCRC } from '../../shared/utils/tipCalculations'
import { todayCR } from '../../shared/utils'
import { ROLE_LABELS } from '../../shared/constants'

const MONTH_NAMES: Record<string, string> = {
  '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio',
  '07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre',
}


export default function MisPropinas() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [employee,  setEmployee]  = useState<Employee | null>(null)
  const [rows,      setRows]      = useState<AttendanceRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [noLink,    setNoLink]    = useState(false)

  useEffect(() => {
    if (!profile) return
    getEmployeeByProfileId(profile.id)
      .then(async emp => {
        if (!emp) { setNoLink(true); setLoading(false); return }
        setEmployee(emp)
        const data = await getAttendanceHistory(12)
        setRows(data.filter(r => r.employee_id === emp.id))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [profile])

  // Group by month
  const byMonth = useMemo(() => {
    const acc: Record<string, {
      q1Days: number; q1Hours: number; q1Earn: number
      q2Days: number; q2Hours: number; q2Earn: number
    }> = {}
    for (const r of rows) {
      const ym  = r.session_date.slice(0, 7)
      const day = Number(r.session_date.slice(8, 10))
      if (!acc[ym]) acc[ym] = { q1Days:0, q1Hours:0, q1Earn:0, q2Days:0, q2Hours:0, q2Earn:0 }
      const e = acc[ym]
      if (day <= 15) {
        e.q1Days++; e.q1Hours += r.hours_worked; e.q1Earn += r.payout_crc ?? 0
      } else {
        e.q2Days++; e.q2Hours += r.hours_worked; e.q2Earn += r.payout_crc ?? 0
      }
    }
    return Object.entries(acc).sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])

  const totalEarned = rows.reduce((s, r) => s + (r.payout_crc ?? 0), 0)
  const totalHours  = rows.reduce((s, r) => s + r.hours_worked, 0)
  const totalShifts = rows.length
  const curMonth    = todayCR().slice(0, 7)
  const curEarn     = rows.filter(r => r.session_date.startsWith(curMonth)).reduce((s, r) => s + (r.payout_crc ?? 0), 0)

  if (loading) {
    return <div className="loading-screen"><span className="loading-mark">心</span></div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--t-paper)', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div style={{ background: 'var(--t-ink)', padding: '0 1.5rem', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: 'var(--t-gold)' }}>心</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--t-gold)' }}>Mis Propinas</div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.2em', color: '#555', textTransform: 'uppercase' }}>Satori</div>
          </div>
        </div>
        <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }} onClick={() => navigate('/')}>← Inicio</button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 640, color: 'var(--t-ink)' }}>

        {/* No link state */}
        {noLink && (
          <div style={{ background: 'var(--t-ink)', border: '1px solid #2a2a2a', borderRadius: 3, padding: '2rem', textAlign: 'center', color: 'var(--t-paper)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔗</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--t-gold)' }}>
              Perfil no vinculado
            </div>
            <div style={{ fontSize: '0.82rem', color: '#888' }}>
              Tu cuenta de usuario no está vinculada a un empleado todavía.
              Pedile al dueño que vincule tu perfil en Admin → Empleados.
            </div>
          </div>
        )}

        {employee && (
          <>
            {/* Employee card */}
            <div style={{ background: 'var(--t-ink)', borderRadius: 3, padding: '1.25rem', marginBottom: '1.25rem', borderLeft: '4px solid var(--t-gold)' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--t-gold)' }}>
                {employee.full_name}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.15rem' }}>
                {ROLE_LABELS[employee.role] ?? employee.role}
              </div>
            </div>

            {/* Summary KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem', marginBottom: '1.25rem' }}>
              {[
                { label: 'Este mes', val: formatCRC(curEarn), color: 'var(--t-teal)' },
                { label: 'Turnos totales', val: String(totalShifts), color: '' },
                { label: 'Horas trabajadas', val: totalHours.toFixed(1) + 'h', color: '' },
                { label: 'Total cobrado (12m)', val: formatCRC(totalEarned), color: 'var(--t-gold)' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--t-ink)', padding: '0.875rem 1rem', borderRadius: 2 }}>
                  <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#555', marginBottom: '0.3rem' }}>{k.label}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1rem', fontWeight: 800, color: k.color || 'var(--t-paper)' }}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* Monthly summary table + detail */}
            {byMonth.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
                Sin registros de propinas todavía
              </div>
            ) : (
              <>
                {/* Compact summary table */}
                <div style={{ marginBottom: '1.25rem', background: 'var(--t-ink)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #1a1a1a', fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#555', fontWeight: 700 }}>
                    Resumen por mes
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                        {['Mes', 'Turnos', 'Horas', 'Q1', 'Q2', 'Total'].map(h => (
                          <th key={h} style={{ padding: '0.4rem 0.75rem', textAlign: h === 'Mes' ? 'left' : 'right', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', fontWeight: 400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byMonth.map(([ym, d], i) => {
                        const [y, m] = ym.split('-')
                        const total = d.q1Earn + d.q2Earn
                        const maxTotal = Math.max(...byMonth.map(([,d2]) => d2.q1Earn + d2.q2Earn))
                        const isBest = total === maxTotal && maxTotal > 0
                        return (
                          <tr key={ym} style={{ borderBottom: '1px solid #111', background: isBest ? 'rgba(42,122,106,.08)' : i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.02)' }}>
                            <td style={{ padding: '0.45rem 0.75rem', fontWeight: isBest ? 700 : 400, color: isBest ? 'var(--t-teal)' : 'inherit' }}>
                              {isBest && '★ '}{MONTH_NAMES[m] ?? m} {y.slice(2)}
                            </td>
                            <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#888' }}>{d.q1Days + d.q2Days}</td>
                            <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#888', fontSize: '0.75rem' }}>{(d.q1Hours + d.q2Hours).toFixed(0)}h</td>
                            <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: 'var(--t-teal)', fontSize: '0.78rem' }}>{d.q1Earn > 0 ? formatCRC(d.q1Earn) : '—'}</td>
                            <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: 'var(--t-gold)', fontSize: '0.78rem' }}>{d.q2Earn > 0 ? formatCRC(d.q2Earn) : '—'}</td>
                            <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 700, color: isBest ? 'var(--t-teal)' : 'var(--t-ink)' }}>{formatCRC(total)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--t-ink)', borderTop: '2px solid var(--t-border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888' }}>TOTAL {byMonth.length} meses</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#888' }}>{totalShifts}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#888', fontSize: '0.75rem' }}>{totalHours.toFixed(0)}h</td>
                        <td colSpan={2}/>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 800, fontFamily: "'DM Mono',monospace", color: 'var(--t-gold)' }}>{formatCRC(totalEarned)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Quincenal detail cards (collapsed by default, show most recent) */}
                <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', marginBottom: '0.75rem', fontWeight: 700 }}>
                  Detalle quincenal
                </div>
                {byMonth.slice(0, 3).map(([ym, d]) => {
                  const [y, m] = ym.split('-')
                  const total = d.q1Earn + d.q2Earn
                  return (
                    <div key={ym} style={{ background: '#fff', border: '1px solid var(--t-border)', borderRadius: 3, marginBottom: '0.75rem', overflow: 'hidden' }}>
                      <div style={{ background: 'var(--t-panel)', padding: '0.625rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{MONTH_NAMES[m] ?? m} {y}</div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, color: 'var(--t-teal)' }}>{formatCRC(total)}</div>
                      </div>
                      <div style={{ padding: '0.625rem 1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        {[
                          { label: 'Q1 (días 1-15)',  days: d.q1Days, hours: d.q1Hours, earn: d.q1Earn, textColor: 'var(--t-teal)' },
                          { label: 'Q2 (días 16-fin)', days: d.q2Days, hours: d.q2Hours, earn: d.q2Earn, textColor: 'var(--t-gold)' },
                        ].map(q => (
                          <div key={q.label} style={{ background: 'var(--t-panel)', borderRadius: 2, padding: '0.5rem 0.75rem' }}>
                            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', marginBottom: '0.2rem' }}>{q.label}</div>
                            <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: '0.95rem', color: q.textColor }}>
                              {q.earn > 0 ? formatCRC(q.earn) : '—'}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '0.15rem' }}>{q.days} turnos · {q.hours.toFixed(1)}h</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
