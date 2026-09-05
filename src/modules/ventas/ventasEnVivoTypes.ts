import type { DiaData, ProductMap } from '../../shared/types/ventas'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · pestaña EN VIVO — extensión ADITIVA del modelo que ya existe                  ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ── LA REGLA ───────────────────────────────────────────────────────────────────────────────
// El día vive en `DiaData`, el MISMO tipo que produce `xlsParser` y que guarda `ventas_dias`.
// No hay un modelo paralelo: si «En vivo» inventara su propio total del día, tarde o temprano
// diría un número distinto del que dice «Hoy» para la misma fecha, y nadie sabría cuál vale.
//
// Lo que se agrega acá es SOLO lo que el import de xls no puede saber, porque solo existe
// mientras el servicio corre: el ritmo hora por hora, si el local está abierto, la proyección
// de cierre. Todo eso son campos NUEVOS en tipos NUEVOS — no se toca ni se reinterpreta ningún
// campo de `DiaData`, `SaloneroDay` ni `CajeroDay`.
//
// ── POR QUÉ ES BACKWARD-COMPATIBLE ─────────────────────────────────────────────────────────
//   · `DiaData` no cambia: ni un campo agregado, ni uno cambiado de tipo o de significado.
//   · Nada de acá se importa desde `xlsParser`, `ventasUtils` ni ninguna pestaña existente.
//     La dependencia va en un solo sentido: En vivo → el modelo. Nunca al revés.
//   · Los derivados del día NO se recalculan acá: salen de `getDayStats(dia)`, la función que
//     ya usan «Hoy» y Contabilidad.
//
// ── EL ARTÍCULO PAX ────────────────────────────────────────────────────────────────────────
// En el xls, el pax viaja como una línea de producto llamada `PAX`, y `xlsParser` la SACA del
// mix (`if (prod === 'PAX') return`, xlsParser.ts): cuenta comensales, no es algo que se venda.
// El mock respeta eso: `prods` nunca trae `PAX`. Si apareciera, inflaría las unidades del mix
// y el «lo que más se vendió» arrancaría con un artículo que no es un plato.

/** Los dos locales. Mismos slugs que `locations.id`, `work_days.local` y el biotime-bridge. */
export type LocalId = 'santa-teresa' | 'nosara'

export const LOCALES: { id: LocalId; label: string }[] = [
  { id: 'santa-teresa', label: 'Santa Teresa' },
  { id: 'nosara',       label: 'Nosara' },
]

/** El nombre del artículo que el PoS usa para los comensales. Ver el bloque de arriba. */
export const ARTICULO_PAX = 'PAX'

/**
 * El ritmo del día, hora por hora. LIVE-ONLY: el import de xls trae el día entero, sin
 * repartirlo por hora, así que esto no existe en `DiaData`.
 *
 * `hora` es hora de RELOJ de Costa Rica (UTC−6 fijo, sin horario de verano — misma regla que
 * el biotime-bridge y la mig 059), en 24 h.
 *
 * FUENTE FUTURA (PoS `ndf`): hora de cierre de la cuenta · Σ del total · conteo de cuentas.
 */
export interface VentaPorHora {
  hora:    number    // 0–23, hora CR
  monto:   number    // CRC
  tickets: number
}

/**
 * La comparación contra el histórico, sobre la venta acumulada A LA MISMA HORA. Comparar las
 * 19:00 de hoy contra un día entero diría que siempre vamos mal.
 *
 * FUENTE FUTURA: Σ de días ya cerrados de nuestra propia base (`ventas_dias`), no del PoS.
 * Es lo primero que se puede cablear de verdad: el módulo ya carga `dias`.
 */
export interface ComparativaHistorico {
  mismoDiaSemanaPasada: number    // CRC
  promedio4Semanas:     number    // CRC
}

/**
 * ── EL INDICADOR ───────────────────────────────────────────────────────────────────────
 *
 * No mide ventas: mide si se puede confiar en `promPax`. Existe porque en el modelo actual el
 * pax sale del artículo `PAX` del xls, y si el salonero no lo carga, `xlsParser` directamente
 * DESCARTA al salonero del día (`if (!pax || !total) return`). O sea: hoy un pax mal cargado
 * no se ve como un error, se ve como un salonero que no trabajó.
 *
 * Con el PoS en línea se puede medir antes de que eso pase.
 *
 *   pctPaxNativoCargado   → % de mesas con el pax en el campo NATIVO del PoS
 *   matchArticuloVsNativo → cuando además se carga como artículo, % de mesas donde coinciden
 *
 * ⚠ FASE B: necesita el campo nativo de comensales de `ndf` y el puente mesero ↔ `employees`.
 */
