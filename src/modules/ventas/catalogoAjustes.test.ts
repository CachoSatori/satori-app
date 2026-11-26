// Ventas v2 · 3.1b — módulo puro de «Ajustes → Catálogo». Datos ficticios.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CatalogoProductosRpc } from '../../shared/api/posNdf'
import {
  armarCatalogo, errorNombreFamilia, esNuevo, fichaConCategoria, fichaConRinde, filtrarCatalogo, normalizarNombreFamilia,
  rotuloCategoria, FILTROS_VACIOS, ROTULO_CATEGORIA,
} from './catalogoAjustes'
import { CATEGORIAS } from './catalogoPos'

const HOY = '2026-11-26'
const p = (codigo: string, nombre: string, familia: number | null, categoria: string, extra: Partial<CatalogoProductosRpc['productos'][number]> = {}) =>
  ({ codigo, nombre, familia, categoria, categoriaPropia: null, rinde: 1, vistoDesde: '2025-01-01', vistoHasta: '2026-11-20', ...extra })

const RPC: CatalogoProductosRpc = {
  productos: [
    p('10', 'ZETA ROLLO FICTICIO', 3, 'comida'),
    p('11', 'ALFA ROLLO FICTICIO', 3, 'comida'),
    p('20', 'CERVEZA FICTICIA', 5, 'bebida', { rinde: 4 }),
    p('30', 'REGALO FICTICIO', 17, 'cortesia'),
    p('40', 'MENU FICTICIO POR PERSONA', 11, 'menu_especial', { categoriaPropia: 'menu_especial' }),
    p('50', 'PROMO NUEVA FICTICIA', 25, 'bebida', { vistoDesde: '2026-11-20' }),
    p('60', 'SIN FAMILIA CARGADA', 99, 'otros'),
    p('70', 'POSTRE FICTICIO', 4, 'comida'),
  ],
  familias: [
    { familia: 3, nombre: 'ROLLS FICTICIOS', categoria: 'comida', orden: 20 },
    { familia: 4, nombre: 'POSTRES FICTICIOS', categoria: 'comida', orden: 10 },
    { familia: 5, nombre: 'BEBIDAS FICTICIAS', categoria: 'bebida', orden: 10 },
    { familia: 11, nombre: 'MENU FICTICIO', categoria: 'comida', orden: 90 },
    { familia: 17, nombre: 'CORTESIAS FICTICIAS', categoria: 'cortesia', orden: 10 },
    { familia: 25, nombre: 'PROMOS FICTICIAS', categoria: 'bebida', orden: 20 },
  ],
  categoriasEditables: ['comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros'],
  categoriasFijas: ['giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes'],
}

describe('armarCatalogo', () => {
  const filas = armarCatalogo(RPC, HOY)
  it('orden: categoría (menu_especial tercera) → orden de la familia → nombre', () => {
    expect(filas.map(f => f.codigo)).toEqual(['70', '11', '10', '20', '50', '40', '60', '30'])
  })
  it('la categoría es la que manda la base; la de la familia viaja aparte (para «De su familia»)', () => {
    const menu = filas.find(f => f.codigo === '40')!
    expect(menu.categoria).toBe('menu_especial')
    expect(menu.categoriaFamilia).toBe('comida')
  })
  it('regalías (familia 17) sale bloqueada; las de venta no', () => {
    expect(filas.find(f => f.codigo === '30')!.bloqueada).toBe(true)
    expect(filas.filter(f => f.codigo !== '30').every(f => !f.bloqueada)).toBe(true)
  })
  it('familia sin fila → «Familia N», marcada, y su categoría por defecto «otros»', () => {
    const f = filas.find(x => x.codigo === '60')!
    expect(f.familiaNombre).toBe('Familia 99')
    expect(f.familiaSinFila).toBe(true)
    expect(f.categoriaFamilia).toBe('otros')
  })
  it('«cambiado» = categoría propia o rinde > 1', () => {
    expect(filas.filter(f => f.cambiado).map(f => f.codigo).sort()).toEqual(['20', '40'])
  })
})

describe('esNuevo (S9: visto por primera vez en los últimos 30 días, día CR)', () => {
  it.each([['2026-10-27', true], ['2026-10-26', false], ['2026-11-26', true]])('%s → %s', (d, v) => {
    expect(esNuevo(d, HOY)).toBe(v)
  })
})

