/**
 * TipQuincenal — Vista quincenal de propinas (Q1: días 1-15, Q2: días 16-fin)
 * BUG-4 FIX: now fetches its own data independently from calcCache.
 * No longer requires Historial to be opened first.
 */
import { useState, useEffect, useMemo } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'
import { calcHistory, formatCRC } from '../../shared/utils/tipCalculations'
import { getTipEntriesBySession } from '../../shared/api/tips'

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

const MONTH_NAMES: Record<string, string> = {
  '01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun',
  '07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic',
}

export default function TipQuincenal({ sessions, calcCache, employees, rolePoints }: Props) {
  const months     = useMemo(() => getMonths(sessions), [sessions])
  const [month, setMonth] = useState(months[0] ?? '')
  // Local cache so we can load independently of TipHistory
  const [localCache, setLocalCache] = useState<Record<string, HistoryCalc>>({})
  const [loading, setLoading] = useState(false)

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Merge parent cache + local cache
  const mergedCache = useMemo(() => ({ ...calcCache, ...localCache }), [calcCache, localCache])

  // Sessions for selected month
  const monthSessions = useMemo(() =>
    sessions.filter(s => s.status === 'closed' && s.session_date.startsWith(month)),
  [sessions, month])

  // Auto-load any sessions not yet in either cache
  useEffect(() => {
    const missing = monthSessions.filter(s => !mergedCache[s.id])
    if (!missing.length) return
    setLoading(true)
    Promise.all(missing.map(async s => {
      const entries = await getTipEntriesBySession(s.id)
      const calc = calcHistory(
        entries.map(e => ({
          employee_id:    e.employee_id,
          hours_worked:   e.hours_worked,
          tip_amount_crc: e.tip_amount_crc,
          tip_amount_usd: e.tip_amount_usd,
          points:         e.points,
          payout_crc:     e.payout_crc,
        })),
        employees.map(e => ({ id: e.id, full_name: e.full_name, role: e.role })),
        rolePoints,
        {
          pool_efectivo_crc: s.pool_efectivo_crc,
          pool_efectivo_usd: s.pool_efectivo_usd,
          pool_barra_crc:    s.pool_barra_crc,
          exchange_rate:     s.exchange_rate,
        },
      )
      return [s.id, calc] as [string, HistoryCalc]
    }))
    .then(results => {
      const newEntries = Object.fromEntries(results)
      setLocalCache(prev => ({ ...prev, ...newEntries }))
    })
    .catch(console.error)
    .finally(() => setLoading(false))
  }, [month, monthSessions, mergedCache, employees, rolePoints])

  // Q1/Q2 split
  const q1Sessions = monthSessions.filter(s => Number(s.session_date.slice(8, 10)) <= 15)
  const q2Sessions = monthSessions.filter(s => Number(s.session_date.slice(8, 10)) > 15)

  // Aggregate per employee
  const empData = useMemo(() => {
    const acc: Record<string, {
      id: string; name: string; role: string
      q1Days:0; q1Hours:0; q1Earn:0
      q2Days:0; q2Hours:0; q2Earn:0
      total:0; promDia:0
    }> = {}

    const processSession = (s: TipSession, isQ1: boolean) => {
      const calc = mergedCache[s.id]
      if (!calc) return
      for (const row of calc.rows) {
        const emp = empMap.get(row.employeeId)
        if (!emp) continue
        if (!acc[emp.id]) acc[emp.id] = {
          id: emp.id, name: emp.full_name, role: emp.role,
          q1Days:0, q1Hours:0, q1Earn:0, q2Days:0, q2Hours:0, q2Earn:0, total:0, promDia:0,
        } as typeof acc[string]
        const e = acc[emp.id]
        if (isQ1) { e.q1Days++; e.q1Hours += row.hours; e.q1Earn += row.payout_crc }
        else      { e.q2Days++; e.q2Hours += row.hours; e.q2Earn += row.payout_crc }
        e.total += row.payout_crc
      }
    }

    q1Sessions.forEach(s => processSession(s, true))
    q2Sessions.forEach(s => processSession(s, false))

    return Object.values(acc)
      .map(e => ({ ...e, promDia: (e.q1Days + e.q2Days) > 0 ? e.total / (e.q1Days + e.q2Days) : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [q1Sessions, q2Sessions, mergedCache, empMap])

  const q1Total    = q1Sessions.reduce((s, ss) => s + (mergedCache[ss.id]?.totalPool ?? 0), 0)
  const q2Total    = q2Sessions.reduce((s, ss) => s + (mergedCache[ss.id]?.totalPool ?? 0), 0)
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
            <button key={mo} onClick={() => setMonth(mo)}
              className={`vt-range-btn ${month === mo ? 'active' : ''}`}
              style={{ fontSize: '0.72rem' }}>
              {(MONTH_NAMES[mm] ?? mm).slice(0, 3)} {my}
            </button>
          )
        })}
      </div>

      {loading && (
        <div style={{ padding: '1rem', color: '#888', fontSize: '0.82rem' }}>
          ⟳ Cargando datos del mes…
        </div>
      )}

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

      {empData.length === 0 && !loading ? (
        <div className="tips-empty-state">
          <p className="tips-empty-text">No hay datos para este mes</p>
        </div>
      ) : (
        <>
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
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', color: '#5a5040' }}>{e.q1Days || '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', color: '#5a5040' }}>{e.q1Hours > 0 ? e.q1Hours.toFixed(1)+'h' : '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(42,122,106,0.04)', fontWeight: 700, color: 'var(--t-teal)', borderRight: '1px solid var(--t-border)' }}>
                      {e.q1Earn > 0 ? formatCRC(e.q1Earn) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', color: '#5a5040' }}>{e.q2Days || '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', color: '#5a5040' }}>{e.q2Hours > 0 ? e.q2Hours.toFixed(1)+'h' : '—'}</td>
                    <td style={{ textAlign: 'right', background: 'rgba(200,169,110,0.04)', fontWeight: 700, color: 'var(--t-gold)', borderRight: '1px solid var(--t-border)' }}>
                      {e.q2Earn > 0 ? formatCRC(e.q2Earn) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color: 'var(--t-ink)' }}>{formatCRC(e.total)}</td>
                    <td style={{ textAlign: 'right', color: '#5a5040', fontSize: '0.78rem' }}>{formatCRC(e.promDia)}/día</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--t-ink)', color: 'var(--t-gold)', fontWeight: 700 }}>
                  <td style={{ padding: '0.6rem 0.75rem' }}>TOTAL</td>
                  <td colSpan={2} style={{ padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem', borderRight: '1px solid #333' }}>{formatCRC(empData.reduce((s,e) => s + e.q1Earn, 0))}</td>
                  <td colSpan={2} style={{ padding: '0.6rem 0.5rem' }}></td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem', borderRight: '1px solid #333' }}>{formatCRC(empData.reduce((s,e) => s + e.q2Earn, 0))}</td>
                  <td style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontSize: '1rem' }}>{formatCRC(grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="tips-btn-ghost"
              style={{ fontSize: '0.78rem' }}
              onClick={() => {
                const BOM = '﻿'
                const [y, m2] = month.split('-')
                const hdrs = ['Empleado','Rol','Q1 Días','Q1 Horas','Q1 Propinas (₡)','Q2 Días','Q2 Horas','Q2 Propinas (₡)','Total Mes (₡)','Prom/Día (₡)']
                const rows = empData.map(e => [
                  e.name, e.role,
                  e.q1Days, e.q1Hours.toFixed(1), e.q1Earn,
                  e.q2Days, e.q2Hours.toFixed(1), e.q2Earn,
                  e.total, e.promDia.toFixed(0),
                ].map(v => `"${v}"`).join(','))
                const csv = BOM + [hdrs.join(','), ...rows].join('\n')
                const a = document.createElement('a')
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
                a.download = `propinas_${y}_${m2}_quincenal.csv`
                a.click()
              }}
            >
              ⬇ CSV planilla
            </button>
            <button
              className="tips-btn-ghost"
              style={{ fontSize: '0.78rem' }}
              onClick={() => window.print()}
            >
              🖨 Imprimir / PDF
            </button>
            <span style={{ fontSize: '0.72rem', color: '#888' }}>
              💡 Ctrl+P para guardar como PDF para nómina
            </span>
          </div>
        </>
      )}
    </div>
  )
}
