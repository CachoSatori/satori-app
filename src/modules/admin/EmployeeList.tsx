import { useState, useEffect } from 'react'
import type { Employee, UserRole, Profile } from '../../shared/types/database'
import { createEmployee, updateEmployee, toggleEmployeeActive, getAllProfiles, linkProfileToEmployee } from '../../shared/api/admin'
import { getVentasDias } from '../../shared/api/ventas'
import { allSaloneros } from '../ventas/ventasUtils'
// pos_name (columna viva en employees) = nombre exacto en el XLS de ventas/POS, clave de dias.saloneros.
// Se elige desde un dropdown de nombres reales para evitar typos; ata Mi Rendimiento y VentasICP al empleado.

import { ROLE_LABELS } from '../../shared/constants'
import { useAuth } from '../../shared/hooks/useAuth'
import { leerLoginsSinEmpleado, POS_LOGIN_RE, DIAS_LOGINS, type LoginSinEmpleado } from './loginsPosSinEmpleado'

/** D2: '' = sin login; si no, 3 dígitos. Devuelve el mensaje de error o null. */
const errorLogin = (v: string) => v.trim() === '' || POS_LOGIN_RE.test(v.trim()) ? null : 'El login del PoS son 3 dígitos (ej. 041).'

const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

interface Props {
  employees: Employee[]
  onRefresh: () => Promise<void>
}

