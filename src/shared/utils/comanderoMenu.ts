// Menú visual del comandero (SPEC P0-b) — armado PURO del grid: qué productos se
// muestran, en qué categoría y en qué orden. Sin IO; testeado en comanderoMenu.test.ts.

export interface MenuMeta {
  tipo: string
  subclasificacion: string
  station: string
}
export interface MenuPrice { price_final_crc: number | null }

export interface MenuTile {
  nombre: string
  category: string
  station: string
  price_final_crc: number
}

/** Categoría del tile: subclasificación (la misma que ordena el KDS, D4);
 *  si está vacía cae a tipo; si tampoco hay, 'Otros'. */
export function categoryOf(meta: MenuMeta): string {
  return meta.subclasificacion.trim() || meta.tipo.trim() || 'Otros'
}

/**
 * Solo productos ACTIVOS (el meta ya viene filtrado) y CON PRECIO cargado —
 * el grid jamás ofrece algo que el picker bloquearía. Categorías y tiles en
 * alfabético es-CR; el orden fino por más-vendidos es P2.
 */
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
    byCategory.get(category)!.push({ nombre, category, station: m.station, price_final_crc: price })
  }
  const collator = new Intl.Collator('es-CR')
  for (const tiles of byCategory.values()) tiles.sort((a, b) => collator.compare(a.nombre, b.nombre))
  const categories = [...byCategory.keys()].sort(collator.compare)
  return { categories, byCategory }
}
