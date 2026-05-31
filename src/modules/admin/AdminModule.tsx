import { useState, useEffect, useCallback } from 'react'
import type { Employee, RoleTipPoints } from '../../shared/types/database'
import { getAllEmployees } from '../../shared/api/admin'
import { getRoleTipPoints } from '../../shared/api/tips'
import EmployeeList from './EmployeeList'
import RolePointsConfig from './RolePointsConfig'
import ExchangeRateWidget from './ExchangeRateWidget'
import EmployeeHours from './EmployeeHours'

type Tab = 'employees' | 'rolepoints' | 'exchange' | 'hours'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

async function sendMonthlyReport(month?: string): Promise<{ ok: boolean; month?: string; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/monthly-report`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(month ? { month } : {}),
  })
  return res.json()
}

export default function AdminModule() {
  const [tab, setTab] = useState<Tab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rolePoints, setRolePoints] = useState<RoleTipPoints[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingReport, setSendingReport] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [emps, points] = await Promise.all([
        getAllEmployees(),
        getRoleTipPoints(),
      ])
      setEmployees(emps)
      setRolePoints(points)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">管</span>
      </div>
    )
  }

  return (
    <div className="tips-module">
      <div className="module-header">
        <div className="module-header-left">
          <span className="module-header-kanji">管</span>
          <div>
            <h2 className="module-header-title">Administración</h2>
            <p className="module-header-sub">Empleados · Configuración</p>
          </div>
        </div>
        <div className="module-header-actions">
          <button
            className={`tab-btn ${tab === 'employees' ? 'active' : ''}`}
            onClick={() => setTab('employees')}
          >
            Empleados
          </button>
          <button
            className={`tab-btn ${tab === 'rolepoints' ? 'active' : ''}`}
            onClick={() => setTab('rolepoints')}
          >
            Puntos por rol
          </button>
          <button
            className={`tab-btn ${tab === 'exchange' ? 'active' : ''}`}
            onClick={() => setTab('exchange')}
          >
            Tipo de cambio
          </button>
          <button
            className={`tab-btn ${tab === 'hours' ? 'active' : ''}`}
            onClick={() => setTab('hours')}
          >
            Horas trabajadas
          </button>
        </div>
      </div>

      {/* Email report button */}
      <div style={{ padding: '0.625rem 1.5rem', borderBottom: '1px solid var(--t-border)', background: 'var(--t-panel)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#5a5040', letterSpacing: '0.06em' }}>
          📧 Reporte mensual automático — día 1 de cada mes a satorisushibar@gmail.com
        </span>
        <button
          className="tips-btn-ghost"
          style={{ fontSize: '0.78rem', marginLeft: 'auto' }}
          disabled={sendingReport}
          onClick={async () => {
            setSendingReport(true)
            setReportMsg(null)
            const result = await sendMonthlyReport()
            if (result.ok) {
              setReportMsg(`✓ Reporte de ${result.month} enviado`)
            } else {
              setReportMsg(`✗ Error: ${result.error?.slice(0, 80)}`)
            }
            setSendingReport(false)
            setTimeout(() => setReportMsg(null), 6000)
          }}
        >
          {sendingReport ? '⟳ Enviando…' : '📧 Enviar reporte ahora'}
        </button>
        {reportMsg && (
          <span style={{ fontSize: '0.78rem', color: reportMsg.startsWith('✓') ? 'var(--t-teal)' : 'var(--t-red)', fontWeight: 600 }}>
            {reportMsg}
          </span>
        )}
      </div>

      {error && (
        <div className="module-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div style={{ padding: '1.5rem' }}>
        {tab === 'employees' && (
          <EmployeeList employees={employees} onRefresh={loadData} />
        )}
        {tab === 'rolepoints' && (
          <RolePointsConfig rolePoints={rolePoints} onRefresh={loadData} />
        )}
        {tab === 'exchange' && (
          <ExchangeRateWidget />
        )}
        {tab === 'hours' && (
          <EmployeeHours employees={employees} />
        )}
      </div>
    </div>
  )
}
