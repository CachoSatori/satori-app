// ── Ventas v2 · «Tiempos» → «Meses y temporadas» (SPEC-ventas-v2 §5.4 ítem 4, PR 3.5.3) — PURO ─────────────────
//
// El año contra los anteriores, por año, mes por mes y por trimestre, con lo que está en curso A LA FECHA (hasta
// ayer, D2) y la base cortada a los mismos días. Es lo que mostraba «Análisis» → «Año vs Año» (retirada en el
// 3.5.3), con las MISMAS cuentas: las funciones de `aLaFecha.ts` que usaba aquella pantalla (`totalesEnRango`,
// `alineadoAlCorte`, `variacion`), sin una fecha calculada acá. Lo que cambia es solo cómo se rotula: cada % dice
// qué año contra cuál y con qué fechas (§12.5, criterio 5; antes la columna decía «vs 2026» sobre el cambio de
// 2026 contra 2025).
//
// ── DE DÓNDE SALEN LOS DÍAS ───────────────────────────────────────────────────────────────────
// · Desde el corte del PoS (`CORTE_HIST` = `CORTE_POS`, 5-ene-2024): los días de Contabilidad de la función de la 190, los mismos
//   del resto de «Tiempos» y de «Resumen» (`cifrasDelRango`).
// · Antes del corte (2023 y 1–4 ene 2024): `ventas_hist`, el resumen diario viejo, como lo armaba
//   `getContabilidadDays` para «Análisis». Un día viene de una sola fuente (`combinarHist`).

import type { ContabilidadDay, HistMap } from '../../shared/types/ventas'
import {
  alineadoAlCorte, enCurso, hastaN, rangoAnioNatural, rangoMesNatural, rangoTrimestreNatural, totalesEnRango, variacion,
  type Corte, type Rango, type Totales,
} from './aLaFecha'
import { fechasCortas, PRIMER_DIA_CON_DATOS } from './periodos'

/**
 * El corte entre el histórico viejo y el PoS: el primer día del PoS. Es `CORTE_POS` de `ventasFuente.ts` (el mismo
 * 5-ene-2024); se toma de `periodos.ts` para que este módulo siga sin I/O (lo cuida `mesesTemporadas.test.ts`).
 */
export const CORTE_HIST = PRIMER_DIA_CON_DATOS

/** Un año en una celda: lo que se sumó (`null` = sin días cerrados) y sus totales. */
export interface ValorAnio {
  anio:  number
  rango: Rango | null
  t:     Totales
}

/** El cambio de un año contra otro, con las fechas de cada lado (para rotularlo). */
export interface CambioAnio {
  anio:        number
  contra:      number
  /** % de la venta neta. `null` = sin comparación (un lado sin datos, o año en curso contra uno completo). */
  pct:         number | null
  rango:       Rango | null
  rangoContra: Rango | null
}

export interface TarjetaAnio extends ValorAnio {
  /** El año de ayer y todavía no terminó: va «a la fecha». */
  vivo:   boolean
  /** Contra el año anterior de la lista (alineado a la misma fecha si este va a la fecha). `null` = el más viejo. */
  cambio: CambioAnio | null
}

export interface FilaMes {
  /** 1–12. */
  mes:     number
  /** El mes de ayer y todavía no terminó: cada año se suma del 1 al día de ayer. */
  vivo:    boolean
  /** Las fechas del mes en curso (1 → ayer); `null` si el mes no está en curso. */
  rangoVivo: Rango | null
  /** Un valor por año, en el orden de `anios` (el más nuevo primero). */
  valores: ValorAnio[]
  /** Cada año contra el que le sigue en la lista (el anterior): `anios[i]` contra `anios[i + 1]`. */
  cambios: CambioAnio[]
}

export interface FilaTotal {
  valores: ValorAnio[]
  cambios: CambioAnio[]
}

export interface Trimestre {
  q:       1 | 2 | 3 | 4
  vivo:    boolean
  valores: ValorAnio[]
  /** Uno por año: contra el año anterior; `null` para el más viejo. */
  cambios: (CambioAnio | null)[]
}

export interface MesesTemporadas {
  corte:      Corte
  /** Años con datos, el más nuevo primero. */
  anios:      number[]
  /** El año de ayer sigue (no es 31-dic). */
  anioVivo:   boolean
  /** 1-ene → ayer del año en curso. */
  rangoYTD:   Rango | null
  tarjetas:   TarjetaAnio[]
  /** Solo los meses con algún día en algún año. */
  meses:      FilaMes[]
  /** Fila «A LA FECHA»: cada año del 1-ene a la misma fecha. `null` si el año no está en curso. */
  aLaFecha:   FilaTotal | null
  /** Fila «AÑO COMPLETO» (o «TOTAL»): el año en curso no se compara contra uno completo. */
  completo:   FilaTotal
  trimestres: Trimestre[]
}

/**
 * Los días que suma la sección: `ventas_hist` ANTES del corte del PoS (2023) y los del PoS DESDE el corte. Un día
 * viene de una sola fuente; ninguno después de `hasta` (ayer). Ordenados por fecha.
 */
