// Admin → Usuarios → «+ Nuevo empleado» (firmado por el dueño, 05/11).
// El owner carga nombre, correo y rol (y opcionalmente el empleado del módulo Empleados a vincular);
// la Edge Function `alta-empleado` crea la cuenta con una contraseña temporal que se muestra UNA vez.
import { useState } from 'react'
import type { Employee, UserRole } from '../../shared/types/database'
import { ROLE_LABELS } from '../../shared/constants'
import { ROLES_ALTA, crearCuentaEmpleado, AltaEmpleadoError, type AltaEmpleadoResultado } from '../../shared/api/altaEmpleado'

interface Props {
  employees: Employee[]
  onClose: () => void
  onCreated: () => void
}

export default function NuevoEmpleado({ employees, onClose, onCreated }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [employeeId, setEmployeeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creado, setCreado] = useState<AltaEmpleadoResultado | null>(null)
  const [copiado, setCopiado] = useState(false)

  // Solo empleados activos sin cuenta (la función lo vuelve a validar).
  const vinculables = employees.filter(e => e.is_active && !e.profile_id)

  const elegirEmpleado = (id: string) => {
    setEmployeeId(id)
    const emp = vinculables.find(e => e.id === id)
    if (emp) {
      if (!fullName.trim()) setFullName(emp.full_name)
      if (!role && ROLES_ALTA.includes(emp.role)) setRole(emp.role)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (fullName.trim().length < 3) { setError('Escribí el nombre completo'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Revisá el correo'); return }
    if (!role) { setError('Elegí el rol'); return }
    setSaving(true)
    try {
      const r = await crearCuentaEmpleado({ full_name: fullName.trim(), email: email.trim(), role, employee_id: employeeId || null })
      setCreado(r)
      onCreated()
    } catch (err) {
      setError(err instanceof AltaEmpleadoError ? err.message : 'No se pudo crear la cuenta')
    } finally { setSaving(false) }
  }

  const copiar = async () => {
    if (!creado) return
    try { await navigator.clipboard.writeText(creado.temp_password); setCopiado(true) } catch { setCopiado(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={() => { if (!saving) onClose() }}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        {creado ? (
          <>
            <div className="cd-modal-title">Cuenta creada</div>
            <div className="cd-modal-meta">{creado.full_name} · {ROLE_LABELS[creado.role]}{creado.employee_linked ? ' · vinculada al empleado' : ''}</div>
            <div style={{ fontSize: '0.8rem', margin: '0.75rem 0 0.4rem' }}>Correo: <strong>{creado.email}</strong></div>
            <div style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Contraseña temporal:</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <code data-testid="temp-password" style={{ fontSize: '1.05rem', padding: '0.35rem 0.6rem', border: '1px solid var(--c-linea)', borderRadius: 2, letterSpacing: '0.06em' }}>
                {creado.temp_password}
              </code>
              <button type="button" className="btn-save-inline" onClick={copiar}>{copiado ? '✓ Copiada' : 'Copiar'}</button>
            </div>
            <p style={{ fontSize: '0.74rem', lineHeight: 1.5, color: 'var(--c-laca)', marginBottom: '1rem' }}>
              ⚠ No se vuelve a mostrar. Entregásela en persona; al entrar por primera vez la va a tener que cambiar.
            </p>
            <div className="cd-modal-actions">
              <button className="cd-btn-green" onClick={onClose}>Listo</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="cd-modal-title">Nuevo empleado</div>
            <div className="cd-modal-meta">Se crea la cuenta con una contraseña temporal</div>

            {vinculables.length > 0 && (
              <label className="nuevo-emp-field">
                <span>Vincular con empleado (opcional)</span>
                <select value={employeeId} onChange={e => elegirEmpleado(e.target.value)} disabled={saving}>
                  <option value="">— Sin vincular —</option>
                  {vinculables.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </label>
            )}
            <label className="nuevo-emp-field">
              <span>Nombre completo</span>
              <input value={fullName} onChange={e => setFullName(e.target.value)} disabled={saving} placeholder="Nombre y apellido" />
            </label>
            <label className="nuevo-emp-field">
              <span>Correo</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={saving} placeholder="nombre@ejemplo.com" />
              <small>Si no tiene correo propio: <code>satorisushibar+nombre@gmail.com</code></small>
            </label>
            <label className="nuevo-emp-field">
              <span>Rol</span>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)} disabled={saving}>
                <option value="">— Elegí el rol —</option>
                {ROLES_ALTA.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <small>Para sumar un propietario, creá la cuenta y cambiale el rol desde la lista.</small>
            </label>

            {error && <p className="field-error" role="alert" style={{ margin: '0.5rem 0' }}>{error}</p>}

            <div className="cd-modal-actions">
              <button type="button" className="tips-btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
              <button type="submit" className="cd-btn-green" disabled={saving}>{saving ? 'Creando…' : 'Crear cuenta'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
