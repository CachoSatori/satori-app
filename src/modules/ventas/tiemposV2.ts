// ── Ventas v2 · «Tiempos» (SPEC-ventas-v2 §5.4, fase 2.3) — el cálculo, PURO ───────────────────
//
// Sin I/O ni reloj. Recibe la misma `Lectura` que el Resumen (función de la 190, o la 067 de
// respaldo) y, para el turno, las filas de la 080 (`pos_prompax_agregado`). Las fechas salen de
// `periodos.ts`: acá no se calcula ninguna fecha a mano.
//
// ── QUÉ NÚMERO ES CADA COSA ────────────────────────────────────────────────────────────────
// · Venta neta, días y personas (PAX): los de Contabilidad (`cifrasDelRango` → `getDayStats`, un
//   redondeo por día; el total de un grupo de días = la SUMA de esos días, #288). El día es el día
//   CR de la FACTURA. Por construcción, Σ de los días de semana = la venta del período, y cada
//   quincena = Contabilidad para esas fechas (lo cuidan las pruebas).
// · Venta por persona: LA de `indicadores.ts` (D4): día y turno por la SESIÓN DE CAJA.
// · Turno (mediodía / noche): por la HORA CR de la factura (06–16 mediodía · 17–05 noche, la franja
//   de la 080), no por la caja (§5.4, «trampa conocida»). Para que el turno cuadre con la venta del
//   día: mediodía = la parte de mediodía de la 080 redondeada; noche = la venta del día − mediodía.
//   Si la 080 y Contabilidad difieren en más de ₡1 un día, se avisa (no se tapa).
// · Mapa de calor día × hora: SOLO SALÓN. La 190 trae la hora de cada factura de salón, pero no la
//   de barra, delivery ni llevar (habría que bajar todas las facturas y líneas). Se rotula así.

import type { FilaPromPaxRpc } from '../../shared/api/posNdf'
import type { ContabilidadDay } from '../../shared/types/ventas'
import { diaCRDeFactura, esFacturaDeSalon, estimadorPorNeta, horaCRDeFactura, franjaDeHora,
  ubicarFacturas, ventaPorPersona, type EstimadorPersonas, type FacturaIndicador, type VentaPorPersona } from './indicadores'
import { calcularPeriodo, diaSemana, periodoAnterior, type BaseId, type PeriodoV2, type Rango } from './periodos'
import { cambioPct, cifrasDelRango, type CifrasRango, type Lectura } from './resumenV2'
import { turnoDeFranja, type TurnoPromPax } from './ventasPromPaxExplicado'

/** Lunes a domingo (D10: semana ISO). Índice 0 = lunes, como `diaSemana`. */
export const DIAS_SEMANA_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const

/** Cuántas quincenas muestra la tabla (§5.4, ítem 3). */
export const QUINCENAS_EN_TABLA = 12

// ── Lo que hay que leer ─────────────────────────────────────────────────────────────────────

/**
 * Las últimas `n` quincenas que terminan en la del último día del período, la más nueva primero.
 * La más nueva puede estar en curso («a la fecha», hasta ayer).
 */
export function ultimasQuincenas(p: PeriodoV2, n = QUINCENAS_EN_TABLA, primerDiaConDatos?: string): PeriodoV2[] {
  const out: PeriodoV2[] = [calcularPeriodo({ tipo: 'quincena', dia: p.hasta, ancla: p.ancla, primerDiaConDatos })]
  while (out.length < n) {
    const q = periodoAnterior(out[out.length - 1], primerDiaConDatos)
    if (q.hasta < (primerDiaConDatos ?? '2024-01-05')) break
    out.push(q)
  }
  return out
}

