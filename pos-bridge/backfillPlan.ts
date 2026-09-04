// ── pos-bridge · el plan del backfill (A4) ─────────────────────────────────────
//
// PURO: parsea los argumentos y decide QUÉ días barrer y en qué orden. No lee el
// PoS, no manda nada, no mira el reloj salvo cuando se lo pasan. Así el barrido se
// prueba entero sin base de datos.

import { assertFecha } from './consulta.ts'

export type Orden = 'reciente-primero' | 'viejo-primero'

export interface ArgsBackfill {
  /** `null` en modo `--todo`: lo descubre el PoS (`min(FechaRegistra)`). */
  desde:   string | null
  /** `null` en modo `--todo`: hasta AYER (hoy no, que todavía se está facturando). */
  hasta:   string | null
  todo:    boolean
  dryRun:  boolean
  orden:   Orden
  /** Pausa entre días, para no machacar el SQL Server del local. */
  pausaMs: number
}

export const PAUSA_POR_DEFECTO = 500
export const PAUSA_MIN = 0
export const PAUSA_MAX = 10_000

export const USO = `Uso: npm run pos:backfill -- --desde YYYY-MM-DD --hasta YYYY-MM-DD [opciones]
     npm run pos:backfill -- --todo [opciones]

Trae el histórico de ventas CERRADAS del PoS a pos_ndf_tickets / pos_ndf_ticket_lines
de STAGING, día por día, agrupando el log por mes. Corre EN PARALELO con el agente en
vivo: no le toca el cursor ni las mesas abiertas.

Opciones:
  --desde YYYY-MM-DD   primer día del rango (inclusive)
  --hasta YYYY-MM-DD   último día del rango (inclusive)
  --todo               desde la venta más vieja del PoS hasta ayer
  --dry-run            lee y cuenta, NO envía nada
  --orden asc          del más viejo al más reciente (por defecto: al revés)
  --pausa-ms N         pausa entre días (default ${PAUSA_POR_DEFECTO}; 300–800 es lo sano)
  -h, --help           esta ayuda`

