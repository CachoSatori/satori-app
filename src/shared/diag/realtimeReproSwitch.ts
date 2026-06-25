// ─────────────────────────────────────────────────────────────────────────────
// Switch de diagnóstico SOLO-STAGING para reproducir A DEMANDA el cuelgue de
// Realtime tras suspensión profunda, SIN tener que suspender la máquina por horas.
// Es herramienta de estabilización, NO feature.
//
// CÓMO SE REMUEVE TODO (de un solo golpe):
//   1. Borrar este archivo (src/shared/diag/realtimeReproSwitch.ts) y su test.
//   2. Borrar el bloque gateado al final de src/shared/api/supabase.ts
//      (el `import('../diag/realtimeReproSwitch')` bajo `if (VITE_APP_ENV === 'staging')`).
//   No hay otra dependencia: el seam es cero-diff sobre la lógica de auth real.
//
// QUÉ HACE: parchea EN CALIENTE client.auth.getSession / refreshSession (y tumba el
// socket) para forzar las MISMAS ramas que dispara una conexión zombi real, y luego
// permite volver a la normalidad para verificar que el sistema RECUPERA. Se maneja
// desde la consola del navegador vía window.__satoriDiag (mismo patrón que
// __satoriOutbox en outbox.ts). El cliente entra POR PARÁMETRO → testeable sin browser.
// ─────────────────────────────────────────────────────────────────────────────

import type { Session, User } from '@supabase/supabase-js'

const LOG = '[diag-repro]'

// Forma estructural de un AuthError del SDK, SIN depender de la clase real (tiene un
// miembro protegido → no se puede construir desde afuera). El consumidor real
// (ensureRealtimeHealthy) solo mira la verdad/falsedad de `error`, así que esto basta
// para ejercitar la rama de auth como un error real (no un timeout).
type AuthErrorLike = { name: string; message: string; status?: number; code?: string }

// Resultados de los métodos parcheados. Son subconjuntos EXACTOS de los tipos reales del
// SDK (getSession / refreshSession) → la instancia real de Supabase es estructuralmente
// asignable a DiagSupabaseClient y los stubs encajan sin `any` ni casts.
type GetSessionResult =
  | { data: { session: Session }; error: null }
  | { data: { session: null }; error: null }
  | { data: { session: null }; error: AuthErrorLike }

type RefreshSessionResult =
  | { data: { session: Session | null; user: User | null }; error: null }
  | { data: { session: null; user: null }; error: AuthErrorLike }

// Forma mínima del cliente que el switch toca. Inyectable: el test le pasa un fake que
// implementa SOLO esto; la instancia real (SupabaseClient<Database>) la satisface.
export interface DiagSupabaseClient {
  auth: {
    getSession: () => Promise<GetSessionResult>
    refreshSession: (currentSession?: { refresh_token: string }) => Promise<RefreshSessionResult>
  }
  realtime: {
    connect: () => void
    disconnect: (code?: number, reason?: string) => Promise<'ok' | 'timeout'>
  }
}

export type DiagMode = 'zombie' | 'expired' | 'normal'

export interface RealtimeReproSwitch {
  armZombie: () => void
  armExpired: () => void
  disarm: () => void
  status: () => void
  armBootHang: (which?: 'getSession' | 'loadProfile') => void
  disarmBootHang: () => void
}

