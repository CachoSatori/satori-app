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
 * El error que NO hay que tragarse. Si `punch_time` llega sin zona horaria, mandarla
 * igual haría que el edge la rechace (`invalid`) y, como el ciclo habría avanzado el
 * `last_id`, esa marca se perdería en silencio. Peor todavía: si alguien "arreglara" el
 * problema poniéndole una zona inventada, las marcas quedarían corridas 6 horas y las
 * horas de la quincena saldrían mal SIN que nada falle. Preferimos frenar el ciclo.
 */
export class NaiveTimestampError extends Error {
  constructor(valor: string) {
    super(
      `punch_time sin zona horaria: "${valor}". La columna public.iclock_transaction.punch_time ` +
      'tiene que ser timestamptz (con -06:00). Sin zona, las marcas se guardarían corridas 6 horas.',
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
 * Fila de BioTime → cuerpo del edge. NO normaliza ni filtra: `punch_state` va CRUDO
 * ('0'/'1'), el edge lo traduce a in/out y cuenta lo que descarta. Lo único que se toca
 * es el instante, que se serializa con zona explícita.
 */
export function mapRow(row: BiotimeRow): IngestPunch {
  const punchTime =
    row.punch_time instanceof Date
      // timestamptz → el driver ya devuelve el instante correcto; ISO lo deja en UTC (mismo instante).
      ? row.punch_time.toISOString()
      : String(row.punch_time).trim()

  if (!TZ_RE.test(punchTime)) throw new NaiveTimestampError(punchTime)

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
