import { useState, useEffect } from 'react'
import type { Employee, UserRole, Profile } from '../../shared/types/database'
import { createEmployee, updateEmployee, toggleEmployeeActive, getAllProfiles, linkProfileToEmployee } from '../../shared/api/admin'
// pos_name added to Employee type via DB migration — exact name as it appears in POS XLS

import { ROLE_LABELS } from '../../shared/constants'

const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']

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

  const [editPosName, setEditPosName] = useState('')

  const handleEdit = (emp: Employee) => {
    setEditId(emp.id)
    setEditName(emp.full_name)
    setEditRole(emp.role)
    setEditPosName((emp as { pos_name?: string }).pos_name ?? '')
  }

  const handleSaveEdit = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      await updateEmployee(id, {
        full_name: editName.trim().toUpperCase(),
        role: editRole,
        ...(editPosName.trim() ? { pos_name: editPosName.trim().toUpperCase() } : { pos_name: null }),
      } as Parameters<typeof updateEmployee>[1])
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
                      style={{ width: '130px', marginBottom: '2px' }}
                    />
                    <div>
                      <input
                        className="tip-input"
                        value={editPosName}
                        onChange={e => setEditPosName(e.target.value)}
                        disabled={saving}
                        placeholder="Nombre en POS…"
                        style={{ width: '130px', fontSize: '0.72rem', opacity: 0.7 }}
                      />
                    </div>
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
                  <td className="admin-emp-name">
                    {emp.full_name}
                    {(emp as { pos_name?: string }).pos_name && (
                      <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '1px' }}>
                        POS: {(emp as { pos_name?: string }).pos_name}
                      </div>
                    )}
                  </td>
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
    <div style={{ marginTop:'1.5rem', borderTop:'1px solid #eee', paddingTop:'1rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize:'0.78rem', padding:'6px 14px', border:'1px solid #ddd', borderRadius:2, background:'transparent', cursor:'pointer', color:'#888' }}>
        {open ? '▲ Cerrar' : '📋 Importar empleados en masa'}
      </button>

      {open && (
        <div style={{ marginTop:'0.75rem', background:'#f9f7f2', border:'1px solid #ddd', borderRadius:2, padding:'1rem' }}>
          <div style={{ fontSize:'0.72rem', color:'#888', marginBottom:'0.5rem' }}>
            Pegá los nombres, uno por línea. Se agregarán los que no existan (los duplicados se ignoran).
          </div>
          <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-start', flexWrap:'wrap' }}>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={'FRANCISCO\nMARIA\nJUAN\n...'}
              rows={6}
              style={{ flex:1, minWidth:180, padding:'8px 10px', border:'1px solid #ccc', borderRadius:2, fontFamily:'monospace', fontSize:'0.82rem', resize:'vertical', background:'#fff' }}
            />
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:'0.68rem', color:'#888', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.1em' }}>Rol para todos</div>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)}
                style={{ width:'100%', padding:'6px 8px', border:'1px solid #ccc', borderRadius:2, fontSize:'0.82rem', marginBottom:'0.75rem' }}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
              </select>

              {preview.length > 0 && (
                <div style={{ fontSize:'0.72rem', marginBottom:'0.75rem' }}>
                  {newOnes.length > 0 && <div style={{ color:'#2a7a4a' }}>+ {newOnes.length} nuevo{newOnes.length > 1 ? 's' : ''}</div>}
                  {dupOnes.length > 0 && <div style={{ color:'#888' }}>⊘ {dupOnes.length} ya exist{dupOnes.length > 1 ? 'en' : 'e'}</div>}
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={saving || newOnes.length === 0}
                style={{ width:'100%', padding:'7px', borderRadius:2, background: newOnes.length > 0 ? '#2a7a4a' : '#ccc', color:'#fff', fontWeight:700, fontSize:'0.82rem', border:'none', cursor: newOnes.length > 0 ? 'pointer' : 'not-allowed' }}>
                {saving ? 'Importando…' : `Importar ${newOnes.length}`}
              </button>
              {msg && <div style={{ marginTop:'0.5rem', fontSize:'0.75rem', color: msg.startsWith('✓') ? '#2a7a4a' : '#c23b22' }}>{msg}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
