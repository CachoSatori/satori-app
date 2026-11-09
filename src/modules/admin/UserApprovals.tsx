import { useState, useEffect, useCallback } from 'react'
import type { Profile, Employee, UserRole } from '../../shared/types/database'
import { getAllProfiles, updateProfileRole, setProfileActive } from '../../shared/api/admin'

import { ROLE_LABELS } from '../../shared/constants'
import NuevoEmpleado from './NuevoEmpleado'
import { ALIAS_CORREO_EJEMPLO } from './aliasCorreo'

const ROLES: UserRole[] = ['owner', 'contador', 'manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina', 'proveedor']

interface Props {
  employees: Employee[]
  currentUserId?: string
  // Refresca la lista de empleados (vínculo nuevo) SIN desmontar esta pantalla.
  onEmployeesChanged?: () => void
}

export default function UserApprovals({ employees, currentUserId, onEmployeesChanged }: Props) {
  const [nuevo, setNuevo] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      setProfiles(await getAllProfiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando usuarios')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const empOf = (profileId: string) => employees.find(e => e.profile_id === profileId)

  const handleRole = async (id: string, role: UserRole) => {
    setSavingId(id); setError(null)
    try { await updateProfileRole(id, role); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSavingId(null) }
  }

  const handleActive = async (id: string, active: boolean) => {
    setSavingId(id); setError(null)
    try { await setProfileActive(id, active); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSavingId(null) }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--t-muted)' }}>Cargando usuarios…</div>

  const pending = profiles.filter(p => !p.is_active)
  const active  = profiles.filter(p => p.is_active)

  const renderRow = (p: Profile) => {
    const emp = empOf(p.id)
    const isMe = p.id === currentUserId
    return (
      <tr key={p.id} className="admin-row">
        <td className="admin-emp-name">
          {p.full_name}{isMe && <span style={{ color: 'var(--t-muted)', fontWeight: 400 }}> (vos)</span>}
          <div style={{ fontSize: '0.65rem', color: 'var(--t-muted)', marginTop: 1 }}>
            {p.email ?? '—'}{emp && <span> · 👤 {emp.full_name}</span>}
          </div>
        </td>
        <td>
          <select
            value={p.role}
            disabled={savingId === p.id || isMe}
            onChange={e => handleRole(p.id, e.target.value as UserRole)}
            style={{ fontSize: '0.78rem', background: 'var(--t-paper)', border: '1px solid var(--t-border)', borderRadius: 2, padding: '0.3rem 0.45rem', color: 'var(--t-ink)' }}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </td>
        <td className="admin-row-actions">
          {p.is_active ? (
            <button className="btn-delete-inline" disabled={savingId === p.id || isMe}
              onClick={() => handleActive(p.id, false)} title={isMe ? 'No podés deshabilitarte a vos mismo' : ''}>
              Deshabilitar
            </button>
          ) : (
            <button className="btn-save-inline" disabled={savingId === p.id}
              onClick={() => handleActive(p.id, true)}>
              ✓ Habilitar
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="admin-section" style={{ maxWidth: 720 }}>
      {error && <p className="field-error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

      {/* Alta de empleados (05/11): el registro abierto está cerrado desde SEC-01; las cuentas las crea
          el owner desde acá con la Edge Function `alta-empleado`. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn-save-inline" onClick={() => setNuevo(true)}>+ Nuevo empleado</button>
      </div>
      <div style={{ border: '1px solid var(--t-border)', borderRadius: 4, padding: '0.75rem 0.875rem',
        marginBottom: '1.25rem', fontSize: '0.74rem', lineHeight: 1.6, color: 'var(--t-muted)' }}>
        <strong style={{ color: 'var(--t-ink)' }}>¿Cómo dar de alta a alguien?</strong><br />
        1. Tocá <strong>+ Nuevo empleado</strong> y cargá nombre, correo (el suyo o un alias
        <code> {ALIAS_CORREO_EJEMPLO}</code>) y rol. Si ya está en Empleados, vinculalo.<br />
        2. Copiá la <strong>contraseña temporal</strong> y entregásela en persona: no se vuelve a mostrar.<br />
        3. La persona entra con su correo y esa contraseña, elige una nueva y aterriza directo en su
        pantalla (cajero → Caja, bandeja proveedores → Registrar pago).
      </div>

      {nuevo && (
        <NuevoEmpleado employees={employees} onClose={() => setNuevo(false)}
          onCreated={() => { load(); onEmployeesChanged?.() }} />
      )}

      <div className="admin-section-header">
        <span className="admin-section-title">Cuentas deshabilitadas {pending.length > 0 && `(${pending.length})`}</span>
      </div>
      {pending.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--t-muted)', marginBottom: '1.5rem' }}>
          No hay cuentas deshabilitadas.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.72rem', color: 'var(--t-muted)', marginBottom: '0.6rem', lineHeight: 1.5 }}>
            Estas cuentas no pueden entrar. Para devolverle el acceso a alguien, revisá el rol y tocá <strong>Habilitar</strong>.
          </p>
          <table className="admin-table" style={{ marginBottom: '2rem' }}>
            <thead><tr><th>Usuario</th><th>Rol</th><th></th></tr></thead>
            <tbody>{pending.map(renderRow)}</tbody>
          </table>
        </>
      )}

      <div className="admin-section-header">
        <span className="admin-section-title">Usuarios activos ({active.length})</span>
      </div>
      <table className="admin-table">
        <thead><tr><th>Usuario</th><th>Rol</th><th></th></tr></thead>
        <tbody>{active.map(renderRow)}</tbody>
      </table>
    </div>
  )
}
