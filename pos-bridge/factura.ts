// ── pos-bridge · comparación de NumeroFactura ──────────────────────────────────
//
// `NumeroFactura` es un DECIMAL en el PoS y viaja siempre como string (un `Number` lo
// trunca arriba de 2^53). Eso obliga a comparar a mano: como texto, '9' > '10', y el
// agente se saltearía facturas para siempre sin que nada falle.
//
// Puro y sin dependencias: es la aritmética que sostiene el cursor.

/** `' 005001.00 '` → `'5001'`. `null` si no es un entero decimal reconocible. */
export function normalizarFactura(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (s === '') return null
  // El PoS puede devolver el decimal con parte fraccionaria en cero.
  const sinDecimales = s.replace(/\.0*$/, '')
  if (!/^\d+$/.test(sinDecimales)) return null
  const sinCeros = sinDecimales.replace(/^0+(?=\d)/, '')
  return sinCeros
}

/**
 * Compara dos números de factura por VALOR: primero por largo (ya sin ceros a la
 * izquierda), después lexicográficamente. Es la comparación numérica de enteros
 * arbitrariamente grandes, sin pasar por punto flotante.
 */
export function compararFactura(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a === b ? 0 : (a < b ? -1 : 1)
}

/** El mayor de una lista de números de factura (los ilegibles se ignoran). */
export function mayorFactura(valores: readonly unknown[], actual: string | null = null): string | null {
  let mayor = normalizarFactura(actual)
  for (const v of valores) {
    const n = normalizarFactura(v)
    if (n === null) continue
    if (mayor === null || compararFactura(n, mayor) > 0) mayor = n
  }
  return mayor
}

/**
 * El número de factura inmediatamente ANTERIOR: `'110850'` → `'110849'`, `'1000'` → `'999'`.
 * `null` para `'0'` (no hay anterior) y para lo ilegible.
 *
 * Es lo que permite TOPAR el cursor sin pasar por punto flotante: el cursor nunca puede
 * quedar por encima de una factura que todavía está en curso (`R`), porque la lectura
 * incremental es `NumeroFactura > cursor` y esa factura, cuando cierre, ya no se leería.
 * El tope es entonces `anteriorFactura(menor R)`.
 */
export function anteriorFactura(v: unknown): string | null {
  const n = normalizarFactura(v)
  if (n === null || n === '0') return null
  const digitos = n.split('')
  let i = digitos.length - 1
  while (i >= 0 && digitos[i] === '0') { digitos[i] = '9'; i-- }
  digitos[i] = String(Number(digitos[i]) - 1)
  return digitos.join('').replace(/^0+(?=\d)/, '')
}
