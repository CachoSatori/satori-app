import type { Local } from './config.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ESQUELETO · Lectura incremental del PoS (SQL Server, base `ndf`)                       ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ⚠ FASE A: ESTO NO LEE NADA. Todavía no tenemos permiso de lectura sobre `ndf`, así que no
//   sabemos cómo se llaman las tablas ni las columnas. Lo que sí sabemos es la FORMA que tiene
//   que tener el agente, porque el biotime-bridge ya la probó en producción.
//
// Este archivo espeja `tools/biotime-bridge/src/fetchPunches.ts`. SOLO LECTURA: no conoce el
// driver (recibe un ejecutor de consultas, lo arma `db.ts`), así que el SELECT, el filtro
// incremental y el mapeo se pueden probar sin base.
//
// ── LO QUE HAY QUE CABLEAR (ver README) ────────────────────────────────────────────────────
//   1. `FETCH_SQL` — la consulta real.
//   2. `PosRow`    — los nombres reales de las columnas.
//   3. `mapRow`    — el mapeo columna del PoS → nuestro modelo.
// Nada más. El loop, el estado y el empuje ya están.

/**
 * ⚠ TODO CABLEAR · La consulta real contra `ndf`.
 *
 * Lo que tiene que cumplir, aprendido del biotime-bridge:
 *   · Un corte INCREMENTAL por una clave que crezca (`WHERE id > @lastId`), ordenado por esa
 *     clave y con `TOP` para acotar el lote.
 *   · SOLO cuentas CERRADAS. Una cuenta abierta cambia de monto: si se empuja y después se
 *     modifica, la base queda con un número que ya no existe.
 *   · SIN filtro de fecha: el corte lo da el id confirmado, no el reloj de la PC.
 *
 * ⚠ Y una lección cara del biotime-bridge (sep-2026): el supuesto «el id crece con el tiempo»
 *   NO siempre vale. Ahí se perdieron cuatro días de fichajes porque aparecieron marcas más
 *   nuevas con id más bajo que el corte, invisibles para siempre al `WHERE id > lastId`.
 *   Cuando se cablee esto, la consulta lleva ADEMÁS una red por tiempo:
 *
 *       WHERE id > @lastId OR fecha_cierre >= @desde     -- ventana móvil de N días
 *
 *   El costo es reenviar un puñado de filas por ciclo, que la base descarta por clave única.
 *   El beneficio es que un id fuera de orden no se traga un día entero de ventas.
 *
 * Sintaxis de SQL Server (no Postgres): `TOP (@n)`, parámetros con `@`.
 */
export const FETCH_SQL = `
-- ⚠ PLANTILLA — no ejecutar. Los nombres son inventados hasta tener el esquema real.
SELECT TOP (@batchSize)
       t.id                AS pos_id,          -- TBD: la PK incremental de la cuenta
       t.fecha_cierre      AS cerrada_en,      -- TBD: instante de cierre (¿con zona? ¿naive?)
       t.total             AS total,           -- TBD: total de la cuenta
       t.comensales        AS pax,             -- TBD: EL campo nativo de comensales (ver CalidadPax)
       t.mesero_id         AS mesero_id,       -- TBD: identificador del mesero (NUNCA el nombre)
       t.terminal          AS terminal         -- TBD: caja/terminal, si existe
  FROM dbo.tickets t                           -- TBD: la tabla real de cuentas
 WHERE t.id > @lastId
   AND t.cerrada = 1                           -- TBD: cómo marca el PoS una cuenta cerrada
 ORDER BY t.id ASC
`

/**
 * ⚠ TODO CABLEAR · La fila cruda tal como la devuelve el driver.
 *
 * Los tipos son los que ESPERAMOS, no los que sabemos. Ojo con `cerrada_en`: en SQL Server
 * `datetime`/`datetime2` NO llevan zona horaria. Si llega naive, hay que estamparle el offset
 * de Costa Rica (UTC−6 FIJO, sin horario de verano) igual que en `fetchPunches.ts` — y NO
 * dejar que el driver lo interprete con la zona del proceso, que es exactamente el bug que
 * corrió las marcas de BioTime una hora durante semanas.
 */
export interface PosRow {
  pos_id:     number | string
  cerrada_en: Date | string
  total:      number | string
  pax:        number | string | null
  mesero_id:  number | string | null
  terminal:   string | null
}

