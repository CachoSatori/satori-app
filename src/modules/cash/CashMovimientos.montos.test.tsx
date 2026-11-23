// @vitest-environment happy-dom
//
// Montos en Caja → Movimientos (20-nov, rehace lo útil del #73). Antes, `Number(x) || 0` guardaba ₡0 si la celda
// quedaba vacía o con algo que no era número, y un ingreso con vuelto (₡ negativos) se podía pasar a egreso
// (egreso negativo → saldo mal). Ahora Nuevo movimiento y la tabla validan el movimiento COMPLETO con
// validarMovimiento. Harness espejo de CashMovimientos.negativos.test.tsx. Montos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

const cashApi = vi.hoisted(() => ({
  updateCashMovement: vi.fn(async () => ({})),
  createDayMovement: vi.fn(async (m: { fecha?: string }) => m),
  getCierresDia: vi.fn(async () => [] as unknown[]),
}))
const requireManager = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: cashApi.updateCashMovement,
  deleteCashMovement: vi.fn(),
  createDayMovement: cashApi.createDayMovement,
  getCierresDia: cashApi.getCierresDia,
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn((): string[] => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'M' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => requireManager }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'
import { todayCR } from '../../shared/utils'
import { MSG_MONTO_CERO, MSG_MONTO_INVALIDO, MSG_NEGATIVO_SOLO_INGRESO } from './validarMovimiento'
import { teclearNumero } from './teclearNumero.testutil'
const { updateCashMovement, createDayMovement, getCierresDia } = cashApi

const hoy = todayCR()
const mkMov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm1', session_id: null, created_by: 'u1', movement_type: 'egreso_operativo',
  amount_crc: 5000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
  description: 'gasto suelto', subcategory: '', supplier_id: null, supplier_name: '', employee_name: '',
  method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado', approved_by: null,
  approved_at: null, account_id: null, created_at: `${hoy}T12:00:00Z`, updated_at: `${hoy}T12:00:00Z`, ...over,
} as unknown as CashMovement)
// Vuelto: ingreso del cierre con dólares y colones negativos (forma de recordCierreSales).
const vuelto = () => mkMov({
  id: 'v1', movement_type: 'ingreso', amount_crc: -5000, amount_usd: 100,
  description: 'ventas con vuelto', subcategory: 'Ventas cierre',
})

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const fila = (desc: string) => screen.getByDisplayValue(desc).closest('tr') as HTMLElement
const celdas = (desc: string) => within(fila(desc)).getAllByRole('spinbutton') as HTMLInputElement[]
// Cuadro type="number" con texto que no es número («12abc»): el navegador entrega value === '' y marca
// validity.badInput. Se simula ESE estado (no un value que el navegador nunca entrega).
const ponerIlegible = (input: HTMLInputElement, ilegible = true) => {
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: ilegible, valid: !ilegible }) })
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.input(input)
}
const blurCon = async (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } })
  await act(async () => { fireEvent.blur(input) })
}

beforeEach(() => { vi.clearAllMocks(); getCierresDia.mockResolvedValue([]); window.alert = vi.fn() })

