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

export const PASSWORD_MIN_CAMBIO = 10

export const MENSAJE_DEBIL =
  'Esa contraseña es muy fácil de adivinar. Hacela más larga o mezclá palabras y números: por ejemplo, tres o cuatro palabras con un número en el medio'

/** Valida el formulario antes de ir al servidor. Devuelve el mensaje a mostrar, o null si está bien. */
export function validarCambio(actual: string, nueva: string, nueva2: string): string | null {
  if (!actual) return 'Escribí tu contraseña actual'
  if (nueva.length < PASSWORD_MIN_CAMBIO) return `La contraseña nueva debe tener al menos ${PASSWORD_MIN_CAMBIO} caracteres`
  // Decisión del dueño (17-nov): lo que el medidor marca «Débil» no se acepta.
  if (fuerzaPassword(nueva) === 'debil') return MENSAJE_DEBIL
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

// Palabras que hacen fácil de adivinar una contraseña del local (en minúscula y sin tildes).
const COMUNES = ['satori', 'sushi', 'password', 'contrasena', 'qwerty', 'asdf', '123456', 'abc123', 'santateresa', 'nosara']

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Fuerza simple. «Débil» no se acepta (`validarCambio`, decisión del dueño 17-nov).
 * Débil: menos del mínimo, una palabra común del local, 4 caracteres iguales seguidos o un solo tipo de carácter
 * corto. Fuerte: 14 o más con 3 tipos (minúscula, mayúscula, número, símbolo), o 18 o más con 2. El resto, aceptable.
 */
export function fuerzaPassword(p: string): Fuerza {
  if (p.length < PASSWORD_MIN_CAMBIO) return 'debil'
  const plano = sinTildes(p.toLowerCase())
  if (COMUNES.some(w => plano.includes(w))) return 'debil'
  if (/(.)\1{3,}/.test(p)) return 'debil'
  const tipos = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length
  if ((p.length >= 14 && tipos >= 3) || (p.length >= 18 && tipos >= 2)) return 'fuerte'
  if (tipos >= 2 || p.length >= 16) return 'media'
  return 'debil'
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
  debil_servidor:      'El sistema no acepta esa contraseña por ser muy fácil. Elegí otra más larga o con números y símbolos',
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
