/**
 * (11-nov, modo transición; decisión del dueño) Cómo va el paso de las tarjetas viejas (de papel, sin QR) al sistema
 * nuevo (el QR o el link del anfitrión → cupón del turista).
 *
 *  · Se mide por SEMANA (lunes a domingo, hora de Costa Rica), sobre las visitas de anfitriones registradas en la app:
 *    con cupón (QR o link) y tarjetas viejas (cargadas a mano en caja).
 *  · Criterio para apagar la tarjeta vieja (sin fecha fija): las tarjetas viejas son MENOS DEL 15 % de las visitas de
 *    anfitriones DOS SEMANAS COMPLETAS SEGUIDAS. Se revisa cada 2 semanas.
 * Sin nombres: solo cuentas.
 */
export const UMBRAL_APAGADO_PCT = 15
export const SEMANAS_SEGUIDAS = 2

export interface VisitaMedida { fecha_visita: string; miembro_id: string; cupon_id: string | null }
export interface SemanaTransicion {
  /** lunes de la semana, 'AAAA-MM-DD' (Costa Rica) */
  lunes: string
  /** la semana todavía no terminó (es la de hoy) */
  enCurso: boolean
  visitas: number
  viejas: number
  conCupon: number
  /** % de tarjetas viejas sobre las visitas; null sin visitas */
  pctViejas: number | null
  /** anfitriones distintos que tuvieron al menos una visita con cupón (ya usan su QR o su link) */
  anfitrionesConCupon: number
  /** anfitriones distintos que SOLO llegaron con tarjeta vieja esa semana */
  anfitrionesSoloVieja: number
}

const CR_MS = 6 * 3600 * 1000   // Costa Rica: UTC−6 todo el año
const DIA_MS = 24 * 3600 * 1000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** El lunes (Costa Rica) de la semana de ese instante, 'AAAA-MM-DD'. */
export function lunesCr(instante: string | Date): string {
  const ms = new Date(instante).getTime() - CR_MS            // «reloj» de Costa Rica como si fuera UTC
  const dia = new Date(ms).getUTCDay()                        // 0 = domingo
  return iso(ms - ((dia + 6) % 7) * DIA_MS)
}
/** El instante (ISO, UTC) en que empieza ese día en Costa Rica. */
export const inicioDiaCr = (fecha: string): string => new Date(Date.parse(`${fecha}T00:00:00Z`) + CR_MS).toISOString()
const sumarDias = (fecha: string, n: number) => iso(Date.parse(`${fecha}T00:00:00Z`) + n * DIA_MS)

/** Desde cuándo hay que leer para tener `semanas` semanas (la de hoy incluida). */
export function rangoTransicion(ahora: string | Date, semanas: number): { desde: string; hasta: string } {
  const l = lunesCr(ahora)
  return { desde: inicioDiaCr(sumarDias(l, -7 * (semanas - 1))), hasta: inicioDiaCr(sumarDias(l, 7)) }
}

/** Las últimas `semanas` semanas (la de hoy primero), con sus cuentas. */
export function semanasTransicion(visitas: ReadonlyArray<VisitaMedida>, ahora: string | Date, semanas = 5): SemanaTransicion[] {
  const hoy = lunesCr(ahora)
  const out: SemanaTransicion[] = []
  for (let i = 0; i < semanas; i++) {
    const lunes = sumarDias(hoy, -7 * i)
    const filas = visitas.filter(v => lunesCr(v.fecha_visita) === lunes)
    const viejas = filas.filter(v => v.cupon_id === null).length
    const conCuponIds = new Set(filas.filter(v => v.cupon_id !== null).map(v => v.miembro_id))
    const viejaIds = new Set(filas.filter(v => v.cupon_id === null).map(v => v.miembro_id))
    out.push({
      lunes, enCurso: i === 0, visitas: filas.length, viejas, conCupon: filas.length - viejas,
      pctViejas: filas.length ? Math.round((viejas * 1000) / filas.length) / 10 : null,
      anfitrionesConCupon: conCuponIds.size,
      anfitrionesSoloVieja: [...viejaIds].filter(id => !conCuponIds.has(id)).length,
    })
  }
  return out
}

export type EstadoTransicion =
  | { listo: true; texto: string }
  | { listo: false; texto: string }

/**
 * ¿Se cumple el criterio para apagar? Mira las últimas semanas COMPLETAS (la de hoy no cuenta): hacen falta
 * `SEMANAS_SEGUIDAS` con visitas y con menos del `UMBRAL_APAGADO_PCT` % de tarjetas viejas.
 */
export function estadoTransicion(semanas: ReadonlyArray<SemanaTransicion>): EstadoTransicion {
  const completas = semanas.filter(s => !s.enCurso).slice(0, SEMANAS_SEGUIDAS)
  if (completas.length < SEMANAS_SEGUIDAS || completas.some(s => s.visitas === 0)) {
    return { listo: false, texto: `Todavía no hay ${SEMANAS_SEGUIDAS} semanas completas con visitas de anfitriones para decidir.` }
  }
  const bajo = completas.every(s => (s.pctViejas ?? 100) < UMBRAL_APAGADO_PCT)
  const pcts = completas.map(s => `${String(s.pctViejas).replace('.', ',')} %`).reverse().join(' y ')
  return bajo
    ? { listo: true, texto: `Se cumple el criterio: las tarjetas viejas fueron ${pcts} de las visitas en las últimas ${SEMANAS_SEGUIDAS} semanas completas (menos del ${UMBRAL_APAGADO_PCT} %). El dueño decide cuándo apagarla.` }
    : { listo: false, texto: `Todavía no: las tarjetas viejas fueron ${pcts} de las visitas en las últimas ${SEMANAS_SEGUIDAS} semanas completas (el criterio es menos del ${UMBRAL_APAGADO_PCT} % las dos).` }
}
