// ── Ventas v2 · 3.2 — «Productos» definitiva (SPEC-ventas-v2 §5.2, SPEC-3.1-catalogo §2.5 y §9.5) — PURO ─────────
//
// Sin I/O, sin Supabase, sin reloj. Arma lo que muestra «Productos» desde lo que devuelve `pos_ventas_productos`
// (mig 198, `getVentasProductos`): una lectura por período y una por cada base de comparación (tope de 3 pedidos).
//
// Reglas (las de la 198 y la 3.1; no se inventa ninguna):
//   · LA CATEGORÍA LA DECIDE LA BASE (`pos_categoria_efectiva`). Acá no se recalcula: se agrupa por lo que trae.
//   · LA NETA NO MIRA CATEGORÍAS. La del período es `neta_cts` de la 198 (= la de «Resumen», función 190, al céntimo).
//     Con un canal elegido es Σ de las líneas de venta de ese canal (la familia de la línea decide qué es venta,
//     `esLineaDeVenta`); las facturas sin líneas no tienen canal en la 198 y solo entran en «Todos».
//   · Σ de las categorías de venta + facturas sin detalle = la neta, al céntimo (`cierra`).
//   · Unidades en ₡0 (B-1 = A, 24-nov): se sirvieron, no se vendieron. Precio por ítem = monto ÷ unidades VENDIDAS ×
//     «rinde»; un producto con todas en ₡0 no tiene precio («incluido»). La popularidad cuenta TODAS las servidas.
//   · «Rinde» (D-1 = A): cuenta N unidades en el precio por ítem y en la popularidad. No toca personas ni la neta.
//   · Participación = venta de la categoría ÷ venta neta del período (con «Facturas sin detalle», cierra en 100 %).

import type { VentaProductoRpc, VentasProductosRpc } from '../../shared/api/posNdf'
import { CATEGORIAS, CATEGORIAS_FIJAS, CATEGORIAS_NO_VENTA, nombreFamilia } from './catalogoPos'
import { rotuloCategoria } from './catalogoAjustes'
import { esLineaDeVenta } from './netaVenta'
import { sumarDias } from './periodos'

/** Quién ve la ingeniería de menú (SPEC-ventas-v2 §6: «Productos — ingeniería de menú»: owner y manager; contador no). */
export const ROLES_INGENIERIA: readonly string[] = ['owner', 'manager']

export type CanalProductos = 'todos' | 'salon' | 'delivery' | 'llevar'
export const CANALES_PRODUCTOS: readonly { id: CanalProductos; label: string }[] = [
  { id: 'todos', label: 'Todos los canales' },
  { id: 'salon', label: 'Salón' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'llevar', label: 'Para llevar' },
]

const noEsVenta = (c: string) => (CATEGORIAS_NO_VENTA as readonly string[]).includes(c)
const ordenCategoria = (c: string): number => {
  const i = (CATEGORIAS as readonly string[]).indexOf(c)
  return i === -1 ? (CATEGORIAS as readonly string[]).indexOf('otros') : i
}
const claveProducto = (f: Pick<VentaProductoRpc, 'codigo' | 'nombre'>): string =>
  f.codigo !== null ? `c:${f.codigo}` : `n:${(f.nombre ?? '').toUpperCase()}`

/** Las filas del canal elegido (`todos` = todas). */
export function filasDelCanal(rpc: Pick<VentasProductosRpc, 'productos'>, canal: CanalProductos): VentaProductoRpc[] {
  return canal === 'todos' ? rpc.productos : rpc.productos.filter(f => f.canal === canal)
}

/** Un producto ya juntado (todas sus filas del período en esa categoría). */
export interface ProductoV2 {
  clave:            string
  codigo:           string | null
  nombre:           string
  familia:          number | null
  categoria:        string
  unidades:         number
  unidadesCero:     number
  unidadesVendidas: number
  rinde:            number
  montoCts:         number
  /** Céntimos por ítem vendido (× rinde); null = todas sus unidades fueron en ₡0 («incluido»). */
  precioItemCts:    number | null
}

export interface FamiliaV2 {
  familia:          number | null
  nombre:           string
  montoCts:         number
  unidades:         number
  unidadesCero:     number
  productos:        ProductoV2[]
}

