import { useState } from 'react'
import type { RoleTipPoints, UserRole } from '../../shared/types/database'
import { upsertRoleTipConfig } from '../../shared/api/admin'
import { ROLE_LABELS } from '../../shared/constants'

// Roles que participan en el pool de propinas
const TIP_ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

interface Props {
  rolePoints: RoleTipPoints[]
  onRefresh: () => Promise<void>
}

export default function RolePointsConfig({ rolePoints, onRefresh }: Props) {
  const [editingPts, setEditingPts] = useState<Record<string, number>>({})
  const [editingRcv, setEditingRcv] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const getPts = (role: UserRole): number => {
    if (role in editingPts) return editingPts[role]
    return rolePoints.find(r => r.role === role)?.points ?? 0
  }
  // Null-safe: si el flag viene null/ausente → true (default esquema)
  const getRcv = (role: UserRole): boolean => {
    if (role in editingRcv) return editingRcv[role]
    return rolePoints.find(r => r.role === role)?.recibe_propina !== false
  }

  const dirtyRoles = [...new Set([...Object.keys(editingPts), ...Object.keys(editingRcv)])] as UserRole[]
  const isDirty = dirtyRoles.length > 0

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Persiste puntos + elegibilidad juntos (upsert onConflict 'role').
      await Promise.all(dirtyRoles.map(role => upsertRoleTipConfig(role, getPts(role), getRcv(role))))
      setEditingPts({})
      setEditingRcv({})
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
        Fórmula: <span style={{ color: 'var(--accent)' }}>take-home = (horas × puntos_rol / total_puntos) × pool</span>.
        <br />“Recibe propina” en <strong>No</strong> saca al rol del roster del turno y del pool (reversible; no afecta turnos ya cerrados).
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Rol</th>
            <th>Puntos / hora</th>
            <th>Recibe propina</th>
          </tr>
        </thead>
        <tbody>
          {TIP_ROLES.map(role => {
            const rcv = getRcv(role)
            return (
              <tr key={role} className="admin-row">
                <td><span className="role-tag">{ROLE_LABELS[role]}</span></td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="1"
                    value={getPts(role)}
                    onChange={e => setEditingPts(prev => ({ ...prev, [role]: parseInt(e.target.value) || 0 }))}
                    className="tip-input"
                    style={{ width: '70px', opacity: rcv ? 1 : 0.4 }}
                    disabled={saving || !rcv}
                    title={rcv ? undefined : 'El rol no recibe propina: los puntos no aplican'}
                  />
                </td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: saving ? 'default' : 'pointer', fontSize: '0.82rem' }}>
                    <input
                      type="checkbox"
                      checked={rcv}
                      onChange={e => setEditingRcv(prev => ({ ...prev, [role]: e.target.checked }))}
                      disabled={saving}
                      aria-label={`Recibe propina: ${ROLE_LABELS[role]}`}
                    />
                    <span style={{ color: rcv ? 'var(--success, #27874f)' : 'var(--gray-light, #888)', fontWeight: 600 }}>
                      {rcv ? 'Sí' : 'No'}
                    </span>
                  </label>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {error && <p className="field-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  )
}
