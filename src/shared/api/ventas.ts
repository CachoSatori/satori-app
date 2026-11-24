import { supabase } from './supabase'
import { puedeEditarCompetencias, SIN_PERMISO_COMPETENCIAS } from '../permisosCompetencias'
import type { HistDay, ProductInfo, Meta, Comp } from '../types/ventas'
import type { Json } from '../types/supabase.gen'

// ── Días ────────────────────────────────────────────────────
// 16-nov-2026 (decisión del dueño): las ventas del día se leen SOLO del PoS
// (`modules/ventas/ventasFuente.ts`). La carga y la lectura de `ventas_dias` (xls) se retiraron;
// la tabla queda como histórico, sin borrar nada.

// ── Histórico ────────────────────────────────────────────────

/**
 * `ventas_hist` (reporte general 2023-2025). La app usa SOLO lo anterior al corte del PoS
 * (`combinarHist` en `ventasFuente.ts`); se pide entero y se recorta allá, para que la regla del
 * corte viva en un solo lugar.
 */
export async function getVentasHist(): Promise<Record<string, HistDay>> {
  // PostgREST default limit is 1000 rows — override to avoid silently truncating
  // historical data (we have 1096 days: 2023–2025)
  const { data, error } = await supabase
    .from('ventas_hist')
    .select('session_date, data')
    .order('session_date', { ascending: true })
    .limit(5000)
  if (error) throw new Error(error.message)
  const result: Record<string, HistDay> = {}
  for (const row of (data as unknown as Array<{ session_date: string; data: HistDay }> ?? [])) {
    result[row.session_date] = row.data
  }
  return result
}

// ── Product Map ──────────────────────────────────────────────

export async function getProductMap(): Promise<Record<string, ProductInfo>> {
  const { data, error } = await supabase.from('product_map').select('*')
  if (error) throw new Error(error.message)
  const result: Record<string, ProductInfo> = {}
  for (const row of (data as Array<{nombre:string;tipo:string;clasificacion:string;subclasificacion:string;multiplicador:number;costo_unitario:number}> ?? [])) {
    result[row.nombre] = {
      tipo:             row.tipo,
      clasificacion:    row.clasificacion ?? '',
      subclasificacion: row.subclasificacion ?? '',
      multiplicador:    row.multiplicador ?? 1,
      costo_unitario:   row.costo_unitario ?? 0,
    }
  }
  return result
}

export async function saveProductMapItems(
  items: Array<{ nombre: string } & ProductInfo>,
): Promise<void> {
  for (let i = 0; i < items.length; i += 100) {
    const { error } = await supabase
      .from('product_map')
      .upsert(items.slice(i, i + 100).map(it => ({
          nombre:           it.nombre,
          tipo:             it.tipo,
          clasificacion:    it.clasificacion,
          subclasificacion: it.subclasificacion,
          multiplicador:    it.multiplicador,
          costo_unitario:   it.costo_unitario ?? 0,
          updated_at:       new Date().toISOString(),
        })),
        { onConflict: 'nombre' },
      )
    if (error) throw new Error(error.message)
  }
}

export async function updateProductInfo(nombre: string, info: Partial<ProductInfo>): Promise<void> {
  // `tipoDeFamilia` es una marca de RUNTIME (quién puso el tipo: la familia del PoS o una
  // persona). No es una columna de `product_map` y no se persiste — se descarta acá para que
  // no viaje nunca al upsert.
  const persistible: Record<string, unknown> = { ...info }
  delete persistible.tipoDeFamilia
  const { error } = await supabase
    .from('product_map')
    .upsert(
      { nombre, ...persistible, updated_at: new Date().toISOString() },
      { onConflict: 'nombre' },
    )
  if (error) throw new Error(error.message)
}

// ── Metas ────────────────────────────────────────────────────

export async function getMetas(): Promise<Meta> {
  const { data, error } = await supabase.from('ventas_metas').select('*')
  if (error) throw new Error(error.message)
  const defaults: Meta = {
    restaurante: {},
    margen:      {},
    global: { promPax: 15000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7500, ventas: 800000 },
    salMetas:    {},
  }
  for (const row of (data as unknown as Array<{ key: string; value: Meta }> ?? [])) {
    if (row.key === 'all') return row.value
  }
  return defaults
}

export async function saveMetas(metas: Meta): Promise<void> {
  const { error } = await supabase
    .from('ventas_metas')
    .upsert(
      { key: 'all', value: metas as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) throw new Error(error.message)
}

// ── Competencias ─────────────────────────────────────────────

export async function getComps(): Promise<Comp[]> {
  const { data, error } = await supabase
    .from('ventas_comps')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data as unknown as Array<{ data: Comp }> ?? [])).map(r => r.data)
}

export async function saveComp(comp: Comp, role: string): Promise<void> {
  if (!puedeEditarCompetencias(role)) throw new Error(SIN_PERMISO_COMPETENCIAS)
  // Delete-then-insert: avoids unreliable JSONB path filtering on UPDATE
  await supabase.from('ventas_comps').delete().filter('data->>id', 'eq', comp.id)
  const { error } = await supabase
    .from('ventas_comps')
    .insert({ data: comp as unknown as Json })
  if (error) throw new Error(error.message)
}

export async function deleteComp(compId: string, role: string): Promise<void> {
  if (!puedeEditarCompetencias(role)) throw new Error(SIN_PERMISO_COMPETENCIAS)
  await supabase.from('ventas_comps').delete().filter('data->>id', 'eq', compId)
}