export interface CategoriaV2 {
  categoria:        string
  rotulo:           string
  montoCts:         number
  unidades:         number
  unidadesCero:     number
  /** Unidades vendidas × rinde (la base del precio por ítem). */
  itemsVendidos:    number
  precioItemCts:    number | null
  /** 0–1 de la neta del período (con el canal elegido). */
  participacion:    number
  familias:         FamiliaV2[]
}

export interface MixV2 {
  netaCts:          number
  /** Facturas sin ninguna línea guardada (solo en «Todos»): su valor servido, que ya está en la neta. */
  sinDetalleCts:    number
  /** Las categorías de venta con movimiento, en el orden fijo de la carta. */
  categorias:       CategoriaV2[]
  /** Lo que no es venta (regalías, personal, ingredientes): se muestra aparte, nunca suma a la neta. */
  fueraDeVenta:     { categoria: string; rotulo: string; montoCts: number; unidades: number }[]
  /** Σ categorías de venta + sin detalle = neta, al céntimo. */
  cierra:           boolean
}

const precio = (montoCts: number, items: number): number | null => (items > 0 ? Math.round(montoCts / items) : null)

/** Los productos del período, juntados por (producto, categoría), con nombre y familia VIGENTES del catálogo. */
export function productosDelPeriodo(rpc: VentasProductosRpc, canal: CanalProductos = 'todos'): ProductoV2[] {
  const cat = new Map(rpc.catalogo.map(c => [c.codigo, c]))
  const acc = new Map<string, ProductoV2>()
  for (const f of filasDelCanal(rpc, canal)) {
    const k = `${claveProducto(f)}|${f.categoria}`
    const c = f.codigo !== null ? cat.get(f.codigo) : undefined
    let p = acc.get(k)
    if (!p) {
      p = {
        clave: claveProducto(f), codigo: f.codigo, nombre: c?.nombre ?? f.nombre ?? f.codigo ?? '',
        familia: c ? c.familia : f.familia, categoria: f.categoria,
        unidades: 0, unidadesCero: 0, unidadesVendidas: 0, rinde: c?.rinde ?? 1, montoCts: 0, precioItemCts: null,
      }
      acc.set(k, p)
    }
    p.unidades += f.unidades
    p.unidadesCero += f.unidadesCero
    p.montoCts += f.montoCts
  }
  return [...acc.values()].map(p => {
    const vendidas = Math.max(0, p.unidades - p.unidadesCero)
    return { ...p, unidadesVendidas: vendidas, precioItemCts: precio(p.montoCts, vendidas * p.rinde) }
  })
}

/** El mix del período: categorías → familias → productos, con su participación en la neta. */
export function mixDelPeriodo(rpc: VentasProductosRpc, canal: CanalProductos = 'todos'): MixV2 {
  const filas = filasDelCanal(rpc, canal)
  const sinDetalleCts = canal === 'todos' ? rpc.sinLineas.cts : 0
  const netaCts = canal === 'todos'
    ? rpc.netaCts
    : filas.reduce((s, f) => s + (esLineaDeVenta(f.familia) ? f.montoCts : 0), 0)
  const ordenFam = new Map(rpc.familias.map(f => [f.familia, f.orden]))
  const porCat = new Map<string, Map<number | null, ProductoV2[]>>()
  for (const p of productosDelPeriodo(rpc, canal)) {
    const fams = porCat.get(p.categoria) ?? new Map<number | null, ProductoV2[]>()
    fams.set(p.familia, [...(fams.get(p.familia) ?? []), p])
    porCat.set(p.categoria, fams)
  }
  const categorias: CategoriaV2[] = []
  const fueraDeVenta: MixV2['fueraDeVenta'] = []
  for (const [categoria, fams] of porCat) {
    const familias: FamiliaV2[] = [...fams.entries()].map(([familia, productos]) => ({
      familia, nombre: nombreFamilia(familia, rpc.familias),
      montoCts: productos.reduce((s, p) => s + p.montoCts, 0),
      unidades: productos.reduce((s, p) => s + p.unidades, 0),
      unidadesCero: productos.reduce((s, p) => s + p.unidadesCero, 0),
      productos: [...productos].sort((a, b) => b.montoCts - a.montoCts || a.nombre.localeCompare(b.nombre, 'es')),
    })).sort((a, b) => (ordenFam.get(a.familia ?? -1) ?? 999) - (ordenFam.get(b.familia ?? -1) ?? 999)
      || a.nombre.localeCompare(b.nombre, 'es'))
    const todos = familias.flatMap(f => f.productos)
    const montoCts = todos.reduce((s, p) => s + p.montoCts, 0)
    const unidades = todos.reduce((s, p) => s + p.unidades, 0)
    if (noEsVenta(categoria)) {
      fueraDeVenta.push({ categoria, rotulo: rotuloCategoria(categoria), montoCts, unidades })
      continue
    }
    const itemsVendidos = todos.reduce((s, p) => s + p.unidadesVendidas * p.rinde, 0)
    categorias.push({
      categoria, rotulo: rotuloCategoria(categoria), montoCts, unidades,
      unidadesCero: todos.reduce((s, p) => s + p.unidadesCero, 0), itemsVendidos,
      precioItemCts: precio(montoCts, itemsVendidos),
      participacion: netaCts !== 0 ? montoCts / netaCts : 0, familias,
    })
  }
  categorias.sort((a, b) => ordenCategoria(a.categoria) - ordenCategoria(b.categoria))
  fueraDeVenta.sort((a, b) => ordenCategoria(a.categoria) - ordenCategoria(b.categoria))
  const suma = categorias.reduce((s, c) => s + c.montoCts, 0) + sinDetalleCts
  return { netaCts, sinDetalleCts, categorias, fueraDeVenta, cierra: suma === netaCts }
}