export function installRealtimeReproSwitch(client: DiagSupabaseClient): RealtimeReproSwitch {
  // Capturamos los métodos ORIGINALES UNA sola vez, al instalar. disarm los restaura por
  // ASIGNACIÓN: cuando supabase.ts vuelva a llamar `client.auth.getSession()`, el `this`
  // será `client.auth` (es una llamada-método) → el binding queda intacto sin .bind/.apply.
  const origGetSession = client.auth.getSession
  const origRefreshSession = client.auth.refreshSession

  let mode: DiagMode = 'normal'

  // Las llamadas a realtime van SIEMPRE como método sobre client.realtime (no como una ref
  // suelta) para no perder el `this` que el SDK necesita internamente (el ajuste de binding).
  const killSocket = (): void => {
    void client.realtime.disconnect().catch(() => { /* socket ya muerto */ })
  }

  const armZombie = (): void => {
    // Conexión zombi: getSession Y refreshSession NUNCA settlean (el fetch quedó sobre un
    // socket muerto tras la suspensión y no vuelve). Encadena getSession-timeout(8s) +
    // CHANNEL_ERROR → FRENO(5) → channel-stuck. Ambos métodos se parchean.
    const hang = <T>(): Promise<T> => new Promise<T>(() => { /* nunca settlea */ })
    client.auth.getSession = () => hang<GetSessionResult>()
    client.auth.refreshSession = () => hang<RefreshSessionResult>()
    killSocket()
    mode = 'zombie'
    console.warn(`${LOG} armZombie: getSession/refreshSession colgados (nunca settlean) + socket tumbado`)
  }

  const armExpired = (): void => {
    // Sesión expirada / deslogueo real. Hay que parchear AMBOS métodos (ajuste clave):
    //  · getSession COMPLETA con session:null → sessionRead=true, token=null → rama
    //    "deslogueado real" (NO la rama de timeout). Si solo se tocara refreshSession,
    //    getSession devolvería la sesión vieja y esta rama NO se ejercitaría.
    //  · refreshSession RESUELVE (no cuelga) con session/user en null y un error de auth
    //    real → reproduce "el refresh falló por auth", distinto de "el refresh se colgó".
    client.auth.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    client.auth.refreshSession = () =>
      Promise.resolve({
        data: { session: null, user: null },
        error: { name: 'AuthApiError', message: 'session expired (diag-repro)', status: 401, code: 'session_expired' },
      })
    killSocket()
    mode = 'expired'
    console.warn(`${LOG} armExpired: getSession→session:null, refreshSession→AuthError (no timeout) + socket tumbado`)
  }

  // BOOT HANG (solo-diag): arma un flag ONE-SHOT en sessionStorage para que la PRÓXIMA carga fuerce
  // que la llamada nombrada del bootstrap (getSession o loadProfile) se cuelgue → dispara el withTimeout
  // del fix → /login. Lo consume y limpia useAuth (gateado por VITE_APP_ENV==='staging', DCE en prod).
  const armBootHang = (which: 'getSession' | 'loadProfile' = 'loadProfile'): void => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('satori-diag-boot-hang', which)
    console.warn(`${LOG} BOOT HANG armado (${which}, one-shot). Recargá (Cmd+R): debe caer a /login a los ~8s SIN loop. La recarga siguiente vuelve a la normalidad.`)
  }
  const disarmBootHang = (): void => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('satori-diag-boot-hang')
    console.log(`${LOG} BOOT HANG desarmado.`)
  }

  const disarm = (): void => {
    // Restaura EXACTAMENTE los métodos originales (mismas referencias) y reconecta el socket,
    // para verificar que el sistema RECUPERA al volver a la normalidad.
    client.auth.getSession = origGetSession
    client.auth.refreshSession = origRefreshSession
    client.realtime.connect()
    mode = 'normal'
    console.log(`${LOG} disarm: métodos originales restaurados + socket reconectado (connect)`)
  }

  const status = (): void => {
    const bootHang = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('satori-diag-boot-hang') : null
    console.log(`${LOG} status: modo actual = '${mode}'` + (bootHang ? ` · boot-hang one-shot armado: ${bootHang}` : ''))
  }

  const api: RealtimeReproSwitch = { armZombie, armExpired, disarm, status, armBootHang, disarmBootHang }

  // Expuesto en window para manejarlo desde la consola del navegador (mismo patrón que
  // __satoriOutbox en outbox.ts). En entornos sin window (Node/test) no rompe y se usa el
  // valor de retorno.
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__satoriDiag = api
  }

  console.log(`${LOG} instalado. Uso: __satoriDiag.armZombie() | .armExpired() | .armBootHang('getSession'|'loadProfile') | .disarmBootHang() | .disarm() | .status()`)
  return api
}
