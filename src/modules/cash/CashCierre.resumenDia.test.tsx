// @vitest-environment happy-dom
//
// «Resumen del día» en el cierre (decisión del dueño, 20-nov):
//   · reemplaza al campo «Notas del cierre», arriba del botón de cerrar; usa la MISMA columna `notas`;
//   · 5 botones de tema (Queja · Personal · Emergencia · 86 · Mantenimiento) agregan «Tema: » en una
//     línea nueva y dejan el foco en el cuadro; «Sin novedades» deja ese texto exacto;
//   · OBLIGATORIO: vacío (o solo espacios) → el botón de cerrar queda deshabilitado y se ve el aviso.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:     vi.fn(async () => [] as unknown[]),
  getCashSessions:   vi.fn(async () => [] as unknown[]),
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
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'

const HOY = todayStr()
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Prueba', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia
const turnoCerrado = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Prueba' } as CashSession

const AVISO = 'Escribí el resumen del día o tocá Sin novedades'
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const botonCierre = () => screen.getByText(/Revisar resumen y cerrar el día/) as HTMLButtonElement
const cuadro = () => screen.getByRole('textbox', { name: 'Resumen del día' }) as HTMLTextAreaElement
const tocar = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))

// Todo listo para cerrar (ventas de noche + conteo que cuadra), MENOS el resumen.
const preparar = async () => {
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Revisar resumen y cerrar el día/)
  setMonto(montos()[0], 100000)
  setMonto(montos()[7], 100000)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turnoCerrado])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día — «Resumen del día» obligatorio', () => {
  it('el título es «Resumen del día» (ya no «Notas del cierre») y tiene los 6 botones', async () => {
    await preparar()
    expect(screen.queryByText('Notas del cierre')).toBeNull()
    expect(cuadro().tagName).toBe('TEXTAREA')
    for (const b of ['Queja', 'Personal', 'Emergencia', '86', 'Mantenimiento', 'Sin novedades']) {
      expect(screen.getByRole('button', { name: b })).toBeTruthy()
    }
  })

  it('vacío → botón deshabilitado + aviso; no abre el resumen ni llama a la RPC', async () => {
    await preparar()
    expect(cuadro().value).toBe('')
    expect(botonCierre().disabled).toBe(true)
    expect(screen.getByText(AVISO)).toBeTruthy()
    fireEvent.click(botonCierre())
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('solo espacios y saltos de línea cuenta como vacío', async () => {
    await preparar()
    fireEvent.change(cuadro(), { target: { value: '   \n  ' } })
    expect(botonCierre().disabled).toBe(true)
    expect(screen.getByText(AVISO)).toBeTruthy()
  })

  it('al escribir algo se habilita y el aviso se va', async () => {
    await preparar()
    fireEvent.change(cuadro(), { target: { value: 'Noche tranquila' } })
    expect(botonCierre().disabled).toBe(false)
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  it('«Sin novedades» deja ese texto exacto y habilita el cierre', async () => {
    await preparar()
    tocar('Sin novedades')
    expect(cuadro().value).toBe('Sin novedades')
    expect(botonCierre().disabled).toBe(false)
  })

  it('un tema agrega «Tema: » en una línea nueva y deja el foco en el cuadro', async () => {
    await preparar()
    tocar('Queja')
    expect(cuadro().value).toBe('Queja: ')
    await waitFor(() => expect(document.activeElement).toBe(cuadro()))
    fireEvent.change(cuadro(), { target: { value: 'Queja: demora en mesa 3' } })
    tocar('86')
    expect(cuadro().value).toBe('Queja: demora en mesa 3\n86: ')
    tocar('Mantenimiento')
    expect(cuadro().value).toBe('Queja: demora en mesa 3\n86:\nMantenimiento: ')
  })

  it('cada uno de los 5 temas escribe su propia etiqueta', async () => {
    await preparar()
    for (const t of ['Personal', 'Emergencia']) tocar(t)
    expect(cuadro().value).toBe('Personal:\nEmergencia: ')
  })

  it('el resumen viaja en `notas` (sin espacios de los bordes) a la RPC de siempre', async () => {
    await preparar()
    tocar('Personal')
    fireEvent.change(cuadro(), { target: { value: cuadro().value + 'faltó un salonero  ' } })
    fireEvent.click(botonCierre())
    expect(screen.getByText(/Resumen del día: Personal: faltó un salonero/)).toBeTruthy()
    fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
    await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
    const p = api.cerrarDiaCompleto.mock.calls[0][0] as { cierre: Record<string, unknown> }
    expect(p.cierre.notas).toBe('Personal: faltó un salonero')
  })
})
