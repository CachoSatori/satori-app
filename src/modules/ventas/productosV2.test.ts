// Ventas v2 · 3.2 — el módulo puro de «Productos» (SPEC-ventas-v2 §5.2; SPEC-3.1-catalogo §2.3, §2.5.1, §3). Datos ficticios.
import { describe, it, expect } from 'vitest'
import { parsearVentasProductos, type VentasProductosRpc } from '../../shared/api/posNdf'
import {
  cambioEnPuntos, categoriaQueMasMovio, masVendidos, mesesPorCategoria, mixDelPeriodo, popularidad, productosDelPeriodo,
  rangoDoceMeses, sinVentas, subenYBajan,
} from './productosV2'

type Fila = [string | null, string, number | null, string, number, number, number, string, number]
const FAMILIAS = [[2, 'ENTRADAS', 'comida', 1], [3, 'ROLLS', 'comida', 2], [5, 'BEBIDAS', 'bebida', 1], [11, 'MENU', 'comida', 9], [17, 'X CORTESIAS', 'cortesia', 1], [19, 'A PAX', 'pax', 1]]
function rpc(productos: Fila[], o: { sin?: number; catalogo?: unknown[][]; meses?: unknown[][] } = {}): VentasProductosRpc {
  const ventas = productos.filter(f => f[2] === null || ![6, 17, 20].includes(f[2] as number)).reduce((s, f) => s + f[5], 0)
  return parsearVentasProductos({
    productos, meses: o.meses ?? [], catalogo: o.catalogo ?? [], familias: FAMILIAS,
    sin_lineas: { facturas: o.sin ? 1 : 0, cts: o.sin ?? 0 }, neta_cts: ventas + (o.sin ?? 0),
  })
}
const BASE: Fila[] = [
  ['10', 'GYOZA', 2, 'salon', 10, 50_000_00, 8, 'comida', 0],
  ['20', 'ROLL', 3, 'salon', 20, 150_000_00, 15, 'comida', 0],
  ['20', 'ROLL', 3, 'delivery', 5, 40_000_00, 5, 'comida', 0],
  ['30', 'CERVEZA', 5, 'salon', 30, 60_000_00, 20, 'bebida', 0],
  ['192', 'MENU 31', 11, 'salon', 4, 100_000_00, 2, 'menu_especial', 0],
  ['700', 'COPA MENU', 11, 'salon', 4, 0, 2, 'bebida', 4],
  ['99', 'REGALO', 17, 'salon', 2, 9_000_00, 2, 'cortesia', 0],
]

describe('mixDelPeriodo', () => {
  it('ordena por categoría (menú especial tercera), cierra contra la neta y deja la regalía afuera', () => {
    const m = mixDelPeriodo(rpc(BASE, { sin: 1_000_00 }))
    expect(m.categorias.map(c => c.categoria)).toEqual(['comida', 'bebida', 'menu_especial'])
    expect(m.netaCts).toBe(400_000_00 + 1_000_00)
    expect(m.cierra).toBe(true)
    expect(m.fueraDeVenta).toEqual([{ categoria: 'cortesia', rotulo: 'Regalías', montoCts: 9_000_00, unidades: 2 }])
    expect(m.categorias.reduce((s, c) => s + c.participacion, 0) + m.sinDetalleCts / m.netaCts).toBeCloseTo(1, 10)
  })

  it('la categoría la trae la base: la copa en ₡0 del menú (familia 11) va en bebida, no se recalcula por familia', () => {
    const b = mixDelPeriodo(rpc(BASE)).categorias.find(c => c.categoria === 'bebida')!
    expect(b.familias.map(f => f.familia)).toEqual([5, 11])
    expect(b.unidadesCero).toBe(4)
    // precio por ítem = monto ÷ vendidas (30), no ÷ 34 (B-1)
    expect(b.precioItemCts).toBe(2_000_00)
  })

  it('con un canal: la neta es la de ese canal y sin las facturas sin detalle', () => {
    const d = mixDelPeriodo(rpc(BASE, { sin: 1_000_00 }), 'delivery')
    expect(d.netaCts).toBe(40_000_00)
    expect(d.sinDetalleCts).toBe(0)
    expect(d.cierra).toBe(true)
  })
})

describe('precio por ítem y «rinde»', () => {
  it('rinde cuenta N ítems en el precio; todo en ₡0 = sin precio («incluido»)', () => {
    const r = rpc(BASE, { catalogo: [['30', 'CERVEZA', 5, 2, '2026-01-01', '2026-10-31', 'bebida']] })
    const ps = productosDelPeriodo(r)
    expect(ps.find(p => p.codigo === '30')!.precioItemCts).toBe(1_000_00)   // 60.000 ÷ (30 × 2)
    expect(ps.find(p => p.codigo === '700')!.precioItemCts).toBeNull()
  })
})

