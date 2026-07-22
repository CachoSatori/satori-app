import type { CashMovement } from '../../shared/types/database'
import { isEgreso } from './cashUtils'

// ── POZO ÚNICO DE EFECTIVO — núcleo puro ─────────────────────────────────────
//
// El modelo viejo mira UNA caja (`saldoCajaFuerte`). El pozo mira TODO el efectivo
// físico del negocio como un solo saldo: da igual en qué bolsillo esté, lo que
// importa es cuánto hay y cuándo entra o sale de la casa.
//
// ⚠️ NADIE en la app importa este archivo todavía. T1 promueve el núcleo y lo valida
// en paralelo contra el histórico; el recableado del cierre es T2. Mientras tanto los
// únicos consumidores son los tests y el harness de `scripts/`.
//
// Reglas (validadas contra el histórico real en el T0 · ver scripts/t0-reconciliacion-cajas):
//
//   1. Cajas FÍSICAS = Caja Fuerte · Caja Proveedores · Registradora. **Banco NO** — la
//      plata en el banco no es efectivo en la casa.
//   2. Ingresos y egresos cuentan si son de una caja física y en efectivo (`method`
//      'Efectivo', o vacío/ausente en las filas viejas que nunca lo cargaron).
//   3. Traspasos ENTRE cajas físicas: NEUTROS. Pasar plata de la Registradora a la Caja
//      Fuerte no cambia cuánto efectivo hay — solo en qué bolsillo está. Ésta es LA
//      diferencia conceptual con `saldoCajaFuerte`, que sí los mueve porque mira una caja.
//   4. Traspasos contra Banco: SÍ mueven. La dirección sale de `subcategory` ('A → B') y
//      **no del `method`**: los depósitos históricos están cargados como 'Transferencia'
//      aunque lo que salió de la bóveda hayan sido billetes.
//   5. Traspaso sin dirección legible (subcategory nula, 'Ajuste', 'Otro traspaso', texto
//      libre): NEUTRO, pero contado aparte en `indeterminados` para que la UI pueda avisar
//      "hay ₡X moviéndose sin decir de dónde a dónde". Silenciarlos sería inventar certeza.
//
// ⚠️ DIFERENCIA DELIBERADA CON `saldoCajaFuerte`: aquél excluye solo `status='pendiente'`;
// el pozo excluye **`pendiente` Y `rechazado`**. Un movimiento rechazado nunca ocurrió: que
// hoy siga restando del saldo de Caja Fuerte es un arrastre del modelo viejo, no una regla.
// Los dos saldos NO tienen por qué coincidir, y por eso conviven durante la validación.

/** Las tres cajas que contienen billetes. `Banco` queda afuera a propósito. */
export const CAJAS_FISICAS = ['Caja Fuerte', 'Caja Proveedores', 'Registradora'] as const

export const CAJA_BANCO = 'Banco'

/** Traspasos sin dirección legible: neutros para el saldo, pero no invisibles. */
export interface Indeterminados {
  cantidad: number
  crc: number
  usd: number
}

export interface SaldoPozo {
  crc: number
  usd: number
  indeterminados: Indeterminados
}

/** En qué se convirtió una fila a los ojos del pozo. Útil para auditar y para la UI. */
export type ClasePozo =
  | 'ingreso'
  | 'egreso'
  | 'traspaso-interno'          // caja física → caja física: neutro
  | 'traspaso-sale-a-banco'     // caja física → Banco: resta
  | 'traspaso-entra-de-banco'   // Banco → caja física: suma
  | 'traspaso-indeterminado'    // sin dirección legible: neutro, pero se cuenta
  | 'fuera'                     // no toca el pozo (Banco, no-efectivo, pendiente/rechazado…)

export interface Contribucion {
  crc: number
  usd: number
  clase: ClasePozo
}

export function esCajaFisica(caja: string | null | undefined): boolean {
  return (CAJAS_FISICAS as readonly string[]).includes(String(caja ?? ''))
}