export default function EmployeeList({ employees, onRefresh }: Props) {
  // D2: el login del PoS lo ve y lo cambia SOLO el owner (la base lo exige con club_employees_pos_login_guardia).
  const { profile } = useAuth()
  const esOwner = profile?.role === 'owner'
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [salNames, setSalNames] = useState<string[]>([])   // nombres reales de ventas (claves de dias.saloneros)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    getAllProfiles().then(setProfiles).catch(() => {})
    getVentasDias(365).then(d => setSalNames(allSaloneros(d))).catch(() => {})
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
  const [newPosLogin, setNewPosLogin] = useState('')
  const [editPosLogin, setEditPosLogin] = useState('')
  // D2: logins del PoS de los últimos 14 días sin empleado (null = cargando; 'fallo' = no se pudo revisar).
  const [sinEmpleado, setSinEmpleado] = useState<LoginSinEmpleado[] | 'fallo' | null>(null)
  const clavesLogin = employees.map(e => e.pos_login ?? '').join('|')
  useEffect(() => {
    if (!esOwner) return
    let vivo = true
    leerLoginsSinEmpleado(employees)
      .then(l => { if (vivo) setSinEmpleado(l) })
      .catch(() => { if (vivo) setSinEmpleado('fallo') })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se relee solo si cambian los logins cargados
  }, [esOwner, clavesLogin])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('salonero')

  const active   = employees.filter(e => e.is_active)
  const inactive = employees.filter(e => !e.is_active)

  // Nombres del XLS de ventas que no son el pos_name de ningún empleado → sin vincular.
  const unassignedNames = salNames
    .filter(n => !employees.some(e => (e.pos_name ?? '') === n))
    .slice()
    .sort((a, b) => a.localeCompare(b))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const errLogin = esOwner ? errorLogin(newPosLogin) : null
    if (errLogin) { setError(errLogin); return }
    setSaving(true)
    setError(null)
    try {
      await createEmployee({
        full_name: name.trim().toUpperCase(), role,
        ...(esOwner && newPosLogin.trim() ? { pos_login: newPosLogin.trim() } : {}),
      })
      setName('')
      setRole('salonero')
      setNewPosLogin('')
      setShowForm(false)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const [editPosName, setEditPosName] = useState('')

  const handleEdit = (emp: Employee, posLogin?: string) => {
    setEditId(emp.id)
    setEditName(emp.full_name)
    setEditRole(emp.role)
    setEditPosName(emp.pos_name ?? '')
    setEditPosLogin(posLogin ?? emp.pos_login ?? '')
    setError(null)
  }

  // D2: «asignar» desde el aviso → Editar del empleado elegido, o Agregar, con el login precargado.
  const asignarAEmpleado = (login: string, empId: string) => {
    const emp = employees.find(e => e.id === empId)
    if (emp) { setShowForm(false); handleEdit(emp, login) }
  }
  const asignarANuevo = (login: string) => {
    setEditId(null); setNewPosLogin(login); setError(null); setShowForm(true)
  }

  const handleSaveEdit = async (id: string) => {
    const antes = employees.find(e => e.id === id)?.pos_login ?? null
    const login = editPosLogin.trim() || null
    // Solo el owner manda el login, y solo si cambió (el trigger guarda historial de cada cambio).
    const cambiaLogin = esOwner && login !== antes
    const errLogin = cambiaLogin ? errorLogin(editPosLogin) : null
    if (errLogin) { setError(errLogin); return }
    setSaving(true)
    setError(null)
    try {
      await updateEmployee(id, {
        full_name: editName.trim().toUpperCase(),
        role: editRole,
        // pos_name: valor exacto de dias.saloneros (del dropdown) → match exacto en Mi Rendimiento. null = sin vincular.
        pos_name: editPosName.trim() ? editPosName.trim() : null,
        ...(cambiaLogin ? { pos_login: login } : {}),
      })
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
          {esOwner && (
            <div className="field">
              <label htmlFor="nuevo-pos-login">Login del PoS (opcional)</label>
              <input
                id="nuevo-pos-login"
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={newPosLogin}
                onChange={e => setNewPosLogin(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej: 041"
                disabled={saving}
              />
            </div>
          )}
          {error && <p className="field-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {esOwner && sinEmpleado === 'fallo' && (
        <p style={{ fontSize: '0.72rem', color: 'var(--c-gris)', margin: '0 0 0.75rem' }}>
          No se pudieron revisar los logins del PoS de los últimos {DIAS_LOGINS} días.
        </p>
      )}
      {esOwner && Array.isArray(sinEmpleado) && sinEmpleado.length > 0 && (
        <LoginsSinEmpleadoPanel
          logins={sinEmpleado}
          employees={employees}
          onAsignarEmpleado={asignarAEmpleado}
          onAsignarNuevo={asignarANuevo}
        />
      )}

      {unassignedNames.length > 0 && (
        <UnassignedNamesPanel
          names={unassignedNames}
          employees={employees}
          profiles={profiles}
          onRefresh={onRefresh}
        />
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
                      style={{ width: '130px', marginBottom: '2px' }}
                    />
                    <div>
                      <select
                        className="tip-input"
                        value={editPosName}
                        onChange={e => setEditPosName(e.target.value)}
                        disabled={saving}
                        title="Nombre en ventas — clave exacta del XLS (dias.saloneros)"
                        style={{ width: '130px', fontSize: '0.72rem', opacity: 0.7 }}
                      >
                        <option value="">— sin vincular —</option>
                        {editPosName && !salNames.includes(editPosName) && (
                          <option value={editPosName}>{editPosName} (actual)</option>
                        )}
                        {salNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    {esOwner && (
                      <div>
                        <input
                          className="tip-input"
                          aria-label="Login del PoS"
                          title="Login del PoS (3 dígitos). Solo el owner lo cambia; queda en el historial."
                          inputMode="numeric"
                          maxLength={3}
                          value={editPosLogin}
                          onChange={e => setEditPosLogin(e.target.value.replace(/\D/g, ''))}
                          disabled={saving}
                          placeholder="Login PoS"
                          style={{ width: '130px', fontSize: '0.72rem', marginTop: '2px' }}
                        />
                      </div>
                    )}
                    {error && <div className="field-error" style={{ fontSize: '0.72rem' }}>{error}</div>}
                  </td>
                  <td>
                    <select
                      value={editRole}
                      onChange={e => setEditRole(e.target.value as UserRole)}
                      disabled={saving}
                      style={{ background: 'var(--c-fondo)', border: '1px solid var(--c-linea)', color: 'var(--c-tinta)', padding: '4px 8px', borderRadius: '2px' }}
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
                  <td className="admin-emp-name">
                    {emp.full_name}
                    {emp.pos_name && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--c-gris)', marginTop: '1px' }}>
                        Ventas: {emp.pos_name}
                      </div>
                    )}
                    {esOwner && emp.pos_login && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--c-gris)', marginTop: '1px' }}>
                        Login del PoS: {emp.pos_login}
                      </div>
                    )}
                  </td>
                  <td><span className="role-tag">{ROLE_LABELS[emp.role] ?? emp.role}</span></td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--c-gris)' }}>
                    {/* Profile link selector */}
                    <select
                      style={{ fontSize: '0.72rem', background: 'var(--c-fondo)', border: '1px solid var(--c-linea)', borderRadius: 2, padding: '0.2rem 0.4rem', color: emp.profile_id ? 'var(--c-teal)' : 'var(--c-gris)' }}
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
                <td colSpan={3} style={{ padding: '12px 12px 4px', fontSize: '0.65rem', color: 'var(--gray-mid)' }}>
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

      {/* ── Importar en masa ── */}
      <BulkImport employees={employees} onRefresh={onRefresh} />
    </div>
  )
}

function BulkImport({ employees, onRefresh }: { employees: Employee[]; onRefresh: () => Promise<void> }) {
  const [open,    setOpen]    = useState(false)
  const [text,    setText]    = useState('')
  const [role,    setRole]    = useState<UserRole>('salonero')
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)

  const existingNames = new Set(employees.map(e => e.full_name.toUpperCase()))

  const preview = text
    .split('\n')
    .map(l => l.trim().toUpperCase())
    .filter(l => l.length > 1)

  const newOnes  = preview.filter(n => !existingNames.has(n))
  const dupOnes  = preview.filter(n =>  existingNames.has(n))

  const handleImport = async () => {
    if (!newOnes.length) return
    setSaving(true)
    setMsg(null)
    try {
      for (const name of newOnes) {
        await createEmployee({ full_name: name, role })
      }
      await onRefresh()
      setMsg(`✓ ${newOnes.length} empleado${newOnes.length > 1 ? 's' : ''} importado${newOnes.length > 1 ? 's' : ''}`)
      setText('')
      setTimeout(() => { setMsg(null); setOpen(false) }, 3000)
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop:'1.5rem', borderTop:'1px solid var(--c-linea)', paddingTop:'1rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize:'0.78rem', padding:'6px 14px', border:'1px solid var(--c-linea)', borderRadius:2, background:'transparent', cursor:'pointer', color:'var(--c-gris)' }}>
        {open ? '▲ Cerrar' : '📋 Importar empleados en masa'}
      </button>

      {open && (
        <div style={{ marginTop:'0.75rem', background:'var(--c-panel)', border:'1px solid var(--c-linea)', borderRadius:2, padding:'1rem' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--c-gris)', marginBottom:'0.5rem' }}>
            Pegá los nombres, uno por línea. Se agregarán los que no existan (los duplicados se ignoran).
          </div>
          <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-start', flexWrap:'wrap' }}>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={'FRANCISCO\nMARIA\nJUAN\n...'}
              rows={6}
              style={{ flex:1, minWidth:180, padding:'8px 10px', border:'1px solid var(--c-linea)', borderRadius:2, fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums', fontSize:'0.82rem', resize:'vertical', background:'var(--c-fondo)' }}
            />
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:'0.68rem', color:'var(--c-gris)', marginBottom:4 }}>Rol para todos</div>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)}
                style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--c-linea)', borderRadius:2, fontSize:'0.82rem', marginBottom:'0.75rem' }}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
              </select>

              {preview.length > 0 && (
                <div style={{ fontSize:'0.72rem', marginBottom:'0.75rem' }}>
                  {newOnes.length > 0 && <div style={{ color:'var(--c-musgo)' }}>+ {newOnes.length} nuevo{newOnes.length > 1 ? 's' : ''}</div>}
                  {dupOnes.length > 0 && <div style={{ color:'var(--c-gris)' }}>⊘ {dupOnes.length} ya exist{dupOnes.length > 1 ? 'en' : 'e'}</div>}
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={saving || newOnes.length === 0}
                style={{ width:'100%', padding:'7px', borderRadius:2, background: newOnes.length > 0 ? 'var(--c-tinta)' : 'var(--c-linea)', color:'var(--c-fondo)', fontWeight:700, fontSize:'0.82rem', border:'none', cursor: newOnes.length > 0 ? 'pointer' : 'not-allowed' }}>
                {saving ? 'Importando…' : `Importar ${newOnes.length}`}
              </button>
              {msg && <div style={{ marginTop:'0.5rem', fontSize:'0.75rem', color: msg.startsWith('✓') ? 'var(--c-musgo)' : 'var(--c-laca)' }}>{msg}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── D2 · Panel «Login del PoS sin empleado» (solo owner) ──
// Logins que facturaron en el PoS en los últimos 14 días y no son el pos_login de ningún empleado. «Asignar» abre
// Editar del empleado elegido, o Agregar, con el login precargado; guardar sigue siendo del owner (la base lo exige).
function LoginsSinEmpleadoPanel({ logins, employees, onAsignarEmpleado, onAsignarNuevo }: {
  logins: LoginSinEmpleado[]
  employees: Employee[]
  onAsignarEmpleado: (login: string, empId: string) => void
  onAsignarNuevo: (login: string) => void
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const candidatos = employees.filter(e => e.is_active && !e.pos_login)
  return (
    <div role="alert" style={{ margin: '0 0 1rem', background: 'var(--c-panel)', border: '1px solid var(--c-oro)', borderRadius: 2, padding: '0.75rem 1rem' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--c-oro-texto)', marginBottom: '0.5rem' }}>
        Facturaron en el PoS en los últimos {DIAS_LOGINS} días y no están cargados en ningún empleado: sus ventas no se le
        acreditan a nadie.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {logins.map(l => (
          <div key={l.login} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--c-oro-texto)' }}>
              Login del PoS {l.login} sin empleado: asignar
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--c-gris)' }}>
              ({l.facturas} {l.facturas === 1 ? 'factura' : 'facturas'})
            </span>
            {abierto === l.login ? (
              <>
                <select
                  aria-label={`Asignar ${l.login} a un empleado`}
                  value=""
                  onChange={e => { if (e.target.value) onAsignarEmpleado(l.login, e.target.value) }}
                  style={{ fontSize: '0.78rem', padding: '4px 8px', border: '1px solid var(--c-linea)', borderRadius: 2, background: 'var(--c-fondo)' }}
                >
                  <option value="">— empleado sin login —</option>
                  {candidatos.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
                <button className="btn-secondary" onClick={() => onAsignarNuevo(l.login)}>+ Empleado nuevo</button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => setAbierto(l.login)}>Asignar</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Panel "Nombres en ventas sin asignar" ──
// Lista los nombres del XLS de ventas que no son el pos_name de ningún empleado y permite,
// por nombre, crear el empleado + setear pos_name (+ rol + usuario opcional) en un clic.
// Sin esquema, sin plata: reusa createEmployee/updateEmployee/linkProfileToEmployee.
function UnassignedNamesPanel({ names, employees, profiles, onRefresh }: {
  names: string[]
  employees: Employee[]
  profiles: Profile[]
  onRefresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  if (names.length === 0) return null
  return (
    <div style={{ margin: '0 0 1rem', background: 'var(--c-panel)', border: '1px solid var(--c-oro)', borderRadius: 2, padding: '0.75rem 1rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.82rem', fontWeight: 700, color: 'var(--c-oro-texto)' }}
      >
        {open ? '▼' : '▶'} Nombres en ventas sin asignar ({names.length})
      </button>
      {open && (
        <>
          <div style={{ fontSize: '0.72rem', color: 'var(--c-oro-texto)', margin: '0.4rem 0 0.7rem' }}>
            Aparecen en los XLS de ventas pero no están vinculados a ningún empleado.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {names.map(n => (
              <UnassignedRow key={n} name={n} employees={employees} profiles={profiles} onRefresh={onRefresh} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function UnassignedRow({ name, employees, profiles, onRefresh }: {
  name: string
  employees: Employee[]
  profiles: Profile[]
  onRefresh: () => Promise<void>
}) {
  const [role, setRole] = useState<UserRole>('salonero')
  const [profileId, setProfileId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Perfiles todavía sin empleado vinculado (y nunca owner/contador) → candidatos a usuario.
  const linkedProfileIds = new Set(
    employees.map(e => e.profile_id).filter((id): id is string => !!id)
  )
  const availableProfiles = profiles.filter(
    p => !['owner', 'contador'].includes(p.role) && !linkedProfileIds.has(p.id)
  )

  const handleAssign = async () => {
    setSaving(true)
    setError(null)
    let changed = false
    try {
      // ¿Ya existe un empleado con ese nombre (case-insensitive) y sin pos_name? → vincular ese, NO duplicar.
      const existing = employees.find(
        e => e.full_name.trim().toUpperCase() === name.trim().toUpperCase() && !e.pos_name
      )
      let empId: string
      if (existing) {
        await updateEmployee(existing.id, { pos_name: name, role })
        empId = existing.id
        changed = true
      } else {
        const created = await createEmployee({ full_name: name.toUpperCase(), role })
        changed = true
        // pos_name EXACTO del XLS (sin uppercase) → match exacto en Mi Rendimiento / VentasICP.
        await updateEmployee(created.id, { pos_name: name })
        empId = created.id
      }
      if (profileId) await linkProfileToEmployee(empId, profileId)
      await onRefresh()   // el nombre desaparece del panel (ya quedó vinculado)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
      setSaving(false)
      if (changed) await onRefresh()   // sincronizar el estado para no duplicar en un reintento
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem', minWidth: 120, fontWeight: 700, color: 'var(--c-gris)' }}>
        {name}
      </span>
      <select
        value={role}
        onChange={e => setRole(e.target.value as UserRole)}
        disabled={saving}
        title="Rol del nuevo empleado"
        style={{ fontSize: '0.78rem', padding: '4px 8px', border: '1px solid var(--c-linea)', borderRadius: 2, background: 'var(--c-fondo)' }}
      >
        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
      </select>
      <select
        value={profileId}
        onChange={e => setProfileId(e.target.value)}
        disabled={saving}
        title="Usuario (opcional)"
        style={{ fontSize: '0.78rem', padding: '4px 8px', border: '1px solid var(--c-linea)', borderRadius: 2, background: 'var(--c-fondo)', color: profileId ? 'var(--c-teal)' : 'var(--c-gris)' }}
      >
        <option value="">— sin usuario —</option>
        {availableProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <button
        onClick={handleAssign}
        disabled={saving}
        style={{ fontSize: '0.78rem', padding: '5px 12px', borderRadius: 2, background: saving ? 'var(--c-linea)' : 'var(--c-tinta)', color: 'var(--c-fondo)', fontWeight: 700, border: 'none', cursor: saving ? 'default' : 'pointer' }}
      >
        {saving ? 'Guardando…' : 'Crear + vincular'}
      </button>
      {error && <span style={{ fontSize: '0.72rem', color: 'var(--c-laca)' }}>✗ {error}</span>}
    </div>
  )
}