/** Todos los rangos que «Tiempos» necesita: el período, sus dos bases, y cada quincena con las suyas. */
export function rangosDeTiempos(p: PeriodoV2, baseA: BaseId, baseB: BaseId, quincenas: readonly PeriodoV2[]): Rango[] {
  const out: Rango[] = []
  const poner = (r: Rango | null | undefined) => { if (r) out.push({ desde: r.desde, hasta: r.hasta }) }
  for (const x of [p, ...quincenas]) {
    poner(x)
    poner(x.bases[baseA])
    poner(x.bases[baseB])
  }
  return out
}

// ── 1. Día de semana ────────────────────────────────────────────────────────────────────────

export interface FilaDiaSemana {
  /** 0 = lunes … 6 = domingo. */
  dow:          number
  nombre:       string
  diasAbiertos: number
  /** Σ de la venta neta de esos días (cada uno como en Contabilidad). */
  neta:         number
  /** Neta ÷ días abiertos de ese día de semana. `null` si no abrió ninguno. */
  promedio:     number | null
  /** 100 = día promedio del período (neta ÷ días abiertos). `null` sin datos. */
  indice:       number | null
  personas:     number
}

/** Una fila por día de semana, lunes a domingo, desde los días de Contabilidad del rango. */
export function porDiaSemana(dias: readonly ContabilidadDay[]): FilaDiaSemana[] {
  const filas = DIAS_SEMANA_LARGO.map((nombre, dow) => ({ dow, nombre, diasAbiertos: 0, neta: 0, personas: 0 }))
  let netaTot = 0, abiertosTot = 0
  for (const d of dias) {
    const f = filas[diaSemana(d.fecha)]
    f.neta += d.ventaNeta
    f.personas += d.pax
    if (d.ventaNeta > 0) { f.diasAbiertos += 1; abiertosTot += 1 }
    netaTot += d.ventaNeta
  }
  const promTot = abiertosTot > 0 ? netaTot / abiertosTot : null
  return filas.map(f => {
    const promedio = f.diasAbiertos > 0 ? f.neta / f.diasAbiertos : null
    return { ...f, promedio, indice: promedio !== null && promTot ? (promedio / promTot) * 100 : null }
  })
}

/**
 * La venta por persona (D4) de cada día de semana. El día de semana es el de la JORNADA de la caja
 * (la misma ubicación que usa `ventaPorPersona`), así una mesa de las 00:30 de la caja de la noche
 * cuenta en el día anterior.
 */
export function vppPorDiaSemana(l: Lectura, r: Rango, estimador: EstimadorPersonas = estimadorPorNeta(l.facturas)): VentaPorPersona[] {
  const ub = ubicarFacturas(l.facturas)
  return DIAS_SEMANA_LARGO.map((_, dow) => ventaPorPersona(l.facturas, r, {
    estimador, filtro: f => { const u = ub.get(f); return !!u && diaSemana(u.dia) === dow },
  }))
}

// ── 2. Hora y turno ─────────────────────────────────────────────────────────────────────────

/** Orden de las horas en el mapa: el día del restaurante arranca a las 06:00 y la madrugada va al final. */
export const ordenHora = (h: number): number => (h + 24 - 6) % 24

export interface MapaHoras {
  /** Horas CR con venta de salón en el rango, en orden del día del restaurante. */
  horas:  number[]
  /** [día de semana][hora] → neta de salón promedio por día abierto de ese día de semana. */
  celdas: number[][]
  /** Σ neta de salón del rango (por día CR de la factura). */
  totalSalon: number
  /** El máximo de `celdas` (para la escala de color). */
  max:    number
}

/**
 * Mapa de calor día de semana × hora CR de la factura, SOLO SALÓN (lo que trae la 190). La celda es
 * un promedio por día abierto (`abiertos[dow]`, de `porDiaSemana`), así los días que se repiten más
 * en el período no pesan más.
 */
