// D16 (decisión del dueño, 23-nov; SPEC Ventas v2 §10.3): en TODA la app, cualquier selector o lista de locales muestra
// Santa Teresa primero y la elige por defecto. La app sigue siendo multi-local: esta es la ÚNICA regla de orden y de
// local por defecto; las pantallas no ordenan por su cuenta ni eligen «el primero que vino de la base».
//
// Orden: activos primero · entre los activos, el local principal (`santa-teresa`, el id de `public.locations` desde la
// mig 091) primero · después alfabético por nombre (y por id si el nombre empata). Los inactivos, al final, con la
// misma regla entre ellos. Un local nuevo entra solo en su lugar alfabético: no hay que tocar código para sumarlo.

/** El id del local principal en `public.locations` (mig 091). Mismo slug que `work_days.local` y el PoS. */
export const LOCAL_PRINCIPAL = 'santa-teresa'

/** Lo mínimo que la regla necesita de un local. `activo` ausente cuenta como activo (listas que ya vienen filtradas). */
export interface LocalOrdenable {
  id: string
  nombre?: string | null
  activo?: boolean | null
}

const comoLocal = (l: unknown): LocalOrdenable => l as LocalOrdenable
const estaActivo = (l: LocalOrdenable) => l.activo !== false
const nombreDe = (l: LocalOrdenable) => (l.nombre ?? '').trim() || l.id

/** Compara dos locales según D16. Exportada para las pruebas y para quien ordene en el lugar. */
export function compararLocales(a: LocalOrdenable, b: LocalOrdenable): number {
  const act = Number(estaActivo(b)) - Number(estaActivo(a))
  if (act !== 0) return act
  const pri = Number(b.id === LOCAL_PRINCIPAL) - Number(a.id === LOCAL_PRINCIPAL)
  if (pri !== 0) return pri
  return nombreDe(a).localeCompare(nombreDe(b), 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id)
}

/**
 * Devuelve una copia ordenada (no toca la lista original). `ver` traduce la forma de cada pantalla
 * (`{ id, name, is_active }`, `{ id, label }`…) a `LocalOrdenable`; por defecto se lee tal cual.
 */
export function ordenarLocales<T>(locales: readonly T[], ver: (l: T) => LocalOrdenable = comoLocal): T[] {
  return [...locales].sort((a, b) => compararLocales(ver(a), ver(b)))
}

/**
 * El local con el que arranca una pantalla, entre los que el usuario puede ver (`locales`, ya filtrados por rol /
 * `mis_locales`):
 *   1. el que ya tenía elegido o guardado (URL, navegador), si sigue entre los visibles;
 *   2. Santa Teresa, si la ve y está activa;
 *   3. el primero de la lista ordenada (activos primero).
 * Sin locales → null (la pantalla decide qué mostrar).
 */
export function localPorDefecto<T>(
  locales: readonly T[],
  guardado?: string | null,
  ver: (l: T) => LocalOrdenable = comoLocal,
): string | null {
  const vistos = locales.map(ver)
  if (guardado && vistos.some(l => l.id === guardado)) return guardado
  const principal = vistos.find(l => l.id === LOCAL_PRINCIPAL && estaActivo(l))
  if (principal) return principal.id
  return [...vistos].sort(compararLocales)[0]?.id ?? null
}
