import { useState } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import { getTipEntriesBySession } from '../../shared/api/tips'
import { calcHistory, formatCRC, formatNum, ROL_LABELS, type HistoryCalc } from '../../shared/utils/tipCalculations'

interface Props {
  sessions:   TipSession[]
  employees:  Employee[]
  rolePoints: RoleTipPoints[]
  onCalcReady?: (sessionId: string, calc: HistoryCalc) => void
}

export default function TipHistory({ sessions, employees, rolePoints, onCalcReady }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calcCache, setCalcCache] = useState<Record<string, HistoryCalc>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const closed = sessions.filter(s => s.status === 'closed')

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

  if (!closed.length) {
    return (
      <div className="tips-empty-state">
        <p className="tips-empty-text">No hay turnos cerrados aún</p>
      </div>
    )
  }

  return (
    <div className="tips-history">
      {closed.map(s => {
        const isOpen = expandedId === s.id
        const calc = calcCache[s.id]
        const isLoading = loadingId === s.id

        return (
          <div key={s.id} className={`hist-item${isOpen ? ' open' : ''}`} onClick={() => handleExpand(s)}>
            <div className="hist-header">
              <div>
                <div className="hist-fecha">{s.session_date} · {s.shift_type}</div>
                <div className="hist-meta">
                  {calc ? `${calc.rows.length} empleados` : ''}
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
                      {calc.rows.map(row => (
                        <div key={row.employeeId} className="hist-emp-row">
                          <div>
                            <div className="hist-emp-name">{row.employeeName}</div>
                            <div className="hist-emp-meta">
                              {ROL_LABELS[row.role]} · {row.hours}h · {formatNum(row.pts_val)} pts
                            </div>
                          </div>
                          <div className="hist-emp-take">{formatCRC(row.payout_crc)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
