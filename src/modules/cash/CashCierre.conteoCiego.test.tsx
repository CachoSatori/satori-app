// @vitest-environment happy-dom
//
// Conteo CIEGO en el cierre del día (decisión de Ismael, 05/11 · mig 074):
//   · antes de «Confirmar conteo»: solo la tabla de separaciones y el total — ni el esperado ni
//     la diferencia; el botón de cierre deshabilitado;
//   · al confirmar: se bloquean los campos de la Fase 2 y aparece la verificación;
//   · fuera de tolerancia → UN reconteo (se guarda el primer conteo) → si sigue fuera, motivo;
//   · la tolerancia (₡500 / US$1), requiresAjuste y cuadra/cuadraUSD NO cambian.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:     vi.fn(async () => [] as unknown[]),
  getCashSessions:   vi.fn(async () => [] as unknown[]),
  // El payload se lee después desde mock.calls (de ahí el parámetro tipado y sin usar acá).
  cerrarDiaCompleto: vi.fn(async (payload: Record<string, unknown>) => { void payload; return { cierre_id: 'c1', idempotente: false } }),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  getAllCashMovements: vi.fn(async () => []),
  saveCierreParcial:   vi.fn(async () => ({})),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Dueña' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
// Fase 1 sellada en ceros → el esperado de la Fase 2 = ventas de noche (pozo vacío).
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia
const turnoCerrado = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Ana' } as CashSession

// [0]=Ventas noche ₡ · [1]=$ · [2]=Retiro ₡ · [3..8]=separaciones (Caja Diaria 3/4 · Registradora 5/6 · Remanente CF 7/8)
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const contar = (remanente: number) => setMonto(montos()[7], remanente)
const botonCierre = () => screen.getByText(/Revisar resumen y cerrar el día/) as HTMLButtonElement
const cerrar = async () => {
  fireEvent.click(botonCierre())
  fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
  await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
  return api.cerrarDiaCompleto.mock.calls[0][0] as { cierre: Record<string, unknown>; ajuste: Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turnoCerrado])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día — conteo ciego', () => {
  it('antes de confirmar: no se ven el esperado ni la diferencia, y no se puede cerrar', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000); contar(100000)
    expect(screen.queryByText(/Debería quedar/)).toBeNull()
    expect(screen.queryByText(/Cuadra correctamente|Diferencia ₡/)).toBeNull()
    expect(screen.queryByText(/Diferencia detectada/)).toBeNull()
    expect(screen.getByText(/El esperado y la diferencia se muestran después de confirmar/)).toBeTruthy()
    expect(botonCierre().disabled).toBe(true)
  })

  it('dentro de tolerancia: confirmar → verificación visible, campos bloqueados, cierra con primer_conteo null', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000); contar(100200)            // +₡200: dentro de ₡500
    fireEvent.click(screen.getByText(/Confirmar conteo/))
    expect(screen.getByText(/Debería quedar en Caja Fuerte/)).toBeTruthy()
    expect(screen.getByText(/Cuadra correctamente/)).toBeTruthy()
    expect(montos()[0].disabled).toBe(true)                   // ventas noche
    expect(montos()[2].disabled).toBe(true)                   // retiro
    expect(montos()[7].disabled).toBe(true)                   // conteo
    expect(screen.queryByText(/Recontar/)).toBeNull()
    const p = await cerrar()
    expect(p.cierre).toMatchObject({ diferencia_crc: 200, primer_conteo_crc: null, primer_conteo_usd: null })
    expect(p.ajuste).toMatchObject({ crc: 0, usd: 0 })
  })

  it('fuera de tolerancia → Recontar (sin motivo todavía) → cuadra → guarda el primer conteo', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000); contar(101500)            // +₡1.500: fuera
    fireEvent.click(screen.getByText(/Confirmar conteo/))
    expect(screen.getByText(/El conteo no cuadra — volvé a contar una vez/)).toBeTruthy()
    expect(screen.queryByText(/Diferencia detectada/)).toBeNull()   // el motivo recién después del reconteo
    expect(botonCierre().disabled).toBe(true)
    fireEvent.click(screen.getByText(/Recontar/))
    expect(montos()[7].value).toBe('')                        // conteo en blanco
    expect(montos()[7].disabled).toBe(false)
    expect(montos()[0].value).toBe('100000')                  // ventas de noche quedan
    expect(screen.queryByText(/Debería quedar/)).toBeNull()   // ciego otra vez
    expect(screen.getByText(/el primer conteo/)).toBeTruthy()
    contar(100000)
    fireEvent.click(screen.getByText(/Confirmar conteo/))
    expect(screen.getByText(/Cuadra correctamente/)).toBeTruthy()
    expect(screen.queryByText(/Recontar/)).toBeNull()         // un solo reconteo
    const p = await cerrar()
    expect(p.cierre).toMatchObject({ diferencia_crc: 0, primer_conteo_crc: 101500, primer_conteo_usd: 0 })
  })

  it('fuera de tolerancia que sigue fuera tras recontar → motivo obligatorio → ajuste + primer conteo', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000); contar(98000)             // −₡2.000
    fireEvent.click(screen.getByText(/Confirmar conteo/))
    fireEvent.click(screen.getByText(/Recontar/))
    contar(98500)                                             // −₡1.500: sigue fuera
    fireEvent.click(screen.getByText(/Confirmar conteo/))
    expect(screen.queryByText(/Recontar/)).toBeNull()
    expect(screen.getByText(/Diferencia detectada — registrá el motivo/)).toBeTruthy()
    expect(botonCierre().disabled).toBe(true)                 // sin motivo no cierra
    fireEvent.change(screen.getByPlaceholderText('Descripción obligatoria…'), { target: { value: 'faltó cambio' } })
    expect(botonCierre().disabled).toBe(false)
    const p = await cerrar()
    expect(p.cierre).toMatchObject({ diferencia_crc: -1500, ajuste_tipo: 'Faltante', primer_conteo_crc: 98000 })
    expect(p.ajuste).toMatchObject({ crc: -1500, motivo: 'faltó cambio' })
  })
})