/** Cambio de la participación en PUNTOS (no en %): 24,1 % contra 22,8 % = +1,3 puntos. null si no hay base. */
export function cambioEnPuntos(actual: MixV2, base: MixV2 | null, categoria: string): number | null {
  if (!base || base.netaCts === 0) return null
  const a = actual.categorias.find(c => c.categoria === categoria)?.participacion ?? 0
  const b = base.categorias.find(c => c.categoria === categoria)?.participacion ?? 0
  return (a - b) * 100
}

/** La categoría que más movió el mix contra la base (mayor cambio en puntos, en valor absoluto). */
export function categoriaQueMasMovio(actual: MixV2, base: MixV2 | null): { categoria: CategoriaV2 | null; puntos: number | null } {
  if (!base || base.netaCts === 0) {
    const mayor = [...actual.categorias].sort((a, b) => b.montoCts - a.montoCts)[0] ?? null
    return { categoria: mayor, puntos: null }
  }
  const cats = new Set([...actual.categorias, ...base.categorias].map(c => c.categoria))
  let mejor: { categoria: string; puntos: number } | null = null
  for (const c of cats) {
    const p = cambioEnPuntos(actual, base, c) ?? 0
    if (!mejor || Math.abs(p) > Math.abs(mejor.puntos)) mejor = { categoria: c, puntos: p }
  }
  if (!mejor) return { categoria: null, puntos: null }
  const enActual = actual.categorias.find(c => c.categoria === mejor.categoria)
  const enBase = base.categorias.find(c => c.categoria === mejor.categoria)
  return { categoria: enActual ?? (enBase ? { ...enBase, montoCts: 0, unidades: 0, participacion: 0 } : null), puntos: mejor.puntos }
}

export interface Movimiento { clave: string; nombre: string; categoria: string; actualCts: number; baseCts: number; deltaCts: number }

/** «Suben y bajan»: los N productos (de venta) que más ganaron y más perdieron venta contra la base. */
export function subenYBajan(actual: VentasProductosRpc, base: VentasProductosRpc, canal: CanalProductos = 'todos', n = 5):
  { suben: Movimiento[]; bajan: Movimiento[] } {
  const juntar = (rpc: VentasProductosRpc) => {
    const m = new Map<string, { nombre: string; categoria: string; cts: number }>()
    for (const p of productosDelPeriodo(rpc, canal)) {
      if (noEsVenta(p.categoria)) continue
      const x = m.get(p.clave) ?? { nombre: p.nombre, categoria: p.categoria, cts: 0 }
      x.cts += p.montoCts
      m.set(p.clave, x)
    }
    return m
  }
  const a = juntar(actual), b = juntar(base)
  const todos: Movimiento[] = [...new Set([...a.keys(), ...b.keys()])].map(k => {
    const x = a.get(k), y = b.get(k)
    const actualCts = x?.cts ?? 0, baseCts = y?.cts ?? 0
    return { clave: k, nombre: x?.nombre ?? y?.nombre ?? k, categoria: x?.categoria ?? y?.categoria ?? 'otros', actualCts, baseCts, deltaCts: actualCts - baseCts }
  })
  const porNombre = (p: Movimiento, q: Movimiento) => p.nombre.localeCompare(q.nombre, 'es')
  return {
    suben: todos.filter(m => m.deltaCts > 0).sort((p, q) => q.deltaCts - p.deltaCts || porNombre(p, q)).slice(0, n),
    bajan: todos.filter(m => m.deltaCts < 0).sort((p, q) => p.deltaCts - q.deltaCts || porNombre(p, q)).slice(0, n),
  }
}

