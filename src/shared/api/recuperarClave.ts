// «¿Olvidaste tu contraseña?» (17-nov, pedido del dueño): sin esto, quien no recordaba la contraseña quedaba trabado,
// sobre todo si el owner le pidió cambiarla (mig 185) y /mi-cuenta le pedía la actual.
//
// Flujo (todo Supabase Auth desde el cliente, sin Edge ni esquema):
//   1) En el login se pide el correo → `resetPasswordForEmail(correo, { redirectTo: <app>/mi-cuenta })`. El mensaje es
//      SIEMPRE el mismo, exista o no la cuenta (no se puede averiguar qué correos están registrados).
//   2) El enlace del correo abre la app con la sesión de recuperación; supabase-js la toma de la URL y emite
//      `PASSWORD_RECOVERY`. Recién ahí (y solo ahí: no por leer la URL, que cualquiera puede escribir) se marca el
//      «modo recuperación» para ESE usuario; /mi-cuenta deja de pedir la contraseña actual.
//   3) Si el enlace venció o ya se usó, Supabase vuelve con `error_code` en la URL: el login lo avisa y ofrece otro.
//
// Qué se guarda en el equipo: en sessionStorage, el id del usuario en recuperación y hasta cuándo (no el correo ni
// ningún token); en localStorage, la hora del último pedido (el freno de un envío por minuto). Nunca contraseñas.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

export const MENSAJE_ENLACE_ENVIADO = 'Si ese correo está registrado, te llegó un enlace para crear una contraseña nueva.'
export const MENSAJE_ENLACE_VENCIDO = 'El enlace del correo venció o ya se usó. Pedí uno nuevo acá abajo.'
export const MENSAJE_SIN_CONEXION_ENVIO = 'Sin conexión: no se pudo pedir el enlace. Probá de nuevo cuando tengas internet.'

/** Un pedido por minuto desde esta pantalla (además del límite propio de Supabase). */
export const FRENO_ENVIO_MS = 60_000
/** El modo recuperación dura lo mismo que el enlace (1 h por defecto en Supabase). */
export const VIGENCIA_RECUPERACION_MS = 60 * 60_000

const CLAVE_MODO = 'satori-recuperacion'          // sessionStorage: { uid, hasta }
const CLAVE_AVISO = 'satori-recuperacion-aviso'   // sessionStorage: 'vencido'
const CLAVE_ULTIMO = 'satori-olvide-ultimo-envio' // localStorage: hora del último pedido (ms)

