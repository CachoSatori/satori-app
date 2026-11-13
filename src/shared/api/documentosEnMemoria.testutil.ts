// (13-nov) Solo para pruebas: una tabla `documents` en memoria con el subconjunto del cliente de Supabase que usan
// findDuplicate / findDuplicateClave / findFacturaParecida / createDocumentRow / listInbox / setDocEstado.
// Así las pruebas de pantalla corren las consultas REALES de duplicados contra filas de verdad, y `borrarMovimiento`
// imita lo que hace prod al borrar un movimiento: la FK `ON DELETE SET NULL` deja el documento en «procesado» sin vínculo
// (el huérfano que deja delete_movement_cascade).

export interface FilaDoc {
  id: string
  created_at: string
  image_path: string
  sha256: string
  estado: 'nuevo' | 'procesado' | 'descartado'
  linked_movement_id: string | null
  clave_fe: string | null
  tipo: string | null
  raw_json: Record<string, unknown> | null
  created_by: string | null
}

export const tablaDocs: FilaDoc[] = []
let seq = 0

/** (13-nov) Simula que la base no responde a las CONSULTAS (lecturas): devuelven `error`, como sin red. */
export const fallas = { lecturas: false }

export function vaciarDocs() { tablaDocs.length = 0; seq = 0; fallas.lecturas = false }

/** Lo que pasa en prod al borrar un movimiento con factura: el documento queda «procesado» y sin vínculo. */
export function borrarMovimiento(movId: string) {
  for (const d of tablaDocs) if (d.linked_movement_id === movId) d.linked_movement_id = null
}

const valor = (d: FilaDoc, col: string): unknown => {
  const m = /^raw_json->>(\w+)$/.exec(col)
  if (m) return d.raw_json?.[m[1]] ?? null
  return (d as unknown as Record<string, unknown>)[col]
}
const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))

type Filtro = (d: FilaDoc) => boolean

function consulta() {
  const filtros: Filtro[] = []
  let orden: { col: string; asc: boolean } | null = null
  let tope = Infinity
  let insertar: Record<string, unknown> | null = null
  let actualizar: Record<string, unknown> | null = null
  let unica = false

  const ejecutar = () => {
    if (insertar) {
      seq += 1
      const fila: FilaDoc = {
        id: `doc-${seq}`, created_at: new Date(Date.UTC(2026, 10, 13, 23, seq)).toISOString(),
        image_path: '', sha256: '', estado: 'nuevo', linked_movement_id: null, clave_fe: null, tipo: null, raw_json: null,
        created_by: null, ...(insertar as Partial<FilaDoc>),
      }
      tablaDocs.push(fila)
      return { data: unica ? { ...fila } : [{ ...fila }], error: null }
    }
    if (fallas.lecturas && !actualizar) return { data: null, error: { message: 'Failed to fetch' } }
    let filas = tablaDocs.filter(d => filtros.every(f => f(d)))
    if (actualizar) { for (const d of filas) Object.assign(d, actualizar); return { data: null, error: null } }
    if (orden) {
      const { col, asc } = orden
      filas = [...filas].sort((a, b) => String(valor(a, col)).localeCompare(String(valor(b, col))) * (asc ? 1 : -1))
    }
    return { data: filas.slice(0, tope).map(d => ({ ...d })), error: null }
  }

  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros.push(d => texto(valor(d, c)) === texto(v)); return q },
    neq: (c: string, v: unknown) => { filtros.push(d => texto(valor(d, c)) !== texto(v)); return q },
    not: (c: string, op: string, v: unknown) => {
      if (op !== 'is' || v !== null) throw new Error(`fake: not(${c}, ${op}) sin soporte`)
      filtros.push(d => valor(d, c) !== null && valor(d, c) !== undefined); return q
    },
    // Solo «col.eq.valor,col.eq.valor» (lo que arma findDuplicate).
    or: (expr: string) => {
      const partes = expr.split(',').map(p => { const [c, op, ...v] = p.split('.'); if (op !== 'eq') throw new Error(`fake: or ${p}`); return [c, v.join('.')] })
      filtros.push(d => partes.some(([c, v]) => texto(valor(d, c)) === v)); return q
    },
    ilike: (c: string, patron: string) => {
      const re = new RegExp('^' + patron.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      filtros.push(d => { const v = texto(valor(d, c)); return v !== null && re.test(v) }); return q
    },
    order: (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return q },
    limit: (n: number) => { tope = n; return q },
    insert: (fila: Record<string, unknown>) => { insertar = fila; return q },
    update: (patch: Record<string, unknown>) => { actualizar = patch; return q },
    single: () => { unica = true; return q },
    then: (ok: (v: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve().then(ejecutar).then(ok, mal),
  }
  return q
}

export const supabaseEnMemoria = {
  from: (tabla: string) => {
    if (tabla !== 'documents') throw new Error(`fake: tabla ${tabla} sin soporte`)
    return consulta()
  },
}
