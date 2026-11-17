// «Cambiar mi contraseña» (cualquier usuario logueado). Todo pasa por Supabase Auth desde el cliente:
// sin Edge Function y sin tocar el esquema.
//
// Flujo: 1) se vuelve a entrar con la contraseña actual (`signInWithPassword` del mismo correo): prueba que la
// persona sabe la contraseña y deja una sesión recién creada (GoTrue puede pedir reautenticación si la sesión es
// vieja); 2) `updateUser({ password })`; 3) se cierran las otras sesiones (`signOut({ scope: 'others' })`).
//
// La contraseña NUNCA se loguea ni se guarda: vive solo en el estado del formulario mientras está abierto.
// No pasa por la cola offline (sin conexión el botón está apagado), ni por console, ni por localStorage.
// Los errores se traducen a un motivo fijo; el mensaje técnico de Supabase no se muestra ni se guarda.
import { supabase } from './supabase'

// Decisión del dueño (17-nov, en prod): «con 8 caracteres mezclando letras y números está bien; que no haga falta
// ningún signo». Mayúsculas y signos no son obligatorios.
export const PASSWORD_MIN_CAMBIO = 8

/** Por qué una contraseña sale «Débil». Se muestra siempre, en el medidor y al tocar «Cambiar contraseña». */
export type MotivoDebil = 'corta' | 'falta_numero' | 'falta_letra' | 'nombre_local' | 'palabra_comun' | 'repeticion'

export const MOTIVO_DEBIL: Record<MotivoDebil, string> = {
  corta:         `Muy corta: usá al menos ${PASSWORD_MIN_CAMBIO} caracteres`,
  falta_numero:  'Le falta un número: agregá al menos uno (no hace falta ningún signo)',
  falta_letra:   'Le falta una letra: agregá al menos una',
  nombre_local:  'Es el nombre del local con un número: agregá otra palabra',
  palabra_comun: 'Es una palabra muy conocida con un número: elegí otra o agregá otra palabra',
  repeticion:    'Es una secuencia o una repetición (como 12345678 o aaaaaaaa): elegí otra',
}

/** Valida el formulario antes de ir al servidor. Devuelve el mensaje a mostrar, o null si está bien. */
export function validarCambio(actual: string, nueva: string, nueva2: string): string | null {
  if (!actual) return 'Escribí tu contraseña actual'
  if (nueva.length < PASSWORD_MIN_CAMBIO) return `La contraseña nueva debe tener al menos ${PASSWORD_MIN_CAMBIO} caracteres`
  // Decisión del dueño (17-nov): lo que el medidor marca «Débil» no se acepta, y se dice por qué.
  const { motivo } = evaluarPassword(nueva)
  if (motivo) return `Contraseña débil. ${MOTIVO_DEBIL[motivo]}`
  if (nueva !== nueva2) return 'Las contraseñas nuevas no coinciden'
  if (nueva === actual) return 'La contraseña nueva tiene que ser distinta de la actual'
  return null
}

export type Fuerza = 'debil' | 'media' | 'fuerte'

export const FUERZA_TEXTO: Record<Fuerza, string> = {
  debil:  'Débil',
  media:  'Aceptable',
  fuerte: 'Fuerte',
}

// Palabras que hacen fácil de adivinar una contraseña (en minúscula y sin tildes). Solo pesan si la contraseña ES
// básicamente una de ellas: una frase larga que las contiene no es débil.
const DEL_LOCAL = ['santateresa', 'satori', 'sushi', 'nosara']
const COMUNES = [...DEL_LOCAL, 'contrasena', 'password', 'qwerty', 'abc123', '123456', 'asdf']

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Cuántos tipos de carácter tiene: minúscula, mayúscula, número, símbolo. Letras con tilde y la ñ son letras
 * (`\p{L}`), no símbolos; el espacio no suma ningún tipo; una sola mayúscula al principio («Murcielago») no cuenta
 * como mayúscula (es lo primero que cualquiera prueba). Informativo: la fuerza ya no exige mayúsculas ni signos.
 */
export function tiposDeCaracter(p: string): number {
  const t = p.trim()
  const mayusculas = (t.match(/\p{Lu}/gu) ?? []).length
  const soloInicial = mayusculas === 1 && /^\p{Lu}/u.test(t)
  return [
    /\p{Ll}/u.test(t),
    mayusculas > 0 && !soloInicial,
    /\p{N}/u.test(t),
    /[^\p{L}\p{N}\s]/u.test(t),
  ].filter(Boolean).length
}

/** Toda la contraseña es un mismo carácter, una secuencia seguida (abcd…, 1234…, 9876…) o un bloque corto repetido. */
function esSecuenciaORepeticion(p: string): boolean {
  const c = [...p.toLowerCase()]
  if (c.length < 2) return false
  const paso = c[1].codePointAt(0)! - c[0].codePointAt(0)!
  if (Math.abs(paso) <= 1 && c.every((x, i) => i === 0 || x.codePointAt(0)! - c[i - 1].codePointAt(0)! === paso)) return true
  for (let n = 2; n <= 4 && n * 2 <= c.length; n++) {
    if (c.every((x, i) => x === c[i % n])) return true
  }
  return false
}

/**
 * Fuerza y motivo. Reglas (decisión del dueño 17-nov):
 * - Débil: menos de 8; o 8–15 sin letras o sin números; o es básicamente una palabra común (quitándola quedan
 *   4 caracteres o menos, o quedan solo números y signos, menos de 8: «satori2026», «Sushi2026!!»); o es toda una
 *   secuencia o repetición («12345678», «a1a1a1a1»).
 * - 16 o más nunca es débil, salvo que sea un solo carácter repetido.
 * - Fuerte: 12+ con letras y números, o 16+ de cualquier tipo. El resto, aceptable.
 */
