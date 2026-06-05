import { useState, useEffect, useMemo } from 'react'
import type { Employee } from '../../shared/types/database'
import { getAttendanceHistory } from '../../shared/api/tips'
import type { AttendanceRow } from '../../shared/api/tips'
import { shiftLabel, fi } from '../../shared/utils'
import { ROLE_LABELS } from '../../shared/constants'

interface Props {
  employees: Employee[]
}


// Cuántos meses de historia traemos del backend. 24 cubre el año en curso + el anterior
// (suficiente para comparar 2025 vs 2026 con el selector de año).
const FETCH_MONTHS = 24

function fmtDate(d: string) {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${Number(dd)} ${months[Number(m)-1]} ${y}`
}

export default function EmployeeHours({ employees }: Props) {
  const [allRows, setAllRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear]         = useState<string>('all')   // 'all' | 'YYYY'
  const [selected, setSelected] = useState<string | 'all'>('all')
  const [view, setView]         = useState<'resumen'|'detalle'>('resumen')

  useEffect(() => {
    setLoading(true)
    getAttendanceHistory(FETCH_MONTHS)
      .then(setAllRows)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Años disponibles en los datos (desc)
  const years = useMemo(() => {
    const s = new Set<string>()
    allRows.forEach(r => s.add(r.session_date.slice(0, 4)))
    return [...s].sort().reverse()
  }, [allRows])

  // Filtrar por año seleccionado
  const rows = useMemo(() => (
    year === 'all' ? allRows : allRows.filter(r => r.session_date.startsWith(year))
  ), [allRows, year])

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

  // Totales del período (para la fila de totales)
  const totals = useMemo(() => summary.reduce(
    (t, s) => ({ shifts: t.shifts + s.shifts, hours: t.hours + s.hours, payout: t.payout + s.payout }),
    { shifts: 0, hours: 0, payout: 0 },
  ), [summary])

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
  // Etiqueta de mes con año cuando hay varios años en vista (evita ambigüedad)
  const monthHdr = (ym: string) => year === 'all'
    ? `${MONTH_NAMES[ym.slice(5, 7)]} '${ym.slice(2, 4)}`
    : `${MONTH_NAMES[ym.slice(5, 7)]} Hs`

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando historial…</div>
  }

  if (allRows.length === 0) {
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

  const monthCols = months_in_data.slice(0, 3)

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
          value={year}
          onChange={e => setYear(e.target.value)}
        >
          <option value="all">Todos los años</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
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
                {monthCols.map(ym => (
                  <th key={ym} style={{ textAlign: 'right' }}>{monthHdr(ym)}</th>
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
                  {monthCols.map(ym => (
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
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--t-border, #2a2a2a)', fontWeight: 700 }}>
                <td className="admin-emp-name">TOTAL{year !== 'all' ? ` ${year}` : ''}</td>
                <td style={{ color: '#888', fontSize: '0.72rem' }}>{summary.length} empl.</td>
                <td style={{ textAlign: 'right' }}>{totals.shifts}</td>
                <td style={{ textAlign: 'right', color: 'var(--t-teal)' }}>
                  {totals.hours.toLocaleString('es-CR', { maximumFractionDigits: 1 })}h
                </td>
                <td style={{ textAlign: 'right', color: '#5a5040' }}>
                  {totals.shifts > 0 ? (totals.hours / totals.shifts).toFixed(1) : '—'}h
                </td>
                {monthCols.map(ym => {
                  const mh = summary.reduce((s, x) => s + (x.byMonth[ym]?.hours ?? 0), 0)
                  return <td key={ym} style={{ textAlign: 'right', fontSize: '0.82rem', color: '#5a5040' }}>{mh > 0 ? mh.toFixed(1) : '—'}</td>
                })}
                <td style={{ textAlign: 'right', color: 'var(--t-teal)' }}>{totals.payout > 0 ? fi(totals.payout) : '—'}</td>
              </tr>
            </tfoot>
          </table>
          <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.5rem' }}>
            Hacé click en un empleado para ver el detalle por turno · Datos: últimos {FETCH_MONTHS} meses
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
                    <td><span className="role-tag" style={{ background: (r.shift_type === 'PM' || r.shift_type === 'Noche') ? 'rgba(42,122,106,0.12)' : 'rgba(200,169,110,0.12)', color: (r.shift_type === 'PM' || r.shift_type === 'Noche') ? 'var(--t-teal)' : '#a07830' }}>{shiftLabel(r.shift_type)}</span></td>
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
              Mostrando primeros 200 registros — filtrá por año o empleado para ver todo
            </div>
          )}
        </>
      )}
    </div>
  )
}
