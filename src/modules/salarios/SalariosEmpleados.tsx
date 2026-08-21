import { useState } from 'react'
import type { Employee, UserRole } from '../../shared/types/database'
import { createEmployee, updateEmployeePayroll, toggleEmployeeActive } from '../../shared/api/admin'
import { updateEmployeeHomebankingName } from '../../shared/api/salarios'
import { ROLE_LABELS } from '../../shared/constants'
import { fi } from '../../shared/utils'

// Los mismos roles que ofrece Admin → Empleados. El enum user_role NO se toca.
const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

type Filtro = 'activos' | 'inactivos' | 'todos'

// Borrador de los datos de nómina de una fila (o del alta). Todo texto: los inputs
// devuelven strings y se convierten recién al persistir, así un campo a medio escribir
// (ej. "26" camino a "2600") no se redondea ni salta a 0 mientras se tipea.
interface Draft {
  hourly:    string
  fijo:      string
  participa: boolean
  code:      string
  ingreso:   string
  banco:     string   // nombre del beneficiario en el homebanking (mig 058)
}

const emptyDraft: Draft = { hourly: '0', fijo: '0', participa: true, code: '', ingreso: '', banco: '' }

function draftOf(emp: Employee): Draft {
  return {
    hourly:    String(emp.hourly_rate_crc ?? 0),
    fijo:      String(emp.fixed_salary_crc ?? 0),
    participa: emp.participa_servicio ?? true,
    code:      emp.biotime_emp_code ?? '',
    ingreso:   emp.fecha_ingreso ?? '',
    banco:     emp.nombre_homebanking ?? '',
  }
}