export function evaluarPassword(p: string): { fuerza: Fuerza; motivo: MotivoDebil | null } {
  const debil = (motivo: MotivoDebil) => ({ fuerza: 'debil' as const, motivo })
  if (p.length < PASSWORD_MIN_CAMBIO) return debil('corta')
  if (/^(.)\1*$/su.test(p)) return debil('repeticion')
  if (p.length >= 16) return { fuerza: 'fuerte', motivo: null }

  const tieneLetra = /\p{L}/u.test(p)
  const tieneNumero = /\p{N}/u.test(p)
  if (!tieneLetra) return debil('falta_letra')
  if (!tieneNumero) return debil('falta_numero')

  const plano = sinTildes(p.toLowerCase()).replace(/\s+/g, '')
  const encontradas = COMUNES.filter(w => plano.includes(w))
  if (encontradas.length) {
    const resto = encontradas.reduce((r, w) => r.split(w).join(''), plano)
    if (resto.length <= 4 || (!/\p{L}/u.test(resto) && resto.length < 8)) {
      return debil(encontradas.some(w => DEL_LOCAL.includes(w)) ? 'nombre_local' : 'palabra_comun')
    }
  }
  if (esSecuenciaORepeticion(p)) return debil('repeticion')

  return { fuerza: p.length >= 12 ? 'fuerte' : 'media', motivo: null }
}

/** Solo la fuerza (ver `evaluarPassword`). «Débil» no se acepta (`validarCambio`). */
export function fuerzaPassword(p: string): Fuerza {
  return evaluarPassword(p).fuerza
}

export type MotivoFallo =
  | 'actual_incorrecta'
  | 'sin_conexion'
  | 'demasiados_intentos'
  | 'igual_a_actual'
  | 'debil_servidor'
  | 'reautenticar'
  | 'sin_correo'
  | 'desconocido'

export const MENSAJE_FALLO: Record<MotivoFallo, string> = {
  actual_incorrecta:   'La contraseña actual no es correcta',
  sin_conexion:        'Sin conexión: no se cambió nada. Probá de nuevo cuando tengas internet',
  demasiados_intentos: 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo',
  igual_a_actual:      'La contraseña nueva tiene que ser distinta de la actual',
  debil_servidor:      'El sistema no acepta esa contraseña por ser muy fácil. Elegí otra más larga, con letras y números',
  reautenticar:        'Por seguridad, cerrá sesión, volvé a entrar y probá de nuevo',
  sin_correo:          'Tu cuenta no tiene correo: pedile ayuda a la gerencia',
  desconocido:         'No se pudo cambiar la contraseña. Probá de nuevo; si sigue, avisá a la gerencia',
}

export type ResultadoCambio =
  | { ok: true; otrasSesionesCerradas: boolean }
  | { ok: false; motivo: MotivoFallo }

interface ErrorAuth { name?: string; code?: string; status?: number }

const esSinConexion = (e: ErrorAuth) =>
  e.name === 'AuthRetryableFetchError' || e.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)
const esLimite = (e: ErrorAuth) => e.status === 429 || (e.code ?? '').startsWith('over_')

/** Motivo de un error de `signInWithPassword` al verificar la contraseña actual. */
export function motivoReingreso(e: ErrorAuth): MotivoFallo {
  if (esSinConexion(e)) return 'sin_conexion'
  if (esLimite(e)) return 'demasiados_intentos'
  if (e.code === 'invalid_credentials' || e.status === 400) return 'actual_incorrecta'
  return 'desconocido'
}

/** Motivo de un error de `updateUser({ password })`. */
export function motivoActualizar(e: ErrorAuth): MotivoFallo {
  if (esSinConexion(e)) return 'sin_conexion'
  if (esLimite(e)) return 'demasiados_intentos'
  if (e.code === 'same_password') return 'igual_a_actual'
  if (e.code === 'weak_password') return 'debil_servidor'
  if (e.code === 'reauthentication_needed' || e.code === 'reauthentication_not_valid') return 'reautenticar'
  return 'desconocido'
}

/**
 * Cambia la contraseña de la persona logueada. No valida el formulario (eso es `validarCambio`).
 * Nunca lanza: todo error vuelve como `{ ok: false, motivo }`.
 */
export async function cambiarMiPassword(email: string | null | undefined, actual: string, nueva: string): Promise<ResultadoCambio> {
  if (!email) return { ok: false, motivo: 'sin_correo' }
  try {
    // 1) Contraseña actual. Si es incorrecta, supabase-js no toca la sesión abierta.
    const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: actual })
    if (e1) return { ok: false, motivo: motivoReingreso(e1) }

    // 2) Contraseña nueva.
    const { error: e2 } = await supabase.auth.updateUser({ password: nueva })
    if (e2) return { ok: false, motivo: motivoActualizar(e2) }

    // 3) Cerrar las otras sesiones (otros equipos y la sesión de antes del paso 1). La contraseña ya cambió:
    //    si esto falla, se avisa, pero el cambio vale.
    let otrasSesionesCerradas = true
    try {
      const { error: e3 } = await supabase.auth.signOut({ scope: 'others' })
      if (e3) otrasSesionesCerradas = false
    } catch {
      otrasSesionesCerradas = false
    }
    return { ok: true, otrasSesionesCerradas }
  } catch (e) {
    const err = (e ?? {}) as ErrorAuth
    return { ok: false, motivo: esSinConexion(err) ? 'sin_conexion' : 'desconocido' }
  }
}
