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

const ROLE_LABELS: Record<string, string> = {
  salonero: 'Salonero', barman: 'Barman', barback: 'Barback',
  runner: 'Runner', cocina: 'Cocina', cajero: 'Cajero', manager: 'Encargado',
}

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
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: '1rem', fontWeight: 800, color: k.color || 'var(--t-paper)' }}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* Monthly breakdown */}
            {byMonth.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: '0.85rem' }}>
                Sin registros de propinas todavía
              </div>
            ) : (
              byMonth.map(([ym, d]) => {
                const [y, m] = ym.split('-')
                const total = d.q1Earn + d.q2Earn
                return (
                  <div key={ym} style={{ background: '#fff', border: '1px solid var(--t-border)', borderRadius: 3, marginBottom: '0.75rem', overflow: 'hidden' }}>
                    <div style={{ background: 'var(--t-panel)', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{MONTH_NAMES[m] ?? m} {y}</div>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, color: 'var(--t-teal)' }}>
                        {formatCRC(total)}
                      </div>
                    </div>
                    <div style={{ padding: '0.75rem 1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      {[
                        { label: 'Q1 (días 1-15)', days: d.q1Days, hours: d.q1Hours, earn: d.q1Earn, color: 'rgba(42,122,106,0.12)', textColor: 'var(--t-teal)' },
                        { label: 'Q2 (días 16-fin)', days: d.q2Days, hours: d.q2Hours, earn: d.q2Earn, color: 'rgba(200,169,110,0.12)', textColor: 'var(--t-gold)' },
                      ].map(q => (
                        <div key={q.label} style={{ background: q.color, borderRadius: 2, padding: '0.625rem 0.75rem' }}>
                          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', marginBottom: '0.25rem' }}>{q.label}</div>
                          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '1rem', color: q.textColor }}>
                            {q.earn > 0 ? formatCRC(q.earn) : '—'}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: '#888', marginTop: '0.15rem' }}>
                            {q.days} turnos · {q.hours.toFixed(1)}h
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </>
        )}
      </div>
    </div>
  )
}
