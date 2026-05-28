import { useState } from 'react'
import type { RoleTipPoints, UserRole } from '../../shared/types/database'
import { updateRoleTipPoints } from '../../shared/api/admin'

const ROLE_LABELS: Record<string, string> = {
  salonero: 'Salonero', barman: 'Barman', barback: 'Barback',
  runner: 'Runner', cocina: 'Cocina', manager: 'Encargado',
  cajero: 'Cajero', owner: 'Propietario', contador: 'Contador',
}

// Roles que participan en el pool de propinas
const TIP_ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'manager']

interface Props {
  rolePoints: RoleTipPoints[]
  onRefresh: () => Promise<void>
}

export default function RolePointsConfig({ rolePoints, onRefresh }: Props) {
  const [editing, setEditing] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const getValue = (role: UserRole): number => {
    if (role in editing) return editing[role]
    return rolePoints.find(r => r.role === role)?.points ?? 0
  }

  const isDirty = Object.keys(editing).length > 0

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await Promise.all(
        Object.entries(editing).map(([role, points]) =>
          updateRoleTipPoints(role as UserRole, points)
        )
      )
      setEditing({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <span className="admin-section-title">Puntos por rol</span>
        {isDirty && (
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        )}
        {saved && !isDirty && (
          <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>✓ Guardado</span>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--gray-light)', marginBottom: '1rem', lineHeight: 1.5 }}>
        Fórmula: <span style={{ color: 'var(--accent)' }}>take-home = (horas × puntos_rol / total_puntos) × pool</span>
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Rol</th>
            <th>Puntos / hora</th>
          </tr>
        </thead>
        <tbody>
          {TIP_ROLES.map(role => (
            <tr key={role} className="admin-row">
              <td><span className="role-tag">{ROLE_LABELS[role]}</span></td>
              <td>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={getValue(role)}
                  onChange={e => setEditing(prev => ({ ...prev, [role]: parseInt(e.target.value) || 0 }))}
                  className="tip-input"
                  style={{ width: '70px' }}
                  disabled={saving}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="field-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  )
}
