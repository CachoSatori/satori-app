// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Analítica PoS · EL CONTRATO DE DATOS (Fase A)                                          ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Estos tipos son NUESTRO modelo, no el del PoS. Es a propósito: cuando tengamos permiso de
// lectura sobre `ndf` (SQL Server), el esquema real va a tener otros nombres, otras tablas y
// probablemente otra forma. Lo que NO queremos es que esa forma se filtre hasta la pantalla.
//
// La regla: el mapeo «campo del PoS → campo nuestro» vive en UN solo lugar (el agente
// `tools/pos-bridge/`, y después la Edge Function). De acá para arriba nadie sabe cómo se
// llaman las columnas de `ndf`. Si mañana cambian el PoS, se reescribe el mapeo y la UI ni se
// entera.
//
// Cada campo lleva su fuente futura anotada como `TBD`: no la inventamos. Cuando llegue el
// esquema, esos TBD son la lista de trabajo.
//
// ⚠ NADA de esto toca plata real todavía. Los montos son colones (CRC), enteros, sin decimales
//   — la misma convención que el resto de la app (`fi()` de shared/utils).

/** Los dos locales. Mismos slugs que `locations.id`, `work_days.local` y el biotime-bridge. */
export type LocalId = 'santa-teresa' | 'nosara'

export const LOCALES: { id: LocalId; label: string }[] = [
  { id: 'santa-teresa', label: 'Santa Teresa' },
  { id: 'nosara',       label: 'Nosara' },
]

/**
 * El estado del día, a la hora que se mire. Es la fila que alimenta los KPI de arriba.
 *
 * FUENTE FUTURA (PoS `ndf`, SQL Server):
 *   fecha             ← TBD · fecha de la sesión/jornada del PoS (¿corte propio o día civil?)
 *   local             ← TBD · el PoS es por local; si hay una sola base, TBD el campo que separa
 *   ventaAcumulada    ← TBD · Σ del total de las cuentas CERRADAS del día (sin impuestos ni servicio)
 *   tickets           ← TBD · conteo de cuentas cerradas
 *   pax               ← TBD · Σ de comensales declarados por cuenta (ver `CalidadPax`: puede venir vacío)
 *   proyeccionCierre  ← calculado por NOSOTROS, no viene del PoS (ver `mock.ts`)
 *
 * `ticketPromedio` y `ventaPorPax` son derivados y NO se guardan: se calculan con las funciones
 * de abajo, para que la pantalla y cualquier otro consumidor no puedan sacar números distintos.
 */
export interface VentaDia {
  fecha:            string        // 'YYYY-MM-DD'
  local:            LocalId
  ventaAcumulada:   number        // CRC
  tickets:          number
  ticketPromedio:   number        // CRC · derivado: ventaAcumulada / tickets
  pax:              number
  ventaPorPax:      number        // CRC · derivado: ventaAcumulada / pax
  /**
   * Adónde llegaría el día si el ritmo se mantiene. Es una ESTIMACIÓN nuestra, no un dato del
   * PoS: la pantalla tiene que decirlo con esas palabras y nunca mostrarla como venta real.
   */
  proyeccionCierre: number        // CRC
}

/**
 * El ritmo del día, hora por hora. `hora` es la hora de RELOJ de Costa Rica (UTC−6 fijo, sin
 * horario de verano — misma regla que el biotime-bridge), en 24 h.
 *
 * FUENTE FUTURA:
 *   hora    ← TBD · hora de cierre de la cuenta (¿o de apertura? define a qué hora "cuenta" la venta)
 *   monto   ← TBD · Σ del total de las cuentas cerradas en esa hora
 *   tickets ← TBD · conteo de esas cuentas
 */
export interface VentaPorHora {
  hora:    number    // 0–23, hora CR
  monto:   number    // CRC
  tickets: number
}

/**
 * El mix del día. `pctMix` es participación sobre la venta del día, en porcentaje (0–100).
 *
 * FUENTE FUTURA:
 *   categoria    ← TBD · la categoría del PoS. OJO: puede no coincidir con las nuestras
 *                        (Ventas → Productos ya mantiene un mapeo propio; TBD si se reusa)
 *   subcategoria ← TBD · opcional, si el PoS tiene dos niveles
 *   monto        ← TBD · Σ de las líneas de esa categoría
 *   unidades     ← TBD · Σ de cantidades
 *   pctMix       ← derivado: monto / venta del día × 100
 */
export interface VentaPorCategoria {
  categoria:     string
  subcategoria?: string
  monto:         number    // CRC
  unidades:      number
  pctMix:        number    // 0–100
}

/**
 * Lo que más se vendió. Se ordena por `monto` o por `unidades` según lo que se esté mirando —
 * son dos preguntas distintas y la pantalla deja elegir.
 *
 * FUENTE FUTURA:
 *   nombre    ← TBD · descripción del artículo en el PoS
 *   categoria ← TBD · la del artículo (misma advertencia de mapeo que arriba)
 *   unidades  ← TBD · Σ de cantidades vendidas
 *   monto     ← TBD · Σ del importe de esas líneas
 */
export interface TopProducto {
  nombre:    string
  categoria: string
  unidades:  number
  monto:     number    // CRC
}

/**
 * Rendimiento por salonero.
 *
 * ⚠ TODO CABLEAR FASE B. En Fase A esto NO se muestra como dato: la pantalla lo renderiza
 * marcado como ejemplo. Depende de dos cosas que todavía no tenemos:
 *   1. que el PoS identifique al mesero por cuenta, y
 *   2. que ese identificador se pueda casar con `employees` (NUNCA por nombre — casar por
 *      nombre ya produjo drift real en BioTime; ver SPEC §9).
 *
 * FUENTE FUTURA:
 *   salonero    ← TBD · id del mesero en el PoS + TBD el puente hacia employees.id
 *   ventas      ← TBD · Σ de sus cuentas cerradas
 *   pax         ← TBD · Σ de comensales de esas cuentas (ver CalidadPax)
 *   ventaPorPax ← derivado
 */
