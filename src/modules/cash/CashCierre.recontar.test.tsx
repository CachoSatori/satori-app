// @vitest-environment happy-dom
//
// «Recontar» UNA vez en el cierre del día (decisión del dueño, 05/11 · columnas de la mig 074):
//   · el esperado y la verificación se ven EN VIVO (sin conteo ciego);
//   · dentro de tolerancia (₡500 / US$1): sin pasos extra, primer_conteo null;
//   · fuera: al pedir el cierre se ofrece recontar una vez (se guarda el primer conteo y el conteo
//     queda en blanco); si sigue fuera — o se elige no recontar — el motivo es obligatorio.
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
const confirmarResumen = async () => {
  fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
  await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
  return api.cerrarDiaCompleto.mock.calls[0][0] as { cierre: Record<string, unknown>; ajuste: Record<string, unknown> }
}
const preparar = async () => {
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Revisar resumen y cerrar el día/)
  setMonto(montos()[0], 100000)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turnoCerrado])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día — «Recontar» una vez', () => {
  it('la verificación se ve en vivo, sin confirmar nada', async () => {
    await preparar(); contar(100200)
    expect(screen.getByText(/Debería quedar en Caja Fuerte/)).toBeTruthy()
    expect(screen.getByText(/Cuadra correctamente/)).toBeTruthy()
    expect(screen.queryByText(/Confirmar conteo/)).toBeNull()
  })

  it('dentro de tolerancia: directo al resumen, sin oferta, primer_conteo null', async () => {
    await preparar(); contar(100200)                          // +₡200
    expect(botonCierre().disabled).toBe(false)
    fireEvent.click(botonCierre())
    expect(screen.queryByText(/El conteo no cuadra/)).toBeNull()
    const p = await confirmarResumen()
    expect(p.cierre).toMatchObject({ diferencia_crc: 200, primer_conteo_crc: null, primer_conteo_usd: null })
    expect(p.ajuste).toMatchObject({ crc: 0, usd: 0 })
  })

  it('fuera → la diferencia se ve en vivo y el motivo todavía no se pide; al cerrar se ofrece recontar', async () => {
    await preparar(); contar(101500)                          // +₡1.500
    expect(screen.getByText(/al cerrar vas a poder recontar una vez/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('Descripción obligatoria…')).toBeNull()
    expect(botonCierre().disabled).toBe(false)
    fireEvent.click(botonCierre())
    expect(screen.getByText(/El conteo no cuadra/)).toBeTruthy()
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
  })

  it('fuera → Recontar → cuadra → cierra sin motivo y guarda el primer conteo', async () => {
    await preparar(); contar(101500)
    fireEvent.click(botonCierre())
    fireEvent.click(screen.getByText(/↺ Recontar/))
    expect(montos()[7].value).toBe('')                        // conteo en blanco
    expect(montos()[0].value).toBe('100000')                  // ventas de noche quedan
    expect(screen.getByText(/el primer conteo/)).toBeTruthy()
    contar(100000)
    fireEvent.click(botonCierre())
    expect(screen.queryByText(/El conteo no cuadra/)).toBeNull()
    const p = await confirmarResumen()
    expect(p.cierre).toMatchObject({ diferencia_crc: 0, primer_conteo_crc: 101500, primer_conteo_usd: 0 })
    expect(p.ajuste).toMatchObject({ crc: 0 })
  })

  it('fuera → Recontar → sigue fuera → sin segunda oferta, motivo obligatorio → ajuste + primer conteo', async () => {
    await preparar(); contar(98000)                           // −₡2.000
    fireEvent.click(botonCierre())
    fireEvent.click(screen.getByText(/↺ Recontar/))
    contar(98500)                                             // −₡1.500: sigue fuera
    expect(screen.getByText(/Diferencia detectada — registrá el motivo/)).toBeTruthy()
    expect(botonCierre().disabled).toBe(true)                 // sin motivo no cierra
    fireEvent.change(screen.getByPlaceholderText('Descripción obligatoria…'), { target: { value: 'faltó cambio' } })
    fireEvent.click(botonCierre())
    expect(screen.queryByText(/El conteo no cuadra/)).toBeNull()   // un solo reconteo
    const p = await confirmarResumen()
    expect(p.cierre).toMatchObject({ diferencia_crc: -1500, ajuste_tipo: 'Faltante', primer_conteo_crc: 98000 })
    expect(p.ajuste).toMatchObject({ crc: -1500, motivo: 'faltó cambio' })
  })

  it('fuera → «No recontar» → motivo obligatorio → cierra con primer_conteo null', async () => {
    await preparar(); contar(98000)
    fireEvent.click(botonCierre())
    fireEvent.click(screen.getByText(/No recontar/))
    expect(botonCierre().disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Descripción obligatoria…'), { target: { value: 'sin cambio' } })
    fireEvent.click(botonCierre())
    const p = await confirmarResumen()
    expect(p.cierre).toMatchObject({ diferencia_crc: -2000, primer_conteo_crc: null, primer_conteo_usd: null })
    expect(p.ajuste).toMatchObject({ crc: -2000, motivo: 'sin cambio' })
  })
})
