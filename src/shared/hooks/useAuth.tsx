import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, withTimeout, AUTH_OP_TIMEOUT_MS } from '../api/supabase'
import type { Profile } from '../types/database'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (fullName: string, email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) { console.error('Error cargando perfil:', error); return }
    setProfile(data)
  }

  useEffect(() => {
    // getSession del bootstrap CON tope: tras suspensión larga el fetch puede quedar sobre el socket
    // zombi y NUNCA settlear → el .finally(setLoading(false)) no corría → splash 祭 eterno (pantalla
    // negra). withTimeout NO rechaza: RESUELVE con sesión nula al vencer → setUser(null) → loading=false
    // → RequireAuth manda a /login. (Ver HANG-RCA-2; la máquina de 3 estados de supabase.ts no cubría
    // esta capa de arranque.) NO confundir con el caso "getSession FALLA", que ya cubría el .catch.
    withTimeout(
      supabase.auth.getSession(),
      AUTH_OP_TIMEOUT_MS,
      'getSession (bootstrap useAuth)',
      { data: { session: null }, error: null },
    )
      .then(async ({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) await loadProfile(session.user.id)
      })
      .catch(err => console.error('getSession error:', err))
      .finally(() => {
        setLoading(false)
        // Señal para el SW-WATCHDOG de index.html: el bootstrap resolvió (con o sin
        // sesión) — la app NO está colgada, no hace falta auto-sanar el service worker.
        ;(window as unknown as { __satoriBootOk?: boolean }).__satoriBootOk = true
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) { await loadProfile(session.user.id) }
        else { setProfile(null) }
        // INITIAL_SESSION fires before getSession() refreshes the token.
        // Let getSession().finally() own the initial loading=false so we
        // always clear loading with a valid, refreshed session (and profile).
        if (event !== 'INITIAL_SESSION') setLoading(false)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  // Refresco PROACTIVO del token al volver el foco/visibilidad. Si la pestaña estuvo
  // en segundo plano y el token venció, getSession() lo refresca ANTES de que el usuario
  // dispare una acción crítica → elimina la carrera click-vs-refresh que colgaba las
  // escrituras de caja ("se queda pensando", ver HANG-RCA.md). Si falla, NO bloquea la UI
  // (la red de seguridad de los timeouts en las escrituras actúa).
  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState !== 'visible') return
      supabase.auth.getSession().catch(err => console.error('refresh on focus:', err))
    }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  const signUp = async (fullName: string, email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    })
    if (error) return { error: error.message }
    return { error: null }
  }

  const signOut = async () => { await supabase.auth.signOut() }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
