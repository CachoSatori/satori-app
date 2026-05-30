import { useState, useEffect, useMemo } from 'react'
import type { Employee } from '../../shared/types/database'
import { getAttendanceHistory } from '../../shared/api/tips'
import type { AttendanceRow } from '../../shared/api/tips'

interface Props {
  employees: Employee[]
}

const ROLE_LABELS: Record<string, string> = {
  salonero: 'Salonero', barman: 'Barman', barback: 'Barback',
  runner: 'Runner', cocina: 'Cocina', cajero: 'Cajero', manager: 'Encargado',
}

function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }
function fmtDate(d: string) {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${Number(dd)} ${months[Number(m)-1]} ${y}`
}

export default function EmployeeHours({ employees }: Props) {
  const [rows, setRows]       = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [months, setMonths]   = useState(3)
  const [selected, setSelected] = useState<string | 'all'>('all')
  const [view, setView]       = useState<'resumen'|'detalle'>('resumen')

  useEffect(() => {
    setLoading(true)
    getAttendanceHistory(months)
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [months])

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Build summary per employee
  const summary = useMemo(() => {
    const acc: Record<string, {
      emp: Employee
      shifts: number
      hours: number
      payout: number
      byMonth: Record<string, { shifts: number; hours: number; payout: number }>
    }> = {}

    for (const r of rows) {
      const emp = empMap.get(r.employee_id)
      if (!emp) continue
      if (!acc[emp.id]) acc[emp.id] = { emp, shifts: 0, hours: 0, payout: 0, byMonth: {} }
      const a = acc[emp.id]
      a.shifts++
      a.hours   += r.hours_worked
      a.payout  += r.payout_crc ?? 0
      const ym = r.session_date.slice(0, 7)
      if (!a.byMonth[ym]) a.byMonth[ym] = { shifts: 0, hours: 0, payout: 0 }
      a.byMonth[ym].shifts++
      a.byMonth[ym].hours  += r.hours_worked
      a.byMonth[ym].payout += r.payout_crc ?? 0
    }

    return Object.values(acc).sort((a, b) => b.hours - a.hours)
  }, [rows, empMap])

  // Available months in data
  const months_in_data = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => s.add(r.session_date.slice(0, 7)))
    return [...s].sort().reverse()
  }, [rows])

  const MONTH_NAMES: Record<string, string> = {
    '01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun',
    '07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic',
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando historial…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="admin-section">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          <div>Sin registros de asistencia todavía</div>
          <div style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
            Los datos aparecen cuando cerrás turnos de propinas
          </div>
        </div>
      </div>
    )
  }

  const filteredRows = selected === 'all'
    ? rows
    : rows.filter(r => r.employee_id === selected)

  return (
    <div className="admin-section">
      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div className="admin-section-title" style={{ flex: 1 }}>
          Asistencia y horas trabajadas
        </div>
        <select
          className="tips-input-dark"
          style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          value={months}
          onChange={e => setMonths(Number(e.target.value))}
        >
          <option value={1}>Último mes</option>
          <option value={3}>Últimos 3 meses</option>
          <option value={6}>Últimos 6 meses</option>
          <option value={12}>Último año</option>
        </select>
        <div style={{ display: 'flex', border: '1px solid var(--t-border)', borderRadius: 2, overflow: 'hidden' }}>
          {(['resumen','detalle'] as const).map(v => (
            <button key={v}
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.72rem', background: view === v ? 'var(--t-ink)' : '#fff', color: view === v ? 'var(--t-gold)' : '#5a5040', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}
              onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* RESUMEN view */}
      {view === 'resumen' && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Rol</th>
                <th style={{ textAlign: 'right' }}>Turnos</th>
                <th style={{ textAlign: 'right' }}>Horas total</th>
                <th style={{ textAlign: 'right' }}>Hs/turno prom</th>
                {months_in_data.slice(0, 3).map(ym => (
                  <th key={ym} style={{ textAlign: 'right' }}>
                    {MONTH_NAMES[ym.slice(5, 7)]} Hs
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>Propinas cobradas</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(({ emp, shifts, hours, payout, byMonth }) => (
                <tr key={emp.id} className="admin-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setSelected(emp.id); setView('detalle') }}>
                  <td className="admin-emp-name">{emp.full_name}</td>
                  <td><span className="role-tag">{ROLE_LABELS[emp.role] ?? emp.role}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{shifts}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--t-teal)' }}>
                    {hours.toLocaleString('es-CR', { maximumFractionDigits: 1 })}h
                  </td>
                  <td style={{ textAlign: 'right', color: '#5a5040' }}>
                    {shifts > 0 ? (hours / shifts).toFixed(1) : '—'}h
                  </td>
                  {months_in_data.slice(0, 3).map(ym => (
                    <td key={ym} style={{ textAlign: 'right', fontSize: '0.82rem', color: '#5a5040' }}>
                      {byMonth[ym]?.hours.toFixed(1) ?? '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', color: 'var(--t-teal)', fontWeight: 600 }}>
                    {payout > 0 ? fi(payout) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.5rem' }}>
            Hacé click en un empleado para ver el detalle por turno
          </div>
        </>
      )}

      {/* DETALLE view */}
      {view === 'detalle' && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <select
              className="tips-input-dark"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              value={selected}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="all">Todos los empleados</option>
              {employees.filter(e => e.is_active).map(e => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
            {selected !== 'all' && (() => {
              const emp = empMap.get(selected)
              const s = summary.find(x => x.emp.id === selected)
              if (!emp || !s) return null
              return (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong>{s.shifts}</strong> <span style={{ color: '#888' }}>turnos</span>
                  </span>
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong style={{ color: 'var(--t-teal)' }}>{s.hours.toFixed(1)}h</strong> <span style={{ color: '#888' }}>totales</span>
                  </span>
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong style={{ color: 'var(--t-teal)' }}>{fi(s.payout)}</strong> <span style={{ color: '#888' }}>propinas</span>
                  </span>
                </div>
              )
            })()}
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Turno</th>
                {selected === 'all' && <th>Empleado</th>}
                <th style={{ textAlign: 'right' }}>Horas</th>
                <th style={{ textAlign: 'right' }}>Puntos</th>
                <th style={{ textAlign: 'right' }}>Propina cobrada</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 200).map((r, i) => {
                const emp = empMap.get(r.employee_id)
                return (
                  <tr key={i} className="admin-row">
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.session_date)}</td>
                    <td><span className="role-tag" style={{ background: r.shift_type === 'PM' ? 'rgba(42,122,106,0.12)' : 'rgba(200,169,110,0.12)', color: r.shift_type === 'PM' ? 'var(--t-teal)' : '#a07830' }}>{r.shift_type}</span></td>
                    {selected === 'all' && <td className="admin-emp-name">{emp?.full_name ?? '—'}</td>}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {r.hours_worked}h
                    </td>
                    <td style={{ textAlign: 'right', color: '#5a5040' }}>
                      {r.points != null ? r.points.toFixed(1) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: r.payout_crc ? 'var(--t-teal)' : '#aaa', fontWeight: r.payout_crc ? 600 : 400 }}>
                      {r.payout_crc ? fi(r.payout_crc) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredRows.length > 200 && (
            <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.5rem' }}>
              Mostrando primeros 200 registros — reducí el período para ver todo
            </div>
          )}
        </>
      )}
    </div>
  )
}
