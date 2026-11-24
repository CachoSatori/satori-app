// ── Ventas v2 · 3.1a — el catálogo por código del PoS (mig 196) — PURO ─────────────────────────────────────────
//
// Sin I/O, sin Supabase, sin reloj. Arma lo que la pantalla «Productos» (3.2) y «Ajustes → Catálogo» (3.1b) van a
// mostrar a partir de lo que devuelven `pos_ventas_productos` y `pos_catalogo_productos` (lectores en
// `shared/api/posNdf.ts`). Reglas (SPEC-3.1-catalogo §2 y §3):
//
//   · LA CATEGORÍA LA DECIDE LA BASE. Cada fila trae su categoría efectiva (`pos_categoria_efectiva`); acá no se
//     recalcula ni se «corrige» con la familia. Una sola definición, en un solo lugar.
//   · LA CATEGORÍA NUNCA DECIDE LA VENTA. La neta se suma por la FAMILIA DE LA LÍNEA (fuera: `FAMILIAS_NO_VENTA`,
//     firmada en `netaVenta.ts`), sin mirar categorías. Con cualquier categoría cargada por código, la neta es la misma.
//   · Orden: categoría (orden fijo de `CATEGORIAS`) → orden de la familia → nombre.
//   · Un producto se muestra UNA vez por categoría, con el nombre y la familia VIGENTES del catálogo, aunque en el
//     período haya vendido en dos familias o en dos canales. Una familia sin fila sale «Familia N» (en `otros`).
//   · Unidades en ₡0 (pasos de un menú cerrado, invitaciones): se sirvieron, no se vendieron. Unidades vendidas =
//     unidades − unidades en ₡0; un producto con todas en ₡0 no tiene precio por ítem (null → «incluido»).

import type { CatalogoVentaRpc, FamiliaPosRpc, VentaProductoRpc, VentasProductosRpc } from '../../shared/api/posNdf'
import { FAMILIAS_NO_VENTA, esLineaDeVenta } from './netaVenta'

/** Las 12 categorías, en el orden en que se muestran. `menu_especial` va tercera (venta gastronómica). */
export const CATEGORIAS = [
  'comida', 'bebida', 'menu_especial', 'extras', 'otros', 'merch',
  'giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes',
] as const
export type Categoria = (typeof CATEGORIAS)[number]

/** Lo que una persona puede elegir para un código (la 196 lo valida en el `check`, en la función y lo devuelve). */
export const CATEGORIAS_EDITABLES: readonly Categoria[] = ['comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros']
/** Las que fija la familia: no se eligen a mano ni se le cambian a un producto. */
export const CATEGORIAS_FIJAS: readonly Categoria[] = ['giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes']
/** Las categorías de lo que NO es venta (familias 6, 17 y 20). */
export const CATEGORIAS_NO_VENTA: readonly Categoria[] = ['cortesia', 'personal', 'ingredientes']

export { FAMILIAS_NO_VENTA }

const ordenCategoria = (c: string): number => {
  const i = (CATEGORIAS as readonly string[]).indexOf(c)
  return i === -1 ? CATEGORIAS.indexOf('otros') : i
}

/** El rótulo de una familia: el nombre del PoS, o «Familia N» si todavía no tiene fila. */
export function nombreFamilia(familia: number | null, familias: readonly FamiliaPosRpc[]): string {
  if (familia === null) return 'Sin familia'
  return familias.find(f => f.familia === familia)?.nombre ?? `Familia ${familia}`
}

/** Un producto del mix del período, ya juntado. */
export interface ProductoMix {
  /** null = línea sin código (se agrupa por nombre). */
  codigo:            string | null
  /** El nombre vigente del catálogo (o el de las líneas si el código no está en el catálogo). */
  nombre:            string
  /** La familia vigente del catálogo (o la de la primera fila). */
  familia:           number | null
  familiaNombre:     string
  /** La que trajo la base. */
  categoria:         string
  unidades:          number
  unidadesCero:      number
  /** unidades − unidades en ₡0. */
  unidadesVendidas:  number
  montoCts:          number
  facturas:          number
  /** Céntimos por unidad vendida; null si no tiene ninguna vendida (todo en ₡0 → «incluido»). */
  precioPorItemCts:  number | null
  /** «rinde» del catálogo (1 si no tiene ajuste). Lo aplica la 3.2 donde la SPEC lo pide; acá solo viaja. */
  rinde:             number
}

/** Unidades vendidas de una fila: las que no fueron en ₡0. */
export function unidadesVendidas(f: Pick<VentaProductoRpc, 'unidades' | 'unidadesCero'>): number {
  return Math.max(0, f.unidades - f.unidadesCero)
}

/** Precio por ítem en céntimos (entero), o null si no hay unidades vendidas. */
export function precioPorItemCts(montoCts: number, vendidas: number): number | null {
  return vendidas > 0 ? Math.round(montoCts / vendidas) : null
}

