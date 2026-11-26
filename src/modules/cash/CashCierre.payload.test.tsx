// @vitest-environment happy-dom
//
// Caja PR 3/4 (ronda del verificador): el payload que se manda a `cerrarDiaCompleto` es IDÉNTICO al de antes del PR
// (main 7db63e0) en todos los casos de la diferencia: el PR solo cambia cómo se muestra. Los objetos de abajo se
// sacaron corriendo ESTE mismo archivo contra el CashCierre.tsx de main; si un cambio de presentación tocara lo
// que se guarda, cae acá. Solo se ignora `client_op_id` (UUID nuevo por cierre). Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
  cerrarDiaCompleto:   vi.fn(async (payload: Record<string, unknown>) => { void payload; return { cierre_id: 'c1', idempotente: false } }),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  saveCierreParcial:   vi.fn(async () => ({})),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
// Fase 1 sellada con US$10 → debería US$10; en colones el debería es la venta de noche (pozo vacío).
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Prueba', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 10, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia
const turno = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Cajero' } as CashSession

// [0]=Ventas noche ₡ · [7]=Remanente CF ₡ · [8]=Remanente CF $ (mismo orden que CashCierre.recontar.test.tsx)
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const bloque = (b: string) => document.querySelector(`[data-bloque="${b}"]`) as HTMLElement | null
const botonCierre = () => screen.getByText(/Revisar resumen y cerrar el día/) as HTMLButtonElement

const contar = async (crc: number, usd: number) => {
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Revisar resumen y cerrar el día/)
  setMonto(montos()[0], 100000)
  fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))
  setMonto(montos()[7], crc)
  setMonto(montos()[8], usd)
}
// Fuera de tolerancia: «No recontar» → motivo → resumen. Dentro: directo al resumen.
const abrirResumen = () => {
  fireEvent.click(botonCierre())
  if (screen.queryByText(/El conteo no cuadra/)) {
    fireEvent.click(screen.getByText(/No recontar/))
    fireEvent.change(screen.getByPlaceholderText('Ej.: vuelto mal dado en una mesa'), { target: { value: 'vuelto mal dado' } })
    fireEvent.click(botonCierre())
  }
  return bloque('resumen-diferencia')!
}



const payload = async () => {
  fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
  await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
  const { client_op_id, ...resto } = api.cerrarDiaCompleto.mock.calls[0][0] as Record<string, unknown>
  expect(typeof client_op_id).toBe('string')
  return resto
}
const cierreBase = {
  vn_crc: 100000, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 100000,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  notas: 'Sin novedades', tipo_cambio: 600, primer_conteo_crc: null, primer_conteo_usd: null,
}
const esperado = (remCrc: number, remUsd: number, dif: number, tipo: string, motivo: string, ajCrc: number, ajUsd: number) => ({
  fecha: HOY, exchange_rate: 600,
  cierre: { ...cierreBase, remanente_crc: remCrc, remanente_usd: remUsd, diferencia_crc: dif, ajuste_tipo: tipo, ajuste_motivo: motivo },
  ventas: { mediodia: { crc: 0, usd: 10 }, noche: { crc: 100000, usd: 0 } },
  retiro_crc: 0,
  ajuste: { crc: ajCrc, usd: ajUsd, motivo },
})

beforeEach(() => {
  cleanup(); vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turno])
  api.getAllCashMovements.mockResolvedValue([])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('payload a cerrarDiaCompleto: idéntico al de main en cada caso', () => {
  const casos: [string, number, number, ReturnType<typeof esperado>][] = [
    ['faltan las dos',                    98049,  8,   esperado(98049,  8,   -1951, 'Faltante', 'vuelto mal dado', -1951, -2)],
    ['sobran colones, dólares cuadran',   102300, 10,  esperado(102300, 10,  2300,  'Sobrante', 'vuelto mal dado', 2300,  0)],
    ['colones fuera, dólares dentro ≠ 0', 98049,  9.5, esperado(98049,  9.5, -1951, 'Faltante', 'vuelto mal dado', -1951, 0)],
    ['mezclado: faltan ₡, sobran $',      98049,  13.5,esperado(98049,  13.5,-1951, 'Faltante', 'vuelto mal dado', -1951, 3.5)],
    ['solo dólares fuera (sobran)',       100000, 13.5,esperado(100000, 13.5, 0,    'Sobrante', 'vuelto mal dado', 0,     3.5)],
    ['dentro de tolerancia',              99700,  10,  esperado(99700,  10,  -300,  '',         '',                0,     0)],
  ]
  for (const [nombre, crc, usd, exp] of casos) {
    it(nombre, async () => {
      await contar(crc, usd)
      abrirResumen()
      const p = await payload()
      if (process.env.VOLCAR_PAYLOAD) console.log('PAYLOAD', nombre, JSON.stringify(p))
      expect(p).toEqual(exp)
    })
  }
})
