import { useState, useMemo } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import { getTipEntriesBySession } from '../../shared/api/tips'
import { calcHistory, formatCRC, formatNum, ROL_LABELS, type HistoryCalc } from '../../shared/utils/tipCalculations'
import { shiftLabel } from '../../shared/utils'

interface Props {
  sessions:   TipSession[]
  employees:  Employee[]
  rolePoints: RoleTipPoints[]
  onCalcReady?: (sessionId: string, calc: HistoryCalc) => void
}

const MSHORT = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function TipHistory({ sessions, employees, rolePoints, onCalcReady }: Props) {
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [calcCache,   setCalcCache]   = useState<Record<string, HistoryCalc>>({})
  const [loadingId,   setLoadingId]   = useState<string | null>(null)

  // ── Filters ─────────────────────────────────────────────────
  const [filterEmp,   setFilterEmp]   = useState<string>('all')  // employee id or 'all'
  const [filterMonth, setFilterMonth] = useState<string>('all')  // 'YYYY-MM' or 'all'

  const closed = sessions.filter(s => s.status === 'closed')

  // Available months for filter
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    closed.forEach(s => { if (s.session_date) months.add(s.session_date.slice(0,7)) })
    return [...months].sort().reverse()
  }, [closed])

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return closed.filter(s => {
      if (filterMonth !== 'all' && !s.session_date?.startsWith(filterMonth)) return false
      // Employee filter: only show sessions where that employee worked (needs calc — filter by name in calc)
      return true
    })
  }, [closed, filterMonth])

  const handleExpand = async (s: TipSession) => {
    if (expandedId === s.id) { setExpandedId(null); return }
    setExpandedId(s.id)
    if (calcCache[s.id]) return
    setLoadingId(s.id)
    try {
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
      setCalcCache(prev => ({ ...prev, [s.id]: calc }))
      onCalcReady?.(s.id, calc)
    } finally {
      setLoadingId(null)
    }
  }

  // Active employees (for filter dropdown)
  const activeEmps = employees.filter(e => e.is_active).sort((a,b) => a.full_name.localeCompare(b.full_name))

  // Filter sessions by employee using calcCache when available
  const sessionsToShow = useMemo(() => {
    if (filterEmp === 'all') return filteredSessions
    return filteredSessions.filter(s => {
      const calc = calcCache[s.id]
      if (!calc) return true // show if not loaded yet, will be filtered on expand
      return calc.rows.some(r => r.employeeId === filterEmp)
    })
  }, [filteredSessions, filterEmp, calcCache])

  function fmtMonth(ym: string) {
    const [y, m] = ym.split('-')
    return `${MSHORT[Number(m)]} ${y}`
  }

  if (!closed.length) {
    return (
      <div className="tips-empty-state">
        <p className="tips-empty-text">No hay turnos cerrados aún</p>
      </div>
    )
  }

  return (
    <div className="tips-history">
      {/* ── Filters ── */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', padding:'0.75rem 0', marginBottom:'0.5rem', borderBottom:'1px solid #1a1a1a' }}>
        {/* Month filter */}
        <select
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          style={{ background:'#111', border:'1px solid #2a2a2a', color: filterMonth !== 'all' ? 'var(--t-gold)' : '#888', padding:'5px 10px', borderRadius:2, fontSize:'0.78rem' }}>
          <option value="all">Todos los meses</option>
          {availableMonths.map(ym => (
            <option key={ym} value={ym}>{fmtMonth(ym)}</option>
          ))}
        </select>

        {/* Employee filter */}
        <select
          value={filterEmp}
          onChange={e => setFilterEmp(e.target.value)}
          style={{ background:'#111', border:'1px solid #2a2a2a', color: filterEmp !== 'all' ? 'var(--t-gold)' : '#888', padding:'5px 10px', borderRadius:2, fontSize:'0.78rem' }}>
          <option value="all">Todos los empleados</option>
          {activeEmps.map(e => (
            <option key={e.id} value={e.id}>{e.full_name}</option>
          ))}
        </select>

        <span style={{ fontSize:'0.68rem', color:'#555', marginLeft:'auto' }}>
          {sessionsToShow.length} turno{sessionsToShow.length !== 1 ? 's' : ''}
        </span>
      </div>

      {sessionsToShow.length === 0 ? (
        <div className="tips-empty-state">
          <p className="tips-empty-text">Sin turnos para los filtros seleccionados</p>
        </div>
      ) : (
        sessionsToShow.map(s => {
          const isOpen    = expandedId === s.id
          const calc      = calcCache[s.id]
          const isLoading = loadingId === s.id

          // Employee filter: highlight or hide rows
          const filteredRows = calc?.rows.filter(r => filterEmp === 'all' || r.employeeId === filterEmp)

          return (
            <div key={s.id} className={`hist-item${isOpen ? ' open' : ''}`} onClick={() => handleExpand(s)}>
              <div className="hist-header">
                <div>
                  <div className="hist-fecha">{s.session_date} · {shiftLabel(s.shift_type)}</div>
                  <div className="hist-meta">
                    {calc ? `${calc.rows.length} empleados` : ''}
                    {filterEmp !== 'all' && calc && (() => {
                      const row = calc.rows.find(r => r.employeeId === filterEmp)
                      if (!row) return null
                      return <span style={{ color:'var(--t-gold)', marginLeft:'0.4rem' }}> · {row.employeeName}: {formatCRC(row.payout_crc)}</span>
                    })()}
                  </div>
                </div>
                <div className="hist-right">
                  {calc && <div className="hist-total">{formatCRC(calc.totalPool)}</div>}
                  <span className="hist-toggle">{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {isOpen && (
                <div className="hist-body">
                  {isLoading && <div className="hist-loading">Cargando…</div>}
                  {calc && (
                    <>
                      <div className="hist-pool-row">
                        <span>Pool <strong>{formatCRC(calc.totalPool)}</strong></span>
                        {calc.barraPool > 0 && <span>🍸 Barra <strong>{formatCRC(calc.barraPool)}</strong></span>}
                        <span>₡/pto <strong>{formatCRC(calc.generalRate)}</strong></span>
                        <span>Pts <strong>{formatNum(calc.totalPoints)}</strong></span>
                      </div>
                      <div className="hist-emp-grid">
                        {(filteredRows ?? calc.rows).map(row => (
                          <div key={row.employeeId} className="hist-emp-row"
                            style={{ background: filterEmp === row.employeeId ? 'rgba(200,169,110,.08)' : undefined }}>
                            <div>
                              <div className="hist-emp-name" style={{ color: filterEmp === row.employeeId ? 'var(--t-gold)' : undefined }}>
                                {row.employeeName}
                              </div>
                              <div className="hist-emp-meta">
                                {ROL_LABELS[row.role]} · {row.hours}h · {formatNum(row.pts_val)} pts
                              </div>
                            </div>
                            <div className="hist-emp-take">{formatCRC(row.payout_crc)}</div>
                          </div>
                        ))}
                      </div>
                      {s.notes && (
                        <div style={{ marginTop:'0.5rem', padding:'0.5rem 0.75rem', background:'rgba(0,0,0,0.04)', borderRadius:2, fontSize:'0.78rem', color:'#5a5040', borderLeft:'2px solid var(--t-gold)' }}>
                          📝 {s.notes}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