const claveProducto = (f: Pick<VentaProductoRpc, 'codigo' | 'nombre'>): string =>
  f.codigo !== null ? `c:${f.codigo}` : `n:${(f.nombre ?? '').toUpperCase()}`

/**
 * El mix del período: una fila por (producto, categoría), con el nombre y la familia vigentes del catálogo, ordenado
 * categoría → familia → nombre. `canal` filtra (null = todos). No recalcula ninguna categoría.
 */
export function armarProductos(rpc: VentasProductosRpc, opciones: { canal?: string | null } = {}): ProductoMix[] {
  const porCodigo = new Map<string, CatalogoVentaRpc>(rpc.catalogo.map(c => [c.codigo, c]))
  const acc = new Map<string, ProductoMix>()
  for (const f of rpc.productos) {
    if (opciones.canal && f.canal !== opciones.canal) continue
    const k = `${claveProducto(f)}|${f.categoria}`
    const cat = f.codigo !== null ? porCodigo.get(f.codigo) : undefined
    let p = acc.get(k)
    if (!p) {
      const familia = cat ? cat.familia : f.familia
      p = {
        codigo: f.codigo, nombre: cat?.nombre ?? f.nombre ?? f.codigo ?? '', familia,
        familiaNombre: nombreFamilia(familia, rpc.familias), categoria: f.categoria,
        unidades: 0, unidadesCero: 0, unidadesVendidas: 0, montoCts: 0, facturas: 0, precioPorItemCts: null,
        rinde: cat?.rinde ?? 1,
      }
      acc.set(k, p)
    }
    p.unidades += f.unidades
    p.unidadesCero += f.unidadesCero
    p.montoCts += f.montoCts
    // Una factura con el producto en dos canales o familias se cuenta en cada fila: es un tope, no un conteo exacto.
    p.facturas += f.facturas
  }
  const ordenFamilia = new Map(rpc.familias.map(f => [f.familia, f.orden]))
  const out = [...acc.values()].map(p => {
    const vendidas = unidadesVendidas(p)
    return { ...p, unidadesVendidas: vendidas, precioPorItemCts: precioPorItemCts(p.montoCts, vendidas) }
  })
  return out.sort((a, b) =>
    ordenCategoria(a.categoria) - ordenCategoria(b.categoria)
    || (ordenFamilia.get(a.familia ?? -1) ?? 999) - (ordenFamilia.get(b.familia ?? -1) ?? 999)
    || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Σ céntimos por categoría (todas, también las que no son venta). */
export function montoPorCategoria(rpc: VentasProductosRpc): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of rpc.productos) out.set(f.categoria, (out.get(f.categoria) ?? 0) + f.montoCts)
  return out
}

/**
 * La neta del período en céntimos, desde las filas: Σ de las líneas cuya FAMILIA es venta (`esLineaDeVenta`, la
 * firmada) + las facturas sin líneas. No mira categorías: es la misma cuenta que `neta_cts` de la 196 y la de la 190.
 */
export function netaDeProductos(rpc: Pick<VentasProductosRpc, 'productos' | 'sinLineas'>): number {
  let cts = rpc.sinLineas.cts
  for (const f of rpc.productos) if (esLineaDeVenta(f.familia)) cts += f.montoCts
  return cts
}

/** Lo mismo, partido por canal (para cerrar contra el salón/delivery de «Resumen»). Sin las facturas sin líneas. */
export function netaPorCanal(rpc: Pick<VentasProductosRpc, 'productos'>): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of rpc.productos) if (esLineaDeVenta(f.familia)) out.set(f.canal, (out.get(f.canal) ?? 0) + f.montoCts)
  return out
}

/** Lo mismo, partido por la familia de la línea. */
export function netaPorFamilia(rpc: Pick<VentasProductosRpc, 'productos'>): Map<number | null, number> {
  const out = new Map<number | null, number>()
  for (const f of rpc.productos) if (esLineaDeVenta(f.familia)) out.set(f.familia, (out.get(f.familia) ?? 0) + f.montoCts)
  return out
}

/** ¿Cierra la venta por categoría contra la neta? Σ categorías de venta + sin líneas = neta (la base lo garantiza). */
export function cierraPorCategoria(rpc: VentasProductosRpc): boolean {
  let cts = rpc.sinLineas.cts
  for (const [c, m] of montoPorCategoria(rpc)) if (!(CATEGORIAS_NO_VENTA as readonly string[]).includes(c)) cts += m
  return cts === rpc.netaCts
}

/** Familias que aparecen en el período sin fila en `pos_familias` (para avisar: la plata ya está en la neta). */
export function familiasSinFila(rpc: Pick<VentasProductosRpc, 'productos' | 'familias'>): number[] {
  const conFila = new Set(rpc.familias.map(f => f.familia))
  const out = new Set<number>()
  for (const f of rpc.productos) if (f.familia !== null && !conFila.has(f.familia)) out.add(f.familia)
  return [...out].sort((a, b) => a - b)
}
