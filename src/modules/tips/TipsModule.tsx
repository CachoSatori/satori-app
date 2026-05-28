import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getOpenTipSession,
  getTipSessions,
  getTipEntriesBySession,
  getActiveEmployees,
  getRoleTipPoints,
  createTipSession,
  closeTipSession,
  upsertTipEntry,
  deleteTipEntry,
  savePayouts,
} from '../../shared/api/tips'
import { calculateTips, formatCRC, formatUSD } from '../../shared/utils/tipCalculations'
import type { TipSession, TipEntry, Employee, RoleTipPoints } from '../../shared/types/database'
import type { TipCalculationResult } from '../../shared/utils/tipCalculations'
import TipSessionForm from './TipSessionForm'
import TipEntryRow from './TipEntryRow'
import TipSummary from './TipSummary'
import TipHistory from './TipHistory'

type View = 'session' | 'history'

export default function TipsModule() {
  const { profile } = useAuth()

  // Estado principal
  const [view, setView] = useState<View>('session')
  const [openSession, setOpenSession] = useState<TipSession | null>(null)
  const [sessions, setSessions] = useState<TipSession[]>([])
  const [entries, setEntries] = useState<TipEntry[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rolePoints, setRolePoints] = useState<RoleTipPoints[]>([])
  const [calculation, setCalculation] = useState<TipCalculationResult | null>(null)

  // UI state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)
  const [closing, setClosing] = useState(false)

  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  // Carga inicial
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [open, allSessions, emps, points] = await Promise.all([
        getOpenTipSession(),
        getTipSessions(),
        getActiveEmployees(),
        getRoleTipPoints(),
      ])
      setOpenSession(open)
      setSessions(allSessions)
      setEmployees(emps)
      setRolePoints(points)

      if (open) {
        const sessionEntries = await getTipEntriesBySession(open.id)
        setEntries(sessionEntries)
        if (sessionEntries.length > 0) {
          const calc = calculateTips(sessionEntries, emps, points, open.exchange_rate)
          setCalculation(calc)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Recalcular cuando cambian las entradas
  useEffect(() => {
    if (openSession && entries.length > 0) {
      const calc = calculateTips(entries, employees, rolePoints, openSession.exchange_rate)
      setCalculation(calc)
    } else {
      setCalculation(null)
    }
  }, [entries, employees, rolePoints, openSession])

  // Abrir nueva sesión
  const handleCreateSession = async (date: string, exchangeRate: number, notes?: string) => {
    if (!profile) return
    try {
      const session = await createTipSession(date, exchangeRate, profile.id, notes)
      setOpenSession(session)
      setEntries([])
      setShowNewSession(false)
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creando sesión')
    }
  }

  // Guardar entrada de empleado
  const handleSaveEntry = async (
    employeeId: string,
    hoursWorked: number,
    tipCrc: number,
    tipUsd: number
  ) => {
    if (!openSession) return
    try {
      const updated = await upsertTipEntry({
        session_id: openSession.id,
        employee_id: employeeId,
        hours_worked: hoursWorked,
        tip_amount_crc: tipCrc,
        tip_amount_usd: tipUsd,
      })
      setEntries(prev => {
        const idx = prev.findIndex(e => e.employee_id === employeeId)
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next }
        return [...prev, updated]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando entrada')
    }
  }

  // Eliminar entrada
  const handleDeleteEntry = async (employeeId: string) => {
    if (!openSession) return
    try {
      await deleteTipEntry(openSession.id, employeeId)
      setEntries(prev => prev.filter(e => e.employee_id !== employeeId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error eliminando entrada')
    }
  }

  // Cerrar sesión y guardar payouts
  const handleCloseSession = async () => {
    if (!openSession || !profile || !calculation) return
    setClosing(true)
    try {
      // Guardar los montos calculados en cada entrada
      const payoutData = calculation.rows.map(row => {
        const entry = entries.find(e => e.employee_id === row.employee.id)!
        return { id: entry.id, points: row.points, payout_crc: row.payout_crc }
      })
      await savePayouts(payoutData)
      await closeTipSession(openSession.id, profile.id)
      setOpenSession(null)
      setEntries([])
      setCalculation(null)
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cerrando sesión')
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">心</span>
      </div>
    )
  }

  return (
    <div className="tips-module">
      {/* Header del módulo */}
      <div className="module-header">
        <div className="module-header-left">
          <span className="module-header-kanji">心</span>
          <div>
            <h2 className="module-header-title">Propinas</h2>
            <p className="module-header-sub">Pool del turno · Satori</p>
          </div>
        </div>
        <div className="module-header-actions">
          <button
            className={`tab-btn ${view === 'session' ? 'active' : ''}`}
            onClick={() => setView('session')}
          >
            Turno actual
          </button>
          <button
            className={`tab-btn ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView('history')}
          >
            Historial
          </button>
        </div>
      </div>

      {error && (
        <div className="module-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Vista: Turno actual */}
      {view === 'session' && (
        <div className="tips-session-view">
          {!openSession && !showNewSession && (
            <div className="tips-empty">
              <p className="tips-empty-text">No hay sesión abierta</p>
              {isManager && (
                <button className="btn-primary" onClick={() => setShowNewSession(true)}>
                  Abrir turno
                </button>
              )}
            </div>
          )}

          {!openSession && showNewSession && (
            <TipSessionForm
              onSubmit={handleCreateSession}
              onCancel={() => setShowNewSession(false)}
            />
          )}

          {openSession && (
            <>
              {/* Info de sesión */}
              <div className="session-info-bar">
                <div className="session-info-item">
                  <span className="info-label">Fecha</span>
                  <span className="info-value">{openSession.session_date}</span>
                </div>
                <div className="session-info-item">
                  <span className="info-label">Tipo de cambio</span>
                  <span className="info-value">₡{openSession.exchange_rate.toLocaleString('es-CR')}</span>
                </div>
                <div className="session-info-item">
                  <span className="info-label">Estado</span>
                  <span className="info-value status-open">Abierto</span>
                </div>
              </div>

              {/* Tabla de empleados */}
              <div className="tips-table-container">
                <table className="tips-table">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Rol</th>
                      <th>Horas</th>
                      <th>Propina CRC</th>
                      <th>Propina USD</th>
                      {calculation && <th>Puntos</th>}
                      {calculation && <th>A cobrar</th>}
                      {isManager && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => {
                      const entry = entries.find(e => e.employee_id === emp.id)
                      const calcRow = calculation?.rows.find(r => r.employee.id === emp.id)
                      return (
                        <TipEntryRow
                          key={emp.id}
                          employee={emp}
                          entry={entry}
                          calcRow={calcRow}
                          showCalc={!!calculation}
                          isManager={isManager}
                          onSave={handleSaveEntry}
                          onDelete={handleDeleteEntry}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Resumen */}
              {calculation && (
                <TipSummary
                  calculation={calculation}
                  exchangeRate={openSession.exchange_rate}
                />
              )}

              {/* Botón cerrar */}
              {isManager && entries.length > 0 && (
                <div className="tips-close-bar">
                  <button
                    className="btn-danger"
                    onClick={handleCloseSession}
                    disabled={closing}
                  >
                    {closing ? 'Cerrando…' : 'Cerrar turno y guardar payouts'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Vista: Historial */}
      {view === 'history' && (
        <TipHistory
          sessions={sessions}
          employees={employees}
          rolePoints={rolePoints}
        />
      )}
    </div>
  )
}

// Re-exportar utilidades para uso externo
export { formatCRC, formatUSD }
