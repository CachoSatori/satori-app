import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import type { Profile, Employee, UserRole } from '../../shared/types/database'
import { getAllProfiles, updateProfileRole, setProfileActive } from '../../shared/api/admin'
import { pedidosCambioClave, pedirCambioClave, sacarPedidoCambioClave } from '../../shared/api/cambioClave'
import { fechaHoraCR } from './bitacoraPermisos'

import { ROLE_LABELS } from '../../shared/constants'
import { ALIAS_CORREO_EJEMPLO } from './aliasCorreo'
import NuevoEmpleado from './NuevoEmpleado'
import CambiosPermisos from './CambiosPermisos'

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
  const [verCambios, setVerCambios] = useState<string | null>(null)   // B10: usuario con «Cambios» abierto
  // Mig 185: user_id → desde cuándo tiene pedido el cambio de contraseña (null = no se pudo leer)
  const [pedidos, setPedidos] = useState<Map<string, string> | null>(new Map())

  const cargarPedidos = useCallback(async () => {
    try { setPedidos(new Map((await pedidosCambioClave()).map(p => [p.user_id, p.marcado_en]))) }
    catch { setPedidos(null) }   // no frena la pantalla: solo se avisa abajo
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      setProfiles(await getAllProfiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando usuarios')
    } finally { setLoading(false) }
    void cargarPedidos()
  }, [cargarPedidos])

  useEffect(() => { load() }, [load])

  const empOf = (profileId: string) => employees.find(e => e.profile_id === profileId)
  const nombres = useMemo(() => new Map(profiles.map(p => [p.id, p.full_name])), [profiles])

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

  const handlePedirClave = async (p: Profile) => {
    const pendiente = pedidos?.has(p.id)
    const pregunta = pendiente
      ? `¿Sacar el pedido de cambio de contraseña de ${p.full_name}? Va a poder entrar sin cambiarla.`
      : `¿Obligar a ${p.full_name} a cambiar la contraseña? La próxima vez que entre (o ahora, si ya está adentro) ` +
        'solo va a poder usar «Cambiar mi contraseña» hasta que la cambie.'
    if (!window.confirm(pregunta)) return
    setSavingId(p.id); setError(null)
    try {
      if (pendiente) await sacarPedidoCambioClave(p.id)
      else await pedirCambioClave(p.id)
      await cargarPedidos()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSavingId(null) }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--c-gris)' }}>Cargando usuarios…</div>

  const pending = profiles.filter(p => !p.is_active)
  const active  = profiles.filter(p => p.is_active)

  const renderRow = (p: Profile) => {
    const emp = empOf(p.id)
    const isMe = p.id === currentUserId
    const abierto = verCambios === p.id
    const pedidoDesde = pedidos?.get(p.id) ?? null
    return (
      <Fragment key={p.id}>
      <tr className="admin-row">
        <td className="admin-emp-name">
          {p.full_name}{isMe && <span style={{ color: 'var(--c-gris)', fontWeight: 400 }}> (vos)</span>}
          <div style={{ fontSize: '0.65rem', color: 'var(--c-gris)', marginTop: 1 }}>
            {p.email ?? '—'}{emp && <span> · 👤 {emp.full_name}</span>}
          </div>
          {pedidoDesde && (
            <div data-testid="clave-pendiente" style={{ fontSize: '0.65rem', color: 'var(--c-alerta, #c23b22)', marginTop: 2 }}>
              🔑 Cambio de contraseña pendiente · pedido el {fechaHoraCR(pedidoDesde)}
            </div>
          )}
        </td>
        <td>
          <select
            value={p.role}
            disabled={savingId === p.id || isMe}
            onChange={e => handleRole(p.id, e.target.value as UserRole)}
            style={{ fontSize: '0.78rem', background: 'var(--c-fondo)', border: '1px solid var(--c-linea)', borderRadius: 2, padding: '0.3rem 0.45rem', color: 'var(--c-tinta)' }}>
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
          <button className="tips-btn-ghost" style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', marginLeft: '0.4rem' }}
            aria-expanded={abierto} onClick={() => setVerCambios(abierto ? null : p.id)}>
            {abierto ? 'Ocultar cambios' : 'Cambios'}
          </button>
          {/* Mig 185: obligar a cambiar la contraseña al entrar (no para uno mismo: eso es «Cambiar mi contraseña»). */}
          {!isMe && pedidos && (
            <button className="tips-btn-ghost" style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', marginLeft: '0.4rem' }}
              disabled={savingId === p.id} onClick={() => handlePedirClave(p)}>
              {pedidoDesde ? 'Sacar pedido de contraseña' : 'Pedir cambio de contraseña'}
            </button>
          )}
        </td>
      </tr>
      {abierto && (
        <tr><td colSpan={3} style={{ padding: 0 }}><CambiosPermisos key={`${p.id}-${p.updated_at}`} profileId={p.id} nombres={nombres} /></td></tr>
      )}
      </Fragment>
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
      <div style={{ border: '1px solid var(--c-linea)', borderRadius: 4, padding: '0.75rem 0.875rem',
        marginBottom: '1.25rem', fontSize: '0.74rem', lineHeight: 1.6, color: 'var(--c-gris)' }}>
        <strong style={{ color: 'var(--c-tinta)' }}>¿Cómo dar de alta a alguien?</strong><br />
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

      {pedidos === null && (
        <p style={{ fontSize: '0.72rem', color: 'var(--c-gris)', marginBottom: '0.75rem' }}>
          No se pudo ver quién tiene pendiente el cambio de contraseña. Revisá la conexión y volvé a abrir la pestaña.
        </p>
      )}
      {pedidos && pedidos.size > 0 && (
        <p data-testid="clave-pendientes-resumen" style={{ fontSize: '0.74rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          🔑 <strong>{pedidos.size}</strong> {pedidos.size === 1 ? 'usuario tiene' : 'usuarios tienen'} pendiente el cambio
          de contraseña: no pueden usar la app hasta cambiarla. Cuando la cambian, el aviso se va solo.
        </p>
      )}

      <div className="admin-section-header">
        <span className="admin-section-title">Cuentas deshabilitadas {pending.length > 0 && `(${pending.length})`}</span>
      </div>
      {pending.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--c-gris)', marginBottom: '1.5rem' }}>
          No hay cuentas deshabilitadas.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.72rem', color: 'var(--c-gris)', marginBottom: '0.6rem', lineHeight: 1.5 }}>
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
