import type { Local } from './config.js'

// ── Lectura incremental de BioTime ──────────────────────────────────────────────
// SOLO LECTURA. Este archivo no conoce `pg`: recibe un ejecutor de consultas (lo arma
// `db.ts`). Así el SELECT, el filtro `id > last` y el mapeo se prueban sin base.

/**
 * El SELECT contra BioTime. `id` es incremental, así que ordenar por `id` y arrancar en
 * `> last_id` alcanza para no releer lo ya empujado. Sin `where` de fecha a propósito:
 * el corte lo da el id confirmado, no el reloj de la PC.
 */
export const FETCH_SQL = `SELECT id, emp_code, punch_time, punch_state, terminal_alias
FROM public.iclock_transaction
WHERE id > $1
ORDER BY id ASC
LIMIT $2`

/** Fila cruda de `public.iclock_transaction`, tal como la devuelve el driver. */
export interface BiotimeRow {
  id:             string | number      // bigint: `pg` lo entrega como STRING
  emp_code:       string | number | null
  punch_time:     Date | string
  punch_state:    string | number | null
  terminal_alias: string | null
}

/** Una marca en el formato que espera la Edge Function `ingest-punches`. */
export interface IngestPunch {
  biotime_id:  number
  emp_code:    string
  punch_time:  string
  punch_state: string | number
  terminal?:   string
  raw:         Record<string, unknown>
}

export interface Queryable {
  query<T>(text: string, params: unknown[]): Promise<{ rows: T[] }>
}

/** Instante CON zona horaria explícita (`Z` o `±HH:MM`) — lo único que el edge acepta. */
const TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Un `timestamp` naive de Postgres tal como lo entrega el parser de `db.ts`:
 * `'2026-08-16 16:00:00'` o `'2026-08-16T16:00:00.123'`. Sin zona, sin offset.
 */
const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/**
 * ── EL DESFASE DE 1 HORA (piloto v3, agosto 2026) ──────────────────────────────────────
 *
 * Costa Rica es **UTC−6 FIJO**: no tiene horario de verano, nunca lo tuvo en el período que
 * nos importa, y no lo va a tener. Ese `-06:00` es la ÚNICA verdad de este archivo.
 *
 * Qué pasaba: `public.iclock_transaction.punch_time` de BioTime es un `timestamp` NAIVE
 * (reloj de pared, sin zona). `pg` lo convertía a `Date` interpretándolo en la zona del
 * **proceso Node** — o sea, en la zona que tenga configurada la PC del reloj. Si esa PC
 * está en una zona UTC−5 (Bogotá/Lima) o en una zona CON horario de verano que en agosto
 * corre a UTC−5 (Central Time), una marca de las 16:00 salía como 21:00Z en vez de 22:00Z
 * y la app la mostraba a las **15:00**: exactamente 1 hora atrás. Y el guard de abajo NO
 * lo veía, porque un `Date` siempre serializa con `Z`.
 *
 * Ahora `db.ts` desactiva ese parseo (los naive llegan como TEXTO crudo) y acá se les pone
 * el offset de Costa Rica a mano. El resultado deja de depender de cómo esté configurada
 * la PC del local.
 */
export const CR_OFFSET = '-06:00'

/**
 * `'2026-08-16 16:00:00'` (reloj de pared de Costa Rica) → `'2026-08-16T16:00:00-06:00'`.
 * NO mueve la hora: solo dice en qué zona estaba leída, que es lo que faltaba.
 */
export function conOffsetCR(naive: string): string {
  return `${naive.replace(' ', 'T')}${CR_OFFSET}`
}

/**
 * El error que NO hay que tragarse. Si `punch_time` llega como algo que no es ni un
 * instante con zona ni un `timestamp` naive reconocible, mandarlo igual haría que el edge
 * lo rechace (`invalid`) y, como el ciclo habría avanzado el `last_id`, esa marca se
 * perdería en silencio. Preferimos frenar el ciclo.
 */
export class NaiveTimestampError extends Error {
  constructor(valor: string) {
    super(
      `punch_time con formato irreconocible: "${valor}". Se esperaba un instante con zona ` +
      `(Z o ±HH:MM) o un timestamp naive de Costa Rica (YYYY-MM-DD HH:MM:SS).`,
    )
    this.name = 'NaiveTimestampError'
  }
}

/** `bigint` de Postgres → number. Explota antes que mandar un id truncado. */
function idNumerico(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isSafeInteger(n)) {
    throw new Error(`iclock_transaction.id fuera de rango o no numérico: ${JSON.stringify(v)}`)
  }
  return n
}

/**
 * `punch_time` → instante con zona explícita, SIEMPRE, y sin depender de la zona de la PC.
 *
 *   · `Date`            → el driver ya resolvió un instante absoluto (columna `timestamptz`);
 *                          `toISOString()` lo deja en UTC, que es el MISMO instante.
 *   · texto CON zona    → se respeta tal cual (ya dice en qué zona está).
 *   · texto SIN zona    → es el reloj de pared de Costa Rica: se le pone `-06:00`.
 *   · cualquier otra cosa → frena el ciclo.
 */
export function normalizarInstante(v: Date | string): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new NaiveTimestampError(String(v))
    return v.toISOString()
  }
  const s = String(v).trim()
  if (TZ_RE.test(s)) return s
  if (NAIVE_RE.test(s)) return conOffsetCR(s)
  throw new NaiveTimestampError(s)
}

/**
 * Fila de BioTime → cuerpo del edge. NO normaliza ni filtra: `punch_state` va CRUDO
 * ('0'/'1'), el edge lo traduce a in/out y cuenta lo que descarta. Lo único que se toca
 * es el instante, que se serializa con zona explícita.
 */
export function mapRow(row: BiotimeRow): IngestPunch {
  const punchTime = normalizarInstante(row.punch_time)

  const punch: IngestPunch = {
    biotime_id:  idNumerico(row.id),
    emp_code:    row.emp_code === null || row.emp_code === undefined ? '' : String(row.emp_code).trim(),
    punch_time:  punchTime,
    // Crudo, tal cual BioTime: normalizar acá duplicaría la regla que ya vive en el edge.
    punch_state: (row.punch_state ?? '') as string | number,
    // `raw` = la fila original, para poder reconciliar después sin volver a BioTime.
    raw: {
      id:             row.id,
      emp_code:       row.emp_code,
      punch_time:     punchTime,
      punch_state:    row.punch_state,
      terminal_alias: row.terminal_alias,
    },
  }
  if (row.terminal_alias !== null && row.terminal_alias !== undefined) {
    punch.terminal = String(row.terminal_alias)
  }
  return punch
}

/** Un lote de marcas nuevas: las de `id > lastId`, en orden, hasta `batchSize`. */
export async function fetchPunches(
  q: Queryable,
  lastId: number,
  batchSize: number,
): Promise<IngestPunch[]> {
  const { rows } = await q.query<BiotimeRow>(FETCH_SQL, [lastId, batchSize])
  return rows.map(mapRow)
}

/** Para el log del ciclo: `local` sale del config, no de BioTime. */
export function describeLote(local: Local, punches: IngestPunch[]): string {
  if (punches.length === 0) return `${local}: sin marcas nuevas`
  return `${local}: ${punches.length} marca(s), ids ${punches[0].biotime_id}..${punches[punches.length - 1].biotime_id}`
}
