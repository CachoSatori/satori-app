// Ventas v2 · 3.1a — catalogoPos (puro). Datos FICTICIOS con la forma de `pos_ventas_productos` (mig 196).
import { describe, it, expect } from 'vitest'
import { parsearVentasProductos, type VentasProductosRpc } from '../../shared/api/posNdf'
import {
  CATEGORIAS, CATEGORIAS_NO_VENTA, FAMILIAS_NO_VENTA, armarProductos, cierraPorCategoria, familiasSinFila, montoPorCategoria,
  netaDeProductos, netaPorCanal, nombreFamilia, precioPorItemCts, unidadesVendidas,
} from './catalogoPos'

// [codigo, nombre, familia, canal, unidades, monto_cts, facturas, categoria, unidades_cero]
const BASE = {
  productos: [
    ['9001', 'ROLL VIEJO', 2, 'salon', 1, 100000, 1, 'comida', 0],
    ['9001', 'ROLL FICTICIO', 3, 'delivery', 1, 350000, 1, 'comida', 0],
    ['9001', 'ROLL FICTICIO', 3, 'salon', 3, 710000, 2, 'comida', 0],
    ['9002', 'TRAGO FICTICIO', 5, 'salon', 1, 300000, 1, 'bebida', 0],
    ['9002', 'TRAGO FICTICIO', 17, 'salon', 1, 80000, 1, 'cortesia', 0],
    ['9008', 'PASO DE MENU', 5, 'salon', 3, 0, 1, 'bebida', 3],
    ['9009', 'MENU POR PERSONA', 11, 'salon', 4, 400000, 1, 'menu_especial', 0],
    ['9010', 'POSTRE FICTICIO', 4, 'salon', 2, 9000, 1, 'comida', 0],
    ['9011', 'CAMISETA FICTICIA', 31, 'salon', 1, 1500000, 1, 'otros', 0],
    [null, 'SIN CODIGO', 22, 'salon', 1, 50000, 1, 'extras', 0],
    ['9004', 'PERSONAL FICTICIO', 6, 'salon', 1, 200000, 1, 'personal', 0],
  ],
  meses: [],
  catalogo: [
    ['9001', 'ROLL FICTICIO NUEVO', 3, 2, '2026-10-01', '2026-11-22', 'comida'],
    ['9002', 'TRAGO FICTICIO', 5, 1, '2026-10-01', '2026-11-20', 'bebida'],
  ],
  familias: [[2, 'FICTICIA 2', 'comida', 10], [3, 'FICTICIA 3', 'comida', 20], [4, 'FICTICIA 4', 'comida', 50],
    [5, 'FICTICIA 5', 'bebida', 10], [11, 'FICTICIA 11', 'comida', 70], [22, 'FICTICIA 22', 'extras', 10],
    [6, 'FICTICIA 6', 'personal', 10], [17, 'FICTICIA 17', 'cortesia', 10]],
  sin_lineas: { facturas: 1, cts: 123450 },
  neta_cts: 100000 + 350000 + 710000 + 300000 + 0 + 400000 + 9000 + 1500000 + 50000 + 123450,
}
const rpc = (o: Partial<typeof BASE> = {}): VentasProductosRpc => parsearVentasProductos({ ...BASE, ...o })

