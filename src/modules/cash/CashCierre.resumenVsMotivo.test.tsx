// @vitest-environment happy-dom
//
// «Resumen del día» ≠ motivo de la diferencia (21-nov):
//   · el resumen se ve ANTES del conteo físico y de la diferencia/ajuste;
//   · el motivo se llama «¿Por qué hubo diferencia? *», es corto (maxLength 160) y tiene contador x/160;
//   · si el cierre pide motivo y el resumen y el motivo son el mismo texto (normalizado), no cierra;
//   · «Sin novedades» con un motivo real cierra normal. Los montos y la RPC no cambian.
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

const AVISO_IGUALES = 'El resumen del día y el motivo de la diferencia tienen que ser distintos'
// [0]=Ventas noche ₡ · [7]=Remanente CF ₡ (ver CashCierre.recontar.test.tsx)
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const botonCierre = () => screen.getByText(/Revisar resumen y cerrar el día/) as HTMLButtonElement
const resumen = () => screen.getByRole('textbox', { name: 'Resumen del día' }) as HTMLTextAreaElement
const motivo = () => screen.getByPlaceholderText('Ej.: vuelto mal dado en una mesa') as HTMLInputElement
const escribir = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

// Ventas de noche ₡100.000 y conteo ₡98.000 (−₡2.000, fuera de tolerancia) → «No recontar» → se pide el motivo.
const prepararConDiferencia = async () => {
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Revisar resumen y cerrar el día/)
  setMonto(montos()[0], 100000)
  setMonto(montos()[7], 98000)
  escribir(resumen(), 'Noche tranquila')
  fireEvent.click(botonCierre())
  fireEvent.click(screen.getByText(/No recontar/))
}
const confirmar = async () => {
  fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
  await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
  return api.cerrarDiaCompleto.mock.calls[0][0] as { cierre: Record<string, unknown>; ajuste: Record<string, unknown> }
}
const antes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turnoCerrado])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día — resumen del día y motivo de la diferencia, separados', () => {
  it('el resumen está ANTES del conteo físico, de la diferencia y del motivo; con el placeholder nuevo', async () => {
    await prepararConDiferencia()
    const conteo = screen.getByText('Conteo físico — separaciones')
    const diferencia = screen.getByText(/Diferencia detectada — registrá el motivo/)
    expect(antes(resumen(), conteo)).toBe(true)
    expect(antes(resumen(), diferencia)).toBe(true)
    expect(antes(resumen(), motivo())).toBe(true)
    expect(antes(motivo(), botonCierre())).toBe(true)
    expect(resumen().placeholder).toBe('Qué pasó hoy: quejas, personal, 86, mantenimiento… (la diferencia va aparte)')
  })

  it('el motivo: etiqueta nueva, maxLength 160 y contador x/160', async () => {
    await prepararConDiferencia()
    expect(screen.getByText('¿Por qué hubo diferencia? *')).toBeTruthy()
    expect(screen.queryByText('Motivo *')).toBeNull()
    expect(motivo().maxLength).toBe(160)
    expect(screen.getByLabelText('Caracteres del motivo').textContent).toBe('0/160')
    escribir(motivo(), 'Vuelto mal dado')
    expect(screen.getByLabelText('Caracteres del motivo').textContent).toBe('15/160')
  })

  it('resumen = motivo (mayúsculas, espacios y saltos distintos) → aviso, no abre el resumen ni llama a la RPC', async () => {
    await prepararConDiferencia()
    escribir(resumen(), 'Faltó cambio\nen la mesa 4')
    escribir(motivo(), '  faltó   CAMBIO en la mesa 4 ')
    expect(screen.getByText(AVISO_IGUALES)).toBeTruthy()
    expect(botonCierre().disabled).toBe(true)
    fireEvent.click(botonCierre())
    expect(screen.queryByText('Resumen del cierre del día')).toBeNull()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('al cambiar uno de los dos, el aviso se va y cierra; cada texto viaja en su campo', async () => {
    await prepararConDiferencia()
    escribir(resumen(), 'Faltó cambio')
    escribir(motivo(), 'Faltó cambio')
    expect(screen.getByText(AVISO_IGUALES)).toBeTruthy()
    escribir(resumen(), 'Llegó tarde un proveedor')
    expect(screen.queryByText(AVISO_IGUALES)).toBeNull()
    expect(botonCierre().disabled).toBe(false)
    fireEvent.click(botonCierre())
    const p = await confirmar()
    expect(p.cierre).toMatchObject({ notas: 'Llegó tarde un proveedor', ajuste_motivo: 'Faltó cambio', ajuste_tipo: 'Faltante', diferencia_crc: -2000 })
    expect(p.ajuste).toMatchObject({ crc: -2000, motivo: 'Faltó cambio' })
  })

  it('«Sin novedades» en el resumen + un motivo real → cierra', async () => {
    await prepararConDiferencia()
    fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))
    escribir(motivo(), 'Vuelto mal dado en una mesa')
    expect(screen.queryByText(AVISO_IGUALES)).toBeNull()
    fireEvent.click(botonCierre())
    const p = await confirmar()
    expect(p.cierre).toMatchObject({ notas: 'Sin novedades', ajuste_motivo: 'Vuelto mal dado en una mesa' })
  })

  it('con el modal abierto, si el motivo pasa a ser igual al resumen, «CONFIRMAR» no cierra', async () => {
    await prepararConDiferencia()
    escribir(motivo(), 'Vuelto mal dado')
    fireEvent.click(botonCierre())
    const btn = (await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/)) as HTMLButtonElement
    escribir(motivo(), 'noche   TRANQUILA')   // el campo sigue en la pantalla debajo del modal
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    await new Promise(r => setTimeout(r, 0))
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
  })

  it('sin diferencia (cuadra) no se pide motivo y el chequeo no aplica', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    setMonto(montos()[0], 100000)
    setMonto(montos()[7], 100000)
    escribir(resumen(), 'Noche tranquila')
    expect(screen.queryByPlaceholderText('Ej.: vuelto mal dado en una mesa')).toBeNull()
    fireEvent.click(botonCierre())
    const p = await confirmar()
    expect(p.cierre).toMatchObject({ notas: 'Noche tranquila', ajuste_motivo: '' })
  })
})