/** Una venta en el formato que va a esperar la Edge Function `ingest-ventas`. */
export interface VentaCruda {
  posId:     number
  /** Instante con zona explícita, SIEMPRE. Ver la advertencia de arriba. */
  cerradaEn: string
  total:     number
  pax:       number | null
  meseroId:  string | null
  terminal?: string
  /** La fila original, para poder reconciliar después sin volver al PoS. */
  raw:       Record<string, unknown>
}

export interface Queryable {
  query<T>(text: string, params: Record<string, unknown>): Promise<{ rows: T[] }>
}

/** Costa Rica es UTC−6 FIJO: no tiene horario de verano. Misma constante que el biotime-bridge. */
export const CR_OFFSET = '-06:00'

/** Un `datetime` naive de SQL Server como texto → instante con offset de Costa Rica. */
const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/
const TZ_RE    = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * `cerrada_en` → instante con zona explícita, sin depender de la zona de la PC.
 *
 * Es la misma función que `normalizarInstante` del biotime-bridge, y está duplicada a
 * propósito: los dos agentes son procesos independientes que se instalan por separado en
 * PCs distintas. Compartir código entre ellos obligaría a un paquete común y a desplegar los
 * dos juntos cada vez. La regla que NO se puede duplicar es el offset, y por eso está en una
 * constante con el mismo nombre en los dos lados.
 */
export function normalizarInstante(v: Date | string): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error(`cerrada_en inválido: ${String(v)}`)
    return v.toISOString()
  }
  const s = String(v).trim()
  if (TZ_RE.test(s)) return s
  if (NAIVE_RE.test(s)) return `${s.replace(' ', 'T')}${CR_OFFSET}`
  throw new Error(
    `cerrada_en con formato irreconocible: "${s}". Se esperaba un instante con zona ` +
    `(Z o ±HH:MM) o un datetime naive de Costa Rica (YYYY-MM-DD HH:MM:SS).`,
  )
}

/** Numérico seguro. Explota antes que mandar un id truncado o un monto `NaN`. */
function numero(v: unknown, campo: string): number {
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new Error(`${campo} no numérico: ${JSON.stringify(v)}`)
  return n
}

/**
 * ⚠ TODO CABLEAR · Fila del PoS → nuestro modelo.
 *
 * El mapeo vive ACÁ y en ningún otro lado: es lo que hace que la forma del PoS no se filtre
 * hasta la pantalla (ver `src/modules/analitica-pos/types.ts`).
 */
export function mapRow(row: PosRow): VentaCruda {
  const posId = numero(row.pos_id, 'pos_id')
  if (!Number.isSafeInteger(posId)) {
    throw new Error(`pos_id fuera de rango: ${JSON.stringify(row.pos_id)}`)
  }

  return {
    posId,
    cerradaEn: normalizarInstante(row.cerrada_en),
    total:     numero(row.total, 'total'),
    // `null` ≠ `0`: «no se cargó el comensal» es distinto de «vinieron cero personas», y esa
    // diferencia es justamente lo que mide `CalidadPax`. Aplastarla acá borraría el indicador.
    pax:       row.pax === null || row.pax === undefined ? null : numero(row.pax, 'pax'),
    meseroId:  row.mesero_id === null || row.mesero_id === undefined ? null : String(row.mesero_id).trim(),
    ...(row.terminal ? { terminal: String(row.terminal) } : {}),
    raw:       { ...row, cerrada_en: normalizarInstante(row.cerrada_en) },
  }
}

/**
 * Un lote de ventas nuevas: las de `posId > lastId`, en orden, hasta `batchSize`.
 *
 * ⚠ FASE A: devuelve SIEMPRE `[]`. La estructura está para que cablearla sea reemplazar el
 * cuerpo, no reescribir el archivo. Descomentar cuando `FETCH_SQL` sea real.
 */
export async function fetchVentas(
  _q: Queryable,
  _lastId: number,
  _batchSize: number,
): Promise<VentaCruda[]> {
  // const { rows } = await _q.query<PosRow>(FETCH_SQL, { lastId: _lastId, batchSize: _batchSize })
  // return rows.map(mapRow)
  return []
}

/** Para el log del ciclo: `local` sale del config, no del PoS. */
export function describeLote(local: Local, ventas: VentaCruda[]): string {
  if (ventas.length === 0) return `${local}: sin ventas nuevas`
  return `${local}: ${ventas.length} venta(s), ids ${ventas[0].posId}..${ventas[ventas.length - 1].posId}`
}
