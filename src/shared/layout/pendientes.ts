// «Para hacer hoy» del Inicio (rediseño B4) — SOLO LECTURA y sin cálculos de plata.
//
// Reúne en una lista las mismas señales que antes iban como estado debajo de las tarjetas del Inicio
// (turnos abiertos hace mucho, movimientos por revisar, stock, lunes de revisión…), más los días sin
// cierre de `diasSinCierre` (la misma alerta que ve Caja). Cada pendiente lleva al módulo donde se
// resuelve, y solo sale si el rol ve ese módulo en su grilla.

export type Tono = 'malo' | 'pendiente'

export interface Pendiente {
  /** Clave estable (para React y los tests). */
  id:      string
  /** Módulo de la grilla donde se resuelve (`modulos.ts`). */
  modulo:  string
  path:    string
  /** Qué hay que hacer, en lenguaje de restaurante. */
  texto:   string
  /** Texto corto de la píldora de estado. */
  estado:  string
  tono:    Tono
}

/** Las señales que ya trae el Inicio. `null` = no se cargó (o el rol no la ve): no se muestra. */
export interface SenalesInicio {
  cashOpen:       boolean
  cashOpenHours:  number
  tipOpen:        boolean
  tipOpenHours:   number
  pendingCount:   number
  invOutStock:    number
  invLowStock:    number
  sopsCount:      number
  esLunes:        boolean
  /** Días anteriores sin cierre completo (`calcularAlertaCierres().dias`). */
  diasSinCierre:  number | null
  /** Turnos de Caja de días anteriores que siguen abiertos (`calcularAlertaCierres().turnos`). */
  turnosViejos:   number | null
}

/** Desde cuántas horas un turno abierto se marca (el mismo umbral que tenían las tarjetas). */
export const HORAS_TURNO_LARGO = 20

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function calcularPendientes(s: SenalesInicio, modulosVisibles: ReadonlySet<string>): Pendiente[] {
  const out: Pendiente[] = []
  const add = (p: Pendiente) => { if (modulosVisibles.has(p.modulo)) out.push(p) }

  // ── Caja ──
  if (s.diasSinCierre && s.diasSinCierre > 0) {
    add({ id: 'dias-sin-cierre', modulo: 'cash', path: '/caja', tono: 'malo',
      texto: 'Cerrar los días que quedaron sin cierre',
      estado: plural(s.diasSinCierre, 'día sin cierre', 'días sin cierre') })
  }
  if (s.turnosViejos && s.turnosViejos > 0) {
    add({ id: 'turnos-viejos', modulo: 'cash', path: '/caja', tono: 'malo',
      texto: 'Cerrar el turno de Caja que quedó abierto de otro día',
      estado: plural(s.turnosViejos, 'turno abierto', 'turnos abiertos') })
  } else if (s.cashOpen && s.cashOpenHours >= HORAS_TURNO_LARGO) {
    add({ id: 'caja-larga', modulo: 'cash', path: '/caja', tono: 'malo',
      texto: 'Revisar el turno de Caja abierto',
      estado: `Abierta ${s.cashOpenHours} h` })
  }
  if (s.pendingCount > 0) {
    add({ id: 'movimientos', modulo: 'cash', path: '/caja', tono: 'pendiente',
      texto: 'Revisar los movimientos de Caja pendientes',
      estado: `${s.pendingCount} por revisar` })
  }

  // ── Propinas ──
  if (s.tipOpen && s.tipOpenHours >= HORAS_TURNO_LARGO) {
    add({ id: 'propinas-larga', modulo: 'tips', path: '/propinas', tono: 'malo',
      texto: 'Cerrar el turno de Propinas abierto',
      estado: `Abierto ${s.tipOpenHours} h` })
  }

  // ── Inventario ──
  if (s.invOutStock > 0) {
    add({ id: 'sin-stock', modulo: 'inventario', path: '/inventario', tono: 'malo',
      texto: 'Reponer lo que se quedó sin stock',
      estado: `${s.invOutStock} sin stock` })
  }
  if (s.invLowStock > 0) {
    add({ id: 'stock-bajo', modulo: 'inventario', path: '/inventario', tono: 'pendiente',
      texto: 'Pedir lo que tiene stock bajo',
      estado: `${s.invLowStock} stock bajo` })
  }

  // ── Semana (los lunes) ──
  if (s.esLunes) {
    add({ id: 'semana', modulo: 'semana', path: '/semana', tono: 'pendiente',
      texto: 'Revisar la semana que pasó', estado: 'Lunes' })
  }

  // ── Procedimientos vacíos ──
  if (s.sopsCount === 0) {
    add({ id: 'sops-vacios', modulo: 'sops', path: '/sops', tono: 'pendiente',
      texto: 'Cargar los procedimientos', estado: 'sin contenido' })
  }

  // Lo malo primero; dentro de cada tono, el orden de arriba.
  return [...out.filter(p => p.tono === 'malo'), ...out.filter(p => p.tono === 'pendiente')]
}

/** La frase de arriba del Inicio: la conclusión en una línea. */
export function fraseEstado(pendientes: readonly Pendiente[]): string {
  const malos = pendientes.filter(p => p.tono === 'malo').length
  if (malos > 0) return malos === 1 ? 'Hay una cosa para resolver hoy.' : `Hay ${malos} cosas para resolver hoy.`
  if (pendientes.length > 0) return pendientes.length === 1 ? 'Queda un pendiente para hoy.' : `Quedan ${pendientes.length} pendientes para hoy.`
  return 'Todo en orden.'
}