describe('filtrarCatalogo', () => {
  const filas = armarCatalogo(RPC, HOY)
  const cods = (f: Partial<typeof FILTROS_VACIOS>) => filtrarCatalogo(filas, { ...FILTROS_VACIOS, ...f }).map(x => x.codigo)
  it('sin filtros: todo', () => expect(cods({})).toHaveLength(8))
  it('buscador por nombre sin mayúsculas ni tildes, y por código', () => {
    expect(cods({ buscar: 'cerveza' })).toEqual(['20'])
    expect(cods({ buscar: 'MENÚ' })).toEqual(['40'])
    expect(cods({ buscar: '50' })).toEqual(['50'])
  })
  it('categoría, familia, los que cambié y nuevos', () => {
    expect(cods({ categoria: 'bebida' })).toEqual(['20', '50'])
    expect(cods({ familia: 3 })).toEqual(['11', '10'])
    expect(cods({ cambiados: true })).toEqual(['20', '40'])
    expect(cods({ nuevos: true })).toEqual(['50'])
    expect(cods({ categoria: 'bebida', nuevos: true })).toEqual(['50'])
  })
})

describe('fichas: siempre los DOS valores, nunca uno que la persona no tocó', () => {
  it('cambiar la categoría manda el rinde que ya tenía', () => {
    expect(fichaConCategoria({ rinde: 4, categoriaPropia: null, bloqueada: false }, 'otros')).toEqual({ rinde: 4, categoria: 'otros' })
  })
  it('«De su familia» manda null', () => {
    expect(fichaConCategoria({ rinde: 1, categoriaPropia: 'menu_especial', bloqueada: false }, '')).toEqual({ rinde: 1, categoria: null })
  })
  it('lo mismo que había o un producto bloqueado: no se manda nada', () => {
    expect(fichaConCategoria({ rinde: 1, categoriaPropia: 'bebida', bloqueada: false }, 'bebida')).toBeNull()
    expect(fichaConCategoria({ rinde: 1, categoriaPropia: null, bloqueada: true }, 'comida')).toBeNull()
  })
  it('cambiar el rinde manda la categoría propia que ya tenía', () => {
    expect(fichaConRinde({ rinde: 1, categoriaPropia: 'menu_especial' }, 3)).toEqual({ rinde: 3, categoria: 'menu_especial' })
  })
  it.each([0, 21, 2.5, Number.NaN, '', '3', -1])('rinde %s no se manda', v => {
    expect(fichaConRinde({ rinde: 1, categoriaPropia: null }, v)).toBeNull()
  })
  it('rinde igual al que había: no se manda', () => {
    expect(fichaConRinde({ rinde: 4, categoriaPropia: null }, 4)).toBeNull()
  })
})

describe('rótulos', () => {
  it('«cortesia» se lee «Regalías»; todas las categorías tienen rótulo', () => {
    expect(rotuloCategoria('cortesia')).toBe('Regalías')
    expect(Object.keys(ROTULO_CATEGORIA).sort()).toEqual([...CATEGORIAS].sort())
  })
})

describe('nombre de familia (mismas reglas que la 204)', () => {
  it('normaliza como la base: sin espacios a los costados ni repetidos; salto de línea y tab = un espacio', () => {
    expect(normalizarNombreFamilia('  Escuela   Ficticia\n\t(surf) ')).toBe('Escuela Ficticia (surf)')
  })
  it.each(['Ñandú Café #2 & Co. - 1/2 + \'A\', B', 'x'.repeat(40)])('«%s» se puede mandar', s => {
    expect(errorNombreFamilia(s)).toBeNull()
  })
  it.each(['', '   ', 'x'.repeat(41), 'alguien@ejemplo.test', '<b>', 'a;b', 'emoji 🍣', 'guion_bajo', 'dólar $5'])('«%s» no', s => {
    expect(errorNombreFamilia(s)).not.toBeNull()
  })
  it('la lista de caracteres y el largo son los mismos que los de la 204 (una sola regla)', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/204_pos_familia_nombre.sql'), 'utf8')
    const ts = readFileSync(resolve(process.cwd(), 'src/modules/ventas/catalogoAjustes.ts'), 'utf8')
    const enSql = sql.match(/v_nom !~ '(\^\[[^']*(?:''[^']*)*\]\+\$)'/)![1].replace(/''/g, "'")
    const enTs = ts.match(/const NOMBRE_FAMILIA_OK = \/(.+)\/\n/)![1]
    expect(enTs).toBe(enSql)
    expect(sql).toContain('char_length(v_nom) > 40')
    expect(ts).toContain('NOMBRE_FAMILIA_MAX = 40')
  })
})
