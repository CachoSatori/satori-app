import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Employee, RoleTipPoints } from '../../shared/types/database'
import { getAllEmployees, getAllProfiles } from '../../shared/api/admin'
import { getRoleTipPoints } from '../../shared/api/tips'
import EmployeeList from './EmployeeList'
import RolePointsConfig from './RolePointsConfig'
import ExchangeRateWidget from './ExchangeRateWidget'
import EmployeeHours from './EmployeeHours'
import UserApprovals from './UserApprovals'
import { useAuth } from '../../shared/hooks/useAuth'

type Tab = 'employees' | 'users' | 'rolepoints' | 'exchange' | 'hours'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

async function sendMonthlyReport(month?: string, tipo?: string): Promise<{ ok: boolean; month?: string; results?: string[]; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/monthly-report`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...(month ? { month } : {}), ...(tipo ? { tipo } : {}) }),
  })
  return res.json()
}

export default function AdminModule() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rolePoints, setRolePoints] = useState<RoleTipPoints[]>([])
  const [pendingUsers, setPendingUsers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingReport, setSendingReport] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [emps, points, profiles] = await Promise.all([
        getAllEmployees(),
        getRoleTipPoints(),
        getAllProfiles().catch(() => []),
      ])
      setEmployees(emps)
      setRolePoints(points)
      setPendingUsers(profiles.filter(p => !p.is_active).length)
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
          <span className="role-badge">Owner</span>
        </div>
        <div className="module-header-actions">
          <button className="cash-back-btn" style={{ borderColor:'#333', color:'#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Nav tabs — barra estilo dashboard */}
      <div className="vt-nav-tabs">
        <div className={`vt-nav-tab ${tab === 'employees' ? 'active' : ''}`} onClick={() => setTab('employees')}>Empleados</div>
        <div className={`vt-nav-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
          Usuarios{pendingUsers > 0 && (
            <span style={{ marginLeft: '0.4rem', background: 'var(--t-red)', color: '#fff', borderRadius: 10, fontSize: '0.6rem', fontWeight: 700, padding: '0.05rem 0.4rem' }}>
              {pendingUsers}
            </span>
          )}
        </div>
        <div className={`vt-nav-tab ${tab === 'rolepoints' ? 'active' : ''}`} onClick={() => setTab('rolepoints')}>Puntos por rol</div>
        <div className={`vt-nav-tab ${tab === 'exchange' ? 'active' : ''}`} onClick={() => setTab('exchange')}>Tipo de cambio</div>
        <div className={`vt-nav-tab ${tab === 'hours' ? 'active' : ''}`} onClick={() => setTab('hours')}>Horas trabajadas</div>
      </div>

      {/* Email report button */}
      <div style={{ padding: '0.625rem 1.5rem', borderBottom: '1px solid var(--t-border)', background: 'var(--t-panel)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', color: '#5a5040', letterSpacing: '0.04em', marginRight: '0.25rem' }}>
          📧 Reportes automáticos — día 1 (mes anterior) · día 15 (propinas quincenal):
        </span>
        {(['ventas','propinas','ambos'] as const).map(tipo => (
          <button
            key={tipo}
            className="tips-btn-ghost"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
            disabled={sendingReport}
            onClick={async () => {
              setSendingReport(true)
              setReportMsg(null)
              const result = await sendMonthlyReport(undefined, tipo)
              if (result.ok) {
                setReportMsg(`✓ ${tipo === 'ambos' ? 'Ambos reportes' : 'Reporte '+tipo} enviado — ${result.month}`)
              } else {
                setReportMsg(`✗ ${result.error?.slice(0, 80)}`)
              }
              setSendingReport(false)
              setTimeout(() => setReportMsg(null), 6000)
            }}
          >
            {sendingReport ? '⟳' : tipo === 'ventas' ? '📈 Ventas' : tipo === 'propinas' ? '💰 Propinas' : '📧 Ambos'}
          </button>
        ))}
        {reportMsg && (
          <span style={{ fontSize: '0.78rem', color: reportMsg.startsWith('✓') ? 'var(--t-teal)' : 'var(--t-red)', fontWeight: 600, marginLeft: '0.5rem' }}>
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
        {tab === 'users' && (
          <UserApprovals employees={employees} currentUserId={profile?.id} />
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
