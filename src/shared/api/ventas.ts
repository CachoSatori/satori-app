import { supabase } from './supabase'
import type { DiaData, HistDay, ProductInfo, Meta, Comp } from '../types/ventas'

// ── Días ────────────────────────────────────────────────────

// 400 days = ~13 months, covers full current + previous year
// At ~5.5KB/day × 400 = ~2.2MB initial load (acceptable)
// Previous 90-day limit was silently cutting off Jan-Feb when loading in June
export async function getVentasDias(days = 400): Promise<Record<string, DiaData>> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('ventas_dias' as never)
    .select('session_date, data')
    .gte('session_date', sinceStr)
    .order('session_date', { ascending: true })
  if (error) throw new Error(error.message)
  const result: Record<string, DiaData> = {}
  for (const row of (data as Array<{ session_date: string; data: DiaData }> ?? [])) {
    result[row.session_date] = row.data
  }
  return result
}

export async function getAllVentasDias(): Promise<Record<string, DiaData>> {
  const { data, error } = await supabase
    .from('ventas_dias' as never)
    .select('session_date, data')
    .order('session_date', { ascending: true })
  if (error) throw new Error(error.message)
  const result: Record<string, DiaData> = {}
  for (const row of (data as Array<{ session_date: string; data: DiaData }> ?? [])) {
    result[row.session_date] = row.data
  }
  return result
}

export async function saveVentasDia(
  date: string,
  data: DiaData,
  uploadedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('ventas_dias' as never)
    .upsert({
      session_date: date,
      file_name:    data.fileName,
      data:         data as never,
      uploaded_by:  uploadedBy,
      uploaded_at:  new Date().toISOString(),
    } as never, { onConflict: 'session_date' })
  if (error) throw new Error(error.message)
}

export async function deleteVentasDia(date: string): Promise<void> {
  const { error } = await supabase.from('ventas_dias' as never).delete().eq('session_date', date)
  if (error) throw new Error(error.message)
}

// ── Histórico ────────────────────────────────────────────────

export async function getVentasHist(): Promise<Record<string, HistDay>> {
  // PostgREST default limit is 1000 rows — override to avoid silently truncating
  // historical data (we have 1096 days: 2023–2025)
  const { data, error } = await supabase
    .from('ventas_hist' as never)
    .select('session_date, data')
    .order('session_date', { ascending: true })
    .limit(5000)
  if (error) throw new Error(error.message)
  const result: Record<string, HistDay> = {}
  for (const row of (data as Array<{ session_date: string; data: HistDay }> ?? [])) {
    result[row.session_date] = row.data
  }
  return result
}

export async function saveVentasHist(hist: Record<string, HistDay>): Promise<void> {
  const rows = Object.entries(hist).map(([date, d]) => ({
    session_date: date,
    data:         d as never,  // HistDay → JSONB
    source:       'hist',
  }))
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase
      .from('ventas_hist' as never)
      .upsert(rows.slice(i, i + 100) as never[], { onConflict: 'session_date' })
    if (error) throw new Error(error.message)
  }
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
        })) as never[],
        { onConflict: 'nombre' },
      )
    if (error) throw new Error(error.message)
  }
}

export async function updateProductInfo(nombre: string, info: Partial<ProductInfo>): Promise<void> {
  const { error } = await supabase
    .from('product_map')
    .upsert(
      { nombre, ...info, updated_at: new Date().toISOString() } as never,
      { onConflict: 'nombre' },
    )
  if (error) throw new Error(error.message)
}

// ── Metas ────────────────────────────────────────────────────

export async function getMetas(): Promise<Meta> {
  const { data, error } = await supabase.from('ventas_metas' as never).select('*')
  if (error) throw new Error(error.message)
  const defaults: Meta = {
    restaurante: {},
    margen:      {},
    global: { promPax: 15000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7500, ventas: 800000 },
    salMetas:    {},
  }
  for (const row of (data as Array<{ key: string; value: Meta }> ?? [])) {
    if (row.key === 'all') return row.value
  }
  return defaults
}

export async function saveMetas(metas: Meta): Promise<void> {
  const { error } = await supabase
    .from('ventas_metas' as never)
    .upsert(
      { key: 'all', value: metas as never, updated_at: new Date().toISOString() } as never,
      { onConflict: 'key' },
    )
  if (error) throw new Error(error.message)
}

// ── Competencias ─────────────────────────────────────────────

export async function getComps(): Promise<Comp[]> {
  const { data, error } = await supabase
    .from('ventas_comps' as never)
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data as Array<{ data: Comp }> ?? [])).map(r => r.data)
}

export async function saveComp(comp: Comp): Promise<void> {
  // Delete-then-insert: avoids unreliable JSONB path filtering on UPDATE
  await supabase.from('ventas_comps' as never).delete().filter('data->>id', 'eq', comp.id)
  const { error } = await supabase
    .from('ventas_comps' as never)
    .insert({ data: comp as never } as never)
  if (error) throw new Error(error.message)
}

export async function deleteComp(compId: string): Promise<void> {
  await supabase.from('ventas_comps' as never).delete().filter('data->>id', 'eq', compId)
}
