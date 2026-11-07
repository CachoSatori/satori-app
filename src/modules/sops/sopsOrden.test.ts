import { describe, it, expect } from 'vitest'
import type { SOP } from '../../shared/api/sops'
import { agruparSops, coincideBusqueda, compararCodigos, etiquetaCodigo, grupoDe, nombreCorto } from './sopsOrden'

function sop(p: Partial<SOP>): SOP {
  return {
    id: p.title ?? 'x', title: 'x', category: 'General', content: '', display_order: 0,
    is_active: true, created_by: null, created_at: '', updated_at: '', ...p,
  }
}

const A2 = '2. Salón y recepción'
const A4 = '4. Administración y caja'
const A1 = '1. Cultura y servicio'

const lista: SOP[] = [
  sop({ title: 'Tareas del manager', code: '4.1', area: A4, doc_type: 'SOP' }),
  sop({ title: 'Delivery y takeaway', code: '2.9', area: A2, doc_type: 'SOP' }),
  sop({ title: 'Diez', code: '2.10', area: A2 }),
  sop({ title: 'Montaje de Mesas', area: A2, category: 'Apertura', display_order: 10 }),
  sop({ title: 'Cobro de mesa y separación de cuentas', code: '2.5', area: A2, content: 'Datáfono en USD' }),
  sop({ title: 'Nuestro Mantra', code: '1.1', area: A1 }),
  sop({ title: 'Vieja sin área', category: 'Cierre' }),
]

describe('agrupado', () => {
  it('agrupa por área, en orden de área, y deja lo viejo sin área al final por categoría', () => {
    const g = agruparSops(lista, 'all', '')
    expect(g.map(([k]) => k)).toEqual([A1, A2, A4, 'Cierre'])
  })
  it('ordena por código natural y deja lo que no tiene código al final del grupo', () => {
    const [, salon] = agruparSops(lista, 'all', '').find(([k]) => k === A2)!
    expect(salon.map(s => s.code ?? s.title)).toEqual(['2.5', '2.9', '2.10', 'Montaje de Mesas'])
  })
  it('filtra por grupo', () => {
    expect(agruparSops(lista, A4, '').map(([k]) => k)).toEqual([A4])
  })
  it('grupoDe usa category si no hay área', () => {
    expect(grupoDe({ area: null, category: 'Cierre' })).toBe('Cierre')
    expect(grupoDe({ area: A2, category: 'Servicio' })).toBe(A2)
  })
})

describe('búsqueda', () => {
  const cobro = lista[4]
  it('encuentra por código, con o sin "SOP"', () => {
    expect(coincideBusqueda(cobro, '2.5')).toBe(true)
    expect(coincideBusqueda(cobro, 'SOP 2.5')).toBe(true)
    expect(coincideBusqueda(lista[1], '2.5')).toBe(false)
  })
  it('un número de área encuentra todos sus códigos', () => {
    const g = agruparSops(lista, 'all', '4')
    expect(g.flatMap(([, l]) => l).map(s => s.code)).toContain('4.1')
  })
  it('encuentra por título sin tildes ni mayúsculas, y por contenido', () => {
    expect(coincideBusqueda(cobro, 'SEPARACION')).toBe(true)
    expect(coincideBusqueda(cobro, 'datafono')).toBe(true)
    expect(coincideBusqueda(cobro, 'sushi')).toBe(false)
  })
})

describe('utilidades', () => {
  it('orden natural de códigos', () => {
    expect(['2.10', '2.9', '1.2'].sort(compararCodigos)).toEqual(['1.2', '2.9', '2.10'])
  })
  it('etiquetas', () => {
    expect(etiquetaCodigo({ code: '2.5', doc_type: 'SOP' })).toBe('SOP 2.5')
    expect(etiquetaCodigo({ code: '3.2', doc_type: 'Documento' })).toBe('Doc 3.2')
    expect(etiquetaCodigo({ code: null, doc_type: null })).toBeNull()
    expect(nombreCorto(A2)).toBe('Salón y recepción')
    expect(nombreCorto('Cierre')).toBe('Cierre')
  })
})
