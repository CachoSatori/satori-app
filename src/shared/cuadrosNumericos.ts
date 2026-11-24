// ── Cuadros numéricos que no guardan 0 con texto ilegible (R29–R31, R33, R35) ──
//
// Módulo PURO (no lee la base ni la pantalla). Un `<input type="number">` con texto que no es número («0-450»,
// «5-», «--», «12abc») entrega `value === ''` y marca `validity.badInput`: sin mirar la marca, eso contaba como
// vacío (= 0) y se guardaba 0 sin aviso. Cada pantalla guarda NaN en el cuadro ilegible (`leerCuadro`), le pasa
// a la prop `value` lo que da `valorInput` (NaN → '', para que React no borre lo que se ve) y, antes de guardar,
// pide el aviso que NOMBRA el cuadro a `errorDeNumeros`; con aviso el botón se apaga y no se escribe nada.
//
// `esIlegible`, `alEscribir` y `valorInput` nacieron en `src/modules/tips/validarTurno.ts` (#325/#341) y se
// mudaron acá sin cambiar su comportamiento para que los otros módulos no importen de propinas; validarTurno los
// reexporta. Los montos de caja siguen con `errorDeCuadros` de `src/modules/cash/cuadrosMonto.ts` (no se tocó).

/** true si el input muestra algo que el navegador no puede leer como número. */
export function esIlegible(el: { validity?: { badInput?: boolean } | null }): boolean {
  return el.validity?.badInput === true
}

/**
 * onChange y onInput con el mismo manejador. React 19 dispara onChange solo si el `value` que lee cambia: un
 * cuadro vacío que recibe algo ilegible («-», «--450») o uno ilegible que se borra pasa de "" a "" y onChange
 * NO llega (verificado en Chrome headless, 23-nov); onInput llega siempre.
 */
export function alEscribir(f: (el: HTMLInputElement) => void) {
  const h = (e: { currentTarget: HTMLInputElement }) => f(e.currentTarget)
  return { onChange: h, onInput: h }
}

/** Valor para la prop `value` del input: lo ilegible (NaN) va como '' para que React no pise lo que se ve. */
export function valorInput<T>(v: T): T | '' {
  return typeof v === 'number' && Number.isNaN(v) ? '' : v
}

/** Lo que trae un cuadro `type="number"`: NaN si es ilegible, '' si está vacío y si no, el número. */
export function leerCuadro(el: { value: string; validity?: { badInput?: boolean } | null }): number | '' {
  if (esIlegible(el)) return Number.NaN
  return el.value === '' ? '' : Number(el.value)
}

export interface CuadroNumero {
  /** Cómo lo ve la persona en pantalla (va en el aviso entre «»). */
  nombre: string
  /** Lo del estado: número (NaN = ilegible), '' / null / undefined = vacío, o el texto de un cuadro de texto. */
  valor: unknown
  /** Solo enteros (puntos, días, orden, multiplicador). */
  entero?: boolean
  /** Mínimo permitido (incluido). Por defecto 0: ningún cuadro de estos admite negativos. */
  min?: number
  /** Mayor estricto (cantidad > 0). Reemplaza a `min`. */
  mayorQue?: number
  /** Máximo permitido (incluido). */
  max?: number
  /** Vacío permitido (true: es 0 o «sin dato» según la pantalla, como antes) o falta el número (false). */
  vacioVale?: boolean
  /** Ejemplo para el aviso («por ejemplo 10»). */
  ejemplo?: string
}

// Texto de un cuadro de texto (Promociones, Retos): solo dígitos, con punto o coma para los decimales. Nada de «1e3».
const TEXTO_NUMERO = /^-?(\d+([.,]\d*)?|[.,]\d+)$/

/** El número de un valor del estado: NaN si no se puede leer, null si está vacío. */
export function numeroDe(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN
  if (typeof v !== 'string') return Number.NaN
  const t = v.replace(/[\s\u00a0\u202f]/g, '')
  if (t === '') return null
  if (!TEXTO_NUMERO.test(t)) return Number.NaN
  return Number(t.replace(',', '.'))
}

/** «un número entero de 1 a 50», «un número mayor que 0», «un número de 0 en adelante». */
export function reglaDe(c: CuadroNumero): string {
  const tipo = c.entero ? 'un número entero' : 'un número'
  const min = c.mayorQue === undefined ? (c.min ?? 0) : undefined
  const rango = c.mayorQue !== undefined
    ? (c.max !== undefined ? ` mayor que ${c.mayorQue} y hasta ${c.max}` : ` mayor que ${c.mayorQue}`)
    : c.max !== undefined ? ` de ${min} a ${c.max}` : ` de ${min} en adelante`
  return `${tipo}${rango}${c.ejemplo ? ` (por ejemplo ${c.ejemplo})` : ''}`
}

export const msgNoEsNumero = (c: CuadroNumero) =>
  `«${c.nombre}»: lo escrito no es un número. Va ${reglaDe(c)}${c.vacioVale ? ', o borralo' : ''}.`
export const msgFueraDeRegla = (c: CuadroNumero) => `«${c.nombre}»: va ${reglaDe(c)}.`
export const msgFalta = (c: CuadroNumero) => `«${c.nombre}»: falta el número. Va ${reglaDe(c)}.`

/** El aviso del primer cuadro que no se puede guardar (nombrándolo); null si todos sirven. */
export function errorDeNumeros(cuadros: readonly CuadroNumero[]): string | null {
  for (const c of cuadros) {
    const n = numeroDe(c.valor)
    if (n === null) { if (c.vacioVale) continue; return msgFalta(c) }
    if (!Number.isFinite(n)) return msgNoEsNumero(c)
    if (c.entero && !Number.isInteger(n)) return msgFueraDeRegla(c)
    if (c.mayorQue !== undefined ? !(n > c.mayorQue) : n < (c.min ?? 0)) return msgFueraDeRegla(c)
    if (c.max !== undefined && n > c.max) return msgFueraDeRegla(c)
  }
  return null
}
