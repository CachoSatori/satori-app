/**
 * TipCocina — Pool semanal de cocina (solo Admin)
 *
 * Reglas de negocio (idénticas al standalone):
 *  - Agrupar todas las tip_entries con rol = 'cocina' por semana (ISO, lun–dom)
 *  - Sumar el take_home (payout_crc) de esas entradas → pool semanal de cocina
 *  - Dividir en partes iguales entre los empleados de cocina que participaron
 *  - Selena está EXCLUIDA como receptora: su take_home igual entra al pool,
 *    pero su parte se redistribuye entre el resto (no la recibe)
 */
import { useState, useEffect, useMemo } from 'react'
import type { Employee } from '../../shared/types/database'
import { getAttendanceHistory } from '../../shared/api/tips'
import type { AttendanceRow } from '../../shared/api/tips'

interface Props {
  employees: Employee[]
}

const FETCH_MONTHS = 12
const MN = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }
function isSelena(name: string) { return name.toLowerCase().includes('selena') }
function fmtMonth(ym: string) { const [y, m] = ym.split('-'); return `${MN[Number(m)]} ${y}` }
function fmtShort(d: string) { const [, m, dd] = d.split('-'); return `${Number(dd)} ${MN[Number(m)]}` }

// Lunes (ISO) de la semana que contiene `dateStr` → 'YYYY-MM-DD'
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7   // 0 = lunes
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}

interface WeekBucket {
  key:        string                       // lunes ISO
  start:      string                       // fecha real más temprana presente
  end:        string                       // fecha real más tardía presente
  pool:       number                       // suma take_home (incluye Selena)
  receptores: Array<{ id: string; name: string }>
  perPerson:  number
}

export default function TipCocina({ employees }: Props) {
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    getAttendanceHistory(FETCH_MONTHS)
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Empleados de cocina
  const cocinaIds = useMemo(() => {
    const m = new Map<string, Employee>()
    employees.filter(e => e.role === 'cocina').forEach(e => m.set(e.id, e))
    return m
  }, [employees])

  // Solo entradas de cocina
  const cocinaRows = useMemo(
    () => rows.filter(r => cocinaIds.has(r.employee_id)),
    [rows, cocinaIds],
  )

  // Meses disponibles
  const availableMonths = useMemo(() => {
    const s = new Set<string>()
    cocinaRows.forEach(r => s.add(r.session_date.slice(0, 7)))
    return [...s].sort().reverse()
  }, [cocinaRows])

  // Default al mes más reciente con datos
  useEffect(() => {
    if (month === 'all' && availableMonths.length) setMonth(availableMonths[0])
  }, [availableMonths]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthRows = useMemo(
    () => (month === 'all' ? cocinaRows : cocinaRows.filter(r => r.session_date.startsWith(month))),
    [cocinaRows, month],
  )

  // Construir buckets semanales
  const weeks = useMemo<WeekBucket[]>(() => {
    const map: Record<string, {
      pool: number; start: string; end: string; recept: Map<string, string>
    }> = {}
    for (const r of monthRows) {
      const k = mondayOf(r.session_date)
      if (!map[k]) map[k] = { pool: 0, start: r.session_date, end: r.session_date, recept: new Map() }
      const b = map[k]
      b.pool += r.payout_crc ?? 0
      if (r.session_date < b.start) b.start = r.session_date
      if (r.session_date > b.end)   b.end = r.session_date
      const emp = cocinaIds.get(r.employee_id)
      // Selena entra al pool pero NO es receptora
      if (emp && !isSelena(emp.full_name)) b.recept.set(emp.id, emp.full_name)
    }
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => {
        const receptores = [...b.recept.entries()].map(([id, name]) => ({ id, name }))
        return {
          key, start: b.start, end: b.end, pool: b.pool, receptores,
          perPerson: receptores.length > 0 ? b.pool / receptores.length : 0,
        }
      })
  }, [monthRows, cocinaIds])

  // Tabla por empleado (mes seleccionado)
  const byEmp = useMemo(() => {
    const acc: Record<string, { name: string; weeks: number; total: number }> = {}
    for (const w of weeks) {
      for (const r of w.receptores) {
        if (!acc[r.id]) acc[r.id] = { name: r.name, weeks: 0, total: 0 }
        acc[r.id].weeks++
        acc[r.id].total += w.perPerson
      }
    }
    return Object.values(acc).sort((a, b) => b.total - a.total)
  }, [weeks])

  const totalPool = weeks.reduce((s, w) => s + w.pool, 0)

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--c-gris)' }}>Cargando…</div>

  if (cocinaRows.length === 0) {
    return (
      <div className="tips-empty-state">
        <p className="tips-empty-text">Sin entradas de cocina en los últimos {FETCH_MONTHS} meses</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.5rem 0' }}>
      {/* Header + selector de mes */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--c-oro-texto)' }}>🍳 Pool semanal de cocina</div>
        <select value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: 'var(--c-fondo)', border: '1px solid var(--c-linea)', color: 'var(--c-oro-texto)', padding: '5px 10px', borderRadius: 2, fontSize: '0.78rem', marginLeft: 'auto' }}>
          {availableMonths.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </select>
      </div>

      <div style={{ fontSize: '0.68rem', color: 'var(--c-gris)', marginBottom: '0.75rem' }}>
        Selena entra al pool pero no recibe — su parte se reparte entre el resto de cocina.
      </div>

      {/* Tabla por semana */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-linea)' }}>
              <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem', letterSpacing: '0.08em' }}>Semana</th>
              <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Período</th>
              <th style={{ textAlign: 'right', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Pool</th>
              <th style={{ textAlign: 'center', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Participantes</th>
              <th style={{ textAlign: 'right', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Por persona</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w.key} style={{ borderBottom: '1px solid var(--c-linea)' }}>
                <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>Sem. {i + 1}</td>
                <td style={{ padding: '0.45rem 0.5rem', color: 'var(--c-gris)' }}>{fmtShort(w.start)} – {fmtShort(w.end)}</td>
                <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--t-teal)', fontWeight: 600 }}>{fi(w.pool)}</td>
                <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', color: 'var(--c-gris)' }} title={w.receptores.map(r => r.name).join(', ')}>
                  {w.receptores.length || '—'}
                </td>
                <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--c-oro-texto)', fontWeight: 700 }}>
                  {w.perPerson > 0 ? fi(w.perPerson) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--c-tinta)', fontWeight: 700 }}>
              <td style={{ padding: '0.5rem' }}>TOTAL</td>
              <td style={{ padding: '0.5rem', color: 'var(--c-gris)', fontSize: '0.72rem' }}>{weeks.length} semana{weeks.length !== 1 ? 's' : ''}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--t-teal)' }}>{fi(totalPool)}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Tabla por empleado */}
      {byEmp.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--c-gris)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
            Por empleado · {month === 'all' ? 'todo el período' : fmtMonth(month)}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-linea)' }}>
                <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Empleado</th>
                <th style={{ textAlign: 'center', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Semanas</th>
                <th style={{ textAlign: 'right', padding: '0.45rem 0.5rem', color: 'var(--c-gris)', fontWeight: 500, fontSize: '0.68rem' }}>Total recibido</th>
              </tr>
            </thead>
            <tbody>
              {byEmp.map(e => (
                <tr key={e.name} style={{ borderBottom: '1px solid var(--c-linea)' }}>
                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>{e.name}</td>
                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', color: 'var(--c-gris)' }}>{e.weeks}</td>
                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--c-oro-texto)', fontWeight: 700 }}>{fi(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
