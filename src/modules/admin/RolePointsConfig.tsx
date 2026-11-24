import { useState } from 'react'
import type { RoleTipPoints, UserRole } from '../../shared/types/database'
import { upsertRoleTipConfig } from '../../shared/api/admin'
import { ROLE_LABELS } from '../../shared/constants'
import { alEscribir, esIlegible, valorInput } from '../tips/validarTurno'
import { errorDeCuadros } from '../cash/cuadrosMonto'

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

  // Puntos ilegibles («5-», «0-450»: el cuadro da '' y validity.badInput) o negativos → aviso que nombra el rol y
  // no se guarda nada (antes `parseInt('') || 0` guardaba 0 y sacaba al rol del reparto). Vacío sigue siendo 0.
  // Solo cuentan los roles que reciben propina (en los otros el cuadro está apagado). R29–R31.
  const aviso = errorDeCuadros(TIP_ROLES.filter(r => getRcv(r)).map(r => ({
    nombre: `Puntos / hora · ${ROLE_LABELS[r]}`, valor: getPts(r), ilegible: Number.isNaN(getPts(r)),
  })))

  const handleSave = async () => {
    if (aviso) { setError(aviso); return }
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
          <button className="btn-primary" onClick={handleSave} disabled={saving || !!aviso}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        )}
        {saved && !isDirty && (
          <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>✓ Guardado</span>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--gray-light)', marginBottom: '1rem', lineHeight: 1.5 }}>
        Cómo se reparte: <span style={{ color: 'var(--accent)' }}>propina de cada uno = (horas × puntos de su rol ÷ puntos de todo el turno) × pozo del turno</span>.
        <br />“Recibe propina” en <strong>No</strong> saca al rol de la lista del turno y del pozo (se puede revertir; no afecta turnos ya cerrados).
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
                    key={rcv ? 'pts' : 'pts-apagado'}
                    min="0"
                    max="50"
                    step="1"
                    aria-label={`Puntos / hora: ${ROLE_LABELS[role]}`}
                    value={valorInput(getPts(role))}
                    {...alEscribir(el => setEditingPts(prev => ({ ...prev, [role]: esIlegible(el) ? Number.NaN : parseInt(el.value) || 0 })))}
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
                      onChange={e => {
                        const recibe = e.target.checked
                        setEditingRcv(prev => ({ ...prev, [role]: recibe }))
                        // Al apagar el cuadro, lo ilegible se descarta (vuelven los puntos guardados): si no, bloquearía sin verse.
                        if (!recibe) setEditingPts(prev => {
                          if (!Number.isNaN(prev[role])) return prev
                          const rest = { ...prev }; delete rest[role]; return rest
                        })
                      }}
                      disabled={saving}
                      aria-label={`Recibe propina: ${ROLE_LABELS[role]}`}
                    />
                    <span style={{ color: rcv ? 'var(--success, var(--c-musgo))' : 'var(--gray-light, var(--c-gris))', fontWeight: 600 }}>
                      {rcv ? 'Sí' : 'No'}
                    </span>
                  </label>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {(aviso || error) && <p className="field-error" role="alert" style={{ marginTop: '0.75rem' }}>{aviso ?? error}</p>}
    </div>
  )
}
