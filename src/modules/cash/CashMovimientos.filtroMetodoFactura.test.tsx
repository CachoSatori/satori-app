// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'
import type { DocumentRow } from '../../shared/api/documents'

// Filtros del contador (26-nov): «Método», «Factura» (con/sin documento enlazado), el atajo «Efectivo sin factura»
// y el CSV con «Subcategoría» / «Factura» / «N° factura». Las tarjetas de efectivo y Pend. Transferencia NO siguen
// los filtros (se calculan sobre `movements` sin filtrar, a propósito).

const docsMock = vi.hoisted(() => ({ impl: (): Promise<unknown[]> => Promise.resolve([]) }))

vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: vi.fn(),
  deleteCashMovement: vi.fn(),
  getCierresDia: vi.fn(async () => []),
  createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(() => docsMock.impl()) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn((): string[] => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'contador', full_name: 'Contador Test' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'
import { RELOJES_CR, conRelojCR } from '../../test/relojCR.testutil'

const ahora = () => new Date().toISOString()
const mov = (over: Partial<CashMovement>) => ({
  id: 'm-base', session_id: null, created_by: 'u1', movement_type: 'egreso_operativo',
  amount_crc: 1000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
  description: 'gasto', subcategory: '', supplier_id: null,
  supplier_name: '', employee_name: '', method: 'Efectivo', shift: '',
  caja_origen: 'Caja Fuerte', status: 'aprobado', approved_by: null, approved_at: null,
  account_id: null, created_at: ahora(), updated_at: ahora(),
  ...over,
} as unknown as CashMovement)

const doc = (movId: string, numero: string): DocumentRow => ({
  id: 'd-' + movId, image_path: 'x', sha256: null, clave_fe: null, tipo: 'factura',
  raw_json: { numero_documento: numero } as unknown as DocumentRow['raw_json'],
  estado: 'procesado', linked_movement_id: movId, created_by: null, created_at: ahora(),
})

// Fixture: datos ficticios.
const fixture = () => [
  mov({ id: 'm-musico',  description: 'Pago musico ficticio', movement_type: 'egreso_personal', method: 'Efectivo', subcategory: 'Musica' }),
  mov({ id: 'm-encom',   description: 'Encomienda ficticia',  movement_type: 'egreso_operativo', method: 'Efectivo', subcategory: 'Encomiendas' }),
  mov({ id: 'm-factEf',  description: 'Compra con factura',   movement_type: 'egreso_mercaderia', method: 'Efectivo' }),
  mov({ id: 'm-transf',  description: 'Pago por transferencia', movement_type: 'egreso_mercaderia', method: 'Transferencia', status: 'pendiente', amount_crc: 5000 }),
  mov({ id: 'm-sinpe',   description: 'Pago por sinpe',       movement_type: 'egreso_operativo', method: 'SINPE' }),
  mov({ id: 'm-null',    description: 'Movimiento viejo sin metodo', movement_type: 'egreso_operativo', method: null as unknown as string }),
  mov({ id: 'm-ingreso', description: 'Ingreso en efectivo', movement_type: 'ingreso', method: 'Efectivo', amount_crc: 7000 }),
]
const docsFixture = () => [doc('m-factEf', 'FAC-0001')]

const renderMovs = (movements: CashMovement[] = fixture()) => render(
  <CashMovimientos movements={movements} sessions={[]} onRefresh={vi.fn()} />,
)

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement
const elegir = (label: string, value: string) => fireEvent.change(select(label), { target: { value } })
const visibles = (...textos: string[]) => textos.forEach(t => expect(screen.queryByText(t), t).toBeTruthy())
const ocultos  = (...textos: string[]) => textos.forEach(t => expect(screen.queryByText(t), t).toBeNull())
const esperarDocs = () => waitFor(() => expect(select('Factura').disabled).toBe(false))

// Las tarjetas de efectivo/pozo y Pend. Transferencia, como texto.
const tarjetasFijas = () => {
  const cards = [...document.querySelectorAll('.cd-saldo-card')]
  return cards.filter(c => /Efectivo en caja|Caja Fuerte|Pend\. Transferencia/.test(c.textContent ?? ''))
    .map(c => c.textContent)
}

describe.each(RELOJES_CR)('reloj fijo $hoy · $caso', reloj => {
  conRelojCR(reloj)
  beforeEach(() => { docsMock.impl = () => Promise.resolve(docsFixture()) })

  describe('filtro Método', () => {
    it('Efectivo deja solo los de efectivo; el de método null solo aparece en Todos', async () => {
      renderMovs()
      visibles('Movimiento viejo sin metodo')
      elegir('Método', 'Efectivo')
      visibles('Pago musico ficticio', 'Encomienda ficticia', 'Compra con factura', 'Ingreso en efectivo')
      ocultos('Pago por transferencia', 'Pago por sinpe', 'Movimiento viejo sin metodo')
      elegir('Método', 'SINPE')
      visibles('Pago por sinpe')
      ocultos('Pago musico ficticio', 'Movimiento viejo sin metodo')
      elegir('Método', '')
      visibles('Movimiento viejo sin metodo', 'Pago por transferencia')
    })

    it('ofrece Todos + los 4 métodos de cashUtils', () => {
      renderMovs()
      expect([...select('Método').options].map(o => o.textContent)).toEqual(['Todos', 'Efectivo', 'Transferencia', 'SINPE', 'Bitcoin'])
    })
  })

  describe('filtro Factura', () => {
    it('Con factura / Sin factura separan por el documento enlazado', async () => {
      renderMovs()
      await esperarDocs()
      elegir('Factura', 'con')
      visibles('Compra con factura')
      ocultos('Pago musico ficticio', 'Pago por transferencia', 'Ingreso en efectivo')
      elegir('Factura', 'sin')
      visibles('Pago musico ficticio', 'Pago por transferencia', 'Movimiento viejo sin metodo')
      ocultos('Compra con factura')
    })

    it('mientras las facturas cargan: el filtro está deshabilitado y dice «Cargando…»', () => {
      docsMock.impl = () => new Promise(() => {})   // nunca resuelve
      renderMovs()
      expect(select('Factura').disabled).toBe(true)
      expect(select('Factura').options[0].textContent).toBe('Cargando…')
    })

    it('el atajo con facturas cargando no muestra un «sin factura» engañoso: dice «Cargando facturas…»', () => {
      docsMock.impl = () => new Promise(() => {})
      renderMovs()
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      ocultos('Pago musico ficticio', 'Compra con factura')
      expect(screen.getAllByText('Cargando facturas…').length).toBeGreaterThan(0)
    })

    it('si la consulta de facturas falla, «Sin factura» no muestra todo como sin factura', async () => {
      docsMock.impl = () => Promise.reject(new Error('sin red'))
      renderMovs()
      await waitFor(() => expect(select('Factura').options[0].textContent).toBe('No disponible'))
      expect(select('Factura').disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      ocultos('Pago musico ficticio', 'Compra con factura')
      expect(screen.getAllByText(/No se pudieron cargar las facturas/).length).toBeGreaterThan(0)
    })
  })

  describe('atajo «Efectivo sin factura»', () => {
    it('deja egresos en efectivo sin factura y se quita con un segundo toque', async () => {
      renderMovs()
      await esperarDocs()
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      expect(select('Tipo').value).toBe('__egresos')
      expect(select('Método').value).toBe('Efectivo')
      expect(select('Factura').value).toBe('sin')
      visibles('Pago musico ficticio', 'Encomienda ficticia')
      ocultos('Compra con factura', 'Pago por transferencia', 'Pago por sinpe', 'Movimiento viejo sin metodo', 'Ingreso en efectivo')
      const quitar = screen.getByRole('button', { name: '✕ Efectivo sin factura' })
      expect(quitar.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(quitar)
      expect(select('Tipo').value).toBe('')
      expect(select('Método').value).toBe('')
      expect(select('Factura').value).toBe('')
      visibles('Ingreso en efectivo', 'Compra con factura', 'Movimiento viejo sin metodo')
    })

    it('«Todos los egresos» en Tipo junta todos los tipos de egreso y saca ingresos', () => {
      renderMovs()
      elegir('Tipo', '__egresos')
      visibles('Pago musico ficticio', 'Encomienda ficticia', 'Compra con factura')
      ocultos('Ingreso en efectivo')
    })

    it('pie y tarjetas de PERÍODO siguen la lista filtrada', async () => {
      renderMovs()
      await esperarDocs()
      expect(screen.getByText('7 movimientos · Resultado del período')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      expect(screen.getByText('2 movimientos · Resultado del período')).toBeTruthy()
      const ingresos = [...document.querySelectorAll('.cd-saldo-card')].find(c => /Ingresos \(período\)/.test(c.textContent ?? ''))!
      expect(ingresos.textContent).not.toMatch(/7[.,]000/)
    })
  })

  describe('tarjetas de efectivo/pozo y Pend. Transferencia', () => {
    it('son iguales con y sin filtros', async () => {
      renderMovs()
      await esperarDocs()
      const antes = tarjetasFijas()
      expect(antes.length).toBe(2)
      expect(antes.join(' ')).toMatch(/5[.,]000/)   // el pendiente de transferencia
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      elegir('Estado', 'Pagado')
      expect(tarjetasFijas()).toEqual(antes)
    })
  })

  describe('CSV', () => {
    let blobs: Blob[] = []
    beforeEach(() => {
      blobs = []
      URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x' }) as typeof URL.createObjectURL
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    })
    afterEach(() => vi.restoreAllMocks())

    const csv = async () => {
      fireEvent.click(screen.getByRole('button', { name: '⬇ CSV' }))
      const txt = await blobs[blobs.length - 1].text()
      return txt
    }
    const filas = (txt: string) => txt.replace(/^﻿/, '').split('\n')

    it('suma Subcategoría, Factura y N° factura sin quitar columnas, con BOM y comillas', async () => {
      renderMovs()
      await esperarDocs()
      const txt = await csv()
      expect(txt.charCodeAt(0)).toBe(0xFEFF)
      const [hdr, ...rows] = filas(txt)
      expect(hdr).toBe('Fecha,Turno,Tipo,Descripción,Proveedor/Empleado,₡,$,Método,Caja,Estado,Subcategoría,Factura,N° factura')
      expect(rows.length).toBe(7)
      const fact = rows.find(r => r.includes('Compra con factura'))!
      expect(fact.endsWith('"Sí","FAC-0001"')).toBe(true)
      const musico = rows.find(r => r.includes('Pago musico ficticio'))!
      expect(musico.endsWith('"Musica","No",""')).toBe(true)
      // método null: celda vacía, no el texto «null»
      expect(rows.find(r => r.includes('Movimiento viejo sin metodo'))).not.toMatch(/"null"/)
    })

    it('respeta los filtros: con el atajo exporta solo los 2 egresos en efectivo sin factura', async () => {
      renderMovs()
      await esperarDocs()
      fireEvent.click(screen.getByRole('button', { name: 'Efectivo sin factura' }))
      const rows = filas(await csv()).slice(1)
      expect(rows.length).toBe(2)
      expect(rows.every(r => r.includes('"Efectivo"') && r.includes('"No"'))).toBe(true)
    })

    it('sin facturas cargadas no afirma «No»: la columna Factura queda vacía', async () => {
      docsMock.impl = () => new Promise(() => {})
      renderMovs()
      const rows = filas(await csv()).slice(1)
      expect(rows.some(r => r.endsWith('"No",""'))).toBe(false)
    })
  })
})
