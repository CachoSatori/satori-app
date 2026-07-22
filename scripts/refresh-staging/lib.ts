// Utilidades del refresh: paginado, dump a JSON y armado de INSERTs.

import { leerDeProd, leerDeStaging } from './gate.ts'

export type Fila = Record<string, unknown>

const PAGINA = 500

/** Trae una tabla entera, paginada. `origen` decide de qué base. */
export async function traerTabla(
  tabla: string,
  tok: string,
  origen: 'prod' | 'staging',
): Promise<Fila[]> {
  const leer = origen === 'prod' ? leerDeProd : leerDeStaging
  const filas: Fila[] = []
  for (let off = 0; ; off += PAGINA) {
    const lote = (await leer(
      `select * from public.${tabla} order by 1 limit ${PAGINA} offset ${off}`,
      tok,
    )) as Fila[]
    filas.push(...lote)
    if (lote.length < PAGINA) return filas
  }
}

export async function contar(tabla: string, tok: string, origen: 'prod' | 'staging'): Promise<number> {
  const leer = origen === 'prod' ? leerDeProd : leerDeStaging
  const r = (await leer(`select count(*)::int as n from public.${tabla}`, tok)) as { n: number }[]
  return r[0]?.n ?? -1
}

/** Comilla simple doblada — el escape estándar de Postgres. */
export function esc(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * INSERTs por lotes usando `jsonb_populate_recordset`.
 *
 * Se manda el JSON crudo y **Postgres hace la coerción de tipos** contra el rowtype de la
 * tabla destino: uuid, timestamptz, numeric, jsonb, arrays — todo. Construir literales a
 * mano habría funcionado para los casos fáciles y roto en silencio en los raros.
 *
 * Las columnas se listan EXPLÍCITAMENTE y salen de la intersección origen ∩ destino: si
 * staging tiene columnas que prod no (p. ej. `tip_sessions.pool_pos_*`, NOT NULL), se
 * omiten y toman su DEFAULT en vez de reventar el insert con un NULL.
 */
export function sentenciasInsert(tabla: string, filas: Fila[], columnasDestino: Set<string>): string[] {
  if (!filas.length) return []
  const cols = Object.keys(filas[0]).filter(c => columnasDestino.has(c))
  const lista = cols.map(c => `"${c}"`).join(',')
  const out: string[] = []
  const LOTE = 250
  for (let i = 0; i < filas.length; i += LOTE) {
    const json = JSON.stringify(filas.slice(i, i + LOTE).map(f => Object.fromEntries(cols.map(c => [c, f[c]]))))
    out.push(
      `insert into public.${tabla} (${lista}) ` +
        `select ${lista} from jsonb_populate_recordset(null::public.${tabla}, ${esc(json)}::jsonb)`,
    )
  }
  return out
}

/** Columnas que existen en una tabla de staging (el destino). */
export async function columnasDe(tabla: string, tok: string): Promise<Set<string>> {
  const r = (await import('./gate.ts')).leerDeStaging
  const filas = (await r(
    `select column_name from information_schema.columns where table_schema='public' and table_name=${esc(tabla)}`,
    tok,
  )) as { column_name: string }[]
  return new Set(filas.map(x => x.column_name))
}
