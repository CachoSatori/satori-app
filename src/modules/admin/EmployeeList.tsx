import { useState, useEffect } from 'react'
import type { Employee, UserRole, Profile } from '../../shared/types/database'
import { createEmployee, updateEmployee, toggleEmployeeActive, getAllProfiles, linkProfileToEmployee } from '../../shared/api/admin'

const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario', contador: 'Contador', manager: 'Encargado',
  cajero: 'Cajero', salonero: 'Salonero', barman: 'Barman',
  barback: 'Barback', runner: 'Runner', cocina: 'Cocina',
}

interface Props {
  employees: Employee[]
  onRefresh: () => Promise<void>
}

export default function EmployeeList({ employees, onRefresh }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    getAllProfiles().then(setProfiles).catch(() => {})
  }, [])

  const handleLink = async (empId: string, profileId: string) => {
    setLinkingId(empId)
    try {
      await linkProfileToEmployee(empId, profileId || null)
      await onRefresh()
    } finally {
      setLinkingId(null)
    }
  }
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('salonero')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('salonero')

  const active   = employees.filter(e => e.is_active)
  const inactive = employees.filter(e => !e.is_active)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createEmployee({ full_name: name.trim().toUpperCase(), role })
      setName('')
      setRole('salonero')
      setShowForm(false)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (emp: Employee) => {
    setEditId(emp.id)
    setEditName(emp.full_name)
    setEditRole(emp.role)
  }

  const handleSaveEdit = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      await updateEmployee(id, { full_name: editName.trim().toUpperCase(), role: editRole })
      setEditId(null)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (emp: Employee) => {
    setSaving(true)
    try {
      await toggleEmployeeActive(emp.id, !emp.is_active)
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <span className="admin-section-title">Empleados</span>
        <button className="btn-secondary" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancelar' : '+ Agregar'}
        </button>
      </div>

      {showForm && (
        <form className="admin-form" onSubmit={handleCreate}>
          <div className="field">
            <label>Nombre completo</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: DOLORES"
              required
              disabled={saving}
            />
          </div>
          <div className="field">
            <label>Rol</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              disabled={saving}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Perfil de usuario</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {active.map(emp => (
            <tr key={emp.id} className="admin-row">
              {editId === emp.id ? (
                <>
                  <td>
                    <input
                      className="tip-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      disabled={saving}
                      style={{ width: '140px' }}
                    />
                  </td>
                  <td>
                    <select
                      value={editRole}
                      onChange={e => setEditRole(e.target.value as UserRole)}
                      disabled={saving}
                      style={{ background: '#111', border: '1px solid #2a2a2a', color: 'var(--white)', padding: '4px 8px', borderRadius: '2px' }}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="admin-row-actions">
                    <button className="btn-save-inline" onClick={() => handleSaveEdit(emp.id)} disabled={saving}>
                      Guardar
                    </button>
                    <button className="btn-delete-inline" onClick={() => setEditId(null)} disabled={saving}>
                      ✕
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="admin-emp-name">{emp.full_name}</td>
                  <td><span className="role-tag">{ROLE_LABELS[emp.role] ?? emp.role}</span></td>
                  <td style={{ fontSize: '0.72rem', color: '#5a5040' }}>
                    {/* Profile link selector */}
                    <select
                      style={{ fontSize: '0.72rem', background: 'var(--t-paper)', border: '1px solid var(--t-border)', borderRadius: 2, padding: '0.2rem 0.4rem', color: emp.profile_id ? 'var(--t-teal)' : '#888' }}
                      value={emp.profile_id ?? ''}
                      onChange={e => handleLink(emp.id, e.target.value)}
                      disabled={linkingId === emp.id}
                    >
                      <option value="">— Sin perfil —</option>
                      {profiles.filter(p => !['owner','contador'].includes(p.role)).map(p => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="admin-row-actions">
                    <button className="btn-delete-inline" onClick={() => handleEdit(emp)}>
                      Editar
                    </button>
                    <button className="btn-delete-inline" onClick={() => handleToggle(emp)} disabled={saving}>
                      Desactivar
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}

          {inactive.length > 0 && (
            <>
              <tr>
                <td colSpan={3} style={{ padding: '12px 12px 4px', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-mid)' }}>
                  Inactivos
                </td>
              </tr>
              {inactive.map(emp => (
                <tr key={emp.id} className="admin-row inactive">
                  <td className="admin-emp-name" style={{ opacity: 0.4 }}>{emp.full_name}</td>
                  <td><span className="role-tag" style={{ opacity: 0.4 }}>{ROLE_LABELS[emp.role] ?? emp.role}</span></td>
                  <td className="admin-row-actions">
                    <button className="btn-save-inline" onClick={() => handleToggle(emp)} disabled={saving}>
                      Activar
                    </button>
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