export function diasDeAnios(
  hist: HistMap,
  pos: readonly ContabilidadDay[],
  hasta: string,
  corte: string = CORTE_HIST,
): ContabilidadDay[] {
  const out: ContabilidadDay[] = []
  for (const [fecha, h] of Object.entries(hist)) {
    if (fecha >= corte || fecha > hasta) continue
    // Igual que `getContabilidadDays` con un día del histórico viejo.
    out.push({
      fecha, ventaBruta: h.ventaBruta, ventaNeta: h.ventaNeta, iva: h.iva, serv: h.serv,
      salon: h.salon, delivery: h.delivery, pax: h.pax, promPax: h.promPax,
    })
  }
  for (const d of pos) if (d.fecha >= corte && d.fecha <= hasta) out.push(d)
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Los años que tienen algún día, el más nuevo primero (como `availableYears`). */
export function aniosConDatos(dias: readonly ContabilidadDay[]): number[] {
  return [...new Set(dias.map(d => Number(d.fecha.slice(0, 4))))].sort((a, b) => b - a)
}

/** Todo «Meses y temporadas» para el corte `c` (ayer en CR). */
export function mesesTemporadas(dias: readonly ContabilidadDay[], c: Corte): MesesTemporadas {
  const anios = aniosConDatos(dias)
  const valor = (anio: number, r: Rango | null): ValorAnio => ({ anio, rango: r, t: totalesEnRango(dias, r) })
  /** El contenedor del año `y`, alineado al corte si el mismo contenedor del año en curso no terminó. */
  const al = (nat: Rango, vivo: boolean) => alineadoAlCorte(nat, vivo, c)
  const cambio = (a: ValorAnio, b: ValorAnio, sinComparar = false): CambioAnio => ({
    anio: a.anio, contra: b.anio, pct: sinComparar ? null : variacion(a.t, b.t), rango: a.rango, rangoContra: b.rango,
  })
  const pares = (vs: ValorAnio[], sinComparar: (a: ValorAnio, b: ValorAnio) => boolean = () => false) =>
    vs.slice(0, -1).map((v, i) => cambio(v, vs[i + 1], sinComparar(v, vs[i + 1])))

  const anioVivo = enCurso(rangoAnioNatural(c.anio), c)

  const tarjetas: TarjetaAnio[] = anios.map((y, i) => {
    const vivo = y === c.anio && anioVivo
    const v = valor(y, al(rangoAnioNatural(y), false))
    const prevY = anios[i + 1]
    const prev = prevY === undefined ? null : valor(prevY, al(rangoAnioNatural(prevY), vivo))
    return { ...v, vivo, cambio: prev ? cambio(v, prev) : null }
  })

  const meses: FilaMes[] = []
  for (let m = 1; m <= 12; m++) {
    const vivo = enCurso(rangoMesNatural(c.anio, m), c)
    const valores = anios.map(y => valor(y, al(rangoMesNatural(y, m), vivo)))
    if (!valores.some(v => v.t.dias > 0)) continue
    meses.push({ mes: m, vivo, rangoVivo: vivo ? hastaN(rangoMesNatural(c.anio, m), c) : null, valores, cambios: pares(valores) })
  }

  const fila = (vivo: boolean, sinComparar?: (a: ValorAnio, b: ValorAnio) => boolean): FilaTotal => {
    const valores = anios.map(y => valor(y, al(rangoAnioNatural(y), vivo)))
    return { valores, cambios: pares(valores, sinComparar) }
  }
  const aLaFecha = anioVivo ? fila(true) : null
  // Un año en curso no se compara contra uno completo: eso va en la fila «a la fecha».
  const completo = fila(false, (a, b) => anioVivo && (a.anio === c.anio || b.anio === c.anio))

  const trimestres: Trimestre[] = ([1, 2, 3, 4] as const).map(q => {
    const vivo = enCurso(rangoTrimestreNatural(c.anio, q), c)
    const valores = anios.map(y => valor(y, al(rangoTrimestreNatural(y, q), vivo)))
    return { q, vivo, valores, cambios: valores.map((v, i) => (i < valores.length - 1 ? cambio(v, valores[i + 1]) : null)) }
  })

  return { corte: c, anios, anioVivo, rangoYTD: hastaN(rangoAnioNatural(c.anio), c), tarjetas, meses, aLaFecha, completo, trimestres }
}

/** Las fechas de un lado del cambio, siempre con el año: «1–17 nov 2025», «1 ene 2025 – 17 nov 2025». */
export const fechasConAnio = (r: Rango | null): string => (r ? fechasCortas(r, 0) : 'sin días')

/**
 * El rótulo completo de un cambio: «2026 contra 2025: 1 ene – 17 nov 2026 contra 1 ene – 17 nov 2025». Es lo que
 * nombra la base y sus fechas al lado de cada % (§12.5, criterio 5).
 */
export const rotuloCambio = (x: CambioAnio): string =>
  `${x.anio} contra ${x.contra}: ${fechasConAnio(x.rango)} contra ${fechasConAnio(x.rangoContra)}`