describe('catalogoPos — orden y agrupado', () => {
  const ps = armarProductos(rpc())
  it('orden: categoría (menu_especial tercera) → orden de la familia → nombre', () => {
    expect(ps.map(p => `${p.categoria}:${p.codigo ?? p.nombre}`)).toEqual([
      'comida:9001', 'comida:9010', 'bebida:9008', 'bebida:9002', 'menu_especial:9009', 'extras:SIN CODIGO', 'otros:9011',
      'cortesia:9002', 'personal:9004'])
    expect(CATEGORIAS.indexOf('menu_especial')).toBe(2)
  })
  it('un código con dos familias y dos canales en el período se muestra UNA vez, con nombre y familia vigentes', () => {
    const roll = ps.filter(p => p.codigo === '9001')
    expect(roll).toHaveLength(1)
    expect(roll[0]).toMatchObject({ nombre: 'ROLL FICTICIO NUEVO', familia: 3, familiaNombre: 'FICTICIA 3', unidades: 5, montoCts: 1160000, rinde: 2 })
  })
  it('la línea sin código va por su nombre', () => {
    expect(ps.find(p => p.codigo === null)).toMatchObject({ nombre: 'SIN CODIGO', categoria: 'extras', montoCts: 50000 })
  })
  it('familia sin fila → «Familia N», en la categoría que mandó la base (otros), y se avisa', () => {
    expect(ps.find(p => p.codigo === '9011')).toMatchObject({ familiaNombre: 'Familia 31', categoria: 'otros' })
    expect(familiasSinFila(rpc())).toEqual([31])
    expect(nombreFamilia(null, [])).toBe('Sin familia')
  })
  it('la categoría de cada fila es la que manda la función: la app no la recalcula con la familia', () => {
    // la familia 3 es comida por defecto, pero la base dice bebida (una persona lo cambió): manda la base
    const r = rpc({ productos: [['9001', 'X', 3, 'salon', 1, 1000, 1, 'bebida', 0]], catalogo: [], sin_lineas: { facturas: 0, cts: 0 }, neta_cts: 1000 })
    expect(armarProductos(r)[0].categoria).toBe('bebida')
  })
  it('filtra por canal', () => {
    expect(armarProductos(rpc(), { canal: 'delivery' }).map(p => p.codigo)).toEqual(['9001'])
  })
})

describe('catalogoPos — unidades en ₡0', () => {
  it('unidades vendidas = unidades − unidades en ₡0', () => {
    expect(unidadesVendidas({ unidades: 5, unidadesCero: 2 })).toBe(3)
    expect(armarProductos(rpc()).find(p => p.codigo === '9008')).toMatchObject({ unidades: 3, unidadesCero: 3, unidadesVendidas: 0 })
  })
  it('un producto con todas sus unidades en ₡0 no tiene precio (null, no ₡0)', () => {
    expect(armarProductos(rpc()).find(p => p.codigo === '9008')?.precioPorItemCts).toBeNull()
    expect(precioPorItemCts(9000, 2)).toBe(4500)
    expect(precioPorItemCts(0, 0)).toBeNull()
  })
})

describe('catalogoPos — la categoría nunca mueve la venta', () => {
  it('FAMILIAS_NO_VENTA = {6, 17, 20} y sus categorías son cortesia, personal e ingredientes', () => {
    expect([...FAMILIAS_NO_VENTA].sort((a, b) => a - b)).toEqual([6, 17, 20])
    expect([...CATEGORIAS_NO_VENTA]).toEqual(['cortesia', 'personal', 'ingredientes'])
  })
  it('la neta del módulo = neta_cts de la base, y la venta por categoría cierra', () => {
    expect(netaDeProductos(rpc())).toBe(BASE.neta_cts)
    expect(cierraPorCategoria(rpc())).toBe(true)
  })
  it('con cualquier categoría por código, la neta que suma el módulo NO cambia', () => {
    const categorias = ['comida', 'bebida', 'menu_especial', 'extras', 'otros', 'merch', 'cortesia', 'personal']
    for (const c of categorias) {
      const otra = rpc({ productos: BASE.productos.map(f => [...f.slice(0, 7), c, f[8]]) as typeof BASE.productos })
      expect(netaDeProductos(otra), c).toBe(BASE.neta_cts)
    }
  })
  it('lo regalado (familia 17) no es venta aunque el producto sea bebida, y lo vendido sí', () => {
    const canal = netaPorCanal(rpc())
    expect(canal.get('salon')).toBe(100000 + 710000 + 300000 + 400000 + 9000 + 1500000 + 50000)
    expect(montoPorCategoria(rpc()).get('cortesia')).toBe(80000)
  })
  it('menu_especial es venta: su plata está en la neta', () => {
    const sin = rpc({ productos: BASE.productos.filter(f => f[7] !== 'menu_especial') })
    expect(netaDeProductos(rpc()) - netaDeProductos(sin)).toBe(400000)
  })
})
