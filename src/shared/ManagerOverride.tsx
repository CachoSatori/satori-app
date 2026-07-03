import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { supabase } from './api/supabase'
import { useAuth } from './hooks/useAuth'

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 *  Autorización de gerencia ("override de cajero") — FUENTE ÚNICA del patrón.
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * Acciones sensibles (borrar un movimiento, EDITAR un pago guardado, anular un ítem enviado,
 * deshacer un cierre, etc.) requieren que un owner/manager las autorice. `useManagerOverride()`
 * devuelve `requireManager()`:
 *
 *   const requireManager = useManagerOverride()
 *   const auth = await requireManager()
 *   if (!auth.ok) return            // canceló o contraseña inválida → no seguir
 *
 * Resultado — ManagerAuth:
 *   • owner/manager logueado  → { ok: true }                       (sin credenciales: la acción
 *                                                                    server-side autoriza por su rol)
 *   • cajero (u otro rol)     → abre el modal de UNA contraseña; si valida → { ok: true,
 *                                managerEmail, managerId, managerPassword }
 *   • cancela / inválido      → { ok: false }
 *
 * IMPORTANTE — `requireManager()` resuelve un OBJETO, no un boolean. Siempre chequeá `.ok`
 * (un `if (!(await requireManager()))` sería SIEMPRE falso → guard inútil; TS no lo cacha).
 *
 * ── Solo contraseña: la contraseña IDENTIFICA quién autoriza (mig 045) ───────────────────
 * El modal pide UN campo (la contraseña de gerencia) y llama verify_manager_password (mig 045,
 * SECURITY DEFINER): valida la contraseña contra TODOS los owner/manager activos. Si matchea
 * EXACTAMENTE UNO, devuelve su identidad (user_id, email, role) → ese es el autorizante que se
 * audita. Si matchea MÁS DE UNO (contraseñas duplicadas entre managers), la RPC RECHAZA con
 * error explícito: atribuir a ciegas rompería la auditoría.
 *
 * ── Por qué el modal verifica Y la RPC de plata re-valida ────────────────────────────────
 * verify_manager_password NO cambia la sesión del navegador (crear una sesión paralela colgaba
 * el refresh de token). Por eso, para el BORRADO y la EDICIÓN (reemplazo), el par (email
 * devuelto por la RPC, contraseña ingresada) se PASA a delete_movement_cascade (mig 044), que
 * lo re-valida server-side y autoriza aunque el llamador siga siendo 'cajero'. La verificación
 * del modal sirve de UX inmediata y de gate para los usos que NO tocan plata server-side
 * (anular ítem, deshacer cierre…), que confían en `.ok` sin pasar credenciales a ningún lado.
 *
 * ── Patrón canónico de "borrado/edición con autorización" (sites de caja) ────────────────
 *   const auth = await requireManager(); if (!auth.ok) return
 *   const note = await askNote('movimiento'); if (!note) return          // useDeletionNote()
 *   await deleteCashMovement(id, note, auth.managerEmail, auth.managerPassword)
 * deleteCashMovement reenvía las credenciales a la RPC solo si vienen (owner/manager no las manda).
 *
 * ── Seguridad ────────────────────────────────────────────────────────────────────────────
 * La contraseña es TRANSITORIA: vive en memoria durante el request, viaja a la RPC sobre
 * HTTPS y se descarta. NO se loguea (sin console.* con la contraseña) y NO se persiste
 * (deleteCashMovement nunca encola → no va a IndexedDB ni a ningún store). El email del
 * autorizante lo devuelve el SERVER (identidad verificada), no lo tipea el cajero.
 */
const VERIFY_TIMEOUT_MS = 10_000

type VerifyResult =
  | { ok: true; userId: string; email: string; role: string }
  | { ok: false; error: string }

/**
 * Verifica la contraseña de gerencia SERVER-SIDE vía RPC `verify_manager_password`
 * (SECURITY DEFINER, migración 045): la valida contra TODOS los owner/manager activos y
 * devuelve la identidad del ÚNICO que matchea (colisión → error explícito del server).
 * No crea ninguna sesión paralela en el navegador y corre con timeout de 10s → si la red
 * falla, el error es visible, nunca se cuelga.
 */
