// @vitest-environment happy-dom
// Mismo caso de la validación física del dueño (23-nov-2026), en «Historial → ✏ Editar»: los cuadros traen lo
// guardado («0»), se tipea «-450» / «-200» detrás y el navegador deja «0-450» a la vista con `value` "".
// Antes se validaba y se guardaba 0; ahora «Guardar cambios» queda deshabilitado con el aviso que nombra a la
// persona. Datos ficticios.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Employee, RoleTipPoints, TipSession } from '../../shared/types/database'
import { imitarInputNumeroDeChrome, textoVisible } from './inputNumeroComoChrome.testutil'

const H = vi.hoisted(() => ({
  savePayouts: vi.fn(async () => {}),
  upsertTipEntry: vi.fn(async () => {}),
  updateSessionPools: vi.fn(async () => {}),
}))
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async () => [ent('a'), ent('b')]),
  upsertTipEntry: H.upsertTipEntry, deleteTipEntry: vi.fn(async () => {}), updateSessionPools: H.updateSessionPools,
  savePayouts: H.savePayouts,
  totalElectronicoCrc: vi.fn(() => 0),
}))
vi.mock('../../shared/api/cash', () => ({ reconcilePropinaEgreso: vi.fn(async () => {}) }))

import TipHistory from './TipHistory'

const ent = (id: string) =>
  ({ id: `t-${id}`, session_id: 's1', employee_id: id, hours_worked: 8, tip_amount_crc: 0, tip_amount_usd: 0, points: 80, payout_crc: 30000, covered_role: null })
const ses = {
  id: 's1', session_date: '2026-08-20', shift_type: 'PM', status: 'closed', exchange_rate: 500,
  pool_efectivo_crc: 60000, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, pool_total_crc: 60000,
} as unknown as TipSession
const EMPS = [
  { id: 'a', full_name: 'Ana Sala', role: 'salonero', is_active: true },
  { id: 'b', full_name: 'Beto Sala', role: 'salonero', is_active: true },
] as unknown as Employee[]
const PUNTOS = [{ role: 'salonero', points: 10 }] as unknown as RoleTipPoints[]

// Inputs numéricos de la fila de una persona en la edición: [horas, electrónico ₡, electrónico $].
// (El nombre también sale en la lista detrás del modal: se toma la fila que tiene esos 3 cuadros.)
const inputsDe = (nombre: string) => {
  for (const n of screen.getAllByText(nombre)) {
    let fila: HTMLElement | null = n.parentElement
    for (let i = 0; fila && i < 4; i++, fila = fila.parentElement) {
      const ins = fila.querySelectorAll('input[type="number"]')
      if (ins.length === 3) return [...ins] as HTMLInputElement[]
      if (ins.length > 3) break
    }
  }
  throw new Error(`sin fila de edición para ${nombre}`)
}
const aviso = () => screen.queryByTestId('aviso-negativos')?.textContent ?? null

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

async function abrirEdicion(u: ReturnType<typeof userEvent.setup>) {
  render(<TipHistory sessions={[ses]} employees={EMPS} rolePoints={PUNTOS} isManager />)
  await u.click(screen.getByTitle('Ver detalle y acciones'))
  const editar = await screen.findByRole('button', { name: /Editar/ }) as HTMLButtonElement
  await waitFor(() => expect(editar.disabled).toBe(false))
  await u.click(editar)
  return screen.findByRole('button', { name: /Guardar cambios/ }) as Promise<HTMLButtonElement>
}

describe('Historial → ✏ Editar · lo que se ve es lo que se valida (caso del dueño, 23-nov)', () => {
  it('-450 en ₡ de una persona, -200 en $ de otra, -500 en Efectivo $ → corregir solo Efectivo $ → sigue el aviso con el nombre y no guarda', async () => {
    const u = userEvent.setup()
    const guardar = await abrirEdicion(u)
    expect(guardar.disabled).toBe(false)
    const crcAna = inputsDe('Ana Sala')[1]
    const usdBeto = inputsDe('Beto Sala')[2]
    const efUSD = screen.getAllByRole('spinbutton')[1] as HTMLInputElement      // 💵 Efectivo $ (vacío)
    expect(textoVisible(crcAna)).toBe('0')
    await u.type(crcAna, '-450')
    await u.type(usdBeto, '-200')
    await u.type(efUSD, '-500')
    expect(textoVisible(crcAna)).toBe('0-450')
    expect(textoVisible(usdBeto)).toBe('0-200')
    expect(aviso()).toBe('⚠ Los montos no pueden ser negativos: revisá «💵 Efectivo $».')
    expect(guardar.disabled).toBe(true)

    await u.clear(efUSD)
    await u.type(efUSD, '500')
    await waitFor(() => expect(aviso()).toMatch(/propina ₡ de Ana Sala/))
    expect(guardar.disabled).toBe(true)
    await u.click(guardar)
    expect(H.upsertTipEntry).not.toHaveBeenCalled()
    expect(H.savePayouts).not.toHaveBeenCalled()

    await u.clear(crcAna)
    await u.type(crcAna, '450')
    await waitFor(() => expect(aviso()).toMatch(/propina \$ de Beto Sala/))
    expect(guardar.disabled).toBe(true)

    await u.clear(usdBeto)
    await u.type(usdBeto, '2')
    await waitFor(() => expect(aviso()).toBeNull())
    expect(guardar.disabled).toBe(false)
  })

  it('horas «8-» a la vista → aviso con el nombre y no guarda', async () => {
    const u = userEvent.setup()
    const guardar = await abrirEdicion(u)
    const horasBeto = inputsDe('Beto Sala')[0]
    await u.type(horasBeto, '-')
    expect(textoVisible(horasBeto)).toBe('8-')
    await waitFor(() => expect(aviso()).toMatch(/horas de Beto Sala/))
    expect(guardar.disabled).toBe(true)
  })
})
