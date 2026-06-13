// Menú visual del comandero — armado PURO del grid jerárquico FAMILIA → categoría →
// productos (mig 032). Sin IO; testeado en comanderoMenu.test.ts.

export interface MenuMeta {
  tipo: string                 // categoría (= product_map.tipo)
  subclasificacion: string
  station: string
  photo_url?: string | null
}
export interface MenuPrice { price_final_crc: number | null }

export interface MenuTile {
  nombre: string
  category: string
  station: string
  price_final_crc: number
  photo_url: string | null
}

// Mapeo categoría → familia (mig 032). category en MAYÚSCULA-trim como llave.
export interface CatMap {
  family_id: string | null
  hidden_comandero: boolean
  sort_order: number
}
export interface FamilyDef { id: string; label: string; icon: string; sort_order: number }

const norm = (s: string) => (s || '').trim().toUpperCase()

/** Categoría del tile dentro de una familia: la categoría (tipo); subcategoría es el
 *  3er nivel real de productos. Mantengo categoryOf por compatibilidad de tests previos. */
export function categoryOf(meta: MenuMeta): string {
  return meta.subclasificacion.trim() || meta.tipo.trim() || 'Otros'
}

/**
 * Construye el árbol FAMILIA → categoría → tiles. Solo productos ACTIVOS (meta ya
 * filtrado) y CON PRECIO. Excluye categorías ocultas del comandero (A PAX). Las
 * categorías sin familia mapeada caen en una familia 'otros' al final (no se pierden).
 */
export function buildMenuTree(
  meta: Map<string, MenuMeta>,
  prices: Map<string, MenuPrice>,
  families: FamilyDef[],
  catMap: Map<string, CatMap>,           // llave = categoría normalizada
): {
  families: FamilyDef[]
  byFamily: Map<string, string[]>                       // family_id → categorías (ordenadas)
  byCategory: Map<string, MenuTile[]>                   // categoría → tiles (ordenados)
} {
  const collator = new Intl.Collator('es-CR')
  const byCategory = new Map<string, MenuTile[]>()
  const catOf = new Map<string, { family: string; sort: number }>()  // categoría display → familia

  for (const [nombre, m] of meta) {
    const price = prices.get(nombre)?.price_final_crc
    if (price == null) continue
    const catKey = norm(m.tipo)
    const cm = catMap.get(catKey)
    if (cm?.hidden_comandero) continue                  // A PAX y similares: fuera del comandero
    const category = m.tipo.trim() || 'Otros'
    const family = cm?.family_id ?? 'otros'
    if (!byCategory.has(category)) { byCategory.set(category, []); catOf.set(category, { family, sort: cm?.sort_order ?? 999 }) }
    byCategory.get(category)!.push({ nombre, category, station: m.station, price_final_crc: price, photo_url: m.photo_url ?? null })
  }
  for (const tiles of byCategory.values()) tiles.sort((a, b) => collator.compare(a.nombre, b.nombre))

  // familias presentes (con productos), en orden; 'otros' al final si hace falta
  const famDefs = [...families].sort((a, b) => a.sort_order - b.sort_order)
  if ([...catOf.values()].some(c => c.family === 'otros') && !famDefs.find(f => f.id === 'otros')) {
    famDefs.push({ id: 'otros', label: 'Otros', icon: '📦', sort_order: 999 })
  }
  const byFamily = new Map<string, string[]>()
  for (const f of famDefs) {
    const cats = [...catOf.entries()]
      .filter(([, v]) => v.family === f.id)
      .sort((a, b) => a[1].sort - b[1].sort || collator.compare(a[0], b[0]))
      .map(([cat]) => cat)
    if (cats.length) byFamily.set(f.id, cats)
  }
  const familiesPresent = famDefs.filter(f => byFamily.has(f.id))
  return { families: familiesPresent, byFamily, byCategory }
}

/**
 * Búsqueda transversal: tiles que matchean el texto (en cualquier familia/categoría),
 * solo activos con precio y no-ocultos. Para la barra de búsqueda del comandero.
 */
export function searchTiles(
  meta: Map<string, MenuMeta>,
  prices: Map<string, MenuPrice>,
  catMap: Map<string, CatMap>,
  term: string,
  limit = 30,
): MenuTile[] {
  const q = term.trim().toLowerCase()
  if (q.length < 2) return []
  const out: MenuTile[] = []
  for (const [nombre, m] of meta) {
    const price = prices.get(nombre)?.price_final_crc
    if (price == null) continue
    if (catMap.get(norm(m.tipo))?.hidden_comandero) continue
    if (!nombre.toLowerCase().includes(q) && !m.tipo.toLowerCase().includes(q) && !(m.subclasificacion || '').toLowerCase().includes(q)) continue
    out.push({ nombre, category: m.tipo.trim() || 'Otros', station: m.station, price_final_crc: price, photo_url: m.photo_url ?? null })
    if (out.length >= limit) break
  }
  return out.sort((a, b) => new Intl.Collator('es-CR').compare(a.nombre, b.nombre))
}

/** @deprecated usar buildMenuTree — se mantiene para tests previos (2 niveles plano). */
export function buildMenu(
  meta: Map<string, MenuMeta>,
  prices: Map<string, MenuPrice>,
): { categories: string[]; byCategory: Map<string, MenuTile[]> } {
  const byCategory = new Map<string, MenuTile[]>()
  for (const [nombre, m] of meta) {
    const price = prices.get(nombre)?.price_final_crc
    if (price == null) continue
    const category = categoryOf(m)
    if (!byCategory.has(category)) byCategory.set(category, [])
    byCategory.get(category)!.push({ nombre, category, station: m.station, price_final_crc: price, photo_url: m.photo_url ?? null })
  }
  const collator = new Intl.Collator('es-CR')
  for (const tiles of byCategory.values()) tiles.sort((a, b) => collator.compare(a.nombre, b.nombre))
  const categories = [...byCategory.keys()].sort(collator.compare)
  return { categories, byCategory }
}
