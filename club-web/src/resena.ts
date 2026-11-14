/**
 * 158 (14-nov, firmado por el dueño) · Reseña de Google después del cupón.
 *
 * Cuando la caja usa el cupón del turista, su página del cupón pasa a «Gracias por su visita» con el botón «Escribir una
 * reseña en Google» (link del local, que carga el owner en «Locales»). La base devuelve `resena` solo con el cupón usado
 * hace menos de 7 días; después, el aviso corto de siempre. Política de Google: se le pide a todos, sin premio y sin
 * filtrar por satisfacción. No se piden datos.
 *
 * Lógica pura (sin DOM) para poder probarla: qué vista toca, si un link es de Google y el sondeo cada ~20 s mientras el
 * cupón está vigente y la página abierta (máximo 10 minutos).
 */

/** Solo direcciones de Google. MISMA expresión que el CHECK club_config_resena_url_google de la 158 y que
 * src/modules/club/resenaUrl.ts (la app): lo controla resena.test.ts. */
export const RE_RESENA_GOOGLE =
  /^https:\/\/(maps\.app\.goo\.gl\/[^\s"<>\\]+|g\.page\/[^\s"<>\\]+|(www\.)?google\.com\/maps([/?][^\s"<>\\]*)?|search\.google\.com\/local\/writereview\?[^\s"<>\\]+)$/
export const RESENA_MAX = 500

export function esUrlResena(u: unknown): u is string {
  return typeof u === 'string' && u.length <= RESENA_MAX && RE_RESENA_GOOGLE.test(u)
}

export interface CuponEstado { estado: 'vigente' | 'usado' | 'vencido'; resena?: string | null }
export type VistaCupon = 'cupon' | 'gracias' | 'usado' | 'vencido'

/** Qué se muestra: el cupón, el agradecimiento con la reseña (usado < 7 días con link) o el aviso corto de siempre. */
export function vistaDelCupon(c: CuponEstado): VistaCupon {
  if (c.estado === 'vigente') return 'cupon'
  if (c.estado === 'usado') return esUrlResena(c.resena) ? 'gracias' : 'usado'
  return 'vencido'
}

export const SONDEO_INTERVALO_MS = 20_000
export const SONDEO_MAX_MS = 10 * 60_000

export interface Sondeo<T extends CuponEstado> {
  /** Pide el estado del cupón; `null` si no se pudo (sin señal, tope): se sigue intentando. */
  consultar: () => Promise<T | null>
  /** Se llama UNA vez, cuando el cupón deja de estar vigente. */
  alCambiar: (c: T) => void
  /** Solo se consulta con la página a la vista (pestaña abierta). */
  visible?: () => boolean
  intervaloMs?: number
  maxMs?: number
  ahora?: () => number
}

/** Consulta el cupón cada ~20 s hasta que cambia o pasan 10 minutos. Devuelve la función para pararlo. */
export function sondearCupon<T extends CuponEstado>(o: Sondeo<T>): () => void {
  const intervalo = o.intervaloMs ?? SONDEO_INTERVALO_MS
  const max = o.maxMs ?? SONDEO_MAX_MS
  const ahora = o.ahora ?? (() => Date.now())
  const visible = o.visible ?? (() => true)
  const inicio = ahora()
  let parado = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const parar = () => { parado = true; if (timer) clearTimeout(timer); timer = null }
  const tic = async () => {
    timer = null
    if (parado) return
    if (ahora() - inicio > max) { parar(); return }
    if (visible()) {
      const c = await o.consultar().catch(() => null)
      if (parado) return
      if (c && c.estado !== 'vigente') { parar(); o.alCambiar(c); return }
    }
    timer = setTimeout(() => { void tic() }, intervalo)
  }
  timer = setTimeout(() => { void tic() }, intervalo)
  return parar
}

/** Ruta del sondeo (verificador, menor a): `?sondeo=1` hace que la API lo cuente con su propia clave de tope y no le gaste
 * la lectura al portal ni a la primera carga desde la misma IP. */
export const rutaSondeo = (codigo: string) => `cupon/${codigo}?sondeo=1`

/** Marca el clic en «Escribir una reseña en Google» (verificador, menor b): mejor esfuerzo. No espera ni lanza nunca, pase
 * lo que pase con la red o el tope: el link a Google lo abre el navegador igual (es un <a href>, no depende de esto). */
export function marcarClicResena(codigo: string, f: typeof fetch = (...a) => fetch(...a)): void {
  try { void Promise.resolve(f(`/api/cupon/${codigo}/resena`, { method: 'POST', keepalive: true })).catch(() => undefined) } catch { /* nada */ }
}
