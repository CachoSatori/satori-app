// T0 · Modelo "pozo único" de efectivo — funciones PURAS, solo del harness.
//
// ⚠️ Esto NO vive en src/ a propósito. Es una maqueta para medir el histórico y
// comparar contra el modelo actual (`saldoCajaFuerte`), no código de la app.
//
// Regla del pozo (según la definición del rediseño):
//   · Cajas FÍSICAS = Caja Fuerte · Caja Proveedores · Registradora. 'Banco' queda FUERA.
//   · Ingresos/egresos: cuentan si son de una caja física, en Efectivo (o sin method),
//     y el status no es 'pendiente' ni 'rechazado'.
//   · Traspasos entre cajas físicas: NEUTROS — mover plata de un bolsillo a otro no
//     cambia cuánto efectivo hay.
//   · Traspasos contra Banco: SÍ mueven — 'Caja Fuerte → Banco' resta (el efectivo sale
//     del pozo), 'Banco → Caja Fuerte' suma. La dirección sale de `subcategory`, no del
//     `method` (los depósitos históricos están cargados como 'Transferencia').

/** Forma mínima que necesita el modelo. Compatible con `CashMovement` de la app. */
export type MovPozo = {
  caja_origen?: string | null
  method?: string | null
  movement_type?: string | null
  subcategory?: string | null
  status?: string | null
  amount_crc?: number | null
  amount_usd?: number | null
}

export const CAJAS_FISICAS = ['Caja Fuerte', 'Caja Proveedores', 'Registradora'] as const
export const CAJA_BANCO = 'Banco'

/** Espejo de EGRESO_TYPES de cashUtils (no se importa: el único import de src/ es saldoCajaFuerte). */
export const TIPOS_EGRESO = ['egreso_mercaderia', 'egreso_personal', 'egreso_operativo', 'egreso_socios'] as const

export function esCajaFisica(caja: string | null | undefined): boolean {
  return (CAJAS_FISICAS as readonly string[]).includes(String(caja ?? ''))
}

export function esEgreso(tipo: string | null | undefined): boolean {
  return (TIPOS_EGRESO as readonly string[]).includes(String(tipo ?? ''))
}

/** Efectivo = 'Efectivo' (case-insensitive) o método vacío/ausente. */
export function esEfectivo(method: string | null | undefined): boolean {
  const m = String(method ?? '').trim()
  return m === '' || m.toLowerCase() === 'efectivo'
}

/** Pendiente aún no pasó por caja; rechazado nunca pasó. Ninguno mueve el pozo. */
export function cuentaEnPozo(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  return s !== 'pendiente' && s !== 'rechazado'
}

/** 'Caja Fuerte → Banco' → { origen: 'Caja Fuerte', destino: 'Banco' }. null si no se puede leer. */
export function parseTraspaso(subcategory: string | null | undefined): { origen: string; destino: string } | null {
  const s = String(subcategory ?? '').trim()
  const partes = s.split(/\s*(?:→|->|=>)\s*/)
  if (partes.length !== 2) return null
  const [origen, destino] = partes.map((p) => p.trim())
  if (!origen || !destino) return null
  return { origen, destino }
}

export type ClasePozo =
  | 'ingreso'
  | 'egreso'
  | 'traspaso-interno'          // caja física → caja física: neutro
  | 'traspaso-sale-a-banco'     // física → Banco: resta
  | 'traspaso-entra-de-banco'   // Banco → física: suma
  | 'traspaso-indeterminado'    // sin dirección legible; se ASUME interno (neutro) y se reporta
  | 'fuera'                     // no toca el pozo (Banco, no-efectivo, pendiente/rechazado…)

export type Contribucion = { crc: number; usd: number; clase: ClasePozo }

const CERO = (clase: ClasePozo): Contribucion => ({ crc: 0, usd: 0, clase })

/** Aporte de UNA fila al pozo. Sumar esto sobre todas las filas == saldoPozoEfectivo(). */
export function contribucionPozo(m: MovPozo): Contribucion {
  if (!cuentaEnPozo(m.status)) return CERO('fuera')

  const crc = m.amount_crc || 0
  const usd = m.amount_usd || 0
  const tipo = String(m.movement_type ?? '')

  if (tipo === 'traspaso') {
    const t = parseTraspaso(m.subcategory)
    if (!t) {
      // Sin dirección legible (subcategory null, 'Ajuste', 'Otro traspaso'…). Si la fila
      // pertenece a una caja física la tratamos como movimiento interno → neutro, y el
      // reporte lo lista aparte para que el supuesto quede a la vista.
      return CERO(esCajaFisica(m.caja_origen) ? 'traspaso-indeterminado' : 'fuera')
    }
    const origenFisico = esCajaFisica(t.origen)
    const destinoFisico = esCajaFisica(t.destino)
    if (origenFisico && destinoFisico) return CERO('traspaso-interno')
    if (origenFisico && t.destino === CAJA_BANCO) return { crc: -crc, usd: -usd, clase: 'traspaso-sale-a-banco' }
    if (t.origen === CAJA_BANCO && destinoFisico) return { crc, usd, clase: 'traspaso-entra-de-banco' }
    return CERO('fuera')
  }

  if (!esCajaFisica(m.caja_origen)) return CERO('fuera')
  if (!esEfectivo(m.method)) return CERO('fuera')

  if (tipo === 'ingreso') return { crc, usd, clase: 'ingreso' }
  if (esEgreso(tipo)) return { crc: -crc, usd: -usd, clase: 'egreso' }
  return CERO('fuera')
}

/** Saldo del pozo único de efectivo. Misma forma de retorno que `saldoCajaFuerte`. */
export function saldoPozoEfectivo(movs: MovPozo[]): { crc: number; usd: number } {
  let crc = 0
  let usd = 0
  for (const m of movs) {
    const c = contribucionPozo(m)
    crc += c.crc
    usd += c.usd
  }
  return { crc, usd }
}

// ── Espejo de saldoCajaFuerte, fila por fila ─────────────────────────────────
//
// `saldoCajaFuerte` (src/modules/cash/cashUtils.ts) devuelve un total, no el aporte
// de cada fila, y NO se puede tocar. Para desglosar la diferencia pozo−CF por
// (caja_origen × movement_type) hace falta el aporte por fila, así que se replica acá.
// run.ts VERIFICA que la suma de este espejo sea idéntica a la función real: si el
// espejo se desviara, el reporte aborta en vez de mentir.

/** Aporte de UNA fila a `saldoCajaFuerte`. Réplica literal de la lógica de cashUtils. */
export function contribucionCajaFuerte(m: MovPozo): { crc: number; usd: number } {
  if (String(m.caja_origen ?? '') !== 'Caja Fuerte' || m.status === 'pendiente') return { crc: 0, usd: 0 }
  const c = m.amount_crc || 0
  const u = m.amount_usd || 0
  const tipo = String(m.movement_type ?? '')
  if (tipo === 'ingreso') return { crc: c, usd: u }
  if (esEgreso(tipo)) return { crc: -c, usd: -u }
  if (tipo === 'traspaso') {
    const entra = /→\s*caja fuerte/i.test(m.subcategory || '')
    return entra ? { crc: c, usd: u } : { crc: -c, usd: -u }
  }
  return { crc: 0, usd: 0 }
}
