// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Analítica PoS · EL PROVEEDOR MOCK (Fase A)                                             ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ESTE ES EL ÚNICO ARCHIVO QUE SE REEMPLAZA para pasar a datos reales.
//
// La pantalla llama `getSnapshotVentasEnVivo(local)` y no sabe de dónde sale. Cuando el
// pos-bridge esté cableado, esta función se convierte en una lectura de Supabase (o una RPC) y
// la UI no cambia una línea. Por eso todo lo de acá adentro es privado salvo esa función.
//
// ── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────────────────────
// Los números son INVENTADOS pero PLAUSIBLES: un sushi bar de playa en Santa Teresa, ticket
// promedio ~₡25.000, servicio de noche que arranca a las 17:00 y pica entre 19:00 y 21:00.
// Sirven para ver si la pantalla se lee bien, no para decidir nada.
//
// NO hay lógica de plata real acá: ni impuestos, ni 10% de servicio, ni propinas. Nada de esto
// toca `posFiscal`, `tipCalculations` ni `cashUtils`.

import type {
  CalidadPax, ComparativaHistorico, LocalId, MetricaSalonero, SnapshotVentasEnVivo,
  TopProducto, VentaDia, VentaPorCategoria, VentaPorHora,
} from './types'
import { ticketPromedioDe, ventaPorPaxDe } from './types'

// ── Aleatorio DETERMINISTA ──────────────────────────────────────────────────────
// Un `Math.random()` suelto haría que cada refresco de 30 s repinte todo el gráfico y la
// pantalla parezca rota. Con una semilla derivada del local y de la hora, el mismo día a la
// misma hora da SIEMPRE lo mismo: la pantalla se ve viva (avanza con el reloj) pero estable.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Ruido reproducible en [1-amplitud, 1+amplitud] a partir de una clave. */
function ruido(clave: string, amplitud: number): number {
  const n = (hash(clave) % 1000) / 1000          // [0,1)
  return 1 + (n - 0.5) * 2 * amplitud
}

// ── El reloj de Costa Rica ──────────────────────────────────────────────────────
// UTC−6 FIJO, sin horario de verano. Misma regla que el biotime-bridge y que la mig 059: si
// alguien mete una librería de zonas con DST, esto se rompe en agosto y nadie se entera.
const CR_OFFSET_MS = 6 * 3600_000

function ahoraCR(): Date {
  return new Date(Date.now() - CR_OFFSET_MS)
}

/** La fecha de hoy en Costa Rica, 'YYYY-MM-DD'. */
export function fechaHoyCR(): string {
  return ahoraCR().toISOString().slice(0, 10)
}

/** La hora de reloj de Costa Rica, 0–23. */
export function horaActualCR(): number {
  return ahoraCR().getUTCHours()
}

/**
 * ── LA JORNADA DE SERVICIO, NO EL DÍA CIVIL ────────────────────────────────────────────
 *
 * Entre la medianoche y la apertura no hay «día de hoy» que mostrar: el local está cerrado y
 * el servicio que interesa es el que acaba de terminar. Un dashboard en vivo abierto a las 3
 * de la mañana tiene que mostrar el cierre de anoche, no una pantalla en blanco.
 *
 * Es el mismo criterio del corte de jornada que ya usa Salarios (mig 059): la madrugada
 * pertenece al día que abrió, no al día civil que empezó a las 00:00.
 */
export function servicioEnCursoCR(): boolean {
  const h = horaActualCR()
  return h >= HORA_APERTURA && h <= HORA_CIERRE
}