export function mapaHoras(facturas: readonly FacturaIndicador[], r: Rango, abiertos: readonly number[]): MapaHoras {
  const suma = DIAS_SEMANA_LARGO.map(() => new Array<number>(24).fill(0))
  const usadas = new Set<number>()
  let totalSalon = 0
  for (const f of facturas) {
    if (!esFacturaDeSalon(f)) continue
    const dia = diaCRDeFactura(f.fecha_registra)
    if (!dia || dia < r.desde || dia > r.hasta) continue
    const h = horaCRDeFactura(f.fecha_registra)
    if (h < 0) continue
    const neta = Number(f.neta) || 0
    suma[diaSemana(dia)][h] += neta
    totalSalon += neta
    if (neta !== 0) usadas.add(h)
  }
  const celdas = suma.map((fila, dow) => fila.map(v => (abiertos[dow] > 0 ? v / abiertos[dow] : 0)))
  const horas = [...usadas].sort((a, b) => ordenHora(a) - ordenHora(b))
  const max = Math.max(0, ...celdas.flatMap(fila => horas.map(h => fila[h])))
  return { horas, celdas, totalSalon, max }
}

export interface FilaTurno {
  turno:  TurnoPromPax
  /** Venta neta del turno (por la hora de la factura), cuadrada con la venta del día. */
  neta:   number
  /** % de la venta del período. */
  pct:    number
  /** Venta por persona D4 del turno de CAJA (no del reloj): es la del indicador. */
  vpp:    VentaPorPersona
}

export interface Turnos {
  filas:      FilaTurno[]
  /** Días donde la 080 y Contabilidad difieren en más de ₡1 (no debería pasar: misma regla). */
  descuadres: string[]
}

/**
 * Venta por turno: mediodía (06–16) y noche (17–05) por la hora CR de la factura (franja de la 080).
 * Cuadra por día: mediodía = round(neta 080 de mediodía); noche = venta del día (Contabilidad) −
 * mediodía. Así mediodía + noche = la venta del período, al colón.
 */
export function porTurno(
  dias: readonly ContabilidadDay[],
  filas080: readonly FilaPromPaxRpc[],
  vpp: Record<TurnoPromPax, VentaPorPersona>,
): Turnos {
  const porDia = new Map<string, { m: number; t: number }>()
  for (const f of filas080) {
    const e = porDia.get(f.dia) ?? { m: 0, t: 0 }
    const neta = Number(f.neta) || 0
    if (turnoDeFranja(f.franja) === 'mañana') e.m += neta
    e.t += neta
    porDia.set(f.dia, e)
  }
  let man = 0, noche = 0
  const descuadres: string[] = []
  for (const d of dias) {
    const e = porDia.get(d.fecha) ?? { m: 0, t: 0 }
    if (Math.abs(e.t - d.ventaNeta) > 1) descuadres.push(d.fecha)
    const m = Math.min(Math.max(Math.round(e.m), 0), Math.max(d.ventaNeta, 0))
    man += m
    noche += d.ventaNeta - m
  }
  const tot = man + noche
  const pct = (x: number) => (tot > 0 ? (x / tot) * 100 : 0)
  return {
    filas: [
      { turno: 'mañana', neta: man, pct: pct(man), vpp: vpp['mañana'] },
      { turno: 'noche', neta: noche, pct: pct(noche), vpp: vpp.noche },
    ],
    descuadres,
  }
}

/** El turno de la franja de una hora (para rotular el mapa). */
export const turnoDeHora = (h: number): TurnoPromPax => turnoDeFranja(franjaDeHora(h))

// ── 3. Quincenas ────────────────────────────────────────────────────────────────────────────

export interface FilaQuincena {
  q:        PeriodoV2
  cifras:   CifrasRango
  A:        CifrasRango | null
  B:        CifrasRango | null
  /** Cambio de la venta neta contra A y B (`null` = sin comparación). */
  cambioA:  number | null
  cambioB:  number | null
  /** Cambio de la venta por día abierto (la 2.ª quincena tiene 13 a 16 días). */
  cambioDiaA: number | null
  cambioDiaB: number | null
}

