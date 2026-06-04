import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from './hooks/useAuth'

const URL  = import.meta.env.VITE_SUPABASE_URL as string
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/**
 * Verifica credenciales de un owner/manager SIN tocar la sesión actual:
 * usa un cliente Supabase temporal con persistSession=false (no escribe en
 * localStorage ni reemplaza la sesión del cajero logueado).
 */
async function verifyManager(email: string, password: string): Promise<boolean> {
  const tmp = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const { data, error } = await tmp.auth.signInWithPassword({ email: email.trim(), password })
    if (error || !data.user) return false
    const { data: prof } = await tmp.from('profiles').select('role').eq('id', data.user.id).single()
    const role = (prof as { role?: string } | null)?.role
    await tmp.auth.signOut().catch(() => {})
    return role === 'owner' || role === 'manager'
  } catch {
    return false
  }
}

type RequireManager = () => Promise<boolean>
const Ctx = createContext<RequireManager>(() => Promise.resolve(false))

/** Devuelve una función `requireManager()` que resuelve true si hay autorización. */
export const useManagerOverride = () => useContext(Ctx)

export function ManagerOverrideProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null)

  const requireManager = useCallback<RequireManager>(() => {
    // Owner/manager logueado → autorizado al instante, sin pedir nada.
    if (profile && (profile.role === 'owner' || profile.role === 'manager')) {
      return Promise.resolve(true)
    }
    // Otros roles (cajero, etc.) → pedir credenciales de gerencia.
    return new Promise<boolean>(res => setResolver(() => res))
  }, [profile])

  const finish = (ok: boolean) => { resolver?.(ok); setResolver(null) }

  return (
    <Ctx.Provider value={requireManager}>
      {children}
      {resolver && <ManagerModal onResult={finish} />}
    </Ctx.Provider>
  )
}

function ManagerModal({ onResult }: { onResult: (ok: boolean) => void }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setChecking(true); setError(null)
    const ok = await verifyManager(email, password)
    if (ok) { onResult(true) }
    else { setError('Credenciales inválidas o sin permiso de gerencia'); setChecking(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={() => onResult(false)}>
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
          <button type="button" className="tips-btn-ghost" onClick={() => onResult(false)} disabled={checking}>Cancelar</button>
          <button type="submit" className="cd-btn-green" disabled={checking}>{checking ? 'Verificando…' : 'Autorizar'}</button>
        </div>
      </form>
    </div>
  )
}
