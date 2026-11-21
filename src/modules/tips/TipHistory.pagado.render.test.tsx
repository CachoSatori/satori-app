// @vitest-environment happy-dom
//
// «Historial» muestra LO QUE SE PAGÓ (decisión del dueño, 20-nov-2026) y no deja guardar una edición con horas
// o montos negativos. Datos ficticios.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Employee, RoleTipPoints, TipSession } from '../../shared/types/database'

const H = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  savePayouts: vi.fn(async () => {}),
  upsertTipEntry: vi.fn(async () => {}),
}))
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async () => H.entries),
  upsertTipEntry: H.upsertTipEntry, deleteTipEntry: vi.fn(async () => {}), updateSessionPools: vi.fn(async () => {}),
  savePayouts: H.savePayouts,
  totalElectronicoCrc: vi.fn(() => 0),
}))
vi.mock('../../shared/api/cash', () => ({ reconcilePropinaEgreso: vi.fn(async () => {}) }))

import TipHistory from './TipHistory'

const ent = (id: string, payout_crc: number | null, points = 80) =>
  ({ id: `t-${id}`, session_id: 's1', employee_id: id, hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, points, payout_crc, covered_role: null })
const ses = {
  id: 's1', session_date: '2026-08-20', shift_type: 'PM', status: 'closed', exchange_rate: 500,
  pool_efectivo_crc: 60000, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, pool_total_crc: 60000,
} as unknown as TipSession
const emp = (id: string, role = 'salonero') => ({ id, full_name: `Empleado ${id.toUpperCase()}`, role, is_active: true }) as unknown as Employee
const PUNTOS = [{ role: 'salonero', points: 10 }, { role: 'barman', points: 5 }] as unknown as RoleTipPoints[]
const tomas = () => [...document.querySelectorAll('.hist-emp-take')].map(n => n.textContent!)
const soloDigitos = (t: string) => t.replace(/\D/g, '')

beforeEach(() => { vi.clearAllMocks(); H.entries = [ent('a', 25000), ent('b', 20000), ent('c', 15000)] })
afterEach(() => { cleanup() })