/** Adónde vuelve el enlace del correo: /mi-cuenta de ESTA app (prod: …/satori-app/mi-cuenta; staging: /mi-cuenta). */
export function urlVueltaRecuperacion(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}mi-cuenta`
}

// ── Pedido del enlace ────────────────────────────────────────────────────────────────────────────

/** Milisegundos que faltan para poder pedir otro enlace (0 = ya se puede). */
export function esperaParaPedir(ahora = Date.now()): number {
  const ultimo = Number(localStorage.getItem(CLAVE_ULTIMO) || 0)
  const falta = ultimo + FRENO_ENVIO_MS - ahora
  return falta > 0 && falta <= FRENO_ENVIO_MS ? falta : 0
}

export type ResultadoPedido = { ok: true } | { ok: false; motivo: 'sin_conexion' | 'espera' }

/**
 * Pide el enlace. A propósito NO distingue «no existe esa cuenta», «límite de Supabase» ni «falló el correo»: los tres
 * dependen de si la cuenta existe, y decirlo permitiría averiguar qué correos están registrados. Solo «sin conexión»
 * (que no depende de la cuenta) tiene mensaje propio. Nunca lanza.
 */
export async function pedirEnlaceRecuperacion(correo: string): Promise<ResultadoPedido> {
  if (esperaParaPedir() > 0) return { ok: false, motivo: 'espera' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, motivo: 'sin_conexion' }
  localStorage.setItem(CLAVE_ULTIMO, String(Date.now()))
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), { redirectTo: urlVueltaRecuperacion() })
    if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) {
      localStorage.removeItem(CLAVE_ULTIMO)   // no salió nada: se puede reintentar ya
      return { ok: false, motivo: 'sin_conexion' }
    }
  } catch {
    localStorage.removeItem(CLAVE_ULTIMO)
    return { ok: false, motivo: 'sin_conexion' }
  }
  return { ok: true }
}

// ── Modo recuperación (después de abrir el enlace) ────────────────────────────────────────────────

type Modo = { uid: string; hasta: number }
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach(f => f())

function leerModo(): Modo | null {
  try {
    const m = JSON.parse(sessionStorage.getItem(CLAVE_MODO) ?? 'null') as Modo | null
    if (!m || typeof m.uid !== 'string' || typeof m.hasta !== 'number') return null
    if (m.hasta < Date.now()) { sessionStorage.removeItem(CLAVE_MODO); return null }
    return m
  } catch {
    return null
  }
}

/** Marca el modo recuperación para ese usuario (lo llama el evento `PASSWORD_RECOVERY`). */
export function marcarRecuperacion(uid: string, ahora = Date.now()): void {
  sessionStorage.setItem(CLAVE_MODO, JSON.stringify({ uid, hasta: ahora + VIGENCIA_RECUPERACION_MS }))
  avisar()
}

/** Termina el modo recuperación (contraseña cambiada, sesión cerrada o «pedir otro enlace»). */
export function terminarRecuperacion(): void {
  sessionStorage.removeItem(CLAVE_MODO)
  avisar()
}

/** ¿Este usuario entró con el enlace del correo (y no venció)? */
export function enRecuperacion(uid: string | null | undefined): boolean {
  const m = leerModo()
  return !!uid && !!m && m.uid === uid
}

const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
const foto = () => sessionStorage.getItem(CLAVE_MODO)

/** Hook: true si el usuario de la sesión está en modo recuperación. Se actualiza si el evento llega después. */
export function useModoRecuperacion(uid: string | null | undefined): boolean {
  useSyncExternalStore(suscribir, foto, () => null)
  return enRecuperacion(uid)
}

// ── Aviso para el login (enlace vencido / pedir otro) ────────────────────────────────────────────

/** Deja dicho al login que abra «¿Olvidaste tu contraseña?» con el aviso de enlace vencido. */
export function avisarEnlaceVencido(): void {
  sessionStorage.setItem(CLAVE_AVISO, 'vencido')
}

/** Lo lee UNA vez el login (y lo borra). */
export function tomarAvisoLogin(): 'vencido' | null {
  const v = sessionStorage.getItem(CLAVE_AVISO)
  sessionStorage.removeItem(CLAVE_AVISO)
  return v === 'vencido' ? 'vencido' : null
}

/**
 * ¿La URL es la vuelta de un enlace de Supabase que falló (vencido, ya usado)? Supabase pone `error_code` /
 * `error_description` en el hash (flujo implícito) o en la consulta (PKCE). Solo sirve para AVISAR: el modo
 * recuperación nunca se activa por la URL.
 */
export function urlEsEnlaceFallido(href: string): boolean {
  try {
    const u = new URL(href)
    const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
    const tiene = (p: URLSearchParams) => p.has('error_code') || p.has('error_description')
    return tiene(hash) || tiene(u.searchParams)
  } catch {
    return false
  }
}

let iniciado = false
/**
 * Se llama una vez al arrancar (main.tsx), en la misma pasada que crea el cliente de Supabase: así el oyente está
 * puesto antes de que supabase-js emita `PASSWORD_RECOVERY` (lo hace en un setTimeout después de leer la URL).
 */
export function iniciarRecuperacion(): void {
  if (iniciado) return
  iniciado = true
  if (typeof window !== 'undefined' && urlEsEnlaceFallido(window.location.href)) avisarEnlaceVencido()
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user?.id) marcarRecuperacion(session.user.id)
    else if (event === 'SIGNED_OUT') terminarRecuperacion()
  })
}

/** Solo pruebas. */
export function _reiniciarParaPruebas(): void {
  iniciado = false
  oyentes.clear()
}
