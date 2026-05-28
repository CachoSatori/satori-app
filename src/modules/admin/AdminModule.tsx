import { useState, useEffect, useCallback } from 'react'
import type { Employee, RoleTipPoints } from '../../shared/types/database'
import { getAllEmployees } from '../../shared/api/admin'
import { getRoleTipPoints } from '../../shared/api/tips'
import EmployeeList from './EmployeeList'
import RolePointsConfig from './RolePointsConfig'

type Tab = 'employees' | 'rolepoints'

export default function AdminModule() {
  const [tab, setTab] = useState<Tab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rolePoints, setRolePoints] = useState<RoleTipPoints[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        </div>
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
      </div>
    </div>
  )
}