function num(s: string): number {
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

// Payload listo para la base: los vacíos van como null (sin mapear / pendiente),
// nunca como '' — la columna es text/date y el índice único ignora los null.
function payloadOf(d: Draft) {
  return {
    hourly_rate_crc:    num(d.hourly),
    fixed_salary_crc:   num(d.fijo),
    participa_servicio: d.participa,
    biotime_emp_code:   d.code.trim() ? d.code.trim() : null,
    fecha_ingreso:      d.ingreso ? d.ingreso : null,
  }
}

// Validación en la app ANTES de persistir (A3). El índice único parcial de la mig 055
// es la red de seguridad; esto es lo que hace que el error se vea claro y a tiempo.
function codigoDuplicado(code: string, employees: Employee[], exceptId?: string): Employee | null {
  const c = code.trim()
  if (!c) return null
  return employees.find(e => e.id !== exceptId && (e.biotime_emp_code ?? '') === c) ?? null
}

interface Props {
  employees: Employee[]
  onRefresh: () => Promise<void>
}

export default function SalariosEmpleados({ employees, onRefresh }: Props) {
  const [filtro, setFiltro]   = useState<Filtro>('activos')
  const [editId, setEditId]   = useState<string | null>(null)
  const [draft, setDraft]     = useState<Draft>(emptyDraft)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Alta: empleados que todavía no existen en la app (cocina y back; hoy solo está
  // cargado el personal de servicio de front).
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newRole, setNewRole]   = useState<UserRole>('cocina')
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft)

  const visibles = employees.filter(e =>
    filtro === 'todos' ? true : filtro === 'activos' ? e.is_active : !e.is_active,
  )

  // Sin código de BioTime = no entra al cálculo automático de horas (A1). Se cuenta
  // sobre los activos: un inactivo no entra a cálculos nuevos de todos modos.
  const sinCodigo = employees.filter(e => e.is_active && !e.biotime_emp_code).length

  const startEdit = (emp: Employee) => {
    setError(null)
    setEditId(emp.id)
    setDraft(draftOf(emp))
  }

  const saveEdit = async (emp: Employee) => {
    const dup = codigoDuplicado(draft.code, employees, emp.id)
    if (dup) {
      setError(`El código de BioTime «${draft.code.trim()}» ya es de ${dup.full_name}. Cada usuario del reloj lleva el suyo.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateEmployeePayroll(emp.id, payloadOf(draft))
      // El alias del homebanking va por su propia función: el payload de
      // updateEmployeePayroll es un contrato cerrado (mig 055) y no se ensancha.
      if ((emp.nombre_homebanking ?? '') !== draft.banco.trim()) {
        await updateEmployeeHomebankingName(emp.id, draft.banco)
      }
      setEditId(null)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    const dup = codigoDuplicado(newDraft.code, employees)
    if (dup) {
      setError(`El código de BioTime «${newDraft.code.trim()}» ya es de ${dup.full_name}. Cada usuario del reloj lleva el suyo.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Sin profile_id: el empleado existe sin cuenta de login (FK nullable).
      const creado = await createEmployee({
        full_name: newName.trim().toUpperCase(),
        role:      newRole,
        ...payloadOf(newDraft),
      })
      if (newDraft.banco.trim() && creado?.id) {
        await updateEmployeeHomebankingName(creado.id, newDraft.banco)
      }
      setNewName('')
      setNewRole('cocina')
      setNewDraft(emptyDraft)
      setShowForm(false)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el empleado')
    } finally {
      setSaving(false)
    }
  }

  // Inactivo no se borra: conserva su fila y su historial, solo sale de los cálculos
  // nuevos (A3).
  const handleToggle = async (emp: Employee) => {
    setSaving(true)
    setError(null)
    try {
      await toggleEmployeeActive(emp.id, !emp.is_active)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const draftFields = (d: Draft, set: (d: Draft) => void, prefix: string) => (
    <>
      <td>
        <input
          className="tip-input"
          type="number"
          min="0"
          step="1"
          aria-label={`Tarifa por hora: ${prefix}`}
          value={d.hourly}
          onChange={e => set({ ...d, hourly: e.target.value })}
          disabled={saving}
          style={{ width: '90px' }}
        />
      </td>
      <td>
        <input
          className="tip-input"
          type="number"
          min="0"
          step="1"
          aria-label={`Salario fijo: ${prefix}`}
          value={d.fijo}
          onChange={e => set({ ...d, fijo: e.target.value })}
          disabled={saving}
          style={{ width: '100px' }}
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          aria-label={`Participa del 10%: ${prefix}`}
          checked={d.participa}
          onChange={e => set({ ...d, participa: e.target.checked })}
          disabled={saving}
        />
      </td>
      <td>
        <input
          className="tip-input"
          type="text"
          aria-label={`Código BioTime: ${prefix}`}
          placeholder="— sin mapear —"
          value={d.code}
          onChange={e => set({ ...d, code: e.target.value })}
          disabled={saving}
          style={{ width: '100px' }}
        />
      </td>
      <td>
        <input
          className="tip-input"
          type="date"
          aria-label={`Fecha de ingreso: ${prefix}`}
          value={d.ingreso}
          onChange={e => set({ ...d, ingreso: e.target.value })}
          disabled={saving}
          style={{ width: '130px' }}
        />
      </td>
      <td>
        <input
          className="tip-input"
          type="text"
          aria-label={`Nombre en el homebanking: ${prefix}`}
          placeholder="— usa el nombre —"
          value={d.banco}
          onChange={e => set({ ...d, banco: e.target.value })}
          disabled={saving}
          style={{ width: '160px' }}
        />
      </td>
    </>
  )

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <span className="admin-section-title">Empleados / Tarifas</span>
        <button className="btn-secondary" onClick={() => { setShowForm(v => !v); setError(null) }}>
          {showForm ? 'Cancelar' : '+ Agregar empleado'}
        </button>
      </div>

      <div style={{ padding: '0 12px 8px', fontSize: '0.72rem', color: '#888', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{employees.filter(e => e.is_active).length} activos</span>
        <span>·</span>
        <span style={{ color: sinCodigo > 0 ? 'var(--t-teal)' : '#888' }}>
          {sinCodigo} sin código de BioTime
        </span>
        <span style={{ flex: 1 }} />
        {(['activos', 'inactivos', 'todos'] as Filtro[]).map(f => (
          <button
            key={f}
            className="btn-delete-inline"
            onClick={() => setFiltro(f)}
            style={{ opacity: filtro === f ? 1 : 0.45, textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}

      {showForm && (
        <form className="admin-form" onSubmit={handleCreate}>
          <div className="field">
            <label>Nombre completo</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ej: JOSE"
              required
              disabled={saving}
            />
          </div>
          <div className="field">
            <label>Rol</label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as UserRole)}
              disabled={saving}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tarifa/hora</th>
                <th>Salario fijo</th>
                <th>10%</th>
                <th>Cód. BioTime</th>
                <th>Ingreso</th>
                <th>Nombre en el banco</th>
              </tr>
            </thead>
            <tbody>
              <tr className="admin-row">{draftFields(newDraft, setNewDraft, 'nuevo empleado')}</tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.7rem', color: '#888', margin: '0.25rem 0 0' }}>
            Se crea sin cuenta de login. Los datos de nómina se pueden dejar en 0 y cargarlos después.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Crear empleado'}
            </button>
          </div>
        </form>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Tarifa/hora</th>
            <th>Salario fijo</th>
            <th>10%</th>
            <th>Cód. BioTime</th>
            <th>Ingreso</th>
            <th>Nombre en el banco</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibles.map(emp => (
            <tr key={emp.id} className={`admin-row ${emp.is_active ? '' : 'inactive'}`}>
              <td className="admin-emp-name" style={{ opacity: emp.is_active ? 1 : 0.45 }}>
                {emp.full_name}
                {!emp.is_active && (
                  <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '1px' }}>inactivo</div>
                )}
              </td>
              <td><span className="role-tag">{ROLE_LABELS[emp.role] ?? emp.role}</span></td>

              {editId === emp.id ? (
                <>
                  {draftFields(draft, setDraft, emp.full_name)}
                  <td className="admin-row-actions">
                    <button className="btn-save-inline" onClick={() => saveEdit(emp)} disabled={saving}>
                      Guardar
                    </button>
                    <button className="btn-delete-inline" onClick={() => setEditId(null)} disabled={saving}>
                      ✕
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td>{(emp.hourly_rate_crc ?? 0) > 0 ? fi(emp.hourly_rate_crc) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                  <td>{(emp.fixed_salary_crc ?? 0) > 0 ? fi(emp.fixed_salary_crc) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}>
                    {(emp.participa_servicio ?? true)
                      ? <span style={{ color: 'var(--t-teal)' }}>Sí</span>
                      : <span style={{ opacity: 0.45 }}>No</span>}
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {emp.biotime_emp_code ?? <span style={{ opacity: 0.35 }}>— sin mapear —</span>}
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {emp.fecha_ingreso ?? <span style={{ opacity: 0.35 }}>—</span>}
                  </td>
                  {/* El banco identifica al beneficiario por el NOMBRE (col A del archivo);
                      sin alias cargado se exporta el nombre del empleado. */}
                  <td style={{ fontSize: '0.75rem' }}>
                    {emp.nombre_homebanking ?? <span style={{ opacity: 0.35 }}>— usa {emp.full_name} —</span>}
                  </td>
                  <td className="admin-row-actions">
                    <button className="btn-delete-inline" onClick={() => startEdit(emp)} disabled={saving}>
                      Editar
                    </button>
                    <button className="btn-delete-inline" onClick={() => handleToggle(emp)} disabled={saving}>
                      {emp.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}

          {visibles.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
                Sin empleados en este filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
