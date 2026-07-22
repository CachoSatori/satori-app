// FIX 1 — `getAllCashMovements` tiene que traer TODO, aunque haya más filas que el `max_rows`
// de PostgREST.
//
// El bug real (staging, 2026-07-22): el select no tenía `.range()` ni `.limit()`, PostgREST
// cortaba en 1.000 filas y devolvía esa página SIN AVISAR. Con 1.425 movimientos la app veía
// solo las 1.000 más recientes y la tarjeta "Caja Fuerte" mostraba un número inventado.
//
// El segundo criterio de orden (`id`) tampoco es cosmético: 1.242 de las 1.425 filas comparten
// timestamp con otra, así que sin desempate único el paginado saltea y duplica.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = { id: string; created_at: string; amount_crc: number }

/** Doble de PostgREST: aplica el orden pedido, corta en `maxRows` y respeta `.range()`. */
function fakeSupabase(filas: Fila[], maxRows: number) {
  const llamadas: { from: number; to: number }[] = []
  const orden: string[] = []
  const api = {
    from: () => api,
    select: () => api,
    gte: () => api,
    order: (col: string, o?: { ascending?: boolean }) => {
      orden.push(`${col}:${o?.ascending === false ? 'desc' : 'asc'}`)
      return api
    },
    range: (from: number, to: number) => {
      llamadas.push({ from, to })
      const ordenadas = [...filas].sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      const pedidas = to - from + 1
      const data = ordenadas.slice(from, from + Math.min(pedidas, maxRows))
      return Promise.resolve({ data, error: null })
    },
  }
  return { api, llamadas, orden }
}

const api = vi.hoisted(() => ({ cliente: { from: (): unknown => ({}) } }))
vi.mock('./supabase', () => ({ supabase: api.cliente }))
vi.mock('./cache', () => ({ cachedFetch: (_k: string, fn: () => unknown) => fn(), invalidate: () => {} }))
vi.mock('../offline/outbox', () => ({ applyPendingCash: (r: unknown) => r, enqueue: () => {} }))

const { getAllCashMovements } = await import('./cash')

/** 1.425 filas, y 1.242 de ellas compartiendo timestamp — el escenario real de staging. */
function universoRealista(n = 1425): Fila[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    // Muchos empates a propósito: 12 filas por cada instante, como las cargas históricas.
    created_at: `2026-02-${String((i % 28) + 1).padStart(2, '0')}T12:00:00+00:00`,
    amount_crc: i,
  }))
}

describe('getAllCashMovements — paginación', () => {
  beforeEach(() => vi.clearAllMocks())

  it('trae TODAS las filas aunque superen el max_rows de PostgREST', async () => {
    const filas = universoRealista(1425)
    const { api: fake } = fakeSupabase(filas, 1000)
    api.cliente.from = fake.from as never

    const r = (await getAllCashMovements()) as unknown as Fila[]
    expect(r).toHaveLength(1425)
    // Sin duplicados: el desempate por id garantiza páginas disjuntas.
    expect(new Set(r.map(x => x.id)).size).toBe(1425)
  })

  it('con el fetch VIEJO (una sola página, sin range) se habrían perdido 425 filas', async () => {
    // Deja explícito el tamaño del agujero que este fix cierra.
    const filas = universoRealista(1425)
    const { api: fake } = fakeSupabase(filas, 1000)
    const unaSolaPagina = await fake.range(0, 1_000_000)
    expect((unaSolaPagina.data as Fila[]).length).toBe(1000)
    expect(1425 - 1000).toBe(425)
  })

  it('ordena por created_at Y por id: sin ese desempate el paginado es inseguro', async () => {
    const { api: fake, orden } = fakeSupabase(universoRealista(600), 1000)
    api.cliente.from = fake.from as never
    await getAllCashMovements()
    expect(orden).toContain('created_at:desc')
    expect(orden).toContain('id:desc')
  })

  it('pide páginas hasta agotar y corta cuando el lote viene incompleto', async () => {
    const { api: fake, llamadas } = fakeSupabase(universoRealista(1200), 1000)
    api.cliente.from = fake.from as never
    await getAllCashMovements()
    // 1200 filas con páginas de 500 → 500 + 500 + 200 (la última incompleta corta el loop)
    expect(llamadas.length).toBe(3)
    expect(llamadas[0]).toEqual({ from: 0, to: 499 })
  })

  it('un universo vacío devuelve lista vacía con una sola llamada', async () => {
    const { api: fake, llamadas } = fakeSupabase([], 1000)
    api.cliente.from = fake.from as never
    expect(await getAllCashMovements()).toEqual([])
    expect(llamadas.length).toBe(1)
  })

  it('un universo múltiplo exacto del tamaño de página no pierde filas', async () => {
    const { api: fake } = fakeSupabase(universoRealista(1000), 1000)
    api.cliente.from = fake.from as never
    expect((await getAllCashMovements()) as unknown as Fila[]).toHaveLength(1000)
  })
})