describe('Nuevo movimiento — montos', () => {
  const abrir = async () => {
    render(<CashMovimientos movements={[]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    return screen.getByText('Nuevo movimiento').closest('.cd-modal') as HTMLElement
  }
  const registrar = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Registrar/ })) }) }

  it('vacío: no registra y dice «Ingresá un monto mayor a cero»', async () => {
    await abrir()
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_CERO)).toBeTruthy()
  })
  it('después de «Cancelar», el aviso del monto vacío no queda al volver a abrir', async () => {
    await abrir()
    await registrar()
    expect(screen.getByText(MSG_MONTO_CERO)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(MSG_MONTO_CERO)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    expect(screen.queryByText(MSG_MONTO_CERO)).toBeNull()
  })
  it('«Cancelar» con un cuadro ilegible: al volver a abrir (₡ vacío) no queda «no es un número» y registra', async () => {
    const modal = await abrir()
    const [crc, usd] = within(modal).getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(usd, { target: { value: '20' } })
    ponerIlegible(crc)
    await registrar()
    expect(screen.getByText(MSG_MONTO_INVALIDO)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    const modal2 = screen.getByText('Nuevo movimiento', { selector: '.cd-modal-title' }).closest('.cd-modal') as HTMLElement
    const [crc2] = within(modal2).getAllByRole('spinbutton') as HTMLInputElement[]
    expect(crc2.value).toBe('')
    await registrar()
    expect(screen.queryByText(MSG_MONTO_INVALIDO)).toBeNull()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0]).toMatchObject({ amount_crc: 0, amount_usd: 20 })
  })
  it('cero: no registra y dice por qué', async () => {
    const modal = await abrir()
    fireEvent.change(within(modal).getAllByRole('spinbutton')[0], { target: { value: '0' } })
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_CERO)).toBeTruthy()
  })
  it('no numérico (cuadro ₡ con badInput) con $ cargados: no registra ₡0 y dice por qué', async () => {
    const modal = await abrir()
    const [crc, usd] = within(modal).getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(usd, { target: { value: '20' } })
    ponerIlegible(crc)
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_INVALIDO)).toBeTruthy()
  })
  it('no numérico (cuadro $ con badInput) con ₡ cargados: no registra $0 y dice por qué', async () => {
    const modal = await abrir()
    const [crc, usd] = within(modal).getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(crc, { target: { value: '5000' } })
    ponerIlegible(usd)
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_INVALIDO)).toBeTruthy()
  })
  it('no numérico corregido (badInput se va): registra', async () => {
    const modal = await abrir()
    const [crc, usd] = within(modal).getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(usd, { target: { value: '20' } })
    ponerIlegible(crc)
    ponerIlegible(crc, false)
    await registrar()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0]).toMatchObject({ amount_crc: 0, amount_usd: 20 })
  })
  it('válido: registra con el número leído', async () => {
    const modal = await abrir()
    fireEvent.change(within(modal).getAllByRole('spinbutton')[0], { target: { value: '2500' } })
    await registrar()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0]).toMatchObject({ amount_crc: 2500, amount_usd: 0 })
  })
})

