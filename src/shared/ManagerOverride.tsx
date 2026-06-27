import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { supabase } from './api/supabase'
import { useAuth } from './hooks/useAuth'

const VERIFY_TIMEOUT_MS = 10_000

type VerifyResult = { ok: boolean; error?: string }

/**
 * Verifica credenciales de gerencia SERVER-SIDE vía RPC `verify_manager`
 * (SECURITY DEFINER, migración 019): valida email+contraseña contra auth.users
 * y exige owner/manager activo. No crea ninguna sesión paralela en el navegador
 * (el cliente temporal anterior podía colgarse en el refresh de token) y corre
 * con timeout de 10s → si la red falla, el error es visible, nunca se cuelga.
 */
async function verifyManager(email: string, password: string): Promise<VerifyResult> {
  // El RPC no está en los tipos generados todavía (se regeneran post-merge).
  const rpc = supabase.rpc.bind(supabase) as unknown as
    (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), VERIFY_TIMEOUT_MS))
  try {
    const { data, error } = await Promise.race([rpc('verify_manager', { p_email: email.trim(), p_password: password }), timeout])
    if (error) return { ok: false, error: `No se pudo verificar: ${error.message}. Reintentá.` }
    if (data !== true) return { ok: false, error: 'Credenciales inválidas o sin permiso de gerencia' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'No se pudo verificar (sin conexión o demoró >10s). Revisá la red y reintentá.' }
  }
}

// Resultado de pedir autorización de gerencia. `ok` = autorizado. Cuando autoriza un cajero vía
// credenciales en el modal, viajan managerEmail/managerPassword para que la RPC de borrado las
// re-valide server-side (mig 044). owner/manager logueado → { ok:true } sin credenciales (la RPC
// autoriza por su rol). Las credenciales son transitorias: NO se loguean ni persisten.
export type ManagerAuth = { ok: boolean; managerEmail?: string; managerPassword?: string }
type RequireManager = () => Promise<ManagerAuth>
const Ctx = createContext<RequireManager>(() => Promise.resolve({ ok: false }))

/** Devuelve `requireManager()` que resuelve { ok, managerEmail?, managerPassword? }. */
export const useManagerOverride = () => useContext(Ctx)

export function ManagerOverrideProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [resolver, setResolver] = useState<((res: ManagerAuth) => void) | null>(null)

  const requireManager = useCallback<RequireManager>(() => {
    // Owner/manager logueado → autorizado al instante, sin pedir nada (la RPC autoriza por su rol).
    if (profile && (profile.role === 'owner' || profile.role === 'manager')) {
      return Promise.resolve({ ok: true })
    }
    // Otros roles (cajero, etc.) → pedir credenciales de gerencia.
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
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setChecking(true); setError(null)
    const res = await verifyManager(email, password)
    // Verificado en el cliente (UX + gate de los usos que no son borrado). Para el borrado, estas
    // mismas credenciales se pasan a la RPC, que las re-valida server-side.
    if (res.ok) { onResult({ ok: true, managerEmail: email.trim(), managerPassword: password }) }
    else { setError(res.error ?? 'Credenciales inválidas o sin permiso de gerencia'); setChecking(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={() => onResult({ ok: false })}>
      <form className="cd-modal" onClick={e => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 380 }}>
        <div className="cd-modal-title">🔒 Autorización de gerencia</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--t-muted)', margin: '0 0 0.75rem' }}>
          Eliminar un registro guardado requiere credenciales de un <strong>encargado o dueño</strong>.
        </p>
        <input className="tips-input-dark" type="email" autoComplete="off" placeholder="Correo del encargado/dueño"
          value={email} onChange={e => setEmail(e.target.value)} required disabled={checking} style={{ width: '100%' }} />
        <input className="tips-input-dark" type="password" autoComplete="off" placeholder="Contraseña"
          value={password} onChange={e => setPassword(e.target.value)} required disabled={checking}
          style={{ width: '100%', marginTop: '0.5rem' }} />
        {error && <div style={{ color: 'var(--t-red)', fontSize: '0.78rem', marginTop: '0.5rem' }}>{error}</div>}
        <div className="cd-modal-actions" style={{ marginTop: '0.875rem' }}>
          <button type="button" className="tips-btn-ghost" onClick={() => onResult({ ok: false })} disabled={checking}>Cancelar</button>
          <button type="submit" className="cd-btn-green" disabled={checking}>{checking ? 'Verificando…' : 'Autorizar'}</button>
        </div>
      </form>
    </div>
  )
}
