import { useState } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import { getTipEntriesBySession } from '../../shared/api/tips'
import { calculateTips, formatCRC } from '../../shared/utils/tipCalculations'
import type { TipCalculationResult } from '../../shared/utils/tipCalculations'

interface Props {
  sessions: TipSession[]
  employees: Employee[]
  rolePoints: RoleTipPoints[]
}

export default function TipHistory({ sessions, employees, rolePoints }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calcCache, setCalcCache] = useState<Record<string, TipCalculationResult>>({})
  const [loading, setLoading] = useState<string | null>(null)

  const closedSessions = sessions.filter(s => s.status === 'closed')

  const handleExpand = async (session: TipSession) => {
    if (expandedId === session.id) { setExpandedId(null); return }
    setExpandedId(session.id)
    if (calcCache[session.id]) return

    setLoading(session.id)
    try {
      const entries = await getTipEntriesBySession(session.id)
      const calc = calculateTips(entries, employees, rolePoints, session.exchange_rate)
      setCalcCache(prev => ({ ...prev, [session.id]: calc }))
    } finally {
      setLoading(null)
    }
  }

  if (closedSessions.length === 0) {
    return (
      <div className="tips-empty">
        <p className="tips-empty-text">No hay turnos cerrados aún</p>
      </div>
    )
  }

  return (
    <div className="tip-history">
      <div className="history-title">Historial de turnos</div>
      {closedSessions.map(session => {
        const isOpen = expandedId === session.id
        const calc = calcCache[session.id]
        const isLoading = loading === session.id

        return (
          <div key={session.id} className="history-item">
            <button className="history-row" onClick={() => handleExpand(session)}>
              <span className="history-date">{session.session_date}</span>
              <span className="history-status closed">Cerrado</span>
              <span className="history-toggle">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="history-detail">
                {isLoading && <p className="history-loading">Cargando…</p>}
                {calc && (
                  <>
                    <div className="history-summary">
                      <span>Pool: <strong>{formatCRC(calc.total_pool_crc)}</strong></span>
                      <span>Puntos: <strong>{calc.total_points.toFixed(1)}</strong></span>
                      <span>₡/punto: <strong>{formatCRC(calc.value_per_point)}</strong></span>
                    </div>
                    <table className="tips-table">
                      <thead>
                        <tr>
                          <th>Empleado</th>
                          <th>Horas</th>
                          <th>Puntos</th>
                          <th>A cobrar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calc.rows.map(row => (
                          <tr key={row.employee.id}>
                            <td>{row.employee.full_name}</td>
                            <td>{row.hours_worked}</td>
                            <td>{row.points.toFixed(1)}</td>
                            <td><strong>{formatCRC(row.payout_crc)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