export function filasQuincenas(l: Lectura, quincenas: readonly PeriodoV2[], baseA: BaseId, baseB: BaseId): FilaQuincena[] {
  return quincenas.map(q => {
    const cifras = cifrasDelRango(l, q)
    const ra = q.bases[baseA], rb = q.bases[baseB]
    const A = ra ? cifrasDelRango(l, ra) : null
    const B = rb ? cifrasDelRango(l, rb) : null
    return {
      q, cifras, A, B,
      cambioA: A ? cambioPct(cifras.totales.ventaNeta, A.totales.ventaNeta) : null,
      cambioB: B ? cambioPct(cifras.totales.ventaNeta, B.totales.ventaNeta) : null,
      cambioDiaA: A ? cambioPct(cifras.ventaPorDiaAbierto, A.ventaPorDiaAbierto) : null,
      cambioDiaB: B ? cambioPct(cifras.ventaPorDiaAbierto, B.ventaPorDiaAbierto) : null,
    }
  })
}

/** «1.ª quincena de noviembre» / «2.ª quincena de octubre de 2025». */
export function nombreQuincena(q: Pick<PeriodoV2, 'natural' | 'ancla'>): string {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
    'octubre', 'noviembre', 'diciembre']
  const [a, m, d] = q.natural.desde.split('-').map(Number)
  const anio = a === Number(q.ancla.slice(0, 4)) ? '' : ` de ${a}`
  return `${d === 1 ? '1.ª' : '2.ª'} quincena de ${MESES[m - 1]}${anio}`
}

// ── 5. Calendario ───────────────────────────────────────────────────────────────────────────

export interface MesCalendario {
  /** `YYYY-MM`. */
  mes:     string
  /** Semanas de lunes a domingo; `null` = día fuera del mes o fuera del período. */
  semanas: (ContabilidadDay | { fecha: string; vacio: true } | null)[][]
}

export interface Calendario {
  meses: MesCalendario[]
  mejor: ContabilidadDay | null
  peor:  ContabilidadDay | null
  max:   number
}

/**
 * Los días del rango en grilla de meses (lunes a domingo). Mejor y peor día: entre los días
 * ABIERTOS (venta > 0). Cada celda es la fila de Contabilidad de ese día.
 */
export function calendario(dias: readonly ContabilidadDay[], r: Rango): Calendario {
  const porFecha = new Map(dias.map(d => [d.fecha, d]))
  const meses: MesCalendario[] = []
  let ym = r.desde.slice(0, 7)
  while (ym <= r.hasta.slice(0, 7)) {
    const [a, m] = ym.split('-').map(Number)
    const fin = new Date(Date.UTC(a, m, 0)).getUTCDate()
    const semanas: MesCalendario['semanas'] = []
    let semana: MesCalendario['semanas'][number] = new Array(diaSemana(`${ym}-01`)).fill(null)
    for (let d = 1; d <= fin; d++) {
      const fecha = `${ym}-${String(d).padStart(2, '0')}`
      semana.push(fecha < r.desde || fecha > r.hasta ? null : (porFecha.get(fecha) ?? { fecha, vacio: true }))
      if (semana.length === 7) { semanas.push(semana); semana = [] }
    }
    if (semana.length) semanas.push([...semana, ...new Array(7 - semana.length).fill(null)])
    meses.push({ mes: ym, semanas })
    ym = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
  }
  const abiertos = dias.filter(d => d.ventaNeta > 0 && d.fecha >= r.desde && d.fecha <= r.hasta)
  const mejor = abiertos.reduce<ContabilidadDay | null>((x, d) => (!x || d.ventaNeta > x.ventaNeta ? d : x), null)
  const peor = abiertos.reduce<ContabilidadDay | null>((x, d) => (!x || d.ventaNeta < x.ventaNeta ? d : x), null)
  return { meses, mejor, peor, max: mejor?.ventaNeta ?? 0 }
}