export interface CalidadPax {
  salonero:              string
  mesas:                 number
  pctPaxNativoCargado:   number    // 0–100
  matchArticuloVsNativo: number    // 0–100
}

/**
 * Todo lo que la pestaña consume. `dia` es un `DiaData` EXACTAMENTE igual al que produce el
 * import de xls — mismo tipo, misma forma, mismos campos. El resto son los extras live-only.
 *
 * `pm` viaja con el snapshot porque el mix por categoría se arma con `clasificacion`, igual
 * que en Mix Ventas. Cuando el feed sea real, este `pm` se reemplaza por el que ya carga el
 * módulo y el código de la pantalla no cambia.
 */
export interface SnapshotEnVivo {
  local:           LocalId
  fecha:           string    // 'YYYY-MM-DD' · la JORNADA de servicio, no el día civil
  /** Instante en que se armó el snapshot. La pantalla lo muestra como «actualizado hace…». */
  generadoEn:      string    // ISO
  /**
   * `true` mientras el local está en servicio; `false` fuera de horario, cuando lo que se ve
   * es el ÚLTIMO servicio cerrado. Un dashboard «en vivo» abierto a las 3 de la mañana no
   * puede mostrar un día vacío como si fuera el de hoy.
   */
  servicioEnCurso: boolean

  /** ── El día, en el modelo de siempre ── */
  dia: DiaData
  pm:  ProductMap

  /** ── Extras que solo existen en vivo ── */
  porHora:          VentaPorHora[]
  /** Estimación NUESTRA, no un dato del PoS. La pantalla lo dice con esas palabras. */
  proyeccionCierre: number    // CRC
  historico:        ComparativaHistorico
  /** ⚠ Fase B — hoy son datos de ejemplo, la pantalla los marca como tales. */
  calidadPax:       CalidadPax[]

  // ── Extras del feed real (OPCIONALES) ───────────────────────────────────────────────────
  // Aditivos a propósito: el mock no los trae y sigue cumpliendo el tipo sin cambiar una línea.
  // `DiaData` no tiene dónde guardarlos (su `iva`/`serv` son por salonero), así que viajan acá.

  /** Bruto del día: Σ medios de pago − vuelto (`total_crc`). */
  bruto?:    number
  /** Servicio 10 % cobrado (`Σ servicio_crc`). */
  servicio?: number
  /** IVA informado por el PoS (`Σ iva_crc`). Ver `ivaPendiente`. */
  iva?:      number
  /** Lo regalado, en neto (`Σ regalia_crc`). */
  regalia?:  number
  /**
   * `true` = el PoS todavía no informa IVA (llega en 0 en todo el histórico). La pantalla lo
   * muestra como PENDIENTE en vez de como "₡0": **no se deriva** de neto × 0,13, porque
   * calcular un impuesto que nadie cobró sería inventar plata (SPEC-valor-servido-regalias).
   */
  ivaPendiente?: boolean

  /** Mesas abiertas AHORA (snapshot de `pos_ndf_open`). Solo cuando se mira el día en curso. */
  mesasAbiertas?: number
  /** Comensales sentados en esas mesas. */
  paxAbierto?:    number
  /**
   * De dónde salieron los números. `'pos'` = leídos de `pos_ndf_*`; `'simulado'` = el
   * generador de ejemplo. La pantalla lo dice en pantalla en vez de asumirlo.
   */
  fuente?: 'pos' | 'simulado'
}

// ── Derivados live-only ─────────────────────────────────────────────────────────
// Los del DÍA (venta neta, bruta, iva, servicio, salón, delivery, pax, promPax) NO están acá:
// salen de `getDayStats(dia)` de `ventasUtils`, la misma que usan «Hoy» y Contabilidad. Estos
// tres son los que el modelo del xls no puede dar.