async function verifyManagerPassword(password: string): Promise<VerifyResult> {
  // El RPC no está en los tipos generados todavía (se regeneran post-merge).
  const rpc = supabase.rpc.bind(supabase) as unknown as
    (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), VERIFY_TIMEOUT_MS))
  try {
    const { data, error } = await Promise.race([rpc('verify_manager_password', { p_password: password }), timeout])
    if (error) {
      const msg = error.message ?? ''
      // Errores "de negocio" que levanta la propia RPC → se muestran tal cual (ya vienen claros).
      if (/duplicadas/i.test(msg)) return { ok: false, error: msg }
      if (/inválida|sin permiso/i.test(msg)) {
        return { ok: false, error: 'Contraseña inválida o sin permiso de gerencia. Verificá la contraseña, o pedí a un encargado/dueño que la ingrese.' }
      }
      return { ok: false, error: `Error del servidor al verificar: ${msg}. Reintentá en un momento.` }   // server
    }
    const d = data as { user_id?: string; email?: string; role?: string } | null
    if (!d?.user_id || !d?.email) {
      return { ok: false, error: 'Respuesta inesperada del servidor al verificar (¿migración 045 aplicada?). Avisá a la dueña.' }
    }
    return { ok: true, userId: d.user_id, email: d.email, role: d.role ?? 'manager' }
  } catch {
    return { ok: false, error: 'No se pudo verificar: sin conexión o demoró demasiado (>10s). Revisá internet y reintentá.' }   // red
  }
}

// Resultado de pedir autorización de gerencia. `ok` = autorizado. Cuando autoriza un cajero vía
// el modal, viajan managerEmail (identidad DEVUELTA por verify_manager_password — quién autorizó,
// para auditar) + managerPassword, para que la RPC de plata re-valide el par server-side (mig 044).
// owner/manager logueado → { ok:true } sin credenciales (la RPC autoriza por su rol). La
// contraseña es transitoria: NO se loguea ni persiste.
export type ManagerAuth = { ok: boolean; managerEmail?: string; managerId?: string; managerPassword?: string }
type RequireManager = () => Promise<ManagerAuth>
const Ctx = createContext<RequireManager>(() => Promise.resolve({ ok: false }))

/** Devuelve `requireManager()` que resuelve { ok, managerEmail?, managerId?, managerPassword? }. */
export const useManagerOverride = () => useContext(Ctx)

export function ManagerOverrideProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [resolver, setResolver] = useState<((res: ManagerAuth) => void) | null>(null)

  const requireManager = useCallback<RequireManager>(() => {
    // Owner/manager logueado → autorizado al instante, sin pedir nada (la RPC autoriza por su rol).
    if (profile && (profile.role === 'owner' || profile.role === 'manager')) {
      return Promise.resolve({ ok: true })
    }
    // Otros roles (cajero, etc.) → pedir la contraseña de gerencia.
    return new Promise<ManagerAuth>(res => setResolver(() => res))
  }, [profile])

  const finish = (res: ManagerAuth) => { resolver?.(res); setResolver(null) }

  return (
    <Ctx.Provider value={requireManager}>
      {children}
      {resolver && <ManagerModal onResult={finish} />}
    </Ctx.Provider>
  )
}

function ManagerModal({ onResult }: { onResult: (res: ManagerAuth) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setChecking(true); setError(null)
    const res = await verifyManagerPassword(password)
    // Verificado en el cliente (UX + gate de los usos que no tocan plata). Para borrado/edición,
    // el par (email devuelto, contraseña) se pasa a la RPC de plata, que lo re-valida server-side.
    if (res.ok) { onResult({ ok: true, managerEmail: res.email, managerId: res.userId, managerPassword: password }) }
    else { setError(res.error); setChecking(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={() => onResult({ ok: false })}>
      <form className="cd-modal" onClick={e => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 380 }}>
        <div className="cd-modal-title">🔒 Autorización de gerencia</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--t-muted)', margin: '0 0 0.75rem' }}>
          Esta acción requiere la contraseña de un <strong>encargado o dueño</strong>.
        </p>
        <input className="tips-input-dark" type="password" autoComplete="off" placeholder="Contraseña del encargado/dueño"
          value={password} onChange={e => setPassword(e.target.value)} required disabled={checking}
          autoFocus style={{ width: '100%' }} />
        {error && <div style={{ color: 'var(--t-red)', fontSize: '0.78rem', marginTop: '0.5rem' }}>{error}</div>}
        <div className="cd-modal-actions" style={{ marginTop: '0.875rem' }}>
          <button type="button" className="tips-btn-ghost" onClick={() => onResult({ ok: false })} disabled={checking}>Cancelar</button>
          <button type="submit" className="cd-btn-green" disabled={checking}>{checking ? 'Verificando…' : 'Autorizar'}</button>
        </div>
      </form>
    </div>
  )
}
