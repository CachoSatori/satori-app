// Carteles del Cierre del día (SPEC-caja-estandar §3.2 y §4). SOLO presentación: no calcula la
// diferencia ni decide si el cierre pide ajuste (eso vive en CashCierre: `cuadra`, `cuadraUSD`,
// `cierreNecesitaAjuste`). Recibe la diferencia ya calculada (contado − debería) y arma el texto.
import { OVER_SHORT_TOL, OVER_SHORT_TOL_USD } from './cierreStats'

// ── Barra de fases (§3.2) ────────────────────────────────────────────────────
// Un cierre `completo` cierra el día entero: las dos fases van cerradas aunque no haya fila
// `parcial_mediodia` (en los cierres nuevos la RPC deja una sola fila `completo`).
export type FaseMediodia = 'sellado' | 'pendiente'
export type FaseNoche = 'cerrado' | 'en-curso' | 'en-espera'

export function estadoFases(hayParcial: boolean, hayCompleto: boolean): { mediodia: FaseMediodia; noche: FaseNoche } {
  return {
    mediodia: hayCompleto || hayParcial ? 'sellado' : 'pendiente',
    noche:    hayCompleto ? 'cerrado' : hayParcial ? 'en-curso' : 'en-espera',
  }
}

export const ETIQUETA_MEDIODIA: Record<FaseMediodia, string> = { sellado: 'sellado', pendiente: 'pendiente' }
export const ETIQUETA_NOCHE: Record<FaseNoche, string> = { 'cerrado': 'cerrado', 'en-curso': 'en curso', 'en-espera': 'en espera' }

// ── Diferencia (§4) ──────────────────────────────────────────────────────────
// Colores decididos por el dueño (24-nov): cuadra = musgo (verde) · faltó = laca · sobró = oro.
export type TonoDiferencia = 'musgo' | 'laca' | 'oro'
export type Moneda = 'crc' | 'usd'

export interface TextoDiferencia {
  estado:           'cuadra' | 'faltante' | 'sobrante'
  dentroTolerancia: boolean
  titular:          string
  nota:             string
  tono:             TonoDiferencia
}

const TOL: Record<Moneda, number> = { crc: OVER_SHORT_TOL, usd: OVER_SHORT_TOL_USD }
const UNIDAD: Record<Moneda, number> = { crc: 1, usd: 0.01 }
const TOL_TXT: Record<Moneda, string> = { crc: `₡${OVER_SHORT_TOL}`, usd: `US$${OVER_SHORT_TOL_USD}` }

const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Monto sin signo, al estándar de los reportes: «₡1.951» · «$2,00». */
export function montoSinSigno(abs: number, moneda: Moneda): string {
  if (moneda === 'crc') return '₡' + miles(Math.round(abs))
  const [ent, dec] = abs.toFixed(2).split('.')
  return '$' + miles(Number(ent)) + ',' + dec
}

// Dentro de la tolerancia, el redondeo no puede mostrar la tolerancia misma (₡499,6 → «₡500: dentro
// de la tolerancia (menos de ₡500)» se contradice): ahí se corta hacia abajo a la unidad.
function magnitud(abs: number, moneda: Moneda, dentro: boolean): number {
  const u = UNIDAD[moneda]
  const redondo = Math.round(abs / u) * u
  return dentro && redondo >= TOL[moneda] ? Math.floor(abs / u) * u : redondo
}

/**
 * Texto de la diferencia de una moneda. `cerrado` = el día ya está cerrado (tiempo pasado y
 * «quedó registrada como ajuste de cierre» fuera de tolerancia). Dentro de la tolerancia es
 * `|dif| < tol` — la MISMA frontera que `cuadra` / `cuadraUSD` / `cierreNecesitaAjuste`.
 */
export function textoDiferencia(dif: number, moneda: Moneda, cerrado: boolean): TextoDiferencia {
  const abs = Math.abs(dif)
  const dentro = abs < TOL[moneda]
  const falta = dif < 0
  const m = montoSinSigno(magnitud(abs, moneda, dentro), moneda)
  const verbo = falta ? (cerrado ? 'Faltaron' : 'Faltan') : (cerrado ? 'Sobraron' : 'Sobran')

  if (dentro) {
    const sinDif = Math.round(abs / UNIDAD[moneda]) === 0
    return {
      estado: 'cuadra', dentroTolerancia: true, titular: 'Cuadra', tono: 'musgo',
      nota: sinDif ? 'Sin diferencia.' : `${verbo} ${m}: dentro de la tolerancia (menos de ${TOL_TXT[moneda]}).`,
    }
  }
  return {
    estado: falta ? 'faltante' : 'sobrante', dentroTolerancia: false,
    titular: `${verbo} ${m}`,
    nota: `Fuera de tolerancia (${TOL_TXT[moneda]}).${cerrado ? ' Quedó registrada como ajuste de cierre.' : ''}`,
    tono: falta ? 'laca' : 'oro',
  }
}

/** Línea aparte para dólares: «Dólares: cuadra, sin diferencia» · «Dólares: faltan $2,00, fuera de tolerancia (US$1)». */
export function lineaDolares(difUsd: number, cerrado: boolean): { texto: string; tono: TonoDiferencia } {
  const t = textoDiferencia(difUsd, 'usd', cerrado)
  if (t.estado === 'cuadra') {
    const detalle = t.nota === 'Sin diferencia.' ? 'sin diferencia' : t.nota.charAt(0).toLowerCase() + t.nota.slice(1).replace(/\.$/, '')
    return { texto: `Dólares: cuadra, ${detalle}`, tono: t.tono }
  }
  const titular = t.titular.charAt(0).toLowerCase() + t.titular.slice(1)
  return { texto: `Dólares: ${titular}, fuera de tolerancia (${TOL_TXT.usd})${cerrado ? '; quedó registrada como ajuste de cierre' : ''}`, tono: t.tono }
}

/** Variable CSS del tono (texto). */
export const COLOR_TONO: Record<TonoDiferencia, string> = {
  musgo: 'var(--c-musgo)',
  laca:  'var(--c-laca)',
  oro:   'var(--c-oro-texto)',
}