/** La fecha del servicio que se está mostrando: hoy en servicio, ayer si ya cerró. */
export function fechaServicioCR(): string {
  const d = ahoraCR()
  if (!servicioEnCursoCR()) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** La hora hasta la que hay datos: la actual en servicio, el cierre completo si ya terminó. */
export function horaCorteCR(): number {
  return servicioEnCursoCR() ? horaActualCR() : HORA_CIERRE
}

// ── La forma del servicio ───────────────────────────────────────────────────────
// Peso relativo de cada hora sobre la venta del día. Un sushi bar de playa: cierra la cocina de
// mediodía, arranca fuerte a las 17:00 y pica entre 19:00 y 21:00. La suma no importa (se
// normaliza), importa la FORMA — es lo que hace que el gráfico se lea como un servicio real.
const CURVA_HORARIA: Record<number, number> = {
  11: 2, 12: 6, 13: 8, 14: 5, 15: 2, 16: 3,
  17: 7, 18: 11, 19: 16, 20: 17, 21: 12, 22: 7, 23: 3,
}

const HORA_APERTURA = 11
const HORA_CIERRE   = 23

/** Cuánto del día ya pasó, según la curva: 0 antes de abrir, 1 con el servicio terminado. */
function fraccionTranscurrida(hora: number): number {
  const total = Object.values(CURVA_HORARIA).reduce((s, v) => s + v, 0)
  let acum = 0
  for (const [h, peso] of Object.entries(CURVA_HORARIA)) {
    if (Number(h) <= hora) acum += peso
  }
  return total > 0 ? acum / total : 0
}

// Venta de un día completo, por local. Nosara es más chico.
const VENTA_DIA_COMPLETO: Record<LocalId, number> = {
  'santa-teresa': 1_850_000,
  'nosara':         980_000,
}

const TICKET_PROMEDIO_OBJETIVO: Record<LocalId, number> = {
  'santa-teresa': 26_000,
  'nosara':       23_000,
}

// ── Las piezas del snapshot ─────────────────────────────────────────────────────

function armarPorHora(local: LocalId, fecha: string, hora: number): VentaPorHora[] {
  const totalPesos = Object.values(CURVA_HORARIA).reduce((s, v) => s + v, 0)
  const ventaDia   = VENTA_DIA_COMPLETO[local]
  const ticketProm = TICKET_PROMEDIO_OBJETIVO[local]

  const out: VentaPorHora[] = []
  for (let h = HORA_APERTURA; h <= HORA_CIERRE; h++) {
    // Las horas que todavía no llegaron van en 0: el gráfico tiene que mostrar el día a
    // medias, no un día completo inventado.
    if (h > hora) { out.push({ hora: h, monto: 0, tickets: 0 }); continue }
    const peso  = CURVA_HORARIA[h] ?? 0
    const base  = (ventaDia * peso) / totalPesos
    const monto = Math.round(base * ruido(`${local}|${fecha}|h${h}`, 0.18))
    out.push({ hora: h, monto, tickets: Math.max(0, Math.round(monto / ticketProm)) })
  }
  return out
}

function armarPorCategoria(local: LocalId, fecha: string, ventaAcum: number): VentaPorCategoria[] {
  // Participación típica de un sushi bar. Los pesos se normalizan sobre la venta acumulada, así
  // que el mix siempre cierra en 100 % aunque el día vaya por la mitad.
  const base: { categoria: string; peso: number; precioUnit: number }[] = [
    { categoria: 'Sushi',       peso: 38, precioUnit:  9_500 },
    { categoria: 'Cocina',      peso: 24, precioUnit: 11_000 },
    { categoria: 'Bebidas',     peso: 16, precioUnit:  4_200 },
    { categoria: 'Cocteles',    peso: 12, precioUnit:  6_800 },
    { categoria: 'Entradas',    peso:  6, precioUnit:  5_500 },
    { categoria: 'Postres',     peso:  4, precioUnit:  4_800 },
  ]
  const totalPesos = base.reduce((s, c) => s + c.peso, 0)

  const filas = base.map(c => {
    const monto = Math.round((ventaAcum * c.peso / totalPesos) * ruido(`${local}|${fecha}|${c.categoria}`, 0.12))
    return {
      categoria: c.categoria,
      monto,
      unidades:  Math.max(0, Math.round(monto / c.precioUnit)),
      pctMix:    0,   // se completa abajo, sobre el total REAL de las filas
    }
  })

  // El % se calcula sobre la suma de las filas, no sobre `ventaAcum`: después del ruido los dos
  // números difieren, y un mix que no cierra en 100 se nota.
  const total = filas.reduce((s, f) => s + f.monto, 0)
  return filas
    .map(f => ({ ...f, pctMix: total > 0 ? (f.monto / total) * 100 : 0 }))
    .sort((a, b) => b.monto - a.monto)
}

function armarTopProductos(local: LocalId, fecha: string, ventaAcum: number): TopProducto[] {
  const base: { nombre: string; categoria: string; peso: number; precio: number }[] = [
    { nombre: 'Roll Satori',          categoria: 'Sushi',    peso: 100, precio: 11_500 },
    { nombre: 'Roll Tempura Camarón', categoria: 'Sushi',    peso:  86, precio: 12_000 },
    { nombre: 'Poke Bowl Atún',       categoria: 'Cocina',   peso:  74, precio: 13_500 },
    { nombre: 'Gyozas (6)',           categoria: 'Entradas', peso:  62, precio:  5_800 },
    { nombre: 'Imperial 350ml',       categoria: 'Bebidas',  peso:  58, precio:  3_200 },
    { nombre: 'Ramen Tonkotsu',       categoria: 'Cocina',   peso:  47, precio: 12_800 },
    { nombre: 'Margarita Maracuyá',   categoria: 'Cocteles', peso:  41, precio:  7_200 },
    { nombre: 'Sashimi Mixto',        categoria: 'Sushi',    peso:  35, precio: 14_000 },
  ]
  const totalPesos = base.reduce((s, p) => s + p.peso, 0)

  return base
    .map(p => {
      const monto    = Math.round((ventaAcum * 0.55 * p.peso / totalPesos) * ruido(`${local}|${fecha}|${p.nombre}`, 0.15))
      const unidades = Math.max(0, Math.round(monto / p.precio))
      return { nombre: p.nombre, categoria: p.categoria, unidades, monto }
    })
    .sort((a, b) => b.monto - a.monto)
}

// ── Fase B · datos de EJEMPLO ───────────────────────────────────────────────────
// Estos dos bloques existen para que la pantalla ya tenga su lugar y su forma, NO para que
// alguien los lea como información. La UI los marca visualmente; acá los nombres son genéricos
// a propósito (Salonero 1, 2, 3) para que nadie confunda un ejemplo con una persona real.

function armarSaloneros(local: LocalId, fecha: string, ventaAcum: number, paxTotal: number): MetricaSalonero[] {
  const pesos = [0.31, 0.27, 0.23, 0.19]
  return pesos.map((peso, i) => {
    const ventas = Math.round(ventaAcum * peso * ruido(`${local}|${fecha}|sal${i}`, 0.1))
    const pax    = Math.max(1, Math.round(paxTotal * peso))
    return {
      salonero:    `Salonero ${i + 1}`,
      ventas,
      pax,
      ventaPorPax: ventaPorPaxDe(ventas, pax),
    }
  })
}

function armarCalidadPax(local: LocalId, fecha: string): CalidadPax[] {
  // A propósito NO todos pasan el umbral: el indicador solo sirve si puede dar mal. Con todos
  // en verde nadie lo mira y no habríamos medido nada.
  const base = [
    { salonero: 'Salonero 1', mesas: 14, nativo: 96, match: 91 },
    { salonero: 'Salonero 2', mesas: 11, nativo: 72, match: 58 },
    { salonero: 'Salonero 3', mesas: 12, nativo: 89, match: 84 },
    { salonero: 'Salonero 4', mesas:  9, nativo: 41, match: 30 },
  ]
  return base.map(b => ({
    salonero:              b.salonero,
    mesas:                 b.mesas,
    pctPaxNativoCargado:   Math.min(100, Math.round(b.nativo * ruido(`${local}|${fecha}|${b.salonero}|nat`, 0.04))),
    matchArticuloVsNativo: Math.min(100, Math.round(b.match  * ruido(`${local}|${fecha}|${b.salonero}|mat`, 0.06))),
  }))
}

function armarHistorico(local: LocalId, fecha: string, ventaAcum: number): ComparativaHistorico {
  // La comparación es contra la venta acumulada A LA MISMA HORA, no contra el día cerrado.
  return {
    mismoDiaSemanaPasada: Math.round(ventaAcum * ruido(`${local}|${fecha}|sem`, 0.22)),
    promedio4Semanas:     Math.round(ventaAcum * ruido(`${local}|${fecha}|prom4`, 0.14)),
  }
}

// ── La única puerta de salida ───────────────────────────────────────────────────

/**
 * El snapshot completo de «Ventas en vivo» para un local.
 *
 * ⚠ CABLEAR EN FASE B: reemplazar el cuerpo por la lectura real (Supabase / RPC). La FIRMA se
 * mantiene — es lo que hace que la pantalla no se entere del cambio. Por eso es `async` aunque
 * hoy no espere nada: si fuera síncrona, cablearla obligaría a tocar el componente.
 */
export async function getSnapshotVentasEnVivo(local: LocalId): Promise<SnapshotVentasEnVivo> {
  // Fuera de horario esto devuelve la jornada de AYER, completa. Ver `fechaServicioCR`.
  const fecha    = fechaServicioCR()
  const hora     = horaCorteCR()
  const enCurso  = servicioEnCursoCR()

  const porHora   = armarPorHora(local, fecha, hora)
  const ventaAcum = porHora.reduce((s, h) => s + h.monto, 0)
  const tickets   = porHora.reduce((s, h) => s + h.tickets, 0)

  // ~2,4 comensales por ticket, con ruido. El pax NO se deriva de la venta a propósito: en el
  // PoS real son dos datos independientes, y justamente por eso `CalidadPax` tiene sentido.
  const pax = Math.max(0, Math.round(tickets * 2.4 * ruido(`${local}|${fecha}|pax`, 0.08)))

  // La proyección es NUESTRA, no del PoS: lo que falta del día según la curva. Antes de abrir
  // (fracción 0) no se proyecta nada — dividir por cero daría un número absurdo en pantalla.
  const transcurrido = fraccionTranscurrida(hora)
  const proyeccion   = transcurrido > 0.02 ? Math.round(ventaAcum / transcurrido) : 0

  const dia: VentaDia = {
    fecha,
    local,
    ventaAcumulada:   ventaAcum,
    tickets,
    ticketPromedio:   ticketPromedioDe(ventaAcum, tickets),
    pax,
    ventaPorPax:      ventaPorPaxDe(ventaAcum, pax),
    proyeccionCierre: proyeccion,
  }

  return {
    local,
    generadoEn:      new Date().toISOString(),
    servicioEnCurso: enCurso,
    dia,
    porHora,
    porCategoria: armarPorCategoria(local, fecha, ventaAcum),
    topProductos: armarTopProductos(local, fecha, ventaAcum),
    historico:    armarHistorico(local, fecha, ventaAcum),
    saloneros:    armarSaloneros(local, fecha, ventaAcum, pax),
    calidadPax:   armarCalidadPax(local, fecha),
  }
}

/** Cada cuánto la pantalla vuelve a pedir el snapshot. 30 s: «siempre actualizado» sin ruido. */
export const REFRESH_MS = 30_000