describe('Tabla — edición de montos', () => {
  it('borrar el único monto (celda vacía): avisa, la celda vuelve al guardado y NO guarda ₡0', async () => {
    const onRefresh = vi.fn()
    render(<CashMovimientos movements={[mkMov({ description: 'gasto a vaciar' })]} sessions={[]} onRefresh={onRefresh} />)
    await flush()
    const [crc] = celdas('gasto a vaciar')
    await blurCon(crc, '')
    expect(window.alert).toHaveBeenCalledWith(MSG_MONTO_CERO)
    expect(updateCashMovement).not.toHaveBeenCalled()
    expect(requireManager).not.toHaveBeenCalled()
    expect(crc.value).toBe('5000')
    expect(onRefresh).toHaveBeenCalled()
  })
  it('cero: avisa y NO guarda', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto a cero' })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    await blurCon(celdas('gasto a cero')[0], '0')
    expect(window.alert).toHaveBeenCalledWith(MSG_MONTO_CERO)
    expect(updateCashMovement).not.toHaveBeenCalled()
  })
  it('no numérico (cuadro con badInput) en una fila con ₡ y $: avisa y NO guarda ₡0', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto con letras', amount_usd: 20 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const [crc] = celdas('gasto con letras')
    ponerIlegible(crc)
    await act(async () => { fireEvent.blur(crc) })
    expect(window.alert).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(updateCashMovement).not.toHaveBeenCalled()
    expect(requireManager).not.toHaveBeenCalled()
  })
  it('no numérico (badInput) en los $ de una fila con ₡: avisa y NO guarda $0', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto usd letras', amount_usd: 20 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const usd = celdas('gasto usd letras')[1]
    ponerIlegible(usd)
    await act(async () => { fireEvent.blur(usd) })
    expect(window.alert).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(updateCashMovement).not.toHaveBeenCalled()
  })
  it('sin cambios: no pide autorización ni guarda', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto igual' })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const [crc, usd] = celdas('gasto igual')
    await blurCon(crc, '5000')
    await blurCon(usd, '')
    expect(requireManager).not.toHaveBeenCalled()
    expect(updateCashMovement).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })
  it('vuelto válido: editar ₡ −5000 → −4000 guarda, con la fila para que la API valide', async () => {
    render(<CashMovimientos movements={[vuelto()]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    await blurCon(celdas('ventas con vuelto')[0], '-4000')
    expect(window.alert).not.toHaveBeenCalled()
    expect(updateCashMovement).toHaveBeenCalledWith('v1', { amount_crc: -4000 },
      { movement_type: 'ingreso', amount_crc: -5000, amount_usd: 100 })
  })
  it('vuelto válido: editar los $ (100 → 120) guarda', async () => {
    render(<CashMovimientos movements={[vuelto()]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    await blurCon(celdas('ventas con vuelto')[1], '120')
    expect(updateCashMovement).toHaveBeenCalledWith('v1', { amount_usd: 120 },
      { movement_type: 'ingreso', amount_crc: -5000, amount_usd: 100 })
  })
  it('vuelto pasado a egreso (cambio de tipo): avisa y NO guarda', async () => {
    const onRefresh = vi.fn()
    render(<CashMovimientos movements={[vuelto()]} sessions={[]} onRefresh={onRefresh} />)
    await flush()
    const tipo = within(fila('ventas con vuelto')).getAllByRole('combobox')
      .find(s => (s as HTMLSelectElement).value === 'ingreso') as HTMLSelectElement
    await act(async () => { fireEvent.change(tipo, { target: { value: 'egreso_operativo' } }) })
    expect(window.alert).toHaveBeenCalledWith(MSG_NEGATIVO_SOLO_INGRESO)
    expect(updateCashMovement).not.toHaveBeenCalled()
    expect(requireManager).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })
  it('cambio de tipo de un movimiento sin vuelto: guarda, con la fila', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto a ingreso' })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const tipo = within(fila('gasto a ingreso')).getAllByRole('combobox')
      .find(s => (s as HTMLSelectElement).value === 'egreso_operativo') as HTMLSelectElement
    await act(async () => { fireEvent.change(tipo, { target: { value: 'ingreso' } }) })
    expect(updateCashMovement).toHaveBeenCalledWith('m1', { movement_type: 'ingreso' },
      { movement_type: 'egreso_operativo', amount_crc: 5000, amount_usd: 0 })
  })
})

// R30 (23-nov): cuadro VACÍO al que se le escribe algo ilegible desde la primera tecla. El valor leído pasa de '' a ''
// y React NO dispara onChange: solo onInput (o leer el cuadro al guardar) se entera. teclearNumero manda UN solo
// evento `input`, como el navegador. Caen si se quita el onInput de los cuadros de Nuevo movimiento.
describe('Cuadros vacíos con texto ilegible desde la primera tecla (R30)', () => {
  const abrir = async () => {
    render(<CashMovimientos movements={[]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    const modal = screen.getByText('Nuevo movimiento', { selector: '.cd-modal-title' }).closest('.cd-modal') as HTMLElement
    return within(modal).getAllByRole('spinbutton') as HTMLInputElement[]
  }
  const registrar = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Registrar/ })) }) }

  it('Nuevo movimiento: $ vacío + «-» con ₡ cargados → no registra $0 y dice por qué', async () => {
    const [crc, usd] = await abrir()
    teclearNumero(crc, '5000')
    teclearNumero(usd, '-')
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_INVALIDO)).toBeTruthy()
  })
  it('Nuevo movimiento: ₡ vacío + «--450» con $ cargados → no registra ₡0', async () => {
    const [crc, usd] = await abrir()
    teclearNumero(usd, '20')
    teclearNumero(crc, '--450')
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(MSG_MONTO_INVALIDO)).toBeTruthy()
  })
  it('Nuevo movimiento: borrar el texto ilegible no deja la marca trabada → registra con $0', async () => {
    const [crc, usd] = await abrir()
    teclearNumero(crc, '5000')
    teclearNumero(usd, '-')
    teclearNumero(usd, '')
    await registrar()
    expect(screen.queryByText(MSG_MONTO_INVALIDO)).toBeNull()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0]).toMatchObject({ amount_crc: 5000, amount_usd: 0 })
  })
  it('Tabla: celda $ vacía (guardado $0) + «-» al salir → avisa y NO guarda', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto usd vacío' })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const usd = celdas('gasto usd vacío')[1]
    expect(usd.value).toBe('')
    teclearNumero(usd, '-')
    await act(async () => { fireEvent.blur(usd) })
    expect(window.alert).toHaveBeenCalledWith(MSG_MONTO_INVALIDO)
    expect(updateCashMovement).not.toHaveBeenCalled()
    expect(requireManager).not.toHaveBeenCalled()
  })
})