/** Parseo de argumentos. Puro, para poder probarlo. */
export function parsearArgs(argv: string[]): ArgsBackfill {
  let desde: string | null = null
  let hasta: string | null = null
  let todo = false
  let dryRun = false
  let orden: Orden = 'reciente-primero'
  let pausaMs = PAUSA_POR_DEFECTO
  const libres: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const valor = (): string => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} necesita un valor.\n\n${USO}`)
      return v
    }
    switch (a) {
      case '--desde':    desde = assertFecha(valor()); break
      case '--hasta':    hasta = assertFecha(valor()); break
      case '--todo':     todo = true; break
      case '--dry-run':  dryRun = true; break
      case '--orden': {
        const v = valor().toLowerCase()
        if (v !== 'asc' && v !== 'desc') throw new Error(`--orden acepta asc | desc (llegó "${v}").`)
        orden = v === 'asc' ? 'viejo-primero' : 'reciente-primero'
        break
      }
      case '--pausa-ms': {
        const n = Number(valor())
        if (!Number.isInteger(n) || n < PAUSA_MIN || n > PAUSA_MAX) {
          throw new Error(`--pausa-ms inválido (entero entre ${PAUSA_MIN} y ${PAUSA_MAX}).`)
        }
        pausaMs = n
        break
      }
      default:
        if (a.startsWith('-')) throw new Error(`Opción desconocida: ${a}\n\n${USO}`)
        libres.push(a)
    }
  }

  if (libres.length) throw new Error(`Sobran argumentos: ${libres.join(' ')}\n\n${USO}`)

  // `--todo` y un rango explícito son dos modos distintos: mezclarlos esconde cuál mandó.
  if (todo && (desde !== null || hasta !== null)) {
    throw new Error(`--todo no se combina con --desde/--hasta.\n\n${USO}`)
  }
  if (!todo) {
    if (desde === null || hasta === null) {
      throw new Error(`Faltan --desde y --hasta (o usá --todo).\n\n${USO}`)
    }
    if (desde > hasta) throw new Error(`El rango está al revés: --desde ${desde} > --hasta ${hasta}.`)
  }

  return { desde, hasta, todo, dryRun, orden, pausaMs }
}

// ── Días y tramos ──────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000

/** `'2026-09-01'` → epoch UTC de ese día a medianoche. Solo para contar días. */
function aEpoch(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const aFecha = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10)

/** El día siguiente / anterior, sin líos de zona (se opera en UTC puro). */
export function sumarDias(fecha: string, n: number): string {
  return aFecha(aEpoch(assertFecha(fecha)) + n * DIA_MS)
}

/**
 * Todos los días del rango, inclusive los dos extremos.
 *
 * Por defecto **del más reciente al más viejo**: si el barrido se corta a la mitad, lo
 * que ya entró es lo último —que es lo que se está cuadrando— y no un pedazo de 2024.
 */
export function enumerarDias(desde: string, hasta: string, orden: Orden = 'reciente-primero'): string[] {
  assertFecha(desde); assertFecha(hasta)
  if (desde > hasta) return []
  const dias: string[] = []
  for (let e = aEpoch(desde); e <= aEpoch(hasta); e += DIA_MS) dias.push(aFecha(e))
  return orden === 'reciente-primero' ? dias.reverse() : dias
}

export interface Tramo {
  /** `'2026-09'`. */
  mes:  string
  dias: string[]
}

/**
 * Los días agrupados por mes, **respetando el orden en que vienen**. El log de un
 * barrido de dos años es ilegible día por día; por mes se lee de un vistazo.
 */
export function agruparPorMes(dias: readonly string[]): Tramo[] {
  const tramos: Tramo[] = []
  for (const d of dias) {
    const mes = d.slice(0, 7)
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.mes === mes) ultimo.dias.push(d)
    else tramos.push({ mes, dias: [d] })
  }
  return tramos
}

// ── Contadores ─────────────────────────────────────────────────────────────────

export interface Conteo {
  dias:      number
  /** Días que devolvieron 0 facturas cerradas (normal: cerrado, feriado). */
  diasVacios: number
  tickets:   number
  guardados: number
  lineas:    number
  errores:   number
  /** Primer y último día CON ventas, en orden cronológico. */
  primerDia: string | null
  ultimoDia: string | null
}

export function conteoVacio(): Conteo {
  return { dias: 0, diasVacios: 0, tickets: 0, guardados: 0, lineas: 0, errores: 0, primerDia: null, ultimoDia: null }
}

export interface ResultadoDia {
  fecha:     string
  tickets:   number
  guardados: number
  lineas:    number
  error:     string | null
}

export function acumular(c: Conteo, r: ResultadoDia): Conteo {
  c.dias += 1
  if (r.error !== null) { c.errores += 1; return c }
  if (r.tickets === 0) { c.diasVacios += 1; return c }
  c.tickets   += r.tickets
  c.guardados += r.guardados
  c.lineas    += r.lineas
  if (c.primerDia === null || r.fecha < c.primerDia) c.primerDia = r.fecha
  if (c.ultimoDia === null || r.fecha > c.ultimoDia) c.ultimoDia = r.fecha
  return c
}

export function sumar(a: Conteo, b: Conteo): Conteo {
  return {
    dias:       a.dias + b.dias,
    diasVacios: a.diasVacios + b.diasVacios,
    tickets:    a.tickets + b.tickets,
    guardados:  a.guardados + b.guardados,
    lineas:     a.lineas + b.lineas,
    errores:    a.errores + b.errores,
    primerDia:  [a.primerDia, b.primerDia].filter((x): x is string => x !== null).sort()[0] ?? null,
    ultimoDia:  [a.ultimoDia, b.ultimoDia].filter((x): x is string => x !== null).sort().pop() ?? null,
  }
}

/** La línea de resumen de un tramo (o del barrido entero). */
export function describirConteo(etiqueta: string, c: Conteo): string {
  const rango = c.primerDia === null ? 'sin ventas' : `${c.primerDia}…${c.ultimoDia}`
  return `${etiqueta} · días=${c.dias} (vacíos ${c.diasVacios}) · tickets=${c.tickets} ` +
    `guardados=${c.guardados} · líneas=${c.lineas} · errores=${c.errores} · ${rango}`
}