/** Efectivo = 'Efectivo', o método vacío/ausente (filas viejas anteriores al campo). */
export function esEfectivo(method: string | null | undefined): boolean {
  const m = String(method ?? '').trim()
  return m === '' || m.toLowerCase() === 'efectivo'
}

/** Pendiente todavía no salió de la caja; rechazado nunca salió. Ninguno mueve el pozo. */
export function cuentaEnPozo(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  return s !== 'pendiente' && s !== 'rechazado'
}

/** 'Caja Fuerte → Banco' → { origen:'Caja Fuerte', destino:'Banco' }. null si no se puede leer. */
export function parseTraspaso(subcategory: string | null | undefined): { origen: string; destino: string } | null {
  const partes = String(subcategory ?? '').trim().split(/\s*(?:→|->|=>)\s*/)
  if (partes.length !== 2) return null
  const [origen, destino] = partes.map(x => x.trim())
  if (!origen || !destino) return null
  return { origen, destino }
}

const CERO = (clase: ClasePozo): Contribucion => ({ crc: 0, usd: 0, clase })

/**
 * Cuánto aporta UNA fila al pozo. Sumar esto sobre todas las filas es exactamente
 * `saldoPozoEfectivo`. Se exporta para que la UI pueda explicar fila por fila por qué
 * un movimiento no movió el saldo.
 */
export function contribucionPozo(m: CashMovement): Contribucion {
  if (!cuentaEnPozo(m.status)) return CERO('fuera')

  const crc = m.amount_crc || 0
  const usd = m.amount_usd || 0

  if (m.movement_type === 'traspaso') {
    const t = parseTraspaso(m.subcategory)
    // Sin dirección legible no se puede afirmar nada: se deja neutro y se cuenta.
    if (!t) return CERO('traspaso-indeterminado')

    const origenFisico  = esCajaFisica(t.origen)
    const destinoFisico = esCajaFisica(t.destino)

    if (origenFisico && destinoFisico) return CERO('traspaso-interno')
    if (origenFisico && t.destino === CAJA_BANCO) return { crc: -crc, usd: -usd, clase: 'traspaso-sale-a-banco' }
    if (t.origen === CAJA_BANCO && destinoFisico) return { crc, usd, clase: 'traspaso-entra-de-banco' }
    // Ninguna punta es una caja física conocida (p. ej. 'Banco → Banco', o un nombre que
    // no está en el catálogo). No se puede decidir → neutro y contado.
    return CERO('traspaso-indeterminado')
  }

  if (!esCajaFisica(m.caja_origen)) return CERO('fuera')
  if (!esEfectivo(m.method))        return CERO('fuera')

  if (m.movement_type === 'ingreso') return { crc, usd, clase: 'ingreso' }
  if (isEgreso(m.movement_type))     return { crc: -crc, usd: -usd, clase: 'egreso' }
  return CERO('fuera')
}

/**
 * Saldo del pozo único de efectivo: todo el efectivo físico del negocio, en un número.
 *
 * `indeterminados` NO está sumado ni restado del saldo — son traspasos que se dejaron
 * neutros por no poder leerles la dirección. Se devuelven aparte para que quien muestre
 * el saldo pueda decir "y además hay ₡X sin dirección" en vez de fingir que no existen.
 */
export function saldoPozoEfectivo(movements: CashMovement[]): SaldoPozo {
  let crc = 0
  let usd = 0
  const indeterminados: Indeterminados = { cantidad: 0, crc: 0, usd: 0 }

  for (const m of movements) {
    const c = contribucionPozo(m)
    crc += c.crc
    usd += c.usd
    if (c.clase === 'traspaso-indeterminado') {
      indeterminados.cantidad += 1
      indeterminados.crc += m.amount_crc || 0
      indeterminados.usd += m.amount_usd || 0
    }
  }

  return { crc, usd, indeterminados }
}
