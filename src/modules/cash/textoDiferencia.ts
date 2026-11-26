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
  return lineaMoneda(difUsd, 'usd', cerrado)
}

// ── Las dos monedas juntas: el titular muestra el PEOR estado (verificador #348) ──
// Un faltante en cualquier moneda manda sobre un sobrante, y un sobrante sobre «cuadra». Así un día con
// los colones bien y los dólares cortos no se lee como «Cuadra» grande en verde.
const GRAVEDAD: Record<TextoDiferencia['estado'], number> = { cuadra: 0, sobrante: 1, faltante: 2 }

export interface ResumenDiferencia {
  estado:  TextoDiferencia['estado']
  titular: string
  tono:    TonoDiferencia
  /** Una línea por moneda (solo si hay dólares; si no, la nota de colones). */
  detalle: { texto: string; tono: TonoDiferencia }[]
  /** Día cerrado con algo fuera de tolerancia: «Quedó registrada como ajuste de cierre.» */
  pie:     string | null
}

/** Línea de una moneda: «Colones: cuadra, sin diferencia» · «Dólares: faltaron $2,00, fuera de tolerancia (US$1)». */
export function lineaMoneda(dif: number, moneda: Moneda, cerrado: boolean): { texto: string; tono: TonoDiferencia } {
  const nombre = moneda === 'crc' ? 'Colones' : 'Dólares'
  const t = textoDiferencia(dif, moneda, cerrado)
  const bajar = (x: string) => x.charAt(0).toLowerCase() + x.slice(1)
  if (t.estado === 'cuadra') {
    const detalle = t.nota === 'Sin diferencia.' ? 'sin diferencia' : bajar(t.nota).replace(/\.$/, '')
    return { texto: `${nombre}: cuadra, ${detalle}`, tono: t.tono }
  }
  return { texto: `${nombre}: ${bajar(t.titular)}, fuera de tolerancia (${TOL_TXT[moneda]})`, tono: t.tono }
}

/** Diferencia del día con las dos monedas. `difUsd` null = no hay dato en dólares. */
export function resumenDiferencia(difCrc: number, difUsd: number | null, cerrado: boolean): ResumenDiferencia {
  const tC = textoDiferencia(difCrc, 'crc', cerrado)
  const tU = difUsd === null ? null : textoDiferencia(difUsd, 'usd', cerrado)
  const todas = tU ? [tC, tU] : [tC]
  const peor = todas.reduce((a, b) => (GRAVEDAD[b.estado] > GRAVEDAD[a.estado] ? b : a))
  let titular = 'Cuadra'
  if (peor.estado !== 'cuadra') {
    // «Faltaron ₡1.951 y $2,00»: un verbo y los montos de las monedas que comparten el peor estado.
    const mismas = todas.filter(t => t.estado === peor.estado)
    const verbo = peor.titular.split(' ')[0]
    titular = `${verbo} ${mismas.map(t => t.titular.slice(verbo.length + 1)).join(' y ')}`
  }
  const fuera = todas.some(t => !t.dentroTolerancia)
  return {
    estado: peor.estado, titular, tono: peor.tono,
    detalle: tU ? [lineaMoneda(difCrc, 'crc', cerrado), lineaMoneda(difUsd as number, 'usd', cerrado)] : [{ texto: tC.nota, tono: tC.tono }],
    pie: cerrado && fuera && tU ? 'Quedó registrada como ajuste de cierre.' : null,
  }
}

/** Variable CSS del tono (texto). */
export const COLOR_TONO: Record<TonoDiferencia, string> = {
  musgo: 'var(--c-musgo)',
  laca:  'var(--c-laca)',
  oro:   'var(--c-oro-texto)',
}

/** Clase del cartel `.cd-cierre-resultado` según el tono: musgo → ok · oro → sobra · laca → fail. */
export const CLASE_TONO: Record<TonoDiferencia, 'ok' | 'sobra' | 'fail'> = { musgo: 'ok', oro: 'sobra', laca: 'fail' }

// ── Montos con signo (§4 «Montos») ────────────────────────────────────────────
// SOLO presentación: el personal sigue cargando montos positivos (principio firmado del 22-jul). El signo dice
// si la plata entra (+) o sale (−) de la caja que se nombra al lado; menos tipográfico (U+2212) antes del símbolo.

/** «−₡1.951» · «+₡2.300» · «−$2,00». Lo que redondea a cero va sin signo («₡0», «$0,00»). */
export function montoConSigno(n: number, moneda: Moneda): string {
  const u = UNIDAD[moneda]
  const abs = Math.round(Math.abs(n) / u) * u
  const m = montoSinSigno(abs, moneda)
  if (Math.round(abs / u) === 0) return m
  return (n < 0 ? '−' : '+') + m
}

export interface LineaAjuste {
  moneda:   Moneda
  etiqueta: 'Colones' | 'Dólares'
  /** «−₡1.951» (faltante: sale de Caja Fuerte) · «+$3,50» (sobrante: entra). */
  monto:    string
  tono:     TonoDiferencia
}

/**
 * Ajuste de cierre que se va a registrar en Caja Fuerte, una línea por moneda. Recibe los montos que YA
 * decidió CashCierre para el ajuste (los mismos del `ajuste` que manda a la RPC; 0 = esa moneda no lleva
 * ajuste). No calcula ni compara contra la tolerancia: solo los escribe con signo y color (faltó laca · sobró oro).
 */
export function lineasAjuste(crc: number, usd: number): LineaAjuste[] {
  const out: LineaAjuste[] = []
  if (crc !== 0) out.push({ moneda: 'crc', etiqueta: 'Colones', monto: montoConSigno(crc, 'crc'), tono: crc < 0 ? 'laca' : 'oro' })
  if (usd !== 0) out.push({ moneda: 'usd', etiqueta: 'Dólares', monto: montoConSigno(usd, 'usd'), tono: usd < 0 ? 'laca' : 'oro' })
  return out
}