/** Días antes del período en que un producto tiene que haberse visto para contar como activo (S7). */
export const DIAS_ACTIVO = 90

/**
 * «Sin ventas en el período»: productos activos (vistos en una factura desde 90 días antes del período, S7) que no
 * vendieron ninguna unidad en el período. Sin las categorías que fija la familia (gift cards, pax, dueños, regalías,
 * personal, ingredientes): no son productos de la carta. Ordenados categoría → familia → nombre.
 */
export function sinVentas(rpc: VentasProductosRpc, desde: string):
  { codigo: string; nombre: string; familia: number | null; familiaNombre: string; categoria: string; vistoHasta: string }[] {
  const vendidos = new Set(rpc.productos.filter(f => f.codigo !== null && f.unidades > 0).map(f => f.codigo as string))
  const limite = sumarDias(desde, -DIAS_ACTIVO)
  const ordenFam = new Map(rpc.familias.map(f => [f.familia, f.orden]))
  return rpc.catalogo
    .filter(c => c.vistoHasta >= limite && !vendidos.has(c.codigo) && !(CATEGORIAS_FIJAS as readonly string[]).includes(c.categoria))
    .map(c => ({ codigo: c.codigo, nombre: c.nombre, familia: c.familia, familiaNombre: nombreFamilia(c.familia, rpc.familias), categoria: c.categoria, vistoHasta: c.vistoHasta }))
    .sort((a, b) => ordenCategoria(a.categoria) - ordenCategoria(b.categoria)
      || (ordenFam.get(a.familia ?? -1) ?? 999) - (ordenFam.get(b.familia ?? -1) ?? 999)
      || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Los N productos de venta con más venta del período (con su precio por ítem). */
export function masVendidos(rpc: VentasProductosRpc, canal: CanalProductos = 'todos', n = 10): ProductoV2[] {
  return productosDelPeriodo(rpc, canal)
    .filter(p => !noEsVenta(p.categoria) && p.montoCts > 0)
    .sort((a, b) => b.montoCts - a.montoCts || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, n)
}

/** Umbral de Kasavana–Smith: popular si su participación en unidades supera 0,70 ÷ cantidad de platos. */
export const FACTOR_POPULARIDAD = 0.7

export interface Popularidad {
  categoria: string
  umbral:    number
  productos: (ProductoV2 & { servidas: number; participacionUnidades: number; popular: boolean; incluido: boolean })[]
}

/**
 * Ingeniería de menú, eje de popularidad (§5.2 ítem 5): por categoría, con TODAS las unidades servidas × rinde (las en
 * ₡0 cuentan y se señalan: B-1 = A). El eje de margen no está: necesita costos por código (Inventario, 4.x).
 */
export function popularidad(rpc: VentasProductosRpc, categoria = 'comida', canal: CanalProductos = 'todos'): Popularidad {
  const ps = productosDelPeriodo(rpc, canal).filter(p => p.categoria === categoria && p.unidades > 0)
  const total = ps.reduce((s, p) => s + p.unidades * p.rinde, 0)
  const umbral = ps.length > 0 ? FACTOR_POPULARIDAD / ps.length : 0
  return {
    categoria, umbral,
    productos: ps.map(p => {
      const servidas = p.unidades * p.rinde
      const participacionUnidades = total > 0 ? servidas / total : 0
      return { ...p, servidas, participacionUnidades, popular: participacionUnidades > umbral, incluido: p.unidadesVendidas === 0 }
    }).sort((a, b) => b.servidas - a.servidas || a.nombre.localeCompare(b.nombre, 'es')),
  }
}

/** El rango de los últimos 12 meses que terminan en `hasta` (del día 1 del mes, 11 meses antes, a `hasta`). */
export function rangoDoceMeses(hasta: string, primerDia = '2024-01-05'): { desde: string; hasta: string } {
  const [y, m] = hasta.split('-').map(Number)
  const total = y * 12 + (m - 1) - 11
  const desde = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
  return { desde: desde < primerDia ? primerDia : desde, hasta }
}

export interface MesV2 { mes: string; netaCts: number; porCategoria: Record<string, number> }

/**
 * El gráfico de 12 meses (D5): por mes, la venta de cada categoría de venta (las de ₡0 y las que no son venta, afuera).
 * Sale de `meses` de la 198, con un solo pedido. La neta del mes acá es Σ de las líneas de venta: sin las facturas sin
 * detalle (la 198 no las parte por mes).
 */
export function mesesPorCategoria(rpc: Pick<VentasProductosRpc, 'meses'>, canal: CanalProductos = 'todos'): MesV2[] {
  const out = new Map<string, MesV2>()
  for (const f of rpc.meses) {
    if (canal !== 'todos' && f.canal !== canal) continue
    if (!esLineaDeVenta(f.familia) || noEsVenta(f.categoria)) continue
    const m = out.get(f.mes) ?? { mes: f.mes, netaCts: 0, porCategoria: {} }
    m.netaCts += f.montoCts
    m.porCategoria[f.categoria] = (m.porCategoria[f.categoria] ?? 0) + f.montoCts
    out.set(f.mes, m)
  }
  return [...out.values()].sort((a, b) => a.mes.localeCompare(b.mes))
}

export interface BebidasPorPersona {
  /** Unidades vendidas (sin las de ₡0) × «rinde» de las líneas de venta de categoría bebida, en salón. */
  vendidas:  number
  /** Las de ₡0 (incluidas en un menú cerrado o invitaciones) × «rinde»: se muestran aparte, no suman. */
  incluidas: number
  /** vendidas ÷ personas de salón; null si no hay personas. */
  valor:     number | null
}

/**
 * Ventas v2 · 3.2b — «Bebidas por persona» (SPEC-ventas-v2 §4.1, desde la 3.2; SPEC-3.1 §2.5.1 B-1 y D-1): bebidas
 * VENDIDAS de salón (canal de la factura) × «rinde» ÷ personas de salón. `personas` es el denominador de la venta por
 * persona de «Resumen» (cargadas + estimadas, sin mesas de dueños ni regalías totales; D4, una sola en toda la app).
 */
export function bebidasPorPersona(rpc: Pick<VentasProductosRpc, 'productos' | 'catalogo'>, personas: number): BebidasPorPersona {
  const rinde = new Map(rpc.catalogo.map(c => [c.codigo, c.rinde]))
  let vendidas = 0, incluidas = 0
  for (const f of rpc.productos) {
    if (f.canal !== 'salon' || f.categoria !== 'bebida' || !esLineaDeVenta(f.familia)) continue
    const r = f.codigo !== null ? rinde.get(f.codigo) ?? 1 : 1
    vendidas += Math.max(0, f.unidades - f.unidadesCero) * r
    incluidas += f.unidadesCero * r
  }
  return { vendidas, incluidas, valor: personas > 0 ? vendidas / personas : null }
}

export interface RatioComidaBebida {
  comidaCts: number
  bebidaCts: number
  /** comida ÷ bebida; null si no hay bebida (nunca infinito). */
  valor:     number | null
}

/**
 * Ventas v2 · 3.2c — «Relación comida/bebida» (SPEC-ventas-v2 §4.1, desde la 3.2): neta de categoría comida ÷ neta de
 * categoría bebida, de las líneas de venta del canal (por defecto salón, como «Salón en detalle»). La categoría la da la
 * base (`pos_categoria_efectiva`, mig 198), la misma de «Productos»; `menu_especial` no entra en ninguna de las dos.
 */
export function ratioComidaBebida(rpc: Pick<VentasProductosRpc, 'productos'>, canal: CanalProductos = 'salon'): RatioComidaBebida {
  let comidaCts = 0, bebidaCts = 0
  for (const f of filasDelCanal(rpc, canal)) {
    if (!esLineaDeVenta(f.familia)) continue
    if (f.categoria === 'comida') comidaCts += f.montoCts
    else if (f.categoria === 'bebida') bebidaCts += f.montoCts
  }
  return { comidaCts, bebidaCts, valor: bebidaCts > 0 ? comidaCts / bebidaCts : null }
}
