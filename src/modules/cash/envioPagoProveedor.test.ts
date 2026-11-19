import { describe, it, expect } from 'vitest'
import { agruparEnvios } from './envioPagoProveedor'

const r = (id: string, supplierId: string) => ({ id, supplierId, name: `Prov ${supplierId}`, email: `${supplierId.toLowerCase()}@ejemplo.test` })

describe('agruparEnvios (19-nov: un correo por pago y proveedor)', () => {
  it('junta los ids de cada proveedor en un solo envío, en el orden en que llegan', () => {
    expect(agruparEnvios([r('a1', 'A'), r('c1', 'C'), r('a2', 'A'), r('a1', 'A')])).toEqual([
      { supplierId: 'A', name: 'Prov A', email: 'a@ejemplo.test', ids: ['a1', 'a2'] },
      { supplierId: 'C', name: 'Prov C', email: 'c@ejemplo.test', ids: ['c1'] },
    ])
  })
  it('una factura sola = lista de 1; sin receptores = nada', () => {
    expect(agruparEnvios([r('a1', 'A')])).toEqual([{ supplierId: 'A', name: 'Prov A', email: 'a@ejemplo.test', ids: ['a1'] }])
    expect(agruparEnvios([])).toEqual([])
  })
})