describe('comparación', () => {
  const actual = rpc(BASE)
  const antes = rpc([
    ['10', 'GYOZA', 2, 'salon', 10, 70_000_00, 8, 'comida', 0],
    ['20', 'ROLL', 3, 'salon', 20, 100_000_00, 15, 'comida', 0],
    ['30', 'CERVEZA', 5, 'salon', 30, 30_000_00, 20, 'bebida', 0],
    ['40', 'SAKE', 5, 'salon', 2, 10_000_00, 2, 'bebida', 0],
  ])
  it('cambio en PUNTOS de participación, y la que más movió el mix', () => {
    const a = mixDelPeriodo(actual), b = mixDelPeriodo(antes)
    // menú especial: 25 % ahora, 0 antes
    expect(cambioEnPuntos(a, b, 'menu_especial')).toBeCloseTo(25, 10)
    expect(cambioEnPuntos(a, null, 'comida')).toBeNull()
    const m = categoriaQueMasMovio(a, b)
    expect(m.categoria!.categoria).toBe('menu_especial')
    expect(m.puntos).toBeCloseTo(25, 10)
  })
  it('suben y bajan: por producto de venta, sin regalías; el que ya no se vendió baja entero', () => {
    const { suben, bajan } = subenYBajan(actual, antes)
    expect(suben.map(x => x.clave)).toEqual(['c:192', 'c:20', 'c:30'])
    expect(bajan.map(x => [x.clave, x.deltaCts])).toEqual([['c:10', -20_000_00], ['c:40', -10_000_00]])
    expect([...suben, ...bajan].some(x => x.categoria === 'cortesia')).toBe(false)
  })
  it('los más vendidos no incluyen lo que no es venta ni lo que va en ₡0', () => {
    expect(masVendidos(actual).map(p => p.codigo)).toEqual(['20', '192', '30', '10'])
  })
})

describe('sin ventas en el período', () => {
  it('activos = vistos desde 90 días antes; sin las categorías que fija la familia', () => {
    const r = rpc(BASE, {
      catalogo: [
        ['10', 'GYOZA', 2, 1, '2025-01-01', '2026-10-31', 'comida'],
        ['50', 'TEMPURA', 2, 1, '2025-01-01', '2026-08-03', 'comida'],   // 89 días antes del 1-nov: activo
        ['51', 'VIEJO', 2, 1, '2025-01-01', '2026-08-02', 'comida'],     // 91: inactivo
        ['60', 'PAX', 19, 1, '2025-01-01', '2026-10-30', 'pax'],         // fija: no es carta
      ],
    })
    expect(sinVentas(r, '2026-11-01').map(s => s.codigo)).toEqual(['50'])
  })
})

describe('popularidad (Kasavana–Smith, eje de popularidad)', () => {
  it('umbral 0,70 ÷ n con todas las servidas × rinde; marca lo incluido en ₡0', () => {
    const r = rpc([
      ['1', 'A', 2, 'salon', 60, 600_00, 1, 'comida', 0],
      ['2', 'B', 2, 'salon', 30, 300_00, 1, 'comida', 0],
      ['3', 'C', 11, 'salon', 10, 0, 1, 'comida', 10],
    ])
    const p = popularidad(r)
    expect(p.umbral).toBeCloseTo(0.7 / 3, 10)
    expect(p.productos.map(x => [x.codigo, x.popular, x.incluido])).toEqual([['1', true, false], ['2', true, false], ['3', false, true]])
  })
})

describe('12 meses', () => {
  it('rango: del día 1 del mes, 11 meses antes, sin pasar del primer día con datos', () => {
    expect(rangoDoceMeses('2026-11-25')).toEqual({ desde: '2025-12-01', hasta: '2026-11-25' })
    expect(rangoDoceMeses('2026-01-31')).toEqual({ desde: '2025-02-01', hasta: '2026-01-31' })
    expect(rangoDoceMeses('2024-06-30')).toEqual({ desde: '2024-01-05', hasta: '2024-06-30' })
  })
  it('por mes y categoría de venta; la regalía y las familias fuera de la venta no suman', () => {
    const r = rpc([], { meses: [
      ['2026-09', 2, 'salon', 3, 300_00, 'comida'], ['2026-09', 5, 'delivery', 1, 100_00, 'bebida'],
      ['2026-09', 17, 'salon', 1, 900_00, 'cortesia'], ['2026-10', 5, 'salon', 2, 200_00, 'bebida'],
    ] })
    expect(mesesPorCategoria(r)).toEqual([
      { mes: '2026-09', netaCts: 400_00, porCategoria: { comida: 300_00, bebida: 100_00 } },
      { mes: '2026-10', netaCts: 200_00, porCategoria: { bebida: 200_00 } },
    ])
    expect(mesesPorCategoria(r, 'delivery')).toEqual([{ mes: '2026-09', netaCts: 100_00, porCategoria: { bebida: 100_00 } }])
  })
})