describe('Historial · lo pagado manda', () => {
  it('vista completa: cada fila muestra lo pagado (no 3 × ₡20.000) y sin aviso', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(3))
    expect(tomas().map(soloDigitos).sort()).toEqual(['15000', '20000', '25000'])
    expect(screen.queryByTestId('hist-avisos-pagado')).toBeNull()
    expect(screen.getByText(/3 empleados/)).toBeTruthy()
  })

  it('puntos guardados que no cuadran con lo pagado (80/80/80 y 25.000/20.000/15.000): sin ₡/pto, Pts ni pts por fila', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(3))
    const pozo = document.querySelector('.hist-pool-row')!.textContent!
    expect(pozo).toContain('₡60.000')
    expect(pozo).not.toMatch(/₡\/pto|Pts/)
    expect(document.querySelector('.hist-emp-grid')!.textContent).not.toMatch(/pts/)
  })

  it('puntos guardados que cuadran (100/80/60): ₡/pto y Pts salen de lo guardado y ₡/pto × Pts = pozo', async () => {
    H.entries = [ent('a', 25000, 100), ent('b', 20000, 80), ent('c', 15000, 60)]
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(3))
    const pozo = document.querySelector('.hist-pool-row')!.textContent!
    expect(pozo).toContain('₡/pto ₡250')      // 60.000 / 240; el recálculo con 10 pts/h daba otro número
    expect(pozo).toContain('Pts 240')
  })

  it('barra: el desglose barra/serv sale de lo guardado y suma lo pagado', async () => {
    H.entries = [
      { ...ent('a', 6000, 60), hours_worked: 6 },
      { ...ent('b', 8000, 40), hours_worked: 8 },           // barman: 40 pts guardados; con los puntos de hoy serían 8 × 1 = 8
    ]
    const sesBarra = { ...ses, pool_efectivo_crc: 10000, pool_barra_crc: 4000, pool_total_crc: 14000 } as unknown as TipSession
    render(<TipHistory sessions={[sesBarra]} employees={[emp('a'), emp('b', 'barman')]} rolePoints={[{ role: 'salonero', points: 3 }, { role: 'barman', points: 1 }] as unknown as RoleTipPoints[]} isManager />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(2))
    const filaBarra = screen.getByText('Empleado B', { selector: '.hist-emp-name' }).closest('.hist-emp-row')!.textContent!
    expect(filaBarra).toContain('barra ₡4.000 · serv ₡4.000')   // tasa guardada 10.000 / 100 = ₡100
    expect(document.querySelector('.hist-pool-row')!.textContent).toContain('₡/pto ₡100')
  })

  it('cajero/contador (la persona c está inactiva): el resto ve lo pagado, aviso con cuánto se le pagó y sin ₡/pto', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b')]} rolePoints={PUNTOS} />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(2))
    expect(tomas().map(soloDigitos).sort()).toEqual(['20000', '25000'])     // el recálculo daba 30.000 y 30.000
    const aviso = screen.getByTestId('hist-avisos-pagado').textContent!
    expect(aviso).toMatch(/1 pago a una persona que hoy está inactiva no muestra el nombre/)
    expect(aviso).toContain('₡15.000')
    expect(document.querySelector('.hist-pool-row')!.textContent).toContain('₡60.000')
    expect(document.querySelector('.hist-pool-row')!.textContent).not.toMatch(/₡\/pto/)
    expect(screen.getByText(/3 empleados/)).toBeTruthy()        // cuenta también a la persona inactiva
  })

  it('un turno viejo sin lo guardado: «sin dato guardado» en la fila, nunca el recálculo', async () => {
    H.entries = [ent('a', 25000), ent('b', null), ent('c', 15000)]
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} />)
    fireEvent.click(screen.getByText(/2026-08-20/))
    await waitFor(() => expect(tomas()).toHaveLength(3))
    expect(tomas()).toContain('sin dato guardado')
    expect(tomas().map(soloDigitos)).not.toContain('20000')
    expect(screen.getByTestId('hist-avisos-pagado').textContent).toContain('1 monto no tiene dato guardado')
  })

  it('con personas ocultas «✏ Editar» queda gris (el recálculo pisaría lo pagado)', async () => {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByTitle('Ver detalle y acciones'))
    await screen.findByTestId('modal-avisos-pagado')
    expect((screen.getByRole('button', { name: /Editar/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Historial · ✏ Editar no acepta negativos', () => {
  async function abrirEdicion() {
    render(<TipHistory sessions={[ses]} employees={[emp('a'), emp('b'), emp('c')]} rolePoints={PUNTOS} isManager />)
    fireEvent.click(screen.getByTitle('Ver detalle y acciones'))
    const editar = await screen.findByRole('button', { name: /Editar/ })
    await waitFor(() => expect((editar as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(editar)
    return screen.findByRole('button', { name: /Guardar cambios/ }) as Promise<HTMLButtonElement>
  }

  it('horas negativas → aviso claro, «Guardar cambios» deshabilitado y no guarda; al corregir se habilita', async () => {
    const guardar = await abrirEdicion()
    expect(guardar.disabled).toBe(false)
    const horas = screen.getAllByDisplayValue('8')[0]
    fireEvent.change(horas, { target: { value: '-4' } })
    expect((await screen.findByTestId('aviso-negativos')).textContent).toMatch(/^⚠ Las horas no pueden ser negativas: revisá a Empleado [ABC]\.$/)
    expect(guardar.disabled).toBe(true)
    fireEvent.click(guardar)
    expect(H.savePayouts).not.toHaveBeenCalled()
    fireEvent.change(horas, { target: { value: '4' } })
    await waitFor(() => expect(screen.queryByTestId('aviso-negativos')).toBeNull())
    expect(guardar.disabled).toBe(false)
  })

  it('una persona marcada con 0 horas → mensaje claro al guardar (no el error del CHECK) y no escribe', async () => {
    const guardar = await abrirEdicion()
    fireEvent.change(screen.getAllByDisplayValue('8')[0], { target: { value: '0' } })
    fireEvent.click(guardar)
    expect(await screen.findByText(/^Empleado [ABC] está marcado con 0 horas: cargale las horas que trabajó o desmarcalo\.$/)).toBeTruthy()
    expect(H.upsertTipEntry).not.toHaveBeenCalled()
    expect(H.savePayouts).not.toHaveBeenCalled()
  })

  it('efectivo del pozo negativo → aviso y no guarda', async () => {
    const guardar = await abrirEdicion()
    fireEvent.change(screen.getByDisplayValue('60000'), { target: { value: '-100' } })
    expect((await screen.findByTestId('aviso-negativos')).textContent).toBe('⚠ Los montos no pueden ser negativos: revisá «💵 Efectivo ₡».')
    expect(guardar.disabled).toBe(true)
  })
})