export interface MetricaSalonero {
  salonero:    string
  ventas:      number    // CRC
  pax:         number
  ventaPorPax: number    // CRC
}

/**
 * ── EL INDICADOR DE FASE A ─────────────────────────────────────────────────────────────
 *
 * No mide ventas: mide si podemos CONFIAR en el pax. Existe porque `ventaPorPax` es la métrica
 * que más se mira y la que más fácil miente: si el salonero no carga los comensales, o los
 * carga en un campo que no es el nativo del PoS, el denominador queda mal y nadie lo nota.
 *
 * Antes de cablear nada de Fase B hay que saber qué tan cargado viene el dato. Por eso este
 * tipo entra ya en Fase A: es la medición previa a la decisión.
 *
 *   pctPaxNativoCargado  → de las mesas del salonero, qué % trae el pax en el campo NATIVO
 *                          del PoS. 100 = confiable; bajo = `ventaPorPax` no significa nada.
 *   matchArticuloVsNativo → cuando el pax también se carga como ARTÍCULO (un ítem "cubierto"
 *                          o similar), qué % de las mesas coincide con el campo nativo.
 *                          Un match bajo dice que las dos fuentes se contradicen.
 *
 * FUENTE FUTURA:
 *   salonero              ← TBD (mismo puente que MetricaSalonero)
 *   mesas                 ← TBD · conteo de cuentas del salonero
 *   pctPaxNativoCargado   ← TBD · requiere saber CUÁL es el campo nativo de comensales en `ndf`
 *   matchArticuloVsNativo ← TBD · requiere además identificar el/los artículos que hacen de pax
 */
export interface CalidadPax {
  salonero:              string
  mesas:                 number
  pctPaxNativoCargado:   number    // 0–100
  matchArticuloVsNativo: number    // 0–100
}

/**
 * La comparación contra el histórico. Se calcula sobre la venta ACUMULADA A LA MISMA HORA, no
 * contra el total del día cerrado: comparar las 19:00 de hoy contra un día entero diría que
 * siempre vamos mal.
 *
 * FUENTE FUTURA: los dos son Σ de días ya cerrados en nuestra propia base, no del PoS.
 */
export interface ComparativaHistorico {
  /** Mismo día de la semana, semana pasada, a esta misma hora. */
  mismoDiaSemanaPasada: number    // CRC
  /** Promedio de las últimas 4 semanas, mismo día de la semana, a esta misma hora. */
  promedio4Semanas:     number    // CRC
}

/**
 * Todo lo que la pantalla «Ventas en vivo» necesita, en un solo objeto. El proveedor —hoy el
 * mock, mañana la API real— devuelve esto y nada más: es la superficie que hay que cambiar
 * para pasar a datos reales.
 */
export interface SnapshotVentasEnVivo {
  local:       LocalId
  /** Instante en que se armó el snapshot. La pantalla lo muestra como «actualizado hace…». */
  generadoEn:  string    // ISO
  /**
   * `true` mientras el local está en servicio; `false` fuera de horario, cuando lo que se
   * muestra es el ÚLTIMO servicio cerrado y no un día en curso.
   *
   * Existe porque un dashboard «en vivo» abierto a las 3 de la mañana no puede mostrar un día
   * vacío como si fuera el de hoy: quien lo mira tiene que saber si está viendo algo que
   * todavía se mueve o una foto de anoche.
   */
  servicioEnCurso: boolean
  dia:         VentaDia
  porHora:     VentaPorHora[]
  porCategoria: VentaPorCategoria[]
  topProductos: TopProducto[]
  historico:   ComparativaHistorico
  /** ⚠ Fase B — hoy son datos de ejemplo, la pantalla los marca como tales. */
  saloneros:   MetricaSalonero[]
  /** ⚠ Fase B — ídem. */
  calidadPax:  CalidadPax[]
}

// ── Derivados ───────────────────────────────────────────────────────────────────
// Una sola fórmula por cifra. Si la pantalla dividiera por su cuenta, un cambio de criterio
// (¿el pax incluye niños? ¿el ticket promedio va con o sin servicio?) quedaría en dos lugares
// y los números empezarían a discrepar entre secciones.

/** Ticket promedio = venta / tickets. Sin tickets es `0`, no `NaN`: la pantalla muestra «—». */
export function ticketPromedioDe(venta: number, tickets: number): number {
  if (!tickets || tickets <= 0) return 0
  return Math.round(venta / tickets)
}

/** Venta por pax = venta / comensales. Mismo criterio con el cero. */
export function ventaPorPaxDe(venta: number, pax: number): number {
  if (!pax || pax <= 0) return 0
  return Math.round(venta / pax)
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
 * ¿Se puede confiar en `ventaPorPax`? Umbral de Fase A, deliberadamente exigente: por debajo
 * del 90 % de mesas con pax nativo cargado, el denominador tiene demasiados huecos y la
 * pantalla lo dice en vez de mostrar un número que parece preciso.
 */
export const UMBRAL_PAX_CONFIABLE = 90

export function paxEsConfiable(c: Pick<CalidadPax, 'pctPaxNativoCargado'>): boolean {
  return c.pctPaxNativoCargado >= UMBRAL_PAX_CONFIABLE
}
