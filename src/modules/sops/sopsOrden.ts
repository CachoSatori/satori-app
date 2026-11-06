// Orden, agrupado y búsqueda del módulo SoP (lógica pura, testeada en sopsOrden.test.ts).
//
// · Se agrupa por `area` (las 5 áreas del paquete de noviembre 2026). Una fila sin área
//   —las viejas que todavía no se migraron— cae en su `category` de siempre.
// · Grupos: primero las áreas por su número, después las categorías viejas por nombre.
// · Dentro del grupo: por código en orden natural (2.9 antes que 2.10); las filas sin
//   código van al final, por display_order y título.
// · La búsqueda encuentra por código ("2.5", "SOP 2.5"), título y contenido, sin
//   importar mayúsculas ni tildes.

import type { SOP } from '../../shared/api/sops'

export function grupoDe(s: Pick<SOP, 'area' | 'category'>): string {
  return s.area || s.category || 'General'
}

function numeroDeArea(g: string): number | null {
  const m = /^(\d+)\.\s/.exec(g)
  return m ? Number(m[1]) : null
}

export function compararGrupos(a: string, b: string): number {
  const na = numeroDeArea(a), nb = numeroDeArea(b)
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1
  if (nb !== null) return 1
  return a.localeCompare(b, 'es')
}

export function compararCodigos(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function compararSops(a: SOP, b: SOP): number {
  if (a.code && b.code) return compararCodigos(a.code, b.code)
  if (a.code) return -1
  if (b.code) return 1
  return (a.display_order ?? 0) - (b.display_order ?? 0) || a.title.localeCompare(b.title, 'es')
}

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function coincideBusqueda(s: SOP, q: string): boolean {
  const t = normalizar(q.trim())
  if (!t) return true
  // "SOP 2.5" o "2.5" → buscar por código exacto o por prefijo ("2" → 2.x).
  const cod = /^(?:sop\s*)?(\d+(?:\.\d+)?)\.?$/.exec(t)
  if (cod && s.code) {
    const c = cod[1]
    if (s.code === c || s.code.startsWith(c.includes('.') ? c : c + '.')) return true
  }
  return normalizar(`${s.code ?? ''} ${s.title}`).includes(t) || normalizar(s.content).includes(t)
}

/** Grupos ordenados con sus filas ordenadas, ya filtrados por grupo y búsqueda. */
export function agruparSops(sops: SOP[], grupo: string, busqueda: string): [string, SOP[]][] {
  const grupos = new Map<string, SOP[]>()
  for (const s of sops) {
    const g = grupoDe(s)
    if (grupo !== 'all' && g !== grupo) continue
    if (!coincideBusqueda(s, busqueda)) continue
    const lista = grupos.get(g) ?? []
    lista.push(s)
    grupos.set(g, lista)
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => compararGrupos(a, b))
    .map(([g, l]) => [g, [...l].sort(compararSops)])
}

/** Nombre corto del grupo para pestañas y encabezados: "2. Salón y recepción" → "Salón y recepción". */
export function nombreCorto(g: string): string {
  return g.replace(/^\d+\.\s*/, '')
}

/** Etiqueta del código: "SOP 2.5" o "Doc 3.2". */
export function etiquetaCodigo(s: Pick<SOP, 'code' | 'doc_type'>): string | null {
  if (!s.code) return null
  return `${s.doc_type === 'Documento' ? 'Doc' : 'SOP'} ${s.code}`
}