/**
 * Cuántas cuentas se cerraron. En el modelo del xls solo los CAJEROS traen conteo
 * (`CajeroDay.ordenes`); los saloneros traen pax, no tickets. En vivo el PoS sí sabe cuántas
 * cuentas cerró cada hora, así que el total sale de ahí.
 */
export function ticketsDelDia(porHora: VentaPorHora[]): number {
  return porHora.reduce((s, h) => s + h.tickets, 0)
}

/** Ticket promedio = venta / tickets. Sin tickets es `0`, no `NaN`: la pantalla muestra «—». */
export function ticketPromedioDe(venta: number, tickets: number): number {
  if (!tickets || tickets <= 0) return 0
  return Math.round(venta / tickets)
}

/**
 * Variación porcentual contra una referencia. `null` cuando no hay contra qué comparar —
 * distinto de `0`, que sería «igual que la referencia».
 */
export function variacionPct(actual: number, referencia: number): number | null {
  if (!referencia || referencia <= 0) return null
  return ((actual - referencia) / referencia) * 100
}

/**
 * ¿Se puede confiar en el pax? Umbral deliberadamente exigente: por debajo del 90 % de mesas
 * con pax nativo cargado, el denominador tiene demasiados huecos y la pantalla lo dice en vez
 * de mostrar un número que parece preciso.
 */
export const UMBRAL_PAX_CONFIABLE = 90

export function paxEsConfiable(c: Pick<CalidadPax, 'pctPaxNativoCargado'>): boolean {
  return c.pctPaxNativoCargado >= UMBRAL_PAX_CONFIABLE
}

/**
 * El mix por categoría, armado desde `DiaData` + `ProductMap` — el mismo par que usa Mix
 * Ventas. Se agrupa por `clasificacion`, con el mismo fallback (`SIN CLASIFICAR`).
 *
 * El artículo `PAX` no llega nunca acá porque `xlsParser` ya lo saca de `prods`; el guard
 * explícito está igual, para que el día que el feed venga del PoS —donde el pax puede venir
 * como artículo— no se cuele al mix por la puerta de atrás.
 */
export interface MixCategoria {
  categoria: string
  monto:     number
  unidades:  number
  pctMix:    number    // 0–100
}

export function mixPorCategoria(dia: DiaData, pm: ProductMap): MixCategoria[] {
  const acc = new Map<string, { monto: number; unidades: number }>()

  for (const s of Object.values(dia.saloneros)) {
    for (const [nombre, qty, monto] of (s.prods ?? [])) {
      if (nombre.trim().toUpperCase() === ARTICULO_PAX) continue
      const cat = pm[nombre]?.clasificacion || 'SIN CLASIFICAR'
      const e = acc.get(cat) ?? { monto: 0, unidades: 0 }
      e.monto    += monto
      e.unidades += qty
      acc.set(cat, e)
    }
  }

  const total = [...acc.values()].reduce((s, e) => s + e.monto, 0)
  return [...acc.entries()]
    .map(([categoria, e]) => ({
      categoria,
      monto:    e.monto,
      unidades: e.unidades,
      pctMix:   total > 0 ? (e.monto / total) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto)
}

/**
 * ── VENTA POR PAX (§3.F del SPEC) ──────────────────────────────────────────────────────
 * La fuente PRIMARIA de comensales es el **artículo pax**, no el campo nativo del PoS:
 * el nativo no es obligatorio y hoy no es confiable. Cuando el nativo llegue al 100 %
 * (§3.F) esto se invierte y el artículo se retira.
 */
export function ventaPorPax(venta: number, pax: number): number {
  if (!pax || pax <= 0) return 0
  return Math.round(venta / pax)
}

/**
 * Los productos del día en el formato que come `topProds` de `ventasUtils`. Se reusa esa
 * función en vez de escribir otro ordenamiento: es la que ya decide qué es «lo que más se
 * vendió» en el resto del módulo.
 */
export function prodsDelDia(dia: DiaData): Record<string, { q: number; m: number }> {
  const out: Record<string, { q: number; m: number }> = {}
  for (const s of Object.values(dia.saloneros)) {
    for (const [nombre, qty, monto] of (s.prods ?? [])) {
      if (nombre.trim().toUpperCase() === ARTICULO_PAX) continue
      if (!out[nombre]) out[nombre] = { q: 0, m: 0 }
      out[nombre].q += qty
      out[nombre].m += monto
    }
  }
  return out
}
